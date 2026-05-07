import fs from "node:fs";
import pg from "pg";

const cs = fs.readFileSync(new URL("../neon.local.txt", import.meta.url), "utf8")
  .trim()
  .replace(/^\uFEFF/, "");

const client = new pg.Client({ connectionString: cs });

/** Положите файлы в images/portfolio/durapan/ (например 1.jpg … 4.jpg, cover.jpg), задеплойте сайт, затем заполните URL ниже и выполните: node tools/fix-durapan.mjs */
const portfolio = [
  // "https://katalog-uslug.pro/images/portfolio/durapan/1.jpg",
  // "https://katalog-uslug.pro/images/portfolio/durapan/2.jpg",
];

async function main() {
  await client.connect();
  await client.query("BEGIN");

  await client.query(
    "UPDATE categories SET label=$1 WHERE slug='wood-materials'",
    ["Материалы и комплектующие из ценных пород"]
  );

  await client.query(
    "UPDATE organizations SET title=$1, subtitle=$2, listing_text=$3 WHERE id='durapan'",
    [
      "Penrod (DURAPAN) — материалы из ценных пород",
      "+7 (495) 663-93-29\npenrod@penrod.ru\nМосква",
      "Поставки материалов и комплектующих из древесины ценных пород для производителей мебели и дверей по РФ. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг."
    ]
  );

  await client.query(
    "UPDATE organization_profiles SET legal_name=$1, description_md=$2, address_text=$3, cover_url=$4, portfolio_images=$5::jsonb WHERE org_id='durapan'",
    [
      "Penrod (DURAPAN)",
      "Поставщик материалов и комплектующих из древесины ценных пород для производителей мебели и дверей. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг.",
      "Москва",
      null,
      JSON.stringify(portfolio)
    ]
  );

  await client.query("COMMIT");
  await client.end();
  console.log("OK: durapan fixed + images set");
}

main().catch(async (e) => {
  console.error(e);
  try { await client.query("ROLLBACK"); } catch {}
  process.exit(1);
});