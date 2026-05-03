import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { injectLayout, normalizeFileContent } from './inject-layout.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = normalizeFileContent(
  fs.readFileSync(path.join(root, 'templates', 'page-blank.html'), 'utf8')
);
const once = normalizeFileContent(injectLayout(raw));
const twice = normalizeFileContent(injectLayout(once));
if (once !== twice) {
  console.error('markers mode: not idempotent');
  process.exit(1);
}
if (!once.includes('<header class="site-header">') || !once.includes('mobile-nav')) {
  console.error('markers mode: missing layout');
  process.exit(1);
}
console.log('markers selftest: OK');
