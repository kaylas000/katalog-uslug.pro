/** Одноразово/по необходимости: синхронизировать ?v= у styles.css и main.js во всех .html */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const NEWV = process.argv[2] || "20260508";

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walk(p);
    } else if (ent.name.endsWith(".html")) {
      let s = fs.readFileSync(p, "utf8");
      const u = s
        .replace(/styles\.css\?v=[^\s">]+/g, `styles.css?v=${NEWV}`)
        .replace(/main\.js\?v=[^\s">]+/g, `main.js?v=${NEWV}`);
      if (u !== s) fs.writeFileSync(p, u);
    }
  }
}
walk(root);
