// scripts/verify-migration.mjs
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function ok(msg) { console.log(`[OK]  ${msg}`); }
function fail(msg) { console.log(`[ERR] ${msg}`); process.exitCode = 1; }
async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function read(p) {
  return await fs.readFile(p, "utf8");
}

async function walk(dir) {
  const out = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const it of items) {
    // пропускаем тяжелое/неважное
    if (it.name === "node_modules" || it.name === ".git" || it.name === "dist") continue;
    const full = path.join(dir, it.name);
    if (it.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function containsAny(text, needles) {
  return needles.some((n) => text.includes(n));
}

function countRegex(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

async function checkFileMustExist(rel) {
  const p = path.join(ROOT, rel);
  if (await exists(p)) ok(`exists: ${rel}`);
  else fail(`missing file: ${rel}`);
}

async function checkNoOrgSlugFiles() {
  const orgDir = path.join(ROOT, "org");
  if (!(await exists(orgDir))) return fail("missing org/ directory");

  const files = await walk(orgDir);
  const bad = files.filter((f) => {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    // запрещаем org/<slug>/index.html, разрешаем только org/index.html
    return rel.startsWith("org/") && rel.endsWith("/index.html") && rel !== "org/index.html";
  });

  if (bad.length === 0) ok("no static org/<slug>/index.html pages (good)");
  else {
    fail(`found static org pages (must be removed):\n  - ${bad.map(f => path.relative(ROOT, f)).join("\n  - ")}`);
  }
}

async function checkRedirects() {
  const p = path.join(ROOT, "_redirects");
  if (!(await exists(p))) return fail("missing _redirects (needed for /org/* rewrite)");

  const t = await read(p);
  const normalized = t.replace(/\s+/g, " ").trim();
  if (normalized.includes("/org/* /org/index.html 200")) ok("_redirects contains org rewrite rule");
  else fail(`_redirects does not contain required rule: /org/* /org/index.html 200`);
}

async function checkMainJsNoStaticCatalog() {
  const p = path.join(ROOT, "js", "main.js");
  if (!(await exists(p))) return fail("missing js/main.js");

  const t = await read(p);

  if (t.includes("/data/catalog.json")) {
    fail("js/main.js still references /data/catalog.json (must use API v2)");
  } else ok("js/main.js: no /data/catalog.json");

  // запрет гидрации карточек через HTML страниц организаций
  const banned = [
    "hydrateCatalogCardsFromOrgPages",
    "loadOrgCardText(",
    "org-article",
    "org-showcase-aside",
  ];
  if (containsAny(t, banned)) {
    fail(`js/main.js contains banned legacy hydration markers: ${banned.filter(x => t.includes(x)).join(", ")}`);
  } else ok("js/main.js: no legacy hydration from org HTML");

  // признак что реально ходим в API v2
  if (t.includes("/v1/catalog") && (t.includes("v=2") || t.includes("v', '2") || t.includes('v","2'))) {
    ok("js/main.js: appears to call /v1/catalog with v=2");
  } else {
    fail("js/main.js: cannot detect /v1/catalog?v=2 usage (check fetch URL)");
  }
}

async function checkCatalogV2LooksPaginated() {
  const p = path.join(ROOT, "worker", "src", "catalog-v2.ts");
  if (!(await exists(p))) return fail("missing worker/src/catalog-v2.ts");

  const t = await read(p);

  if (!t.includes("LIMIT")) fail("catalog-v2.ts: SQL does not contain LIMIT (pagination likely fake)");
  else ok("catalog-v2.ts: has LIMIT");

  if (!t.includes("ORDER BY")) fail("catalog-v2.ts: SQL does not contain ORDER BY (cursor pagination suspicious)");
  else ok("catalog-v2.ts: has ORDER BY");

  // минимальный “маркер курсора”
  if (!t.includes("nextCursor")) fail("catalog-v2.ts: cannot find nextCursor logic");
  else ok("catalog-v2.ts: has nextCursor logic");
}

async function checkOrgPublicExists() {
  const p = path.join(ROOT, "worker", "src", "org-public.ts");
  if (await exists(p)) ok("worker/src/org-public.ts exists");
  else fail("missing worker/src/org-public.ts");
}

async function checkCategoryAndRegionPagesAreContainers() {
  // категории
  const cDir = path.join(ROOT, "c");
  if (await exists(cDir)) {
    const files = (await walk(cDir)).filter(f => f.endsWith(`${path.sep}index.html`) || f.endsWith("/index.html"));
    let bad = 0;
    for (const f of files) {
      const t = await read(f);
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");

      if (!t.includes("data-catalog-section")) { bad++; fail(`${rel}: missing data-catalog-section`); continue; }
      if (!t.includes("data-page-category="))  { bad++; fail(`${rel}: missing data-page-category="..."`); continue; }
      if (!t.includes('id="catalog-cards-host"')) { bad++; fail(`${rel}: missing id="catalog-cards-host"`); continue; }

      // карточек не должно быть “вшито”
      if (t.includes("catalog-card-wide")) { bad++; fail(`${rel}: still contains static cards (catalog-card-wide)`); continue; }
    }
    if (bad === 0) ok("category pages: container-only, no static cards");
  }

  // регионы
  const rDir = path.join(ROOT, "r");
  if (await exists(rDir)) {
    const files = (await walk(rDir)).filter(f => f.endsWith(`${path.sep}index.html`) || f.endsWith("/index.html"));
    let bad = 0;
    for (const f of files) {
      const t = await read(f);
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");

      if (!t.includes("data-catalog-section")) { bad++; fail(`${rel}: missing data-catalog-section`); continue; }
      if (!t.includes("data-page-region="))    { bad++; fail(`${rel}: missing data-page-region="..."`); continue; }
      if (!t.includes('id="catalog-cards-host"')) { bad++; fail(`${rel}: missing id="catalog-cards-host"`); continue; }

      if (t.includes("catalog-card-wide")) { bad++; fail(`${rel}: still contains static cards (catalog-card-wide)`); continue; }
    }
    if (bad === 0) ok("region pages: container-only, no static cards");
  }
}

async function optionalApiSmoke() {
  const base = (process.env.KATALOG_API_BASE || "").trim().replace(/\/$/, "");
  if (!base) {
    console.log("[SKIP] API smoke: set env KATALOG_API_BASE to run (e.g. https://xxx.workers.dev)");
    return;
  }

  try {
    const u1 = `${base}/v1/catalog?v=2&limit=2&sort=title`;
    const r1 = await fetch(u1);
    if (!r1.ok) return fail(`API smoke: ${u1} -> HTTP ${r1.status}`);
    const j1 = await r1.json();

    if (!Array.isArray(j1.items)) return fail("API smoke: items is not array");
    if (j1.items.length !== 2 && j1.items.length !== 1 && j1.items.length !== 0) {
      // допускаем меньше 2 если в БД мало данных
      fail(`API smoke: unexpected items length: ${j1.items.length}`);
    }
    if (j1.items.length >= 2 && !j1.nextCursor) fail("API smoke: nextCursor missing on first page (with >=2 items)");
    else ok("API smoke: /v1/catalog?v=2 returns items + nextCursor");

    if (j1.nextCursor) {
      const u2 = `${base}/v1/catalog?v=2&limit=2&sort=title&cursor=${encodeURIComponent(j1.nextCursor)}`;
      const r2 = await fetch(u2);
      if (!r2.ok) return fail(`API smoke: page2 -> HTTP ${r2.status}`);
      const j2 = await r2.json();
      ok("API smoke: page2 fetched");

      const first1 = j1.items?.[0]?.id;
      const first2 = j2.items?.[0]?.id;
      if (first1 && first2 && first1 === first2) fail("API smoke: page1 and page2 start with same id (pagination suspicious)");
      else ok("API smoke: pagination seems to move forward");
    }
  } catch (e) {
    fail(`API smoke error: ${e?.message || String(e)}`);
  }
}

async function main() {
  console.log("=== verify migration (DoD) ===");

  await checkFileMustExist("org/index.html");
  await checkFileMustExist("js/org.js");
  await checkFileMustExist("worker/src/catalog-v2.ts");
  await checkFileMustExist("worker/src/catalog-cursor.ts");
  await checkOrgPublicExists();
  await checkRedirects();
  await checkNoOrgSlugFiles();

  await checkMainJsNoStaticCatalog();
  await checkCatalogV2LooksPaginated();
  await checkCategoryAndRegionPagesAreContainers();

  await optionalApiSmoke();

  if (process.exitCode) {
    console.log("\nFAILED: fix issues above.");
    process.exit(process.exitCode);
  } else {
    console.log("\nPASSED: migration checks look OK.");
  }
}

main();