import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readTextIfExists(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""; } catch { return ""; }
}

function getDbUrl() {
  const envUrl = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (envUrl) return envUrl.replace(/^\uFEFF/, "").trim();

  const w = readTextIfExists(path.join(__dirname, "neon.local.txt")).trim();
  if (w) return w.replace(/^\uFEFF/, "").trim();

  const r = readTextIfExists(path.join(__dirname, "..", "neon.local.txt")).trim();
  if (r) return r.replace(/^\uFEFF/, "").trim();

  throw new Error("No DATABASE_URL/NEON_DATABASE_URL and no neon.local.txt found (worker/ or repo root).");
}

function normLabel(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) out.file = args[i + 1];
  }
  return out;
}

async function main() {
  const { file } = parseArgs();
  const repoRoot = path.join(__dirname, "..");
  const defaultInputPath = path.join(repoRoot, "data", "locations.json");
  const inputPath = file
    ? path.isAbsolute(file)
      ? file
      : path.join(repoRoot, file)
    : fs.existsSync(defaultInputPath)
      ? defaultInputPath
      : null;

  const dbUrl = getDbUrl();
  const client = new pg.Client({ connectionString: dbUrl });

  await client.connect();
  console.log("Connected to DB.");

  try {
    await client.query("BEGIN");

    // 1) Импорт регионов из существующей таблицы regions (минимум, чтобы автокомплит работал сразу)
    const regions = await client.query(`SELECT slug, label FROM regions WHERE is_active=true ORDER BY label ASC`);
    for (const r of regions.rows) {
      await client.query(
        `
        INSERT INTO locations (kind, slug, label, label_norm)
        VALUES ('region', $1::text, $2::text, $3::text)
        ON CONFLICT (slug) DO UPDATE
          SET kind=EXCLUDED.kind, label=EXCLUDED.label, label_norm=EXCLUDED.label_norm
        `,
        [r.slug, r.label, normLabel(r.label)]
      );
    }
    console.log(`Upserted regions into locations: ${regions.rowCount}`);

    // 2) Опциональный импорт дополнительных узлов (районы/города) из JSON
    // Формат: [{kind,slug,label,parentSlug}]
    if (inputPath) {
      if (!fs.existsSync(inputPath)) throw new Error(`locations file not found: ${inputPath}`);

      const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) throw new Error("locations.json must be an array");

      const allowedKinds = new Set(["region", "district", "city", "settlement"]);
      const rows = items.map((x, idx) => {
        const kind = String(x.kind || "").trim();
        const slug = String(x.slug || "").trim();
        const label = String(x.label || "").trim();
        const parentSlug = x.parentSlug == null ? null : String(x.parentSlug).trim();
        if (!kind || !slug || !label) throw new Error(`invalid item at index ${idx}: kind/slug/label required`);
        if (!allowedKinds.has(kind)) throw new Error(`invalid kind at index ${idx}: ${kind}`);
        return { kind, slug, label, label_norm: normLabel(label), parentSlug };
      });

      for (const r of rows) {
        await client.query(
          `
          INSERT INTO locations (kind, slug, label, label_norm)
          VALUES ($1::text, $2::text, $3::text, $4::text)
          ON CONFLICT (slug) DO UPDATE
            SET kind=EXCLUDED.kind, label=EXCLUDED.label, label_norm=EXCLUDED.label_norm
          `,
          [r.kind, r.slug, r.label, r.label_norm]
        );
      }

      // parent_id по parentSlug
      const rel = rows
        .filter((x) => x.parentSlug)
        .map((x) => ({ child: x.slug, parent: x.parentSlug }));
      for (const x of rel) {
        await client.query(
          `
          UPDATE locations c
          SET parent_id = p.id
          FROM locations p
          WHERE c.slug=$1::text AND p.slug=$2::text
          `,
          [x.child, x.parent]
        );
      }
      await client.query(
        `
        UPDATE locations c
        SET parent_id = NULL
        WHERE c.slug = ANY($1::text[]) AND c.kind='region'
        `,
        [rows.filter((x) => x.kind === "region").map((x) => x.slug)]
      );

      console.log(`Imported extra nodes from JSON: ${rows.length}`);
    }

    // 3) Пересчёт region_id и ancestor_ids по дереву
    await client.query(`
      WITH RECURSIVE walk AS (
        SELECT
          id,
          kind,
          parent_id,
          CASE WHEN kind='region' THEN id ELSE NULL END AS region_id,
          ARRAY[]::bigint[] AS ancestors
        FROM locations
        WHERE parent_id IS NULL

        UNION ALL

        SELECT
          l.id,
          l.kind,
          l.parent_id,
          CASE WHEN l.kind='region' THEN l.id ELSE w.region_id END AS region_id,
          w.ancestors || w.id AS ancestors
        FROM locations l
        JOIN walk w ON l.parent_id = w.id
      )
      UPDATE locations t
      SET region_id = w.region_id,
          ancestor_ids = w.ancestors
      FROM walk w
      WHERE t.id = w.id
    `);

    // 4) Привязка существующих организаций к location_id на уровне региона (чтобы locationId фильтр начал работать сразу)
    await client.query(`
      UPDATE organization_profiles p
      SET location_id = loc.id
      FROM organizations o
      JOIN regions r ON r.id = o.region_id
      JOIN locations loc ON loc.kind='region' AND loc.slug = r.slug
      WHERE p.org_id = o.id AND p.location_id IS NULL
    `);

    await client.query("COMMIT");
    console.log("OK: locations imported, computed, org profiles bound to region locations.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e?.message || e);
  process.exit(1);
});
