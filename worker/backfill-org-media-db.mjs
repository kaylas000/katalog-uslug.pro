/**
 * Загружает публичные фото организаций и сохраняет бинарники в БД (bytea).
 * Использует DATABASE_URL/NEON_DATABASE_URL или worker/neon.local.txt.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { createHash } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readNeonLocalFile() {
  const candidates = [
    path.join(root, "neon.local.txt"),
    path.join(root, "worker", "neon.local.txt"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const line = fs
      .readFileSync(p, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("postgres://") || l.startsWith("postgresql://"));
    if (line) return line;
  }
  return null;
}

function normalizeMediaUrl(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/")) return `https://katalog-uslug.pro${v}`;
  if (v.startsWith("images/")) return `https://katalog-uslug.pro/${v}`;
  return null;
}

const connectionString =
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || readNeonLocalFile();
if (!connectionString) {
  console.error(
    "Нужен NEON_DATABASE_URL / DATABASE_URL или worker/neon.local.txt c postgres://..."
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const orgs = await client.query(
    `SELECT
       o.id AS org_id,
       COALESCE(p.portfolio_images, '[]'::jsonb) AS portfolio_images,
       p.cover_url
     FROM organizations o
     JOIN organization_profiles p ON p.org_id = o.id
     WHERE o.published = true
       AND p.moderation_status = 'published'
     ORDER BY o.id`
  );

  let inserted = 0;
  for (const row of orgs.rows) {
    const orgId = String(row.org_id);
    const rawArr = Array.isArray(row.portfolio_images) ? row.portfolio_images : [];
    const urls = rawArr
      .map((x) => normalizeMediaUrl(x))
      .filter((x) => Boolean(x));
    const normalized =
      urls.length > 0
        ? urls
        : [normalizeMediaUrl(row.cover_url)].filter((x) => Boolean(x));

    await client.query("DELETE FROM organization_media_blobs WHERE org_id = $1", [orgId]);
    if (normalized.length === 0) {
      console.log(`- ${orgId}: no media`);
      continue;
    }

    let mediaIndex = 1;
    for (const src of normalized) {
      try {
        const resp = await fetch(src);
        if (!resp.ok) {
          console.warn(`! ${orgId} #${mediaIndex}: ${resp.status} ${src}`);
          mediaIndex += 1;
          continue;
        }
        const arr = new Uint8Array(await resp.arrayBuffer());
        const buf = Buffer.from(arr);
        const contentType = (resp.headers.get("content-type") || "application/octet-stream")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const sha = createHash("sha256").update(buf).digest("hex");

        await client.query(
          `INSERT INTO organization_media_blobs
            (org_id, media_index, source_url, content_type, sha256_hex, byte_size, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
          [orgId, mediaIndex, src, contentType, sha, buf.length, buf]
        );
        inserted += 1;
        console.log(`+ ${orgId} #${mediaIndex}: ${buf.length} bytes`);
      } catch (e) {
        console.warn(`! ${orgId} #${mediaIndex}: fetch/insert failed`);
      }
      mediaIndex += 1;
    }
  }
  console.log(`done. inserted media rows: ${inserted}`);
} finally {
  await client.end();
}
