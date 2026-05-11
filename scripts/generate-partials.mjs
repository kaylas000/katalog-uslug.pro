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

  const desktopAfter = (site.desktopNavAfterCategories || [])
    .map((l) => `        <a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
    .join('\n');

  const mobileAfter = (site.mobileNavAfterCategories || [])
    .map((l) => `      <a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
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
