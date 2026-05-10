Ниже — “план для агента” в формате **конкретных задач по файлам + SQL шаблоны + критерии приёмки**, чтобы можно было выполнять по шагам без расплывчатости. Я даю вариант **A (locations + ancestor_ids)**, потому что он лучше всего масштабируется и даёт “район включает города”.

---

# План работ (Agent Checklist) — “Фильтры локации: районы и города”

## Этап 0. Конвенции и параметры API
**Выбираем:**
- идентификатор фильтра в каталоге: `locationId` (число)
- endpoint автокомплита: `GET /v1/locations`
- kinds: `region|district|city|settlement`
- сортировка подсказок: `label_norm ASC, id ASC`
- keyset cursor для подсказок: `k={labelNorm,id}`

---

# Этап 1 — БД

## 1.1. Миграция: `db/migrations/010_locations.sql`
**Создать файл** `katalog-uslug.pro/db/migrations/010_locations.sql`:

```sql
-- 010_locations.sql

CREATE TABLE IF NOT EXISTS locations (
  id bigserial PRIMARY KEY,

  kind text NOT NULL CHECK (kind IN ('region','district','city','settlement')),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,

  label_norm text NOT NULL, -- lower/trim/replace ё->е и т.п.

  parent_id bigint REFERENCES locations(id) ON DELETE SET NULL,

  -- быстрый фильтр по региону (денорм)
  region_id bigint REFERENCES locations(id) ON DELETE SET NULL,

  -- все предки (для include descendants), например: [region_id, district_id]
  ancestor_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Для автокомплита внутри региона и детерминированной пагинации
CREATE INDEX IF NOT EXISTS idx_locations_region_kind_label
ON locations (region_id, kind, label_norm, id);

-- Для автокомплита без региона (общий)
CREATE INDEX IF NOT EXISTS idx_locations_kind_label
ON locations (kind, label_norm, id);

-- Для include descendants: WHERE ancestor_ids @> ARRAY[$id]
CREATE INDEX IF NOT EXISTS idx_locations_ancestor_ids_gin
ON locations USING GIN (ancestor_ids);

-- Связь организаций с локацией
ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS location_id bigint REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_profiles_location
ON organization_profiles (location_id);
```

> Примечание: `region_id` здесь ссылается на `locations.id` (kind=region). Это удобно, потому что один справочник.

---

# Этап 2 — Импорт справочника (минимально рабочий)

## 2.1. Входные данные
Положить справочник в `data/locations.json` (или другой файл, но фиксируем путь). Формат для MVP:

```json
[
  { "kind":"region", "slug":"moskva", "label":"Москва", "parentSlug": null },
  { "kind":"district", "slug":"svao", "label":"СВАО", "parentSlug":"moskva" },
  { "kind":"city", "slug":"khimki", "label":"Химки", "parentSlug":"moskovskaya-oblast" }
]
```

(Можно потом перейти на ФИАС/КЛАДР, но для запуска нужен хотя бы ваш минимальный набор.)

## 2.2. Скрипт: `scripts/import-locations.mjs`
**Создать файл** `katalog-uslug.pro/scripts/import-locations.mjs`.

Требования:
- читает `data/locations.json`
- вставляет/апсертит строки в `locations`
- выставляет `parent_id` по `parentSlug`
- рассчитывает `region_id`:
  - для region → region_id = self
  - для остальных → поднимаемся по parent’ам до kind=region
- рассчитывает `ancestor_ids`:
  - цепочка родителей вверх (без самого узла), в порядке “сверху вниз” или любом (для `@>` порядок не важен)

**Минимальный алгоритм:**
1) вставить все записи без parent_id (только slug/label/kind/label_norm)
2) второй проход: обновить parent_id по parentSlug
3) третий проход: для каждой записи вычислить region_id и ancestor_ids

---

# Этап 3 — API автокомплита `/v1/locations`

## 3.1. Новый модуль: `worker/src/locations.ts`
Создать `katalog-uslug.pro/worker/src/locations.ts`:

### Контракт
`GET /v1/locations?q=&regionId=&kinds=city,district&limit=&cursor=`

Ответ:
```json
{
  "items": [
    { "id": 123, "kind":"city", "slug":"khimki", "label":"Химки", "regionId": 77, "regionLabel":"Московская область", "parentId": 456, "parentLabel":"..." }
  ],
  "nextCursor":"...",
  "meta": { "limit":10, "q":"хи", "kinds":["city"], "regionId":null }
}
```

### SQL (keyset)
Сортировка: `label_norm ASC, id ASC`

```sql
-- $1 q text|null
-- $2 regionId bigint|null
-- $3 kinds text[]|null
-- $4 cursorLabelNorm text|null
-- $5 cursorId bigint|null
-- $6 limit int

SELECT
  l.id, l.kind, l.slug, l.label,
  l.parent_id AS "parentId",
  p.label AS "parentLabel",
  l.region_id AS "regionId",
  r.label AS "regionLabel"
FROM locations l
LEFT JOIN locations p ON p.id = l.parent_id
LEFT JOIN locations r ON r.id = l.region_id
WHERE
  ($1::text IS NULL OR l.label_norm ILIKE ('%' || $1::text || '%'))
  AND ($2::bigint IS NULL OR l.region_id = $2::bigint)
  AND ($3::text[] IS NULL OR l.kind = ANY($3::text[]))
  AND ($4::text IS NULL OR (l.label_norm, l.id) > ($4::text, $5::bigint))
ORDER BY l.label_norm ASC, l.id ASC
LIMIT $6::int;
```

Cursor: base64url(JSON):
```json
{ "v":1, "k": { "labelNorm":"химки", "id":123 } }
```

## 3.2. Подключение роута: `worker/src/index.ts`
Добавить:
- обработчик `if (path === "/v1/locations") return handleLocations(...)`

---

# Этап 4 — Каталог v2: фильтр по локации

## 4.1. Изменить `worker/src/catalog-v2.ts`
Добавить параметр:
- `locationId` (bigint)

### SQL-условие
Если `locationId` задан:
- join `locations loc_org ON loc_org.id = p.location_id`
- фильтр: `(loc_org.id = $loc OR loc_org.ancestor_ids @> ARRAY[$loc])`

Шаблон WHERE:

```sql
AND (
  $locationId::bigint IS NULL
  OR (
    loc_org.id = $locationId::bigint
    OR loc_org.ancestor_ids @> ARRAY[$locationId::bigint]
  )
)
```

Важно:
- если у организации `p.location_id IS NULL`, она не попадёт в “городской фильтр”. Это ожидаемо.

---

# Этап 5 — Фронтенд (UX “Где?”)

## 5.1. HTML: `index.html` (+ при необходимости шаблоны страниц)
Добавить поле:
- `<input id="filter-where" autocomplete="off" placeholder="Где?">`
- контейнер dropdown: `<div id="where-suggest" class="suggest" hidden></div>`

## 5.2. JS: `js/main.js`
Добавить:
- debounce 250ms
- fetch `/v1/locations?q=...&kinds=city,district&limit=10`
- показать список подсказок
- при выборе:
  - сохранить `state.locationId`
  - обновить query params `locationId=...`
  - вызвать `loadPage(true)` каталога

Также: восстановление из query params при загрузке:
- если `locationId` есть, установить `state.locationId` и (опционально) подтянуть label через `/v1/locations?id=...` (можно отдельным endpoint или хранить label в URL params)

---

# Этап 6 — Авто-проверка (скрипт)
Расширить `scripts/verify-migration.mjs` или сделать `scripts/verify-locations.mjs`:

Проверки:
1) `worker/src/locations.ts` существует
2) `index.ts` роутит `/v1/locations`
3) `catalog-v2.ts` читает `locationId`
4) (опционально network smoke) `GET /v1/locations?q=моск&limit=5` возвращает `{items,nextCursor}`

---

# Definition of Done (по этой фиче)
1) `GET /v1/locations?q=моск&limit=10` → `{items,nextCursor,meta}`
2) `GET /v1/catalog?v=2&locationId=<район/город>` фильтрует
3) пагинация (`nextCursor`) работает с `locationId`
4) UI “Где?” выбирает подсказку и меняет выдачу

---

## Что агенту сказать (короткая команда запуска)
В Cursor Agent:
> “Реализуй план ‘Фильтры локации: районы и города’ по чеклисту. Начни с миграции 010_locations.sql, затем import-locations.mjs, затем /v1/locations, затем locationId в /v1/catalog?v=2, затем UI автокомплит.”

---
Ниже — готовые “кусочки под копипасту” для **всех частей**: БД, Worker API (`/v1/locations`), фильтр `locationId` в `/v1/catalog?v=2`, и фронтенд‑автокомплит “Где?”.

Я делаю это так, чтобы:
- не ломать вашу текущую keyset‑пагинацию каталога,
- не грузить справочник на клиент,
- “район включает города” работало через `ancestor_ids` (GIN).

---

# 1) БД: миграция `010_locations.sql`

Создай файл:

`katalog-uslug.pro/db/migrations/010_locations.sql`

```sql
-- 010_locations.sql

CREATE TABLE IF NOT EXISTS locations (
  id bigserial PRIMARY KEY,

  kind text NOT NULL CHECK (kind IN ('region','district','city','settlement')),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,

  label_norm text NOT NULL,

  parent_id bigint REFERENCES locations(id) ON DELETE SET NULL,

  -- денорм: регион (kind=region) для быстрых фильтров/подсказок
  region_id bigint REFERENCES locations(id) ON DELETE SET NULL,

  -- все предки (для include descendants). пример: [region_id, district_id]
  ancestor_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_region_kind_label
ON locations (region_id, kind, label_norm, id);

CREATE INDEX IF NOT EXISTS idx_locations_kind_label
ON locations (kind, label_norm, id);

CREATE INDEX IF NOT EXISTS idx_locations_ancestor_ids_gin
ON locations USING GIN (ancestor_ids);

ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS location_id bigint REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_profiles_location
ON organization_profiles (location_id);
```

После добавления файла — применяешь миграции как обычно:
```powershell
npm run db:migrate
```

---

# 2) Worker API: `/v1/locations` (autocomplete + keyset cursor)

## 2.1. Новый файл: `worker/src/locations.ts`

Создай файл:

`katalog-uslug.pro/worker/src/locations.ts`

```ts
// worker/src/locations.ts
import type { Env } from "./index"; // если Env не экспортируется - замени на `any`
import { withDbClient } from "./db"; // если у вас другой путь/имя - подстрой

type LocationKind = "region" | "district" | "city" | "settlement";

type CursorV1 = {
  v: 1;
  k: { labelNorm: string; id: string }; // id как string (bigint)
};

function b64urlEncode(str: string): string {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

function decodeCursor(raw: string | null): CursorV1 | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(b64urlDecode(raw));
    if (obj?.v !== 1) return null;
    if (!obj?.k?.labelNorm || !obj?.k?.id) return null;
    return obj as CursorV1;
  } catch {
    return null;
  }
}
function encodeCursor(cur: CursorV1): string {
  return b64urlEncode(JSON.stringify(cur));
}

function normLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function parseLimit(v: string | null, def = 10, max = 50): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function parseBigintString(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  return t;
}

function parseKinds(v: string | null): LocationKind[] | null {
  if (!v) return null;
  const allowed: LocationKind[] = ["region", "district", "city", "settlement"];
  const set = new Set<LocationKind>();
  for (const p of v.split(",").map(x => x.trim()).filter(Boolean)) {
    if (allowed.includes(p as LocationKind)) set.add(p as LocationKind);
  }
  return set.size ? Array.from(set) : null;
}

export async function handleLocations(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const url = new URL(request.url);

  const id = parseBigintString(url.searchParams.get("id"));
  const qRaw = (url.searchParams.get("q") || "").trim();
  const q = qRaw.length >= 2 ? normLabel(qRaw).slice(0, 80) : null;

  const kinds = parseKinds(url.searchParams.get("kinds"));
  const limit = parseLimit(url.searchParams.get("limit"), 10, 50);

  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const cursorLabelNorm = cursor?.k?.labelNorm ?? null;
  const cursorId = cursor?.k?.id ?? null;

  // region filter: принимаем либо regionId, либо regionSlug (удобно фронту)
  const regionIdParam = parseBigintString(url.searchParams.get("regionId"));
  const regionSlug = (url.searchParams.get("regionSlug") || "").trim() || null;

  try {
    const result = await withDbClient(env, async (c) => {
      // 1) если указан id — отдать ровно одну запись
      if (id) {
        const r = await c.query(
          `
          SELECT
            l.id::text AS id, l.kind, l.slug, l.label,
            l.parent_id::text AS "parentId",
            p.label AS "parentLabel",
            l.region_id::text AS "regionId",
            rg.label AS "regionLabel"
          FROM locations l
          LEFT JOIN locations p ON p.id = l.parent_id
          LEFT JOIN locations rg ON rg.id = l.region_id
          WHERE l.id = $1::bigint
          LIMIT 1
          `,
          [id]
        );

        const item = r.rows[0] || null;
        return { items: item ? [item] : [], nextCursor: null };
      }

      // 2) regionSlug -> regionId
      let regionId = regionIdParam;
      if (!regionId && regionSlug) {
        const rr = await c.query(
          `SELECT id::text AS id FROM locations WHERE kind='region' AND slug=$1::text LIMIT 1`,
          [regionSlug]
        );
        regionId = rr.rows[0]?.id ?? null;
      }

      const r = await c.query(
        `
        SELECT
          l.id::text AS id,
          l.kind,
          l.slug,
          l.label,
          l.parent_id::text AS "parentId",
          p.label AS "parentLabel",
          l.region_id::text AS "regionId",
          rg.label AS "regionLabel"
        FROM locations l
        LEFT JOIN locations p  ON p.id  = l.parent_id
        LEFT JOIN locations rg ON rg.id = l.region_id
        WHERE
          ($1::text IS NULL OR l.label_norm ILIKE ('%' || $1::text || '%'))
          AND ($2::bigint IS NULL OR l.region_id = $2::bigint)
          AND ($3::text[] IS NULL OR l.kind = ANY($3::text[]))
          AND ($4::text IS NULL OR (l.label_norm, l.id) > ($4::text, $5::bigint))
        ORDER BY l.label_norm ASC, l.id ASC
        LIMIT $6::int
        `,
        [q, regionId, kinds, cursorLabelNorm, cursorId, limit]
      );

      const items = r.rows;

      let nextCursor: string | null = null;
      if (items.length === limit) {
        const last = items[items.length - 1];
        nextCursor = encodeCursor({ v: 1, k: { labelNorm: normLabel(last.label), id: String(last.id) } });
      }

      return { items, nextCursor };
    });

    return Response.json(
      {
        items: result.items,
        nextCursor: result.nextCursor,
        meta: { limit, q: qRaw || null, kinds, regionId: regionIdParam || null, regionSlug }
      },
      { headers: { ...cors, "Cache-Control": "public, max-age=0, s-maxage=60" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "locations_error";
    return Response.json({ error: "locations_unavailable", message }, { status: 502, headers: cors });
  }
}
```

> Примечание: если у вас `Env` и `withDbClient` лежат иначе — подстрой 2 импорта вверху. Остальное можно оставить 1:1.

## 2.2. Подключить роут в `worker/src/index.ts`

В `worker/src/index.ts`:
1) добавь импорт:
```ts
import { handleLocations } from "./locations";
```

2) добавь роут (до “catch-all”):

```ts
if (path === "/v1/locations" && request.method === "GET") {
  return handleLocations(request, env, cors);
}
```

---

# 3) Каталог v2: добавить фильтр `locationId` (район включает города)

В `worker/src/catalog-v2.ts` сделай 2 изменения:

## 3.1. Прочитать query param `locationId`
Где вы читаете параметры (`category/region/q/minRating/...`) — добавь:

```ts
const locationId = (url.searchParams.get("locationId") || "").trim() || null;
const locationIdOk = locationId && /^\d+$/.test(locationId) ? locationId : null;
```

## 3.2. В SQL добавить join на locations и WHERE по `ancestor_ids`
В вашем SELECT FROM добавь (лучше `LEFT JOIN`, чтобы без фильтра не ломало):

```sql
LEFT JOIN locations loc_org ON loc_org.id = p.location_id
```

И в WHERE добавь:

```sql
AND (
  $LOCATION_ID::bigint IS NULL
  OR (
    loc_org.id = $LOCATION_ID::bigint
    OR loc_org.ancestor_ids @> ARRAY[$LOCATION_ID::bigint]
  )
)
```

Где `$LOCATION_ID` — это новый параметр в списке параметров запроса.

Если проще: добавь этот фильтр во все 3 SQL (title/rating/updated) одинаково.

---

# 4) Импорт/привязка существующих организаций (чтобы фильтр по региону через locationId тоже работал)

После импорта `locations` (в котором есть регионы с `slug`, совпадающим с `regions.slug`) можно один раз сделать привязку:

```sql
UPDATE organization_profiles p
SET location_id = loc.id
FROM organizations o
JOIN regions r ON r.id = o.region_id
JOIN locations loc ON loc.kind='region' AND loc.slug=r.slug
WHERE p.org_id=o.id AND p.location_id IS NULL;
```

Это можно:
- выполнить вручную 1 раз (psql),
- или встроить в `scripts/import-locations.mjs`.

---

# 5) Frontend: автокомплит “Где?” + прокидывание `locationId` в `/v1/catalog?v=2`

## 5.1. HTML (главная и/или шаблон фильтров)
Добавь в блок фильтров:

```html
<div class="filter-item">
  <label class="filter-label" for="filter-where">Где?</label>
  <input id="filter-where" class="input" type="text" placeholder="Город или район" autocomplete="off">
  <div id="where-suggest" class="suggest" hidden></div>
</div>
```

(Если у вас другие классы — не критично, главное `id`.)

## 5.2. JS: вставка в `js/main.js`
В `initCatalogFilters()`:
- добавь состояние:
  - `state.locationId = ...`
- добавь в URLSearchParams перед fetch:
  - `if (state.locationId) p.set('locationId', state.locationId);`

### Готовый блок автокомплита (можно вставить внутрь initCatalogFilters)
Вставь в `initCatalogFilters()` после того как вычислил `apiBase`/`apiUrl` и создал `state`:

```js
  const whereInput = document.getElementById('filter-where');
  const whereSuggest = document.getElementById('where-suggest');

  state.locationId = null;

  function setLocation(id, label) {
    state.locationId = id ? String(id) : null;
    if (whereInput) whereInput.value = label || '';
    // записать в URL
    const u = new URL(window.location.href);
    if (state.locationId) u.searchParams.set('locationId', state.locationId);
    else u.searchParams.delete('locationId');
    history.replaceState(null, '', u.toString());
    loadPage(true);
  }

  async function restoreLocationFromUrl() {
    const u = new URL(window.location.href);
    const lid = (u.searchParams.get('locationId') || '').trim();
    if (!lid || !/^\d+$/.test(lid)) return;
    state.locationId = lid;

    // подтянуть label по id, чтобы поле не было пустым
    try {
      const r = await fetch(`${apiUrl.replace('/v1/catalog','')}/v1/locations?id=${encodeURIComponent(lid)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const item = Array.isArray(j.items) ? j.items[0] : null;
      if (item && whereInput) whereInput.value = item.label || '';
    } catch {}
  }

  function hideSuggest() {
    if (whereSuggest) whereSuggest.hidden = true;
    if (whereSuggest) whereSuggest.innerHTML = '';
  }

  function renderSuggest(items) {
    if (!whereSuggest) return;
    whereSuggest.innerHTML = '';
    if (!items.length) { hideSuggest(); return; }

    items.slice(0, 10).forEach((it) => {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      const hint = [it.kind, it.parentLabel, it.regionLabel].filter(Boolean).join(' • ');
      div.innerHTML = `<div class="suggest-title">${it.label}</div><div class="suggest-hint">${hint}</div>`;
      div.addEventListener('click', () => {
        hideSuggest();
        setLocation(it.id, it.label);
      });
      whereSuggest.appendChild(div);
    });

    whereSuggest.hidden = false;
  }

  let whereTimer = null;
  async function onWhereInput() {
    if (!apiUrl || !whereInput) return;
    const q = (whereInput.value || '').trim();
    if (!q) {
      // очистка
      state.locationId = null;
      const u = new URL(window.location.href);
      u.searchParams.delete('locationId');
      history.replaceState(null, '', u.toString());
      hideSuggest();
      loadPage(true);
      return;
    }
    if (q.length < 2) { hideSuggest(); return; }

    try {
      const regionSlug = (selRegion?.value || '').trim(); // если есть ваш select регионов
      const p = new URLSearchParams();
      p.set('q', q);
      p.set('kinds', 'city,district,region');
      p.set('limit', '10');
      if (regionSlug) p.set('regionSlug', regionSlug);

      const base = apiUrl.replace('/v1/catalog','');
      const r = await fetch(`${base}/v1/locations?${p.toString()}`, { cache: 'no-store' });
      if (!r.ok) { hideSuggest(); return; }
      const j = await r.json();
      renderSuggest(Array.isArray(j.items) ? j.items : []);
    } catch {
      hideSuggest();
    }
  }

  if (whereInput) {
    whereInput.addEventListener('input', () => {
      if (whereTimer) window.clearTimeout(whereTimer);
      whereTimer = window.setTimeout(onWhereInput, 250);
    });

    document.addEventListener('click', (e) => {
      if (!whereSuggest) return;
      const t = e.target;
      if (t === whereInput || whereSuggest.contains(t)) return;
      hideSuggest();
    });
  }

  restoreLocationFromUrl();
```

### И главное: прокинуть `locationId` в запрос каталога v2
Внутри вашей `loadPage(reset)` перед `fetch` добавь:

```js
      if (state.locationId) p.set('locationId', state.locationId);
```

---

# 6) Команды запуска (после реализации)

1) Миграции:
```powershell
npm run db:migrate
```

2) Импорт locations (если сделаешь скрипт) — можем добавить потом, но минимум: чтобы тестить `/v1/locations`, нужно заполнить `locations`.

3) Smoke:
- `GET /v1/locations?q=моск&limit=10`
- `GET /v1/catalog?v=2&locationId=...`

---


