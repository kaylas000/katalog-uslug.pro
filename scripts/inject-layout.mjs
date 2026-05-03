/**
 * Подставляет partials/site-header.html и partials/site-footer.html
 * во все корневые *.html (кроме partials). Сохраняет <head> и блок до <script>.
 * Запуск: npm run build:layout
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function normalizeEOL(s) {
  return s.replace(/\r\n/g, '\n');
}

/** Единый финальный \\n — иначе сравнение на Windows «плавает» */
function normalizeFileContent(s) {
  return normalizeEOL(s).replace(/\s+$/, '') + '\n';
}

const HEADER_PARTIAL = normalizeEOL(fs.readFileSync(path.join(root, 'partials', 'site-header.html'), 'utf8'));
const FOOTER_PARTIAL = normalizeEOL(fs.readFileSync(path.join(root, 'partials', 'site-footer.html'), 'utf8'));

const HTML_FILES = [
  'index.html',
  'add-company.html',
  'analytics.html',
  'autoservice.html',
  'blog.html',
  'care.html',
  'contacts.html',
  'metalworking.html',
  'moderation.html',
  'sportwear.html',
  'org-club-ring.html',
  'org-lazer-rezka.html',
  'org-sidelki.html',
  'org-svk-avto.html',
];

/** Конец блока <div class="mobile-nav">…</div> (сбалансировано по <div> / </div>) */
function endOfMobileNavBlock(html, mobileNavOpenIndex) {
  const tagRe = /<div\b[^>]*>|<\/div>/gi;
  tagRe.lastIndex = mobileNavOpenIndex;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return tagRe.lastIndex;
    } else {
      depth += 1;
    }
  }
  throw new Error('Не найден конец .mobile-nav');
}

/** Убираем только пробелы/табы сразу перед якорем — иначе «хвост» от старой вёрстки + отступ из partial дают лишние байты и нет идемпотентности */
function trimHorizontalSpaceBefore(html, low, anchor) {
  let p = anchor;
  while (p > low && (html[p - 1] === ' ' || html[p - 1] === '\t')) p -= 1;
  return p;
}

function findHeaderSliceStart(html) {
  /** Не использовать \\s* после `>`: иначе «съедаются» отступы перед <!-- Header --> и trimHorizontalSpaceBefore бессилен */
  const bodyOpen = html.match(/<body[^>]*>/);
  if (!bodyOpen) throw new Error('Нет <body>');
  const afterBody = bodyOpen.index + bodyOpen[0].length;
  const c = html.indexOf('<!-- Header -->', afterBody);
  const headerIdx = html.indexOf('<header class="site-header">', afterBody);
  if (headerIdx === -1) throw new Error('Нет <header class="site-header">');
  if (c !== -1 && c < headerIdx) return trimHorizontalSpaceBefore(html, afterBody, c);
  return trimHorizontalSpaceBefore(html, afterBody, headerIdx);
}

function findFooterSliceStart(html, hEnd) {
  const footerIdx = html.indexOf('<footer class="site-footer">');
  if (footerIdx === -1) throw new Error('Нет <footer class="site-footer">');
  const before = html.slice(0, footerIdx);
  const c = before.lastIndexOf('<!-- Footer -->');
  if (c !== -1 && footerIdx - c < 160) return trimHorizontalSpaceBefore(html, hEnd, c);
  return trimHorizontalSpaceBefore(html, hEnd, footerIdx);
}

/** Только до подвала: после .mobile-nav убираем лишние \\n (не трогать .consultant с тем же паттерном </div>) */
function tightenAfterMobileNav(html) {
  const footerIdx = html.indexOf('<footer class="site-footer">');
  if (footerIdx === -1) return html;
  const head = html.slice(0, footerIdx);
  const tail = html.slice(footerIdx);
  const fixed = head.replace(
    /(\n    <\/div>\n  <\/div>\n)\n+(?=\s*(?:<!--|<section|<div class="))/g,
    '$1\n'
  );
  return fixed + tail;
}

export function injectLayout(html) {
  const hStart = findHeaderSliceStart(html);
  const mobIdx = html.indexOf('<div class="mobile-nav">', hStart);
  if (mobIdx === -1) throw new Error('Нет .mobile-nav');
  const hEnd = endOfMobileNavBlock(html, mobIdx);

  const fStart = findFooterSliceStart(html, hEnd);
  const scriptIdx = html.indexOf('<script', fStart);
  if (scriptIdx === -1) throw new Error('Нет <script после подвала');

  const restScript = html.slice(scriptIdx);
  const footerBlock = FOOTER_PARTIAL.replace(/\s+$/, '') + '\n\n  ';

  let out =
    html.slice(0, hStart) + HEADER_PARTIAL + html.slice(hEnd, fStart) + footerBlock + restScript;
  out = tightenAfterMobileNav(out);
  return out;
}

export { normalizeFileContent };

function runInject() {
  for (const name of HTML_FILES) {
    const fp = path.join(root, name);
    const raw = normalizeFileContent(fs.readFileSync(fp, 'utf8'));
    const next = normalizeFileContent(injectLayout(raw));
    if (next === raw) {
      console.log(`${name}: без изменений`);
    } else {
      fs.writeFileSync(fp, next, 'utf8');
      console.log(`${name}: OK`);
    }
  }
}

const __self = path.resolve(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __self;
if (isMain) runInject();
