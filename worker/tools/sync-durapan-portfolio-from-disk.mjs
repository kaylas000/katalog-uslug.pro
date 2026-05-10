/**
 * Берёт уже лежащие в images/portfolio/durapan/ файлы и пишет их URL в organization_profiles (durapan).
 * Не копирует из других папок.
 *
 * Запуск из worker: node tools/sync-durapan-portfolio-from-disk.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const DEST = path.join(repoRoot, "images", "portfolio", "durapan");
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const SITE_ORIGIN = (
  process.env.KATALOG_SITE_ORIGIN || "https://katalog-uslug.pro"
).replace(/\/+$/, "");
const ORG_ID = "durapan";

function readConnectionString() {
  const fromEnv = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv.trim();
  for (const p of [
    path.join(repoRoot, "neon.local.txt"),
    path.join(repoRoot, "worker", "neon.local.txt"),
  ]) {
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

function listImageFiles() {
  if (!fs.existsSync(DEST)) return [];
  return fs
    .readdirSync(DEST, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== ".gitkeep" && IMAGE_RE.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((n) => path.join(DEST, n));
}

async function main() {
  const files = listImageFiles();
  if (files.length === 0) {
    console.error("Нет изображений в", DEST);
    process.exit(1);
  }

  const publicUrls = files.map((fp) => {
    const name = path.basename(fp);
    return `${SITE_ORIGIN}/images/portfolio/${ORG_ID}/${encodeURIComponent(name)}`;
  });
  const coverUrl = publicUrls[0];
  const portfolioJson = JSON.stringify(publicUrls);

  const cs = readConnectionString();
  if (!cs) {
    console.error("Нужен NEON_DATABASE_URL или worker/neon.local.txt");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const upd = await client.query(
      `UPDATE organization_profiles
       SET cover_url = $1,
           portfolio_images = $2::jsonb,
           updated_at = now()
       WHERE org_id = $3
       RETURNING org_id`,
      [coverUrl, portfolioJson, ORG_ID]
    );
    if (upd.rowCount === 0) {
      console.error("UPDATE не затронул строки — нет org_id=durapan?");
      process.exit(1);
    }
  } finally {
    await client.end();
  }

  console.log("OK:", files.length, "файлов → БД");
  publicUrls.forEach((u) => console.log(" ", u));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
