/**
 * Одноразовая миграция URL под ТЗ: /c/…, /org/…, /add/, редиректы со старых путей.
 * Запуск: node scripts/migrate-ia-urls.mjs
 * После: npm run build:site
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function redirectDoc(targetPath) {
  const base = 'https://katalog-uslug.pro';
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=${targetPath}">
  <link rel="canonical" href="${base}${targetPath}">
  <title>Перенаправление…</title>
</head>
<body>
  <p><a href="${targetPath}">Перейти</a></p>
</body>
</html>
`;
}

function moveDir(fromRel, toRel) {
  const from = path.join(root, fromRel);
  const to = path.join(root, toRel);
  if (!fs.existsSync(from)) {
    console.warn('skip move (нет)', fromRel);
    return;
  }
  if (fs.existsSync(to)) {
    console.warn('skip move (уже есть)', toRel);
    return;
  }
  ensureDir(path.dirname(to));
  fs.renameSync(from, to);
  console.log('move', fromRel, '->', toRel);
}

function writeRedirectAt(folderRel, targetUrl) {
  ensureDir(path.join(root, folderRel));
  const fp = path.join(root, folderRel, 'index.html');
  fs.writeFileSync(fp, redirectDoc(targetUrl), 'utf8');
  console.log('redirect', folderRel, '->', targetUrl);
}

const REPLACEMENTS = [
  ['/metalworking/', '/c/metalworking/'],
  ['/autoservice/', '/c/autoservice/'],
  ['/care/', '/c/care/'],
  ['/sportwear/', '/c/sportwear/'],
  ['/org-lazer-rezka/', '/org/lazer-rezka/'],
  ['/org-svk-avto/', '/org/svk-avto/'],
  ['/org-sidelki/', '/org/sidelki/'],
  ['/org-club-ring/', '/org/club-ring/'],
  ['/add-company/', '/add/'],
];

function rewriteUrlsInHtml(content) {
  let s = content;
  for (const [a, b] of REPLACEMENTS) {
    s = s.split(a).join(b);
  }
  /* /c/metalworking/ содержит подстроку /metalworking/ — без этого снова подставится /c/ */
  while (s.includes('/c/c/')) s = s.split('/c/c/').join('/c/');
  while (s.includes('/org/org/')) s = s.split('/org/org/').join('/org/');
  return s;
}

function walkHtmlFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', '.git'].includes(ent.name)) continue;
      walkHtmlFiles(p, out);
    } else if (ent.name.endsWith('.html')) {
      if (p.includes(`${path.sep}partials${path.sep}`) && ent.name.endsWith('.template.html')) continue;
      out.push(p);
    }
  }
  return out;
}

function markerPage(title, h1, innerHtml) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css?v=20260213">
</head>
<body>

<!-- katalog:page-main -->
<section class="section" style="padding-top:80px;padding-bottom:80px;">
  <div class="container">
    <div class="section-header">
      <h1 class="section-title">${h1}</h1>
    </div>
    ${innerHtml}
  </div>
</section>
<!-- katalog:page-main-end -->

  <script src="/js/main.js?v=20260208"></script>
</body>
</html>
`;
}

function main() {
  ensureDir(path.join(root, 'c'));
  ensureDir(path.join(root, 'org'));

  for (const slug of ['metalworking', 'autoservice', 'care', 'sportwear']) {
    moveDir(slug, path.join('c', slug));
    writeRedirectAt(slug, `/c/${slug}/`);
  }

  const orgMap = [
    ['org-lazer-rezka', 'lazer-rezka'],
    ['org-svk-avto', 'svk-avto'],
    ['org-sidelki', 'sidelki'],
    ['org-club-ring', 'club-ring'],
  ];
  for (const [oldF, newSlug] of orgMap) {
    moveDir(oldF, path.join('org', newSlug));
    writeRedirectAt(oldF, `/org/${newSlug}/`);
  }

  moveDir('add-company', 'add');
  writeRedirectAt('add-company', '/add/');

  const categoriesInner = `<div class="grid cards-2 gap-24">
    <a class="card" href="/c/metalworking/"><div class="card-body"><h3 class="card-title">Металлообработка</h3></div></a>
    <a class="card" href="/c/autoservice/"><div class="card-body"><h3 class="card-title">Автосервис</h3></div></a>
    <a class="card" href="/c/care/"><div class="card-body"><h3 class="card-title">Патронаж и сиделки</h3></div></a>
    <a class="card" href="/c/sportwear/"><div class="card-body"><h3 class="card-title">Спортивная одежда</h3></div></a>
  </div>`;

  const searchInner = `<form class="card card-body" action="/search/" method="get" role="search">
    <label class="card-text" for="q">Поиск по каталогу</label>
    <div class="flex gap-12 mt-16" style="flex-wrap:wrap;align-items:center;">
      <input id="q" name="q" type="search" placeholder="Например: лазерная резка" style="flex:1;min-width:220px;padding:12px 14px;border:1px solid #c9d6e8;border-radius:10px;font:inherit;" />
      <button type="submit" class="btn btn-primary">Найти</button>
    </div>
    <p class="section-sub mt-16">Полная выдача и фильтры подключатся на следующем этапе; сейчас страница закрепляет адрес <code>/search/</code>.</p>
  </form>`;

  const privacyInner = `<div class="card"><div class="card-body">
    <p class="card-text">Здесь будет политика конфиденциальности и обработка персональных данных. Текст подготовит юрист; структура страницы уже соответствует разделу юридических страниц в плане проекта.</p>
  </div></div>`;

  const termsInner = `<div class="card"><div class="card-body">
    <p class="card-text">Здесь будут условия использования платформы и правила публикации карточек. Текст подготовит юрист.</p>
  </div></div>`;

  ensureDir(path.join(root, 'categories'));
  fs.writeFileSync(
    path.join(root, 'categories', 'index.html'),
    markerPage('Категории — katalog-uslug.pro', 'Категории услуг', categoriesInner),
    'utf8'
  );
  ensureDir(path.join(root, 'search'));
  fs.writeFileSync(
    path.join(root, 'search', 'index.html'),
    markerPage('Поиск — katalog-uslug.pro', 'Поиск по каталогу', searchInner),
    'utf8'
  );
  ensureDir(path.join(root, 'privacy'));
  fs.writeFileSync(
    path.join(root, 'privacy', 'index.html'),
    markerPage('Конфиденциальность — katalog-uslug.pro', 'Политика конфиденциальности', privacyInner),
    'utf8'
  );
  ensureDir(path.join(root, 'terms'));
  fs.writeFileSync(
    path.join(root, 'terms', 'index.html'),
    markerPage('Условия — katalog-uslug.pro', 'Условия использования', termsInner),
    'utf8'
  );
  console.log('created categories/, search/, privacy/, terms/');

  for (const fp of walkHtmlFiles(root)) {
    let raw = fs.readFileSync(fp, 'utf8');
    const next = rewriteUrlsInHtml(raw);
    if (next !== raw) {
      fs.writeFileSync(fp, next, 'utf8');
      console.log('urls', path.relative(root, fp));
    }
  }

  const rootStubs = [
    ['metalworking.html', '/c/metalworking/'],
    ['autoservice.html', '/c/autoservice/'],
    ['care.html', '/c/care/'],
    ['sportwear.html', '/c/sportwear/'],
    ['org-lazer-rezka.html', '/org/lazer-rezka/'],
    ['org-svk-avto.html', '/org/svk-avto/'],
    ['org-sidelki.html', '/org/sidelki/'],
    ['org-club-ring.html', '/org/club-ring/'],
    ['add-company.html', '/add/'],
  ];
  for (const [name, url] of rootStubs) {
    fs.writeFileSync(path.join(root, name), redirectDoc(url), 'utf8');
    console.log('root stub', name);
  }

  console.log('migrate-ia-urls: готово');
}

main();
