/**
 * Подставляет partials/site-header.html и partials/site-footer.html
 * во все страницы: корень, c/, org/, r/ (по одной подпапке на страницу), прочие slug/index.html (не partials/templates/config).
 *
 * Режимы:
 * 1) Маркеры <!-- katalog:page-main --> … <!-- katalog:page-main-end --> — только контент между
 *    маркерами; шапка, мобильное меню и подвал всегда из partials (шаблон: templates/page-blank.html).
 * 2) Остальные страницы — как раньше: полная разметка с .mobile-nav и подвалом для замены на partials.
 *
 * Запуск: npm run build:layout
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const CATALOG_API_META = 'name="katalog-catalog-api"';

function injectCatalogApiMeta(html) {
  const sitePath = path.join(root, 'config', 'site.json');
  if (!fs.existsSync(sitePath)) return html;
  let url = '';
  try {
    const s = JSON.parse(fs.readFileSync(sitePath, 'utf8'));
    url =
      typeof s.catalogApiBaseUrl === 'string' ? s.catalogApiBaseUrl.trim() : '';
  } catch {
    return html;
  }
  let out = html.replace(
    new RegExp(`\\n\\s*<meta ${CATALOG_API_META}[^>]*>\\s*`, 'gi'),
    '\n'
  );
  /** Кодировка — первым в <head>; иначе длинный префикс до charset мешает раннему распознаванию UTF-8. */
  out = out.replace(/\s*<meta\s+charset\s*=\s*["'][^"']*["']\s*\/?>\s*/gi, '');
  const esc =
    url
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .trim() || '';
  const headOpen = out.search(/<head\b/i);
  if (headOpen === -1) return out;
  const headTagEnd = out.indexOf('>', headOpen);
  if (headTagEnd === -1) return out;
  const apiTag =
    esc.length === 0
      ? ''
      : `\n  <meta ${CATALOG_API_META} content="${esc}">`;
  const merged =
    out.slice(0, headTagEnd + 1) +
    `\n  <meta charset="UTF-8">${apiTag}\n` +
    out.slice(headTagEnd + 1);
  return merged.replace(/\n<meta name="viewport"/, '\n  <meta name="viewport"');
}

function normalizeEOL(s) {
  return s.replace(/\r\n/g, '\n');
}

/** Единый финальный \\n — иначе сравнение на Windows «плавает» */
function normalizeFileContent(s) {
  return normalizeEOL(s.replace(/^\uFEFF/, '')).replace(/\s+$/, '') + '\n';
}

const HEADER_PARTIAL = normalizeEOL(fs.readFileSync(path.join(root, 'partials', 'site-header.html'), 'utf8'));
const FOOTER_PARTIAL = normalizeEOL(fs.readFileSync(path.join(root, 'partials', 'site-footer.html'), 'utf8'));

const MARK_PAGE_MAIN = '<!-- katalog:page-main -->';
const MARK_PAGE_MAIN_END = '<!-- katalog:page-main-end -->';

const LAYOUT_SKIP_DIRS = new Set([
  'partials',
  'templates',
  'scripts',
  'css',
  'js',
  'node_modules',
  '.git',
  'config',
  'data',
]);

function isRedirectStub(html) {
  return /http-equiv\s*=\s*["']refresh["']/i.test(html) && /url\s*=/i.test(html);
}

/** Корень, `c/slug/`, `org/slug/`, `r/slug/`, остальные одноуровневые `slug/index.html` */
function listLayoutHtmlFiles() {
  const out = [];
  function add(fp) {
    const norm = path.normalize(fp);
    if (!fs.existsSync(norm)) return;
    try {
      const raw = fs.readFileSync(norm, 'utf8');
      if (isRedirectStub(raw)) return;
    } catch {
      return;
    }
    out.push(norm);
  }
  add(path.join(root, 'index.html'));
  const cRoot = path.join(root, 'c');
  if (fs.existsSync(cRoot)) {
    for (const ent of fs.readdirSync(cRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      add(path.join(cRoot, ent.name, 'index.html'));
    }
  }
  const orgRoot = path.join(root, 'org');
  if (fs.existsSync(orgRoot)) {
    for (const ent of fs.readdirSync(orgRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      add(path.join(orgRoot, ent.name, 'index.html'));
    }
  }
  const rRoot = path.join(root, 'r');
  if (fs.existsSync(rRoot)) {
    for (const ent of fs.readdirSync(rRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      add(path.join(rRoot, ent.name, 'index.html'));
    }
  }
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.') || LAYOUT_SKIP_DIRS.has(ent.name)) continue;
    if (ent.name === 'c' || ent.name === 'org' || ent.name === 'r') continue;
    add(path.join(root, ent.name, 'index.html'));
  }
  return out.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b), 'ru'));
}

/** Подключение скриптов из config/extensions.json без правки каждой страницы */
function appendExtensionScripts(html) {
  const extPath = path.join(root, 'config', 'extensions.json');
  if (!fs.existsSync(extPath)) return html;
  let bodyScripts = [];
  try {
    const j = JSON.parse(fs.readFileSync(extPath, 'utf8'));
    bodyScripts = Array.isArray(j.bodyScripts) ? j.bodyScripts : [];
  } catch {
    return html;
  }
  const list = bodyScripts.filter((s) => typeof s === 'string' && s.trim());
  if (list.length === 0) return html;
  const lower = html.toLowerCase();
  const bodyClose = lower.lastIndexOf('</body>');
  if (bodyClose === -1) return html;
  const tags = list.map((s) => `\n  <script src="${s.trim()}" defer></script>`).join('');
  return html.slice(0, bodyClose) + tags + html.slice(bodyClose);
}

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
  const headerIdx = html.indexOf('<header class="site-header">', afterBody);
  if (headerIdx === -1) throw new Error('Нет <header class="site-header">');
  /** Точное `<!-- Header -->` (старый маркер) */
  const c = html.indexOf('<!-- Header -->', afterBody);
  if (c !== -1 && c < headerIdx) return trimHorizontalSpaceBefore(html, afterBody, c);
  /**
   * Комментарий из partials: `<!-- Header (фрагменты …) -->`.
   * Начало вырезаемого блока — с первого такого комментария (если есть), иначе с `<header>`,
   * иначе при повторном build:layout старые копии комментариев остаются в HTML.
   */
  let i = afterBody;
  let sliceStart = headerIdx;
  while (i < headerIdx) {
    while (i < headerIdx && /\s/.test(html[i])) i += 1;
    if (i >= headerIdx) break;
    if (!html.startsWith('<!--', i)) break;
    const end = html.indexOf('-->', i + 4);
    if (end === -1 || end > headerIdx) break;
    const inner = html.slice(i + 4, end);
    if (!/^\s*Header\b/i.test(inner)) break;
    sliceStart = Math.min(sliceStart, i);
    i = end + 3;
  }
  return trimHorizontalSpaceBefore(html, afterBody, sliceStart);
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

/** Новые страницы: `slug/index.html` из templates/page-blank.html — правите только между маркерами. */
function injectLayoutContentOnly(html) {
  const bodyMatch = html.match(/<body[^>]*>/i);
  if (!bodyMatch) throw new Error('Нет <body>');
  const bodyOpenEnd = bodyMatch.index + bodyMatch[0].length;
  /** Искать только после <body>: иначе при повторном build совпадение «съедало» бы шапку между body и маркером */
  const ms = html.indexOf(MARK_PAGE_MAIN, bodyOpenEnd);
  if (ms === -1) throw new Error(`Нет маркера ${MARK_PAGE_MAIN} после <body>`);

  const bodyClose = html.toLowerCase().lastIndexOf('</body>');
  if (bodyClose === -1) throw new Error('Нет </body>');
  /** Последний end-маркер перед </body> — иначе indexOf с середины документа мог «цеплять» вхождение внутри partials/вставленного футера */
  const me = html.lastIndexOf(MARK_PAGE_MAIN_END, bodyClose);
  if (me === -1) throw new Error(`Нет маркера ${MARK_PAGE_MAIN_END} перед </body>`);
  if (me <= ms) throw new Error('Маркер конца раньше начала (page-main-end перед page-main)');

  const inner = html.slice(ms + MARK_PAGE_MAIN.length, me);
  const afterEndMark = me + MARK_PAGE_MAIN_END.length;

  /** После маркера может быть только скрипт (черновик) или уже вставленный подвал — ищем первый <script перед </body> */
  const tailAfterEnd = html.slice(afterEndMark, bodyClose);
  const scriptRel = tailAfterEnd.search(/<script\b/i);
  if (scriptRel === -1) {
    throw new Error(
      'После <!-- katalog:page-main-end --> до </body> нужен хотя бы один <script> (см. templates/page-blank.html)'
    );
  }
  const scriptsRegion = tailAfterEnd.slice(scriptRel).replace(/^\uFEFF/, '');

  const headThroughBody = html.slice(0, bodyOpenEnd);
  const restClosing = html.slice(bodyClose);
  const footerBlock = FOOTER_PARTIAL.replace(/\s+$/, '') + '\n\n  ';

  let out =
    headThroughBody +
    '\n\n' +
    HEADER_PARTIAL +
    '\n' +
    MARK_PAGE_MAIN +
    inner +
    MARK_PAGE_MAIN_END +
    '\n\n' +
    footerBlock +
    scriptsRegion +
    restClosing;
  out = tightenAfterMobileNav(out);
  return out;
}

function injectLayoutLegacy(html) {
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

export function injectLayout(html) {
  if (html.includes(MARK_PAGE_MAIN) && html.includes(MARK_PAGE_MAIN_END)) {
    return injectLayoutContentOnly(html);
  }
  return injectLayoutLegacy(html);
}

export { normalizeFileContent };

function runInject() {
  const paths = listLayoutHtmlFiles();
  if (paths.length === 0) {
    console.log('Нет страниц index.html (корень или slug/index.html)');
    return;
  }
  for (const fp of paths) {
    const name = path.relative(root, fp);
    let raw;
    try {
      raw = normalizeFileContent(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      console.log(`${name}: ошибка чтения (${e.message})`);
      continue;
    }
    let next;
    try {
      next = normalizeFileContent(
        injectCatalogApiMeta(appendExtensionScripts(injectLayout(raw)))
      );
    } catch (e) {
      console.log(`${name}: пропуск — ${e.message}`);
      continue;
    }
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
