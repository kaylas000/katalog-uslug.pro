/**
 * Берёт фото из папки в корне репозитория katalog-uslug.pro, кладёт в images/portfolio/durapan/
 * и записывает URL в organization_profiles (durapan).
 *
 * Ищет первую существующую папку из:
 *   <repo>/дюропан
 *   <repo>/durapan
 * или путь из env DURAPAN_MEDIA_DIR (относительно корня репо или абсолютный).
 *
 * Подключение: worker/neon.local.txt или NEON_DATABASE_URL / DATABASE_URL.
 *
 * Запуск из папки worker:
 *   node tools/import-durapan-media-from-folder.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const SITE_ORIGIN = (
  process.env.KATALOG_SITE_ORIGIN || "https://katalog-uslug.pro"
).replace(/\/+$/, "");
const ORG_ID = "durapan";

function readConnectionString() {
  const fromEnv = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv.trim();
  const candidates = [
    path.join(repoRoot, "neon.local.txt"),
    path.join(repoRoot, "worker", "neon.local.txt"),
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

function resolveSourceDir() {
  if (process.env.DURAPAN_MEDIA_DIR) {
    const raw = process.env.DURAPAN_MEDIA_DIR.trim();
    const abs = path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
    console.error("DURAPAN_MEDIA_DIR не найден или не папка:", abs);
    process.exit(1);
  }
  const candidates = [
    path.join(repoRoot, "дюропан"),
    path.join(repoRoot, "durapan"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return null;
}

function listImages(dir) {
  const names = fs.readdirSync(dir, { withFileTypes: true });
  const files = names
    .filter((d) => d.isFile() && IMAGE_RE.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "ru"));
  return files.map((n) => path.join(dir, n));
}

function clearPortfolioDir(destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    return;
  }
  for (const ent of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (ent.name === ".gitkeep") continue;
    const fp = path.join(destDir, ent.name);
    if (ent.isFile()) fs.unlinkSync(fp);
  }
}

async function main() {
  const src = resolveSourceDir();
  if (!src) {
    console.error(
      "Нет папки с фото. Создайте в корне репозитория katalog-uslug.pro папку «дюропан» (или durapan) и положите туда .jpg/.png/.webp, затем снова запустите скрипт.\n" +
        "Либо: DURAPAN_MEDIA_DIR=путь\\к\\папке node tools/import-durapan-media-from-folder.mjs"
    );
    process.exit(1);
  }

  const paths = listImages(src);
  if (paths.length === 0) {
    console.error("В папке нет изображений (*.jpg, *.png, *.webp, *.gif):", src);
    process.exit(1);
  }

  const destDir = path.join(repoRoot, "images", "portfolio", ORG_ID);
  clearPortfolioDir(destDir);

  const publicUrls = [];
  let i = 0;
  for (const fp of paths) {
    i += 1;
    const ext = path.extname(fp).toLowerCase();
    const destName = `${i}${ext}`;
    const destPath = path.join(destDir, destName);
    fs.copyFileSync(fp, destPath);
    publicUrls.push(
      `${SITE_ORIGIN}/images/portfolio/${ORG_ID}/${encodeURIComponent(destName)}`
    );
  }

  const coverUrl = publicUrls[0] ?? null;
  const portfolioJson = JSON.stringify(publicUrls);

  const cs = readConnectionString();
  if (!cs) {
    console.error(
      "Нужен NEON_DATABASE_URL / DATABASE_URL или worker/neon.local.txt с URI."
    );
    console.error(
      "Файлы уже скопированы в images/portfolio/durapan/. Запишите в БД вручную:\n" +
        `  cover_url: ${coverUrl}\n` +
        `  portfolio_images: ${portfolioJson}`
    );
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
      console.warn("organization_profiles: строка durapan не обновлена (нет org_id?).");
    }
  } finally {
    await client.end();
  }

  console.log("OK: скопировано файлов:", paths.length);
  console.log("    из:", src);
  console.log("    в:", destDir);
  console.log("    cover_url:", coverUrl);
  console.log("    portfolio_images:", publicUrls.length, "URL");
  console.log(
    "Сделайте git add images/portfolio/durapan/ && git commit && push, чтобы файлы появились на GitHub Pages."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
