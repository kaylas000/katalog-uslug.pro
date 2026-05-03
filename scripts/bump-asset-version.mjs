import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function walk(d) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', '.git'].includes(ent.name)) continue;
      walk(p);
    } else if (ent.name.endsWith('.html')) {
      let s = fs.readFileSync(p, 'utf8');
      const n = s
        .replaceAll('main.js?v=20260208', 'main.js?v=20260501')
        .replaceAll('styles.css?v=20260213', 'styles.css?v=20260501');
      if (n !== s) {
        fs.writeFileSync(p, n, 'utf8');
        console.log(path.relative(root, p));
      }
    }
  }
}

walk(root);
