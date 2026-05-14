/**
 * Собирает partials/site-header.html и partials/site-footer.html из
 * partials/*.template.html + config/site.json — меню и ссылки в одном месте.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function normalizeEOL(s) {
  return s.replace(/\r\n/g, '\n');
}

/**
 * Вставляет site-header.html и site-footer.html во все index.html,
 * содержащие маркеры {{SITE_HEADER}} / {{SITE_FOOTER}}.
 */
function injectPartials() {
  const header = fs.readFileSync(path.join(root, 'partials', 'site-header.html'), 'utf8').replace(/\s+$/, '');
  const footer = fs.readFileSync(path.join(root, 'partials', 'site-footer.html'), 'utf8').replace(/\s+$/, '');

  /** Рекурсивно обходит директорию, вызывая cb для каждого index.html */
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'worker') {
        walk(full);
      } else if (e.name === 'index.html') {
        processFile(full);
      }
    }
  }

  function processFile(abs) {
    let html;
    try { html = fs.readFileSync(abs, 'utf8'); } catch { return; }
    if (!html.includes('{{SITE_HEADER}}') && !html.includes('{{SITE_FOOTER}}')) return;

    const rel = path.relative(root, abs);
    const newHtml = html
      .replace(/\{\{SITE_HEADER\}\}/g, header)
      .replace(/\{\{SITE_FOOTER\}\}/g, footer);
    if (newHtml !== html) {
      fs.writeFileSync(abs, newHtml.replace(/\s+$/, '') + '\n', 'utf8');
      console.log(`  injected layout: ${rel}`);
    }
  }

  console.log('inject-partials:');
  walk(root);
  console.log('inject-partials: done');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function loadSite() {
  const p = path.join(root, 'config', 'site.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function categoryHref(category) {
  return category.href || `/c/${category.slug}/`;
}

function goodsCategoryHref(category) {
  return category.href || `/goods/${category.slug}/`;
}

function main() {
  const site = loadSite();
  const serviceCats = site.serviceCategories || [];
  const goodsCats = site.goodsCategories || [];
  const footerCatsList = site.footerCategories || [...serviceCats, ...goodsCats];

  const serviceCatDesktop = serviceCats
    .map((c) => `            <a href="${escAttr(categoryHref(c))}">${escAttr(c.label)}</a>`)
    .join('\n');
  const serviceCatMobile = serviceCats
    .map((c) => `      <a href="${escAttr(categoryHref(c))}">${escAttr(c.label)}</a>`)
    .join('\n');
  
  const goodsCatDesktop = goodsCats
    .map((c) => `            <a href="${escAttr(goodsCategoryHref(c))}">${escAttr(c.label)}</a>`)
    .join('\n');
  const goodsCatMobile = goodsCats
    .map((c) => `      <a href="${escAttr(goodsCategoryHref(c))}">${escAttr(c.label)}</a>`)
    .join('\n');
    
  const footerCats = footerCatsList
    .map((c) => `          <a href="${escAttr(categoryHref(c))}">${escAttr(c.label)}</a>`)
    .join('\n');

  function navItemHtml(item) {
    if (item.submenu) {
      const items = item.submenu
        .map((sub) => `            <a href="${escAttr(sub.href)}">${escAttr(sub.label)}</a>`)
        .join('\n');
      return `        <div class="nav-item has-submenu">
          <button class="nav-link nav-submenu-toggle" aria-expanded="false">${escAttr(item.label)}</button>
          <div class="submenu">
${items}
          </div>
        </div>`;
    }
    return `        <a href="${escAttr(item.href)}">${escAttr(item.label)}</a>`;
  }

  function mobileNavItemHtml(item) {
    if (item.submenu) {
      return item.submenu
        .map((sub) => `      <a href="${escAttr(sub.href)}">${escAttr(sub.label)}</a>`)
        .join('\n');
    }
    return `      <a href="${escAttr(item.href)}">${escAttr(item.label)}</a>`;
  }

  const desktopAfter = (site.desktopNavAfterCategories || [])
    .map(navItemHtml)
    .join('\n');

  const mobileAfter = (site.mobileNavAfterCategories || [])
    .map(mobileNavItemHtml)
    .join('\n');

  const add = site.addPrimaryCta || { href: '/add/', label: 'Добавить организацию' };
  let accountHref = typeof site.accountBasePath === 'string' ? site.accountBasePath.trim() : '/account/';
  if (!accountHref.startsWith('/')) accountHref = `/${accountHref}`;
  if (!accountHref.endsWith('/')) accountHref = `${accountHref}/`;

  const footerTools = (site.footerTools || [])
    .map((l) => `          <a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
    .join('\n');

  const legal = (site.footerLegal || [])
    .map((l) => `<a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
    .join(' · ');

  const headerTpl = normalizeEOL(fs.readFileSync(path.join(root, 'partials', 'site-header.template.html'), 'utf8'));
  let header = headerTpl
    .replace('{{SERVICE_CATEGORIES_DESKTOP}}', serviceCatDesktop)
    .replace('{{SERVICE_CATEGORIES_MOBILE}}', serviceCatMobile)
    .replace('{{GOODS_CATEGORIES_DESKTOP}}', goodsCatDesktop)
    .replace('{{GOODS_CATEGORIES_MOBILE}}', goodsCatMobile)
    .replace('{{DESKTOP_NAV_AFTER}}', desktopAfter)
    .replace('{{MOBILE_NAV_AFTER}}', mobileAfter)
    .replace(/\{\{ADD_HREF\}\}/g, escAttr(add.href))
    .replace(/\{\{ADD_LABEL\}\}/g, escAttr(add.label))
    .replace(/\{\{ACCOUNT_HREF\}\}/g, escAttr(accountHref));

  const footerTpl = normalizeEOL(fs.readFileSync(path.join(root, 'partials', 'site-footer.template.html'), 'utf8'));
  let footer = footerTpl
    .replace('{{FOOTER_CATEGORIES}}', footerCats)
    .replace('{{FOOTER_TOOLS}}', footerTools)
    .replace('{{FOOTER_LEGAL}}', legal || '');

  fs.writeFileSync(path.join(root, 'partials', 'site-header.html'), header.replace(/\s+$/, '') + '\n', 'utf8');
  fs.writeFileSync(path.join(root, 'partials', 'site-footer.html'), footer.replace(/\s+$/, '') + '\n', 'utf8');
  console.log('partials: site-header.html + site-footer.html OK (из config/site.json)');
}

main();
injectPartials();
