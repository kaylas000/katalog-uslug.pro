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

function categoryHref(slug) {
  return `/c/${slug}/`;
}

function main() {
  const site = loadSite();
  const cats = site.categories || [];

  const catDesktop = cats
    .map((c) => `            <a href="${escAttr(categoryHref(c.slug))}">${escAttr(c.label)}</a>`)
    .join('\n');
  const catMobile = cats
    .map((c) => `      <a href="${escAttr(categoryHref(c.slug))}">${escAttr(c.label)}</a>`)
    .join('\n');
  const footerCats = cats
    .map((c) => `          <a href="${escAttr(categoryHref(c.slug))}">${escAttr(c.label)}</a>`)
    .join('\n');

  const desktopAfter = (site.desktopNavAfterCategories || [])
    .map((l) => `        <a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
    .join('\n');

  const mobileAfter = (site.mobileNavAfterCategories || [])
    .map((l) => `      <a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
    .join('\n');

  const add = site.addPrimaryCta || { href: '/add/', label: 'Добавить организацию' };

  const footerTools = (site.footerTools || [])
    .map((l) => `          <a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
    .join('\n');

  const legal = (site.footerLegal || [])
    .map((l) => `<a href="${escAttr(l.href)}">${escAttr(l.label)}</a>`)
    .join(' · ');

  const headerTpl = normalizeEOL(fs.readFileSync(path.join(root, 'partials', 'site-header.template.html'), 'utf8'));
  let header = headerTpl
    .replace('{{CATEGORIES_DESKTOP}}', catDesktop)
    .replace('{{CATEGORIES_MOBILE}}', catMobile)
    .replace('{{DESKTOP_NAV_AFTER}}', desktopAfter)
    .replace('{{MOBILE_NAV_AFTER}}', mobileAfter)
    .replace(/\{\{ADD_HREF\}\}/g, escAttr(add.href))
    .replace(/\{\{ADD_LABEL\}\}/g, escAttr(add.label));

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
