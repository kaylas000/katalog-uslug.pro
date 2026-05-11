/**
 * Собирает каталог из data/catalog.json + data/regions.json + config/site.json:
 * — сетка каталога — пустой shell (данные только из API Worker);
 * — data/catalog.json — источник для импорта в Postgres (npm run db:import);
 * — страницы категорий c/<slug>/ — из config/site.json.categories (добавили категорию + шаблон страницы с маркерами).
 *
 * Запуск: npm run build:data
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCardsGridInner, escapeHtml } from './lib/catalog-card.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://katalog-uslug.pro').replace(/\/+$/, '');

const M_HEAD_SEO_START = '<!-- katalog:gen-head-seo -->';
const M_HEAD_SEO_END = '<!-- /katalog:gen-head-seo -->';
const M_REGION_NAV_START = '<!-- katalog:gen-region-seo-nav -->';
const M_REGION_NAV_END = '<!-- /katalog:gen-region-seo-nav -->';
const M_CAT_OPTS_START = '<!-- katalog:gen-category-options -->';
const M_CAT_OPTS_END = '<!-- /katalog:gen-category-options -->';
const M_GRID_START = '<!-- katalog:catalog-grid -->';
const M_GRID_END = '<!-- /katalog:catalog-grid -->';
const M_CATEGORY_CARDS_START = '<!-- katalog:category-cards -->';
const M_CATEGORY_CARDS_END = '<!-- /katalog:category-cards -->';
const M_CATEGORY_INTRO_START = '<!-- katalog:category-intro -->';
const M_CATEGORY_INTRO_END = '<!-- /katalog:category-intro -->';

const STYLES_VERSION = '20260512-migration-complete';

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function versionStaticAssets(html, v) {
  return html
    .replace(/href="\/css\/styles\.css\?v=[^"]*"/g, `href="/css/styles.css?v=${v}"`)
    .replace(/src="\/js\/main\.js\?v=[^"]*"/g, `src="/js/main.js?v=${v}"`)
    .replace(/src="\/js\/org\.js\?v=[^"]*"/g, `src="/js/org.js?v=${v}"`);
}

function replaceBetween(html, startMark, endMark, inner) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) {
    throw new Error(`Маркеры не найдены или порядок неверен: ${startMark}`);
  }
  const startEnd = a + startMark.length;
  return html.slice(0, startEnd) + inner + html.slice(b);
}

function buildCategoryOptions(categories) {
  const lines = ['\n            <option value="">Все категории</option>'];
  for (const c of categories) {
    lines.push(`            <option value="${escapeHtml(c.slug)}">${escapeHtml(c.label)}</option>`);
  }
  return `${lines.join('\n')}\n            `;
}

function replaceCategoryCardsBlock(html, inner) {
  const a = html.indexOf(M_CATEGORY_CARDS_START);
  if (a === -1) {
    throw new Error(`нет маркера ${M_CATEGORY_CARDS_START}`);
  }
  const afterStart = a + M_CATEGORY_CARDS_START.length;
  const tail = html.slice(afterStart);
  const m = /<!--\s*\/katalog:category-cards\s*-->/.exec(tail);
  if (!m) {
    throw new Error(`нет маркера закрытия category-cards после ${M_CATEGORY_CARDS_START}`);
  }
  const endIdx = afterStart + m.index;
  return html.slice(0, afterStart) + inner + html.slice(endIdx);
}

/**
 * Хлебные крошки, h1, абзацы c/* — из label (UTF-8 из site.json).
 * introLead — необязательный первый абзац (иначе шаблон с «Проверенные организации…»).
 * isGoodsCategory — true для категорий товаров (добавляет ссылку на /goods/ в breadcrumbs).
 */
function buildCategoryIntroInner(label, introLead, isGoodsCategory = false) {
  const L = escapeHtml(label);
  const lead =
    typeof introLead === 'string' && introLead.trim()
      ? escapeHtml(introLead.trim())
      : `Проверенные организации категории «${L}». Контакты и информация о компаниях — в карточках ниже.`;
  
  let breadcrumbs = `\n      <nav class="breadcrumbs">
        <a href="/">Главная</a><span>/</span>`;
  
  if (isGoodsCategory) {
    breadcrumbs += `<a href="/goods/">Товары</a><span>/</span>`;
  }
  
  breadcrumbs += `<span>${L}</span>
      </nav>`;
  
  return `${breadcrumbs}
      <h1 class="section-title">${L}</h1>
      <p class="section-sub">${lead}</p>

      <p class="section-sub mt-24 mb-0" style="max-width:640px">
        Фильтры по регионам и рейтингу — на <a href="/#catalog" style="color:var(--primary);text-decoration:underline;text-underline-offset:2px">главной странице каталога</a>.
      </p>
`;
}

const LEGACY_CATEGORY_INTRO_BLOCK_RE =
  /\s*<nav class="breadcrumbs">[\s\S]*?<\/nav>\s*<h1 class="section-title">[^<]*<\/h1>\s*<p class="section-sub">[\s\S]*?<\/p>\s*<p class="section-sub mt-24[^>]*>[\s\S]*?<\/p>/;

function ensureCategoryIntroMarkers(html, relPathForError) {
  if (html.includes(M_CATEGORY_INTRO_START)) return html;
  if (!LEGACY_CATEGORY_INTRO_BLOCK_RE.test(html)) {
    throw new Error(
      `${relPathForError}: добавьте маркеры ${M_CATEGORY_INTRO_START} … ${M_CATEGORY_INTRO_END} вместо статического вводного блока (breadcrumbs, h1, два абзаца).`
    );
  }
  return html.replace(
    LEGACY_CATEGORY_INTRO_BLOCK_RE,
    `\n      ${M_CATEGORY_INTRO_START}\n      ${M_CATEGORY_INTRO_END}`
  );
}

function applyCategoryEmptyCatalogHost(html) {
  let out = html;
  if (out.includes(M_CATEGORY_CARDS_START)) {
    out = replaceCategoryCardsBlock(out, '\n        ');
  } else {
    throw new Error(
      `нет маркеров категории: ${M_CATEGORY_CARDS_START} … ${M_CATEGORY_CARDS_END}`
    );
  }
  out = out.replace(
    '<div class="catalog-split category-cards-below-intro">\n        <div class="catalog-main">\n',
    '<div class="catalog-split category-cards-below-intro">\n        <div class="catalog-main" id="catalog-cards-host">\n'
  );
  out = out.replace(
    /<div class="catalog-main">\s*\n\s*<!-- katalog:category-cards -->/,
    `<div class="catalog-main" id="catalog-cards-host">\n<!-- katalog:category-cards -->`
  );
  return out;
}

function headSeoBlock({ description, canonical, jsonLd }) {
  const lines = [
    `\n  <meta name="description" content="${escapeHtml(description)}">`,
    `  <link rel="canonical" href="${escapeHtml(canonical)}">`,
  ];
  if (jsonLd) {
    lines.push(
      `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
    );
  }
  return `${lines.join('\n')}\n  `;
}

function regionSeoNavHtml() {
  return `\n        <nav class="region-seo-nav" aria-label="Каталог по регионам">
          <a href="/">Главная</a>
          <span class="region-seo-sep">·</span>
          <a href="/regions/">Все субъекты РФ</a>
        </nav>\n        `;
}

function breadcrumbJson(regionLabel, regionPath) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Главная',
        item: `${SITE_ORIGIN}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: regionLabel,
        item: `${SITE_ORIGIN}${regionPath}`,
      },
    ],
  };
}

function setPageRegionAttr(html, regionSlug) {
  if (!regionSlug) return html;
  return html.replace(
    '<section class="section" id="catalog" data-catalog-section>',
    `<section class="section" id="catalog" data-catalog-section data-page-region="${escapeHtml(regionSlug)}">`
  );
}

function setPageCategoryAttr(html, categorySlug) {
  if (!categorySlug) return html;
  const esc = escapeHtml(categorySlug);
  if (/data-page-category="/.test(html)) {
    return html.replace(/data-page-category="[^"]*"/g, `data-page-category="${esc}"`);
  }
  return html.replace(
    '<section class="section">',
    `<section class="section" id="catalog" data-catalog-section data-page-category="${esc}">`
  );
}

function run() {
  const indexPath = path.join(root, 'index.html');
  let tpl = versionStaticAssets(fs.readFileSync(indexPath, 'utf8'), STYLES_VERSION);
  if (!tpl.includes(M_GRID_START)) {
    throw new Error('В index.html нет маркеров каталога (katalog:catalog-grid).');
  }

  const site = readJson(path.join(root, 'config', 'site.json'));
  const regions = readJson(path.join(root, 'data', 'regions.json'));
  const catalogPath = path.join(root, 'data', 'catalog.json');
  const catalog = readJson(catalogPath);
  const serviceCategories = Array.isArray(site.serviceCategories) ? site.serviceCategories : [];
  const goodsCategories = Array.isArray(site.goodsCategories) ? site.goodsCategories : [];
  const allCategories = [...serviceCategories, ...goodsCategories];

  const catOpts = buildCategoryOptions(allCategories);

  tpl = replaceBetween(tpl, M_CAT_OPTS_START, M_CAT_OPTS_END, catOpts);

  const homeDesc =
    'Каталог проверенных подрядчиков для бизнеса: металлообработка, автосервис, материалы из ценных пород, патронаж и другие услуги. Поиск по городу из подсказок и по рейтингу.';
  let homeHtml = replaceBetween(
    tpl,
    M_HEAD_SEO_START,
    M_HEAD_SEO_END,
    headSeoBlock({
      description: homeDesc,
      canonical: `${SITE_ORIGIN}/`,
      jsonLd: null,
    })
  );
  homeHtml = replaceBetween(homeHtml, M_REGION_NAV_START, M_REGION_NAV_END, '\n        ');
  homeHtml = replaceBetween(homeHtml, M_GRID_START, M_GRID_END, buildCardsGridInner(catalog));
  homeHtml = setPageRegionAttr(homeHtml, '');
  homeHtml = versionStaticAssets(homeHtml, STYLES_VERSION);
  fs.writeFileSync(indexPath, homeHtml.replace(/\r\n/g, '\n'), 'utf8');
  console.log('index.html: опции фильтров, SEO в <head>, карточки каталога');

  const rRoot = path.join(root, 'r');
  const allowedSlugs = new Set(regions.map((r) => r.slug));
  if (fs.existsSync(rRoot)) {
    for (const ent of fs.readdirSync(rRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (!allowedSlugs.has(ent.name)) {
        fs.rmSync(path.join(rRoot, ent.name), { recursive: true, force: true });
        console.log(`r/${ent.name}: удалена устаревшая папка`);
      }
    }
  }
  if (!fs.existsSync(rRoot)) fs.mkdirSync(rRoot, { recursive: true });

  for (const region of regions) {
    const slug = region.slug;
    const items = catalog.filter((c) => c.regionSlug === slug);
    const regionPath = `/r/${slug}/`;
    const canonical = `${SITE_ORIGIN}${regionPath}`;
    const title = `Каталог — ${region.label} — katalog-uslug.pro`;
    const desc = region.intro || homeDesc;

    let page = replaceBetween(tpl, M_CAT_OPTS_START, M_CAT_OPTS_END, catOpts);
    page = replaceBetween(
      page,
      M_HEAD_SEO_START,
      M_HEAD_SEO_END,
      headSeoBlock({
        description: desc,
        canonical,
        jsonLd: breadcrumbJson(region.label, regionPath),
      })
    );
    page = replaceBetween(page, M_REGION_NAV_START, M_REGION_NAV_END, regionSeoNavHtml());
    page = replaceBetween(page, M_GRID_START, M_GRID_END, buildCardsGridInner(items));
    page = setPageRegionAttr(page, slug);
    page = versionStaticAssets(page, STYLES_VERSION);
    page = page.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

    const dir = path.join(rRoot, slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const outFp = path.join(dir, 'index.html');
    fs.writeFileSync(outFp, page.replace(/\r\n/g, '\n'), 'utf8');
    console.log(
      `${path.relative(root, outFp)}: пустая сетка (в JSON для региона: ${items.length})`
    );
  }

  // Обработка категорий услуг
  for (const cat of serviceCategories) {
    const catSlug = cat.slug;
    const relPath = `c/${catSlug}/index.html`;
    const fp = path.join(root, ...relPath.split('/'));
    if (!fs.existsSync(fp)) {
      console.warn(
        `${relPath}: нет файла страницы категории — шаблон c/*/index.html с маркерами ${M_CATEGORY_INTRO_START}, ${M_CATEGORY_CARDS_START}`
      );
      continue;
    }
    let chtml = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
    const catLabel = typeof cat.label === 'string' ? cat.label.trim() : catSlug;
    const pageTitle = `${catLabel} — katalog-uslug.pro`;
    chtml = chtml.replace(
      /<title>[^<]*<\/title>/i,
      `<title>${escapeHtml(pageTitle)}</title>`
    );
    chtml = ensureCategoryIntroMarkers(chtml, relPath);
    const introLead =
      typeof cat.introLead === 'string' ? cat.introLead : '';
    chtml = replaceBetween(
      chtml,
      M_CATEGORY_INTRO_START,
      M_CATEGORY_INTRO_END,
      buildCategoryIntroInner(catLabel, introLead, false)
    );
    chtml = applyCategoryEmptyCatalogHost(chtml);
    chtml = setPageCategoryAttr(chtml, catSlug);
    chtml = versionStaticAssets(chtml, STYLES_VERSION);
    fs.writeFileSync(fp, chtml.replace(/\r\n/g, '\n'), 'utf8');
    const n = catalog.filter((i) => i.categorySlug === catSlug).length;
    console.log(`${relPath}: пустой host каталога (в БД ~${n} записей)`);
  }

  // Обработка категорий товаров
  for (const cat of goodsCategories) {
    const catSlug = cat.slug;
    const relPath = `goods/${catSlug}/index.html`;
    const fp = path.join(root, ...relPath.split('/'));
    if (!fs.existsSync(fp)) {
      console.warn(
        `${relPath}: нет файла страницы категории — шаблон goods/*/index.html с маркерами ${M_CATEGORY_INTRO_START}, ${M_CATEGORY_CARDS_START}`
      );
      continue;
    }
    let chtml = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
    const catLabel = typeof cat.label === 'string' ? cat.label.trim() : catSlug;
    const pageTitle = `${catLabel} — Товары — katalog-uslug.pro`;
    chtml = chtml.replace(
      /<title>[^<]*<\/title>/i,
      `<title>${escapeHtml(pageTitle)}</title>`
    );
    chtml = ensureCategoryIntroMarkers(chtml, relPath);
    const introLead =
      typeof cat.introLead === 'string' ? cat.introLead : '';
    chtml = replaceBetween(
      chtml,
      M_CATEGORY_INTRO_START,
      M_CATEGORY_INTRO_END,
      buildCategoryIntroInner(catLabel, introLead, true)
    );
    chtml = applyCategoryEmptyCatalogHost(chtml);
    chtml = setPageCategoryAttr(chtml, catSlug);
    chtml = versionStaticAssets(chtml, STYLES_VERSION);
    fs.writeFileSync(fp, chtml.replace(/\r\n/g, '\n'), 'utf8');
    const n = catalog.filter((i) => i.categorySlug === catSlug).length;
    console.log(`${relPath}: пустой host каталога (в БД ~${n} записей)`);
  }

  writeRegionsIndex(regions);
  console.log(`build-from-data: готово, регионов: ${regions.length}`);
}

function writeRegionsIndex(regions) {
  const dir = path.join(root, 'regions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ul = regions
    .map(
      (r) =>
        `        <li><a href="/r/${escapeHtml(r.slug)}/">${escapeHtml(r.label)}</a></li>`
    )
    .join('\n');
  const desc =
    'Каталог организаций по всем субъектам Российской Федерации: отдельные страницы для поиска и закладок.';
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Субъекты РФ — каталог по регионам — katalog-uslug.pro</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <link rel="canonical" href="${SITE_ORIGIN}/regions/">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css?v=${STYLES_VERSION}">
</head>
<body>

<!-- katalog:page-main -->
<main class="container" style="padding:40px 0 56px;">
  <nav class="breadcrumbs">
    <a href="/">Главная</a><span>/</span><span>Регионы</span>
  </nav>
  <h1 class="section-title">Каталог по субъектам Российской Федерации</h1>
  <p class="section-sub">У каждого субъекта — своя страница <code>/r/…/</code> с каноническим адресом для поисковых систем.</p>
  <ul class="regions-index-list">
${ul}
  </ul>
</main>
<!-- katalog:page-main-end -->

  <script src="/js/main.js?v=${STYLES_VERSION}"></script>
</body>
</html>
`;
  const fp = path.join(dir, 'index.html');
  fs.writeFileSync(fp, html.replace(/\r\n/g, '\n'), 'utf8');
  console.log(`${path.relative(root, fp)}: список регионов`);
}

run();
