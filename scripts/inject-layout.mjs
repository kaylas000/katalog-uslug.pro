/**
 * Вставляет header/footer из partials/*.html во все HTML-страницы,
 * которые содержат маркеры <!-- katalog:page-main -->...<!-- katalog:page-main-end -->
 *
 * Страницы без маркеров (например, jobs/index.html) — не трогает,
 * они должны быть переведены на маркеры вручную.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const header = fs.readFileSync(path.join(root, 'partials', 'site-header.html'), 'utf8').replace(/\s+$/, '');
const footer = fs.readFileSync(path.join(root, 'partials', 'site-footer.html'), 'utf8').replace(/\s+$/, '');

const MAIN_START = '<!-- katalog:page-main -->\n';
const MAIN_END   = '\n<!-- katalog:page-main-end -->';

function inject(filePath) {
  const abs = path.join(root, filePath);
  if (!fs.existsSync(abs)) return;
  let html = fs.readFileSync(abs, 'utf8');

  // Если нет маркеров — пропускаем
  if (!html.includes('<!-- katalog:page-main -->')) return;

  const before = html.split('<!-- katalog:page-main -->')[0];
  const after  = html.split('<!-- katalog:page-main-end -->')[1] || '';

  const bodyStartIdx = before.indexOf('<body');
  if (bodyStartIdx === -1) return;

  const beforeBody = before.slice(0, bodyStartIdx); // <html>, <head>, </head>
  const afterBodyOpen = before.slice(before.indexOf('>', bodyStartIdx) + 1); // после <body> до <!-- katalog:page-main -->

  // Новая структура
  const result = beforeBody + '\n<body>\n' + header + '\n' + MAIN_START +
    html.split('<!-- katalog:page-main -->')[1].split('<!-- katalog:page-main-end -->')[0] + '\n' + MAIN_END + '\n' + footer + after;

  fs.writeFileSync(abs, result.replace(/\s+$/, '') + '\n', 'utf8');
  console.log(`  injected: ${filePath}`);
}

function walk(dir, cb) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, cb);
    } else if (e.name === 'index.html') {
      cb(full);
    }
  }
}

function main() {
  // Сначала чистим старые вставки (заменяем header/footer на маркеры)
  const allPages = [];
  walk(root, (f) => {
    const rel = path.relative(root, f);
    if (rel.startsWith('partials') || rel.startsWith('node_modules') || rel.startsWith('worker')) return;
    if (rel.startsWith('images') || rel.startsWith('css') || rel.startsWith('js')) return;
    if (rel.startsWith('.git')) return;
    allPages.push(rel);
  });

  for (const rel of allPages) {
    const abs = path.join(root, rel);
    let html = fs.readFileSync(abs, 'utf8');

    // Если страница уже имеет маркер <!-- katalog:page-main --> — у неё уже динамическая верстка, пропускаем
    if (html.includes('<!-- katalog:page-main -->')) continue;

    // Если страница не содержит <header class="site-header"> — это не наша страница
    if (!html.includes('<header class="site-header">')) continue;

    // Ищем начало тега <body и заканчиваем после </body>
    // Заменяем header->маркер
    const headerMatch = html.match(/<!-- Header[\s\S]*?<\/header>[\s\S]*?<\/div>\s*<\/div>/);
    const footerMatch = html.match(/<!-- Footer[\s\S]*?<\/footer>[\s\S]*?<\/div>\s*<\/div>/);
    
    if (!headerMatch || !footerMatch) continue;

    const headerEnd = headerMatch.index + headerMatch[0].length;
    const footerStart = footerMatch.index;
    
    const before = html.slice(0, headerEnd);
    const middle = html.slice(headerEnd, footerStart);
    const after = html.slice(footerStart);

    const newHtml = before + '\n' + MAIN_START + middle.trim() + '\n' + MAIN_END + '\n' + after;
    fs.writeFileSync(abs, newHtml.replace(/\s+$/, '') + '\n', 'utf8');
    console.log(`  converted to markers: ${rel}`);
  }

  // Теперь вставляем header/footer во все страницы с маркерами
  for (const rel of allPages) {
    const abs = path.join(root, rel);
    let html = fs.readFileSync(abs, 'utf8');

    if (!html.includes(MAIN_START.trim())) continue;

    const parts = html.split(MAIN_START.trim());
    if (parts.length < 2) continue;
    const beforeParts = parts[0].split('\n');
    // Находим последнюю строку перед маркером — это место после header
    // Просто заменим всё до маркера на header
    const beforeMarker = parts[0];
    const mainContent = parts[1].split(MAIN_END.trim())[0];
    const afterMarker = parts[1].split(MAIN_END.trim())[1] || '';

    // Ищем <body>
    const bodyIdx = beforeMarker.indexOf('<body');
    if (bodyIdx === -1) continue;
    
    const headSection = beforeMarker.slice(0, bodyIdx);
    const afterBodyTag = beforeMarker.slice(beforeMarker.indexOf('>', bodyIdx) + 1);

    const result = headSection + '<body>\n' + header + '\n' + MAIN_START.trim() + '\n' + mainContent.trim() + '\n' + MAIN_END.trim() + '\n' + footer + afterMarker;
    fs.writeFileSync(abs, result.replace(/\s+$/, '') + '\n', 'utf8');
    console.log(`  layout injected: ${rel}`);
  }

  console.log('inject-layout: done');
}

main();
