import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

const regionsPath = path.join(repoRoot, "data", "regions.json");
const outPath = path.join(repoRoot, "data", "locations.json");

function normalizeCityBase(label) {
  let s = String(label || "").trim();
  s = s
    .replace(/\s*—\s*Кузбасс$/i, "")
    .replace(/\s+автономный округ$/i, "")
    .replace(/\s+автономная область$/i, "")
    .replace(/\s+область$/i, "")
    .replace(/\s+край$/i, "")
    .replace(/\s+республика$/i, "");

  // Универсальные словари для более "человечных" подсказок.
  const map = new Map([
    ["Республика Татарстан", "Казань"],
    ["Республика Башкортостан", "Уфа"],
    ["Республика Саха (Якутия)", "Якутск"],
    ["Республика Дагестан", "Махачкала"],
    ["Республика Карелия", "Петрозаводск"],
    ["Республика Коми", "Сыктывкар"],
    ["Республика Мордовия", "Саранск"],
    ["Республика Крым", "Симферополь"],
    ["Республика Алтай", "Горно-Алтайск"],
    ["Республика Адыгея", "Майкоп"],
    ["Республика Хакасия", "Абакан"],
    ["Республика Ингушетия", "Магас"],
    ["Республика Калмыкия", "Элиста"],
    ["Республика Бурятия", "Улан-Удэ"],
    ["Республика Тыва", "Кызыл"],
    ["Республика Северная Осетия — Алания", "Владикавказ"],
    ["Чувашская Республика", "Чебоксары"],
    ["Чеченская Республика", "Грозный"],
    ["Кабардино-Балкарская Республика", "Нальчик"],
    ["Карачаево-Черкесская Республика", "Черкесск"],
    ["Удмуртская Республика", "Ижевск"],
    ["Республика Марий Эл", "Йошкар-Ола"],
    ["Еврейская автономная область", "Биробиджан"],
    ["Ненецкий автономный округ", "Нарьян-Мар"],
    ["Ханты-Мансийский автономный округ — Югра", "Ханты-Мансийск"],
    ["Ямало-Ненецкий автономный округ", "Салехард"],
    ["Чукотский автономный округ", "Анадырь"],
    ["Донецкая Народная Республика", "Донецк"],
    ["Луганская Народная Республика", "Луганск"],
    ["Запорожская область", "Мелитополь"],
    ["Херсонская область", "Херсон"],
    ["Вся Россия", "Россия"],
  ]);

  if (map.has(label)) return map.get(label);
  return s;
}

function main() {
  const regionsRaw = fs.readFileSync(regionsPath, "utf8");
  const regions = JSON.parse(regionsRaw);
  if (!Array.isArray(regions)) {
    throw new Error("regions.json must be an array");
  }

  const out = [];
  for (const region of regions) {
    const slug = String(region.slug || "").trim();
    const label = String(region.label || "").trim();
    if (!slug || !label) continue;

    const city = normalizeCityBase(label);
    const citySlug = `${slug}-city`;
    out.push({
      kind: "city",
      slug: citySlug,
      label: city,
      parentSlug: slug,
    });

    // Для крупнейших регионов добавим "районные" подсказки MVP-уровня.
    if (slug === "moskva") {
      out.push({ kind: "district", slug: "moskva-tsao", label: "Москва — ЦАО", parentSlug: slug });
      out.push({ kind: "district", slug: "moskva-svao", label: "Москва — СВАО", parentSlug: slug });
      out.push({ kind: "district", slug: "moskva-yuao", label: "Москва — ЮАО", parentSlug: slug });
      out.push({ kind: "city", slug: "zelenograd", label: "Зеленоград", parentSlug: slug });
    }
    if (slug === "sankt-peterburg") {
      out.push({
        kind: "district",
        slug: "spb-centralnyy",
        label: "Санкт-Петербург — Центральный район",
        parentSlug: slug,
      });
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Generated ${out.length} location nodes -> data/locations.json`);
}

main();
