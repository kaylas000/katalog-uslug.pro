/**
 * Собирает каталог из data/catalog.json + data/regions.json + config/site.json:
 * — подставляет опции фильтров и карточки в index.html;
 * — генерирует статические страницы r/<регион>/index.html (канонический URL для SEO по регионам).
 *
 * Запуск: npm run build:data
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://katalog-uslug.pro').replace(/\/+$/, '');

const M_HEAD_SEO_START = '<!-- katalog:gen-head-seo -->';
const M_HEAD_SEO_END = '<!-- /katalog:gen-head-seo -->';
const M_REGION_NAV_START = '<!-- katalog:gen-region-seo-nav -->';
const M_REGION_NAV_END = '<!-- /katalog:gen-region-seo-nav -->';
const M_REGION_OPTS_START = '<!-- katalog:gen-region-options -->';
const M_REGION_OPTS_END = '<!-- /katalog:gen-region-options -->';
const M_CAT_OPTS_START = '<!-- katalog:gen-category-options -->';
const M_CAT_OPTS_END = '<!-- /katalog:gen-category-options -->';
const M_GRID_START = '<!-- katalog:catalog-grid -->';
const M_GRID_END = '<!-- /katalog:catalog-grid -->';
const STYLES_VERSION = '20260516';
const MAIN_JS_VERSION = '20260517';

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOrgPortfolioImagesFromHtml(html) {
  const start = html.indexOf('data-portfolio-source');
  if (start === -1) return [];
  const chunk = html.slice(start, start + 12000);
  const re = /data-slide-src="([^"]+)"/gi;
  const urls = [];
  let m;
  while ((m = re.exec(chunk)) !== null) {
    if (!urls.includes(m[1])) urls.push(m[1]);
  }
  return urls;
}

function extractOrgCardContentFromHtml(html) {
  const contactsMatch = html.match(
    /<div class="sidebar-card">\s*<h3>Контакты<\/h3>([\s\S]*?)<\/div>\s*<div class="sidebar-card">/i
  );
  const firstBlockMatch = html.match(
    /<div class="org-article">[\s\S]*?<div class="content-block">([\s\S]*?)<\/div>/i
  );
  if (!contactsMatch || !firstBlockMatch) return null;

  const rowRe = /<div class="sidebar-row">([\s\S]*?)<\/div>/gi;
  const rows = [];
  let rowMatch;
  while ((rowMatch = rowRe.exec(contactsMatch[1])) !== null) {
    const t = stripTags(rowMatch[1]);
    if (t) rows.push(t);
  }
  const pRe = /<p>([\s\S]*?)<\/p>/gi;
  const paragraphs = [];
  let pMatch;
  while ((pMatch = pRe.exec(firstBlockMatch[1])) !== null) {
    const t = stripTags(pMatch[1]);
    if (t) paragraphs.push(t);
  }
  if (!rows.length || !paragraphs.length) return null;

  return {
    subtitle: rows.slice(0, 4).join('\n'),
    text: paragraphs.join('\n\n'),
  };
}

function extractOrgPageBundle(orgUrl) {
  if (!orgUrl || !orgUrl.startsWith('/org/')) return null;
  const parts = orgUrl.split('/').filter(Boolean);
  const slug = parts[1];
  if (!slug) return null;
  const fp = path.join(root, 'org', slug, 'index.html');
  if (!fs.existsSync(fp)) return null;

  const html = fs.readFileSync(fp, 'utf8');
  const portfolioImages = extractOrgPortfolioImagesFromHtml(html);
  const card = extractOrgCardContentFromHtml(html);
  if (!card && !portfolioImages.length) return null;
  return {
    ...(card || {}),
    portfolioImages,
  };
}

function catalogMediaSlidesHtml(portfolioImages) {
  const imgs = Array.isArray(portfolioImages) ? portfolioImages.filter(Boolean) : [];
  const gradients = ['s1', 's2', 's3'];
  const n = imgs.length === 0 ? 3 : Math.min(4, Math.max(3, imgs.length));
  const slides = [];
  for (let i = 0; i < n; i++) {
    const isActive = i === 0 ? ' is-active' : '';
    const url = imgs.length ? imgs[i % imgs.length] : null;
    if (url) {
      const u = escapeHtml(url);
      slides.push(
        `<span class="catalog-slide catalog-slide-photo${isActive}" style="background-image:url(&quot;${u}&quot;)"></span>`
      );
    } else {
      slides.push(`<span class="catalog-slide ${gradients[i % 3]}${isActive}"></span>`);
    }
  }
  return slides.map((s) => `              ${s}`).join('\n');
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

function buildRegionOptions(regions) {
  const lines = ['\n            <option value="">Все регионы</option>'];
  for (const r of regions) {
    lines.push(`            <option value="${escapeHtml(r.slug)}">${escapeHtml(r.label)}</option>`);
  }
  return `${lines.join('\n')}\n            `;
}

function reviewsLabel(n) {
  const x = Number(n) || 0;
  const mod10 = x % 10;
  const mod100 = x % 100;
  if (mod10 === 1 && mod100 !== 11) return `${x} отзыв`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${x} отзыва`;
  return `${x} отзывов`;
}

function cardHtml(item) {
  const rating = typeof item.rating === 'number' ? item.rating.toFixed(1) : escapeHtml(item.rating);
  const href = escapeHtml(item.url || '#');
  const rs = escapeHtml(item.regionSlug || '');
  const cs = escapeHtml(item.categorySlug || '');
  const subtitleHtml = escapeHtml(item.subtitle || '').replace(/\n/g, '<br>');
  const textHtml = escapeHtml(item.text || '').replace(/\n/g, '<br>');
  return `        <article class="card catalog-card-wide" data-region-slug="${rs}" data-category-slug="${cs}" data-org-url="${href}">
          <div class="catalog-card-layout">
            <div class="catalog-media" data-auto-slider>
${catalogMediaSlidesHtml(item.portfolioImages)}
              <span class="catalog-media-label">Фото</span>
            </div>
            <div class="catalog-card-content">
              <div class="tag-row">
                <span class="tag">${escapeHtml(item.categoryLabel)}</span>
                <span class="tag tag-green">${escapeHtml(item.regionLabel)}</span>
              </div>
              <h3 class="card-title">${escapeHtml(item.title)}</h3>
              <p class="catalog-card-text catalog-card-text-main">${subtitleHtml}</p>
              <p class="catalog-card-text catalog-card-about"><strong>О компании:</strong> ${textHtml}</p>
              <div class="catalog-card-footer">
                <span class="tag tag-accent">★ ${rating} · ${reviewsLabel(item.reviews)}</span>
                <a href="${href}" class="btn btn-sm btn-primary">Подробнее →</a>
              </div>
            </div>
          </div>
        </article>`;
}

function catalogEmptyInner() {
  return `        <div class="catalog-empty" role="status">
          <p class="catalog-empty-title">Ничего не найдено</p>
          <p class="catalog-empty-text">Смените регион, категорию или поисковый запрос — либо откройте <a href="/regions/">список всех субъектов РФ</a>.</p>
        </div>`;
}

function buildCardsGridInner(items) {
  if (!items.length) {
    return `\n      <div class="catalog-split">\n        <div class="catalog-main" id="catalog-cards-host">\n${catalogEmptyInner()}\n        </div>\n        <aside class="catalog-side"><div class="catalog-side-placeholder"></div></aside>\n      </div>\n      `;
  }
  const cards = items.map(cardHtml).join('\n');
  return `\n      <div class="catalog-split">\n        <div class="catalog-main" id="catalog-cards-host">\n${cards}\n        </div>\n        <aside class="catalog-side"><div class="catalog-side-placeholder"></div></aside>\n      </div>\n      `;
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

function run() {
  const indexPath = path.join(root, 'index.html');
  let tpl = fs.readFileSync(indexPath, 'utf8');
  if (!tpl.includes(M_GRID_START)) {
    throw new Error('В index.html нет маркеров каталога (katalog:catalog-grid).');
  }

  const site = readJson(path.join(root, 'config', 'site.json'));
  const regions = readJson(path.join(root, 'data', 'regions.json'));
  const catalogPath = path.join(root, 'data', 'catalog.json');
  const catalogRaw = readJson(catalogPath);
  const catalog = catalogRaw.map((item) => {
    const bundle = extractOrgPageBundle(item.url);
    if (!bundle) return item;
    const next = { ...item };
    if (bundle.subtitle && bundle.text) {
      next.subtitle = bundle.subtitle;
      next.text = bundle.text;
    }
    if (bundle.portfolioImages?.length) {
      next.portfolioImages = bundle.portfolioImages;
    }
    return next;
  });
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log('data/catalog.json: тексты и portfolioImages синхронизированы со страницами org');
  const categories = Array.isArray(site.categories) ? site.categories : [];

  const catOpts = buildCategoryOptions(categories);
  const regOpts = buildRegionOptions(regions);

  tpl = replaceBetween(tpl, M_CAT_OPTS_START, M_CAT_OPTS_END, catOpts);
  tpl = replaceBetween(tpl, M_REGION_OPTS_START, M_REGION_OPTS_END, regOpts);

  const homeDesc =
    'Каталог проверенных подрядчиков для бизнеса: металлообработка, автосервис, патронаж и другие услуги. Фильтры по региону и рейтингу.';
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
    page = replaceBetween(page, M_REGION_OPTS_START, M_REGION_OPTS_END, regOpts);
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
    page = page.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

    const dir = path.join(rRoot, slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const outFp = path.join(dir, 'index.html');
    fs.writeFileSync(outFp, page.replace(/\r\n/g, '\n'), 'utf8');
    console.log(`${path.relative(root, outFp)}: ${items.length} карточек`);
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

  <script src="/js/main.js?v=${MAIN_JS_VERSION}"></script>
</body>
</html>
`;
  const fp = path.join(dir, 'index.html');
  fs.writeFileSync(fp, html.replace(/\r\n/g, '\n'), 'utf8');
  console.log(`${path.relative(root, fp)}: список регионов`);
}

run();
