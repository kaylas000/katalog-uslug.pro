/**
 * Накатывает SQL из ../db/migrations/*.sql по имени (как job «Neon DB migrations» в GitHub Actions).
 *
 * Строка подключения: NEON_DATABASE_URL или DATABASE_URL, либо файл ../neon.local.txt
 * (одна строка postgresql://… из Neon).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function readNeonLocalFile() {
  const p = path.join(root, 'neon.local.txt');
  if (!fs.existsSync(p)) return null;
  const line = fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('postgres://') || l.startsWith('postgresql://'));
  return line || null;
}

const connectionString =
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || readNeonLocalFile();
if (!connectionString) {
  console.error(
    'Нужен NEON_DATABASE_URL / DATABASE_URL или файл neon.local.txt в корне проекта (одна строка URI).'
  );
  process.exit(1);
}

const migrationsDir = path.join(root, 'db', 'migrations');
if (!fs.existsSync(migrationsDir)) {
  console.error('Нет каталога db/migrations/');
  process.exit(1);
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('В db/migrations/ нет .sql файлов.');
  process.exit(0);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  for (const name of files) {
    const fp = path.join(migrationsDir, name);
    const sql = fs.readFileSync(fp, 'utf8');
    console.log(`>>> ${path.relative(root, fp)}`);
    await client.query(sql);
  }
  console.log('Миграции применены.');
} finally {
  await client.end();
}
