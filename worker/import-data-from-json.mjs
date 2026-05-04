/**
 * Заливает data/regions.json и data/catalog.json в Postgres (Neon и т.д.).
 * Строка: NEON_DATABASE_URL или DATABASE_URL (как в .dev.vars).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readNeonLocalFile() {
  const p = path.join(root, "neon.local.txt");
  if (!fs.existsSync(p)) return null;
  const line = fs
    .readFileSync(p, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("postgres://") || l.startsWith("postgresql://"));
  return line || null;
}

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  readNeonLocalFile();
if (!connectionString) {
  console.error(
    "Нужен NEON_DATABASE_URL / DATABASE_URL или файл neon.local.txt в корне проекта (одна строка URI)."
  );
  process.exit(1);
}

const regionsPath = path.join(root, "data", "regions.json");
const catalogPath = path.join(root, "data", "catalog.json");

const regions = JSON.parse(fs.readFileSync(regionsPath, "utf8"));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query("BEGIN");

  for (const r of regions) {
    await client.query(
      `INSERT INTO regions (slug, label, intro)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET
         label = EXCLUDED.label,
         intro = EXCLUDED.intro`,
      [r.slug, r.label, r.intro ?? ""]
    );
  }
  console.log(`regions: ${regions.length}`);

  const catMap = new Map();
  for (const o of catalog) {
    if (!catMap.has(o.categorySlug)) {
      catMap.set(o.categorySlug, o.categoryLabel);
    }
  }
  for (const [slug, label] of catMap) {
    await client.query(
      `INSERT INTO categories (slug, label)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label`,
      [slug, label]
    );
  }
  console.log(`categories: ${catMap.size}`);

  const { rows: catRows } = await client.query(
    "SELECT id, slug FROM categories"
  );
  const catId = new Map(catRows.map((x) => [x.slug, x.id]));

  const { rows: regRows } = await client.query(
    "SELECT id, slug FROM regions"
  );
  const regId = new Map(regRows.map((x) => [x.slug, x.id]));

  for (const o of catalog) {
    const cid = catId.get(o.categorySlug);
    const rid = regId.get(o.regionSlug);
    if (cid == null) {
      throw new Error(`Нет категории: ${o.categorySlug} (org ${o.id})`);
    }
    if (rid == null) {
      throw new Error(`Нет региона: ${o.regionSlug} (org ${o.id})`);
    }
    await client.query(
      `INSERT INTO organizations
         (id, title, subtitle, listing_text, category_id, region_id, rating, reviews, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         subtitle = EXCLUDED.subtitle,
         listing_text = EXCLUDED.listing_text,
         category_id = EXCLUDED.category_id,
         region_id = EXCLUDED.region_id,
         rating = EXCLUDED.rating,
         reviews = EXCLUDED.reviews,
         published = EXCLUDED.published,
         updated_at = now()`,
      [
        o.id,
        o.title,
        o.subtitle ?? "",
        o.text ?? "",
        cid,
        rid,
        Number(o.rating) || 0,
        Number(o.reviews) || 0,
      ]
    );
  }
  console.log(`organizations: ${catalog.length}`);

  await client.query("COMMIT");
  console.log("Импорт завершён.");
} catch (e) {
  await client.query("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}
