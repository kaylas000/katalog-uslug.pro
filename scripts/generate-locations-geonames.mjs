import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

const GEO_URL = "https://download.geonames.org/export/dump/RU.zip";
const RU_CITIES_URL = "https://raw.githubusercontent.com/pensnarik/russian-cities/master/russian-cities.json";
const MIN_POPULATION = 3000;
const IMPORTANT_SETTLEMENTS = new Set(["чемодановка", "chemodanovka"]);
const MANUAL_OVERRIDES = [
  { kind: "settlement", slug: "chemodanovka", label: "Чемодановка", parentSlug: "penzenskaya-oblast" },
  { kind: "settlement", slug: "tomilino", label: "Томилино", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "malahovka", label: "Малаховка", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "nahabino", label: "Нахабино", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "oktyabrskiy-mo", label: "Октябрьский", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "kraskovo", label: "Красково", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "udelnaya", label: "Удельная", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "bykovo-mo", label: "Быково", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "tuchkovo", label: "Тучково", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "sofrino", label: "Софрино", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "selyatino", label: "Селятино", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "zaprudnya", label: "Запрудня", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "verbilki", label: "Вербилки", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "obuhovo-mo", label: "Обухово", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "serebryanye-prudy", label: "Серебряные Пруды", parentSlug: "moskovskaya-oblast" },
  { kind: "settlement", slug: "shahovskaya", label: "Шаховская", parentSlug: "moskovskaya-oblast" },
];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function normCompact(s) {
  return norm(s).replace(/\s+/g, "");
}

function slugifyRu(text) {
  const map = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqSlug(base, used, fallback) {
  let s = base || fallback;
  if (!s) s = `loc-${Math.random().toString(36).slice(2, 10)}`;
  if (!used.has(s)) {
    used.add(s);
    return s;
  }
  let i = 2;
  while (used.has(`${s}-${i}`)) i += 1;
  const out = `${s}-${i}`;
  used.add(out);
  return out;
}

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function parseGeonamesRows(tsv) {
  return tsv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const p = line.split("\t");
      return {
        geonameId: p[0],
        name: p[1],
        alternates: p[3] || "",
        countryCode: p[8],
        featureClass: p[6],
        featureCode: p[7],
        admin1: p[10],
        admin2: p[11],
        population: Number.parseInt(p[14] || "0", 10) || 0,
      };
    })
    .filter((x) => x.countryCode === "RU");
}

function buildRegionMatcher(regions) {
  const direct = new Map();
  for (const r of regions) {
    direct.set(normCompact(r.label), r.slug);
  }

  const aliases = new Map([
    ["хантымансийскийавтономныйокругюгра", "hantymansiyskiy-avtonomnyy-okrug-yugra"],
    ["чувашскаяреспублика", "chuvashskaya-respublika-chuvashiya"],
    ["республикасахаякутия", "respublika-saha"],
    ["кемеровскаяобластькузбасс", "kemerovskaya-oblast-kuzbass"],
    ["санктпетербург", "sankt-peterburg"],
    ["всяроссия", "rossiya"],
  ]);

  function resolve(label) {
    const compact = normCompact(label);
    if (direct.has(compact)) return direct.get(compact);
    if (aliases.has(compact)) return aliases.get(compact);
    return null;
  }

  return { resolve };
}

function shouldIncludePlace(row) {
  const n = norm(row.name);
  if (IMPORTANT_SETTLEMENTS.has(n)) return true;
  if (["PPLC", "PPLA", "PPLA2", "PPLA3", "PPLA4"].includes(row.featureCode)) return true;
  return row.population >= MIN_POPULATION;
}

function hasCyrillic(text) {
  return /[а-яё]/i.test(String(text || ""));
}

function pickRussianLabel(row) {
  const base = String(row.name || "").trim();
  if (hasCyrillic(base)) return base;
  const alts = String(row.alternates || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const ru = alts.find((x) => hasCyrillic(x) && x.length >= 2);
  return ru || base;
}

async function main() {
  const regions = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "data", "regions.json"), "utf8")
  );
  const { resolve } = buildRegionMatcher(regions);

  console.log("Downloading geonames RU.zip...");
  const zipBuf = await fetchBuffer(GEO_URL);
  const zip = unzipSync(new Uint8Array(zipBuf));
  const entry = zip["RU.txt"];
  if (!entry) throw new Error("RU.txt not found in archive");
  const rows = parseGeonamesRows(strFromU8(entry));
  console.log(`Loaded geonames rows: ${rows.length}`);

  const adm1Rows = rows.filter((x) => x.featureClass === "A" && x.featureCode === "ADM1");
  const admin1ToRegionSlug = new Map();
  for (const a1 of adm1Rows) {
    let slug = resolve(a1.name);
    if (!slug && a1.alternates) {
      const alts = a1.alternates
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 100);
      for (const alt of alts) {
        slug = resolve(alt);
        if (slug) break;
      }
    }
    if (slug) admin1ToRegionSlug.set(a1.admin1, slug);
  }

  const out = [];
  const usedSlugs = new Set();
  const districtByAdmin = new Map();

  const adm2Rows = rows.filter((x) => x.featureClass === "A" && x.featureCode === "ADM2");
  for (const d of adm2Rows) {
    const regionSlug = admin1ToRegionSlug.get(d.admin1);
    if (!regionSlug || !d.admin2) continue;
    let label = pickRussianLabel(d);
    if (!/район|округ/i.test(label)) label = `${label} район`;
    const slug = uniqSlug(
      `${regionSlug}-${slugifyRu(label)}`,
      usedSlugs,
      `${regionSlug}-adm2-${d.admin2}`
    );
    out.push({
      kind: "district",
      slug,
      label,
      parentSlug: regionSlug,
    });
    districtByAdmin.set(`${d.admin1}:${d.admin2}`, slug);
  }

  const placeRows = rows.filter((x) => x.featureClass === "P" && shouldIncludePlace(x));
  for (const p of placeRows) {
    const regionSlug = admin1ToRegionSlug.get(p.admin1);
    if (!regionSlug) continue;
    const key = `${p.admin1}:${p.admin2 || ""}`;
    const parentSlug = districtByAdmin.get(key) || regionSlug;
    const label = pickRussianLabel(p);
    const n = norm(label);
    const isSettlement =
      /поселок|пгт|рабочий/.test(n) || (p.population < 15000 && p.featureCode === "PPL");
    const kind = isSettlement ? "settlement" : "city";
    const slug = uniqSlug(
      `${regionSlug}-${slugifyRu(label)}`,
      usedSlugs,
      `${regionSlug}-${p.geonameId}`
    );
    out.push({
      kind,
      slug,
      label,
      parentSlug,
    });
  }

  const byNormRegion = new Map(
    regions.map((r) => [normCompact(r.label), r.slug])
  );
  const regionAliases = new Map([
    ["чувашия", "chuvashskaya-respublika-chuvashiya"],
    ["саха", "respublika-saha"],
    ["удмуртия", "udmurtskaya-respublika"],
    ["марийэл", "respublika-mariy-el"],
    ["карачаевочеркесия", "karachaevocherkesskaya-respublika"],
    ["кабардинобалкария", "kabardinobalkarskaya-respublika"],
    ["севернаяосетия", "respublika-severnaya-osetiya-alaniya"],
    ["хантымансийскийао", "hantymansiyskiy-avtonomnyy-okrug-yugra"],
    ["ямалоненецкийао", "yamalonenetskiy-avtonomnyy-okrug"],
    ["ненецкийао", "nenetskiy-avtonomnyy-okrug"],
    ["чукотскийао", "chukotskiy-avtonomnyy-okrug"],
    ["санктпетербург", "sankt-peterburg"],
    ["севастополь", "sevastopol"],
  ]);

  console.log("Downloading Russian cities list...");
  const citiesResp = await fetch(RU_CITIES_URL);
  if (citiesResp.ok) {
    const cities = await citiesResp.json();
    for (const c of cities) {
      const label = String(c?.name || "").trim();
      if (!label) continue;
      const pop = Number.parseInt(String(c?.population || "0"), 10) || 0;
      if (pop < MIN_POPULATION && !IMPORTANT_SETTLEMENTS.has(norm(label))) continue;
      const subj = String(c?.subject || "").trim();
      if (!subj) continue;
      const k = normCompact(subj);
      const regionSlug = byNormRegion.get(k) || regionAliases.get(k);
      if (!regionSlug) continue;
      const slug = uniqSlug(
        `${regionSlug}-${slugifyRu(label)}`,
        usedSlugs,
        `${regionSlug}-${Math.random().toString(36).slice(2, 8)}`
      );
      out.push({
        kind: "city",
        slug,
        label,
        parentSlug: regionSlug,
      });
    }
  }

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.label.localeCompare(b.label, "ru");
  });

  const seen = new Set(out.map((x) => x.slug));
  for (const m of MANUAL_OVERRIDES) {
    if (seen.has(m.slug)) continue;
    out.push(m);
    seen.add(m.slug);
  }

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.label.localeCompare(b.label, "ru");
  });

  const outPath = path.join(repoRoot, "data", "locations.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Generated ${out.length} locations -> data/locations.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
