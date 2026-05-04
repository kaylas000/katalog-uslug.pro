/**
 * Читает neon.local.txt (одна строка — URI из Neon) и пишет worker/.dev.vars
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "neon.local.txt");
const dest = path.join(root, "worker", ".dev.vars");

if (!fs.existsSync(src)) {
  console.error("");
  console.error("Не найден файл neon.local.txt в корне проекта.");
  console.error("Сделай копию neon.local.example.txt → neon.local.txt");
  console.error("и вставь в neon.local.txt одну строку Connection string из Neon.");
  console.error("");
  process.exit(1);
}

const raw = fs.readFileSync(src, "utf8");
const lines = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

const urlLine = lines.find(
  (l) => l.startsWith("postgres://") || l.startsWith("postgresql://")
);

if (!urlLine) {
  console.error("");
  console.error("В neon.local.txt нет строки, начинающейся с postgres://");
  console.error("Открой файл и вставь Connection string из Neon одной строкой.");
  console.error("");
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `DATABASE_URL=${urlLine}\n`, "utf8");

console.log("");
console.log("Готово: строка записана в worker/.dev.vars");
console.log("Дальше: npm run worker:dev");
console.log("");
