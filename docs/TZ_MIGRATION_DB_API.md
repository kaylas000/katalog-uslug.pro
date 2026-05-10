Ниже — полноценное **техническое задание (ТЗ)** на переделку статического каталога в систему, где **карточки превью и страницы организаций не хранятся HTML‑файлами**, а **формируются по шаблонам из данных в БД**, с пользовательским добавлением организаций через `/add/`, автоподтягиванием данных с сайта организации, модерацией и публикацией.

---

# ТЗ: Переход со статического сайта на каталог с БД + API + шаблонными страницами

## 0) Краткое резюме
Нужно:
1) Перенести данные организаций в БД (Postgres).  
2) Реализовать публичное API для каталога и страниц организаций (постраничная выдача, фильтры, поиск).  
3) Сделать добавление организации пользователем через `/add/` → создаётся заявка/черновик в БД.  
4) Реализовать автоматический сбор данных с сайта (enrichment) асинхронно (очередь/джобы).  
5) Сделать публикацию через модерацию/верификацию.  
6) Обеспечить динамические URL вида `/org/{slug}` без хранения миллиона HTML‑страниц (через SSR/rewrites на хостинге с роутингом).  

---

## 1) Цели и границы проекта

### 1.1. Цели
- Убрать зависимость от хранения карточек/страниц организаций в статических HTML.
- Обеспечить масштабирование минимум до **1 000 000 организаций** без деградации билда/репозитория/деплоя.
- Дать пользователям возможность самостоятельно добавлять организации.
- Автоматизировать заполнение карточек и страницы организации на основе данных с внешнего сайта.
- Поддержать SEO‑дружелюбную индексацию (минимум: нормальные URL, canonical, sitemap; лучше: SSR).

### 1.2. Не входит (можно отдельным этапом)
- Полноценная система отзывов с антинакруткой.
- Платёжная система и тарифы (если требуется — отдельный ТЗ).
- Сложная ML‑классификация услуг (можно позже).

---

## 2) Термины
- **Организация** — сущность каталога (title, slug, категория, регион, рейтинг и т.п.).
- **Профиль организации** — расширенные данные (описание, адрес, часы, медиа, контакты).
- **Карточка** — превью организации в списке (листинг).
- **Страница организации** — детальная страница `/org/{slug}`.
- **Заявка (application)** — запись, созданная пользователем через `/add/`, до публикации.
- **Enrichment (обогащение)** — автоматическое извлечение данных с сайта организации.
- **Публикация** — перевод записи в публичный статус (доступна в каталоге, индексируется).

---

## 3) Целевая архитектура

### 3.1. Компоненты
1) **Frontend (сайт)**  
   - Статические ассеты: CSS/JS/иконки/общие страницы.
   - Динамические страницы: листинги и `/org/{slug}` строятся из API.
2) **API слой (Edge/Backend)**  
   - Public API: каталог/организации/поиск.
   - Private/Admin API: модерация, управление.
3) **База данных Postgres**
4) **Очередь/джобы для enrichment**
5) **Хранилище медиа (S3/R2)** — логотипы/обложки/галереи (в БД храним только ссылки/ключи).

### 3.2. Хостинг и роутинг (обязательное требование)
Чтобы не хранить 1M HTML‑страниц, нужен хостинг, где можно сделать:
- **динамические роуты** `/org/:slug` (SSR или server route),
- **rewrites** (все `/org/*` → один обработчик/шаблон).

**Допустимые варианты реализации:**
- Вариант A (рекомендованный для edge): Cloudflare Pages + Functions / Worker SSR.
- Вариант B: любой SSR‑фреймворк (Next.js/Nuxt/SvelteKit) + Postgres + CDN.
- Вариант C (MVP без SSR): один `/org.html` + JS (хуже SEO; годится только как временный шаг).

---

## 4) Роли и права

### 4.1. Роли
- **Гость**: просмотр каталога и страниц.
- **Пользователь**: регистрация, добавление организации, редактирование своих организаций (черновик/опубликовано), запрос “обновить данные с сайта”.
- **Модератор/Админ**: просмотр заявок, правки, публикация/отклонение, блокировки.

### 4.2. Привязка пользователя к организации
Обязательно хранить связь:
- пользователь = владелец/менеджер организации,
- права на редактирование и публикационные действия ограничены этой связью.

---

## 5) Пользовательские сценарии (end-to-end)

### 5.1. Добавление организации (основной сценарий)
1) Пользователь регистрируется/логинится.
2) Переходит на `/add/`, заполняет минимум:
   - название (обязательно),
   - сайт (обязательно),
   - категория, регион (обязательно),
   - контакты (желательно),
   - краткое описание (опционально).
3) После отправки:
   - создаётся **заявка** + **черновик организации** в БД (или только заявка, но лучше сразу черновик).
   - ставится job на **enrichment**.
4) Пользователь видит страницу статуса: “Подтягиваем данные…” + предварительный предпросмотр.
5) Пользователь подтверждает/правит поля, затем отправляет на модерацию.
6) Модератор/автоправила публикуют.
7) Организация появляется в каталоге, доступна по `/org/{slug}`.

### 5.2. Автоподтягивание данных (enrichment)
- Система делает fetch сайта, собирает метаданные, предлагает заполнение:
  - название/description/логотип/обложка/телефон/адрес/соцсети/часы.
- Результат сохраняется как “предложенные поля” с указанием источника и времени.

### 5.3. Верификация владения сайтом (антиспам)
Перед автопубликацией требуется подтверждение одним из способов:
- файл `/.well-known/<token>.txt`,
- meta‑тег в `<head>`,
- DNS TXT (опционально как “усиленный” метод).

---

## 6) Функциональные требования (FR)

### 6.1. Публичный каталог и поиск
**FR-1** Каталог организаций с фильтрами:
- категория, регион/город,
- текстовый поиск,
- сортировка (по релевантности/рейтингу/алфавиту),
- постраничная выдача (обязательна).

**FR-2** Карточка превью формируется по одному шаблону (компонент/функция рендера), данные берутся из API.

**FR-3** Страница организации `/org/{slug}`:
- данные из БД,
- контакты, сайт, описание, галерея,
- “похожие организации” (опционально).

### 6.2. Добавление/редактирование организаций
**FR-4** Страница `/add/`:
- форма,
- валидации,
- сохранение заявки.

**FR-5** Кабинет пользователя:
- список его организаций,
- статусы (draft / pending / published / rejected / blocked),
- редактирование и отправка на повторную модерацию.

### 6.3. Enrichment (автосбор данных)
**FR-6** Асинхронный сбор данных после создания заявки:
- ограничения на время/размер,
- защита от SSRF,
- обработка редиректов в пределах правил.

**FR-7** Источники извлечения (в порядке приоритета):
- Schema.org JSON-LD (Organization/LocalBusiness и т.п.),
- OpenGraph (`og:title`, `og:description`, `og:image`),
- meta description/title,
- favicon/apple-touch-icon.

**FR-8** Хранение результатов enrichment отдельно от “публикуемых” полей:
- чтобы можно было сравнить и откатить,
- чтобы пользователь/модератор видел “что подтянулось”.

### 6.4. Модерация и публикация
**FR-9** Админ-панель/раздел модерации:
- список заявок,
- просмотр extracted данных,
- кнопки approve/publish/reject,
- история действий (audit log).

**FR-10** Публикация:
- выставление флагов статуса,
- появление в `/v1/catalog`,
- доступность `/org/{slug}`.

---

## 7) Нефункциональные требования (NFR)

### 7.1. Масштабирование и производительность
**NFR-1** API каталога обязано поддерживать 1M записей:
- запрещено отдавать весь каталог одним запросом,
- обязателен `limit` + курсорная пагинация (keyset) или offset с ограничениями,
- индексы по полям фильтрации.

**NFR-2** Время ответа:
- каталог: p95 < 400–700 мс (зависит от хостинга),
- страница организации: p95 < 300–600 мс (с кэшем).

**NFR-3** Кэширование:
- edge cache для публичных GET (каталог, организация) с инвалидацией по обновлению.

### 7.2. SEO
**NFR-4** Для `/org/{slug}` желательно SSR (HTML от сервера), минимум:
- корректные title/description,
- canonical,
- robots/meta,
- sitemap (см. ниже).

**NFR-5** Sitemap:
- генерация sitemap index (батчами, например по 50k URL),
- обновление при публикации/снятии с публикации.

### 7.3. Безопасность
**NFR-6** SSRF защита для enrichment:
- запрет private IP (127.0.0.1, 10.0.0.0/8, 169.254.0.0/16 и т.д.),
- лимит редиректов,
- таймауты,
- лимит размера ответа.

**NFR-7** XSS защита:
- всё “подтянутое с сайтов” хранить как текст; HTML — только после sanitation.
- запрет вставки произвольного HTML без очистки.

**NFR-8** Rate limiting + CAPTCHA на `/add/` (минимум: для незнакомых аккаунтов/подозрительных).

---

## 8) Модель данных (предлагаемая)

> Можно адаптировать под вашу текущую схему, но важны: статусы, связь user↔org, хранение extracted отдельно, индексы.

### 8.1. Основные таблицы
1) `users`
- id, email, password_hash / oauth, created_at

2) `organizations`
- id
- slug (unique)
- title
- category_id, region_id
- rating (numeric), reviews_count (int) — опционально
- published (bool)
- created_at, updated_at

3) `organization_profiles`
- org_id (PK/FK)
- website_url
- description (text / markdown)
- listing_text (короткий текст для карточки)
- logo_url, cover_url
- address_text
- work_hours_json
- moderation_status (draft/pending/published/rejected/blocked)
- verification_status (unverified/pending/verified)
- updated_at

4) `organization_contacts`
- id, org_id
- type (phone/email/telegram/whatsapp/etc)
- value
- is_public (bool)

5) `organization_media`
- id, org_id
- kind (logo/cover/gallery)
- url
- sort_order
- source (user/enrichment)
- created_at

6) `organization_members`
- org_id, user_id, role (owner/editor)
- unique(org_id,user_id)

### 8.2. Заявки и модерация
7) `organization_applications`
- id
- user_id
- payload_json (как пришло из формы)
- status (pending/enriching/pending_review/approved/rejected/published)
- moderation_notes
- created_at

8) `organization_site_extracts`
- id
- application_id или org_id
- website_url
- extracted_json
- confidence_json (опционально)
- fetched_at
- status (ok/error)
- error_text

9) `audit_log`
- id, actor_user_id, action, entity_type, entity_id, payload_json, created_at

### 8.3. Индексы (обязательно)
- `organizations(slug) unique`
- `organizations(published, category_id, region_id)`
- полнотекст: `to_tsvector(title, listing_text, description)` или trigram по title
- `organization_profiles(verification_status, moderation_status)`
- `organization_applications(status, created_at)`

---

## 9) API (контракт)

### 9.1. Public API
1) `GET /v1/catalog`
- query: `category`, `region`, `q`, `limit`, `cursor`, `sort`
- response:
```json
{
  "items": [
    { "slug": "abc", "title": "...", "subtitle": "...", "listing_text": "...", "rating": 4.6, "reviews": 12, "url": "/org/abc" }
  ],
  "nextCursor": "..."
}
```

2) `GET /v1/org/{slug}`
- response: объединённые данные организации + профиля + контактов + медиа

3) `GET /v1/categories`, `GET /v1/regions`

### 9.2. Auth API
- `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/logout`
- сессии/JWT (на выбор), refresh tokens (рекомендовано)

### 9.3. Private/User API
- `POST /v1/org/applications` (создать заявку)
- `GET /v1/org/applications/{id}` (статус + извлечённые данные)
- `PATCH /v1/org/{id}` (редактирование черновика владельцем)
- `POST /v1/org/{id}/verify` (проверка токена владения сайтом)
- `POST /v1/org/{id}/enrich` (перезапуск enrichment)

### 9.4. Admin API
- `GET /v1/admin/applications?status=...`
- `POST /v1/admin/applications/{id}/approve`
- `POST /v1/admin/applications/{id}/reject`
- `POST /v1/admin/org/{id}/publish`
- `POST /v1/admin/org/{id}/unpublish`

---

## 10) Enrichment: правила, алгоритм, хранение

### 10.1. Триггеры
- автоматически после `POST /v1/org/applications`
- вручную: “Обновить данные с сайта” из кабинета (rate-limit)

### 10.2. Ограничения
- timeout (например 5–10 сек на fetch),
- max size (например 1–2 МБ HTML),
- max redirects (например 5),
- блок private IP + блок localhost,
- user-agent отдельный.

### 10.3. Что извлекать
- `title` (предложение)
- `description` (короткое и/или длинное)
- `logo_url`, `cover_url`
- `phone/email/address/openingHours` если есть
- `social links` если найдены

### 10.4. Как применять
- extracted сохраняется в `organization_site_extracts`
- автозаполнение в `organization_profiles` — только если поле пустое **или** если пользователь нажал “применить предложенные”.

---

## 11) Рендер страниц и “шаблоны”

### 11.1. Требование DRY
- Карточка и страница используют единые поля.
- Шаблон карточки — один (компонент), используемый:
  - в листинге категорий/регионов/поиска
  - в “похожие организации”

### 11.2. Рендер `/org/{slug}`
**Требование:** URL должен работать без физического файла на каждую организацию.

Реализация:
- SSR функция/endpoint получает slug → запрос в БД → возвращает HTML по шаблону.
- Альтернатива (временная): CSR (JS) — но фиксируется как временный MVP с отдельной задачей “перейти на SSR”.

---

## 12) Миграция данных со статического сайта в БД

### 12.1. Источники
- текущий JSON каталога (если есть)
- текущие HTML страниц организаций (если есть)
- справочники категорий/регионов

### 12.2. Этапы миграции
1) Подготовить миграции БД (schema + индексы).
2) Написать импортёр:
   - загрузка организаций,
   - генерация slug,
   - дедупликация по website_url/canonical,
   - загрузка медиа ссылок (если есть).
3) После импорта:
   - прогнать background job enrichment для улучшения данных (опционально).
4) Проверка качества:
   - % записей без category/region/website,
   - дубли,
   - битые ссылки.

---

## 13) План работ (этапы)

### Этап 1 — База и API (MVP)
- БД: таблицы organizations/profiles/members/applications/extracts.
- Public API: `/v1/catalog` (с пагинацией!), `/v1/org/{slug}`.
- Auth + `/add/` → создание заявки.
- Кабинет: статус заявки, черновик.

**Результат:** данные в БД, сайт показывает каталог из API, страница организации открывается динамически.

### Этап 2 — Enrichment + очередь
- Очередь/джобы, consumer.
- Парсинг OG/JSON-LD/meta.
- UI “предложенные данные”.

**Результат:** после добавления сайт сам подтягивает поля.

### Этап 3 — Верификация + модерация
- Verification flow (well-known/meta).
- Админ-модерация, audit log.

**Результат:** защита от спама + управляемая публикация.

### Этап 4 — SEO/SSR/карта сайта
- SSR для `/org/{slug}`.
- sitemap index + батчи.
- canonical/robots.

---

## 14) Критерии приёмки (Definition of Done)

1) Можно зарегистрироваться и добавить организацию через `/add/`.
2) Созданная организация появляется в кабинете со статусом (draft/enriching/pending/published).
3) Enrichment запускается асинхронно и записывает результат в БД.
4) После публикации:
   - организация доступна по `/org/{slug}`,
   - отображается в каталоге `/v1/catalog` при фильтрах,
   - карточка превью строится из данных API и соответствует шаблону.
5) Каталог работает с пагинацией (нет загрузки “всего каталога”).
6) Нет хранения отдельных HTML‑страниц на каждую организацию.
7) SSRF/XSS базовые меры реализованы.
8) Миграция переносит текущие данные в БД без потерь ключевых полей.

---

## 15) Риски и меры
- **JS‑тяжёлые сайты** могут не отдавать метаданные без headless-браузера → обязателен fallback: ручной ввод + “подтянуть только мета”.
- **Спам** → верификация сайта + rate limit + модерация.
- **SEO** → если начать с CSR, индексация будет хуже → запланировать SSR как обязательный этап.
- **1M записей** → нужен индекс/FTS и курсорная пагинация с самого начала.

---
Ниже — обещанные **3 приложения к ТЗ**: (A) конкретные SQL-паттерны для `/v1/catalog` с keyset pagination, (B) схема `extracted_json` + правила применения, (C) структура SSR-шаблона `/org/{slug}` (и как это сделать на Cloudflare Pages/Workers).

---

## Приложение A — SQL для `/v1/catalog`: фильтры + поиск + keyset pagination

### A1) Почему именно keyset (seek) пагинация
Для миллиона записей нельзя использовать “скачать весь каталог” и даже `OFFSET N` на больших N — будет деградировать. Нужен **seek/keyset**: “дай следующую страницу после последней записи предыдущей страницы”. Классическая схема: сортировка + курсор по значениям сортировки + WHERE “больше/меньше курсора”. (Общее описание и ограничения seek/offset хорошо разобраны в “Pagination Done the PostgreSQL Way”.) 

Ключевой механизм в Postgres: **сравнение кортежей (row comparisons)**, например `WHERE (title, id) > ($cursorTitle, $cursorId)`. Это штатная семантика сравнения строк/кортежей в Postgres. 

---

### A2) Контракт API: курсор
**Курсор** должен быть непрозрачной строкой (обычно base64 JSON), например:

```json
{"title":"Acme","id":12345}
```

И клиент отправляет `?limit=24&cursor=...`.

Важно: **в курсоре храните все поля сортировки + tiebreaker** (обычно `id`), иначе пагинация будет “прыгать”.

---

### A3) Базовый запрос каталога (сортировка по title ASC)
Пример структуры таблиц (упрощённо):
- `organizations(id, slug, title, category_id, region_id, published, rating, reviews_count, updated_at)`
- `organization_profiles(org_id, listing_text, moderation_status)`
- `categories(id, slug, label)`
- `regions(id, slug, label)`

**Запрос:**

```sql
-- :category_slug, :region_slug, :q, :limit, :cursor_title, :cursor_id

WITH base AS (
  SELECT
    o.id,
    o.slug,
    o.title,
    c.slug  AS category_slug,
    c.label AS category_label,
    r.slug  AS region_slug,
    r.label AS region_label,
    p.listing_text,
    o.rating,
    o.reviews_count
  FROM organizations o
  JOIN organization_profiles p ON p.org_id = o.id
  JOIN categories c ON c.id = o.category_id
  JOIN regions r ON r.id = o.region_id
  WHERE
    o.published = TRUE
    AND p.moderation_status = 'published'
    AND (:category_slug IS NULL OR c.slug = :category_slug)
    AND (:region_slug   IS NULL OR r.slug = :region_slug)
    AND (
      :q IS NULL OR
      o.title ILIKE ('%' || :q || '%') OR
      p.listing_text ILIKE ('%' || :q || '%')
    )
)
SELECT *
FROM base
WHERE
  -- keyset: строго "после" курсора
  (:cursor_title IS NULL OR (title, id) > (:cursor_title, :cursor_id))
ORDER BY title ASC, id ASC
LIMIT :limit;
```

Почему `(title, id) > (...)` работает корректно: Postgres определяет сравнение “строк значений” как лексикографическое (с учётом равенства первого поля и сравнения второго). 

**Индекс под этот сценарий (обязательно):**
```sql
CREATE INDEX organizations_pub_title_id_idx
ON organizations (published, title, id);

CREATE INDEX org_profiles_pub_status_idx
ON organization_profiles (moderation_status, org_id);
```

---

### A4) Сортировка по рейтингу (rating DESC) + keyset
Тут порядок “с конца”: больше рейтинг — раньше.

Проблемы:
- `rating` может быть NULL
- одинаковый рейтинг у многих

Решение:
- нормализуем `rating_key = COALESCE(rating, -1)`
- добавляем `reviews_count` как второй ключ сортировки (если нужно)
- добавляем `id` как tiebreaker

```sql
WITH base AS (
  SELECT
    o.id, o.slug, o.title,
    p.listing_text,
    COALESCE(o.rating, -1) AS rating_key,
    COALESCE(o.reviews_count, 0) AS reviews_key
  FROM organizations o
  JOIN organization_profiles p ON p.org_id = o.id
  WHERE o.published = TRUE
    AND p.moderation_status = 'published'
)
SELECT *
FROM base
WHERE
  (
    :cursor_rating_key IS NULL
    OR (rating_key, reviews_key, id) < (:cursor_rating_key, :cursor_reviews_key, :cursor_id)
  )
ORDER BY rating_key DESC, reviews_key DESC, id DESC
LIMIT :limit;
```

Это тот же принцип сравнения кортежей (row comparison), только “в обратную сторону” из-за DESC: используем `<` и сортируем DESC. 

Индекс (пример):
```sql
CREATE INDEX organizations_pub_rating_idx
ON organizations (published, rating DESC, reviews_count DESC, id DESC);
```

---

### A5) Полнотекстовый поиск (FTS) + пагинация по (rank, id)
`ILIKE '%q%'` на миллионе строк — плохо. Правильнее: `tsvector` + GIN.

Пример (упрощённо):

```sql
-- Подготовка (один раз):
-- 1) добавьте materialized поле tsv, либо делайте выражение + индекс выражения
CREATE INDEX org_search_gin_idx
ON organization_profiles
USING GIN (to_tsvector('simple', coalesce(listing_text,'')));

CREATE INDEX org_title_search_gin_idx
ON organizations
USING GIN (to_tsvector('simple', coalesce(title,'')));
```

Запрос:

```sql
WITH ranked AS (
  SELECT
    o.id, o.slug, o.title, p.listing_text,
    ts_rank(
      to_tsvector('simple', coalesce(o.title,'') || ' ' || coalesce(p.listing_text,'')),
      plainto_tsquery('simple', :q)
    ) AS rank
  FROM organizations o
  JOIN organization_profiles p ON p.org_id = o.id
  WHERE o.published = TRUE
    AND p.moderation_status = 'published'
    AND to_tsvector('simple', coalesce(o.title,'') || ' ' || coalesce(p.listing_text,''))
        @@ plainto_tsquery('simple', :q)
)
SELECT *
FROM ranked
WHERE (:cursor_rank IS NULL OR (rank, id) < (:cursor_rank, :cursor_id))
ORDER BY rank DESC, id DESC
LIMIT :limit;
```

Смысл: стабильный порядок `rank DESC, id DESC`; курсор хранит `(rank, id)`.

---

### A6) “Стабильность результата” и дедуп
**Требование:** сортировка должна быть детерминированной. Всегда добавляйте `id` последним ключом сортировки (tiebreaker), иначе записи могут “перетекать” между страницами.

---

## Приложение B — `extracted_json`: схема, confidence, правила “как применять”

### B1) Зачем отдельная таблица extract’ов
Автоподтягивание с сайта никогда не будет идеальным:
- сайты разные,
- где-то нет метаданных,
- где-то SPA без SSR,
- возможны ошибки/таймауты.

Поэтому extracted-данные должны храниться **отдельно** от публикуемых полей, чтобы:
- показывать пользователю “что нашлось”,
- применять выборочно,
- дебажить и повторно прогонять.

Для извлечения HTML в Workers удобно использовать `HTMLRewriter` (парсит/трансформирует HTML потоково). 

---

### B2) Таблица `organization_site_extracts` (рекомендованная)
Минимально:
- `id bigserial`
- `org_id bigint NULL` / или `application_id bigint NOT NULL`
- `website_url text`
- `final_url text` (после редиректов)
- `http_status int`
- `fetched_at timestamptz`
- `status text` (`ok|error`)
- `error_text text NULL`
- `extracted_json jsonb NOT NULL`
- `raw_html_sha256 text NULL` (не хранить HTML целиком — хранить хэш/метрики)

---

### B3) Формат `extracted_json` (практичный “дебажный”)
Пример (с “обёрткой” value/source/confidence):

```json
{
  "fetch": {
    "startedAt": "2026-05-06T12:00:00Z",
    "finishedAt": "2026-05-06T12:00:02Z",
    "finalUrl": "https://example.com/",
    "redirects": ["http://example.com/"],
    "contentType": "text/html",
    "bytes": 183245
  },
  "canonical": {
    "value": "https://example.com/",
    "source": "link[rel=canonical]",
    "confidence": 0.9
  },
  "title": {
    "value": "ООО «Пример»",
    "source": "og:title",
    "confidence": 0.7
  },
  "descriptionShort": {
    "value": "Производство и монтаж ...",
    "source": "meta[name=description]",
    "confidence": 0.6
  },
  "logo": {
    "value": "https://example.com/logo.png",
    "source": "jsonld.logo",
    "confidence": 0.8
  },
  "phones": [
    {"value": "+7...", "source": "jsonld.telephone", "confidence": 0.8}
  ],
  "emails": [
    {"value": "info@example.com", "source": "mailto:", "confidence": 0.5}
  ],
  "address": {
    "value": "Москва, ...",
    "source": "jsonld.address",
    "confidence": 0.8
  },
  "openingHours": {
    "value": ["Mo-Fr 09:00-18:00"],
    "source": "jsonld.openingHours",
    "confidence": 0.7
  },
  "social": [
    {"kind": "vk", "value": "https://vk.com/...", "source": "a[href*=vk.com]", "confidence": 0.6}
  ],
  "images": [
    {"kind": "og:image", "value": "https://example.com/og.jpg", "confidence": 0.6}
  ],
  "rawSignals": {
    "hasJsonLd": true,
    "hasOpenGraph": true,
    "hasMetaDescription": true
  }
}
```

**Почему именно так:**
- “источник” нужен, чтобы модератор/пользователь понимал, откуда взялось.
- “confidence” нужен, чтобы авто-применение было безопасным.

---

### B4) Правила применения extracted → profile (строгая логика)
Политика применения (рекомендую закрепить в коде и в ТЗ как неизменяемую):

**Приоритет источников:**
1) **введено пользователем и подтверждено** (или уже опубликовано)
2) JSON‑LD schema.org (если есть)
3) OpenGraph
4) meta description/title
5) эвристики (по ссылкам/тексту)

**Правило “не перетирать”:**
- если `organization_profiles.description` уже заполнено пользователем — enrichment **не имеет права** его затирать.
- если поле пустое — можно auto-fill при `confidence >= threshold` (например 0.75).
- если confidence ниже — только “предложить”, но не применять.

**Правило “обновлять по кнопке”:**
- пользователь нажал “Применить предложенные данные” → разрешаем overwrite только выбранных полей и фиксируем это в `audit_log`.

---

### B5) Асинхронность: очередь
Enrichment должен идти асинхронно через очередь. Cloudflare Queues как раз для этого: producer отправляет сообщение, consumer воркер обрабатывает батч, поддерживает retries и параметры batching. 

---

## Приложение C — SSR-шаблон `/org/{slug}` + структура страницы + роутинг

### C1) Требование: “одна страница-шаблон, миллион организаций”
Вместо хранения `/org/slug/index.html` физически, должен быть:
- один SSR-обработчик (или функция), который по `slug` отдаёт HTML.

Для Cloudflare Pages Functions есть механизм routing и динамических маршрутов (dynamic routes). 

---

### C2) Структура SSR-страницы организации (блоки + поля)
**HEAD (SEO)**
- `<title>{title} — {category_label} в {region_label}</title>`
- `<meta name="description" content="{listing_text or descriptionShort}">`
- `<link rel="canonical" href="https://.../org/{slug}">`
- OpenGraph (title/description/image)
- JSON‑LD (schema.org Organization/LocalBusiness) — из БД (не из сайта пользователя)

**BODY**
1) **Hero**
   - logo (если есть)
   - title
   - короткая строка: категория • регион
   - рейтинг/кол-во отзывов (если есть)
   - CTA: “Перейти на сайт”, “Позвонить”, “Написать”

2) **Контакты (публичные)**
   - phone/email/messengers (только `is_public = true`)
   - адрес (если есть)
   - часы работы (если есть)

3) **О компании**
   - description (безопасный текст/markdown → рендер через sanitizer)

4) **Услуги/теги**
   - список услуг (если есть)
   - специализации

5) **Галерея**
   - cover + gallery images (из `organization_media`)
   - картинки хранятся в object storage, в БД — ссылки/ключи

6) **Похожие организации** (опционально)
   - тот же шаблон карточек, данные с `/v1/catalog?category=...&region=...&limit=...`

7) **Служебное**
   - “Сообщить об ошибке”, “Это моя компания” (для claim flow)

---

### C3) SSR-реализация: псевдокод Pages Function
- Роут: `/org/[slug].ts`
- Действия:
  1) взять `slug` из params
  2) запросить БД
  3) если не найдено/не published → 404
  4) собрать HTML по шаблону
  5) выставить cache headers

**Кэширование:**
- `Cache-Control: public, max-age=0, s-maxage=300` (пример)
- Инвалидация: при обновлении профиля — смена `updated_at` + можно включить “cache key” по slug и чистить на апдейте (в зависимости от платформы/возможностей)

---

### C4) Карточка превью: один шаблон для SSR и CSR
**Жёсткое требование ТЗ:** HTML карточки должен генерироваться **в одном месте**, иначе будет рассинхрон “до фильтра”/“после фильтра”.

Решение:
- вынести шаблон карточки в общий модуль:
  - `ui/catalogCard.ts` (функция `renderCatalogCard(item): string`)
- использовать:
  - в SSR листингах (если есть SSR)
  - в клиентском JS (для дорендера/бесконечной прокрутки)

---

### C5) Как “подтягивать нужное” с сайта пользователя (без headless)
Парсить:
- JSON‑LD / OG / meta / icon links

В Workers это удобно делать `HTMLRewriter` (для извлечения нужных тегов).   
Очередь — Cloudflare Queues. 

---

## Мини-фиксатор требований (чтобы команда не “съехала” в статический HTML снова)
1) **Запрещено** генерировать и коммитить `org/<slug>/index.html` для каждой компании.  
2) `/v1/catalog` — только постранично (limit+cursor), никакого “весь каталог”.  
3) Enrichment — только асинхронно через очередь/джобы.  
4) Extracted хранится отдельно и применяется строго по правилам.  
5) `/org/{slug}` — динамический роут (SSR/rewrites), не статические миллионы файлов.

--- 
Ниже — 3 обещанных “приложения” в максимально прикладном виде: **(1) спецификация курсора**, **(2) DDL (SQL) для новых таблиц**, **(3) пример producer/consumer на Cloudflare Queues** (под ваш текущий Worker с `nodejs_compat`, `pg` и Hyperdrive).

---

## 1) Спецификация курсора для `/v1/catalog` (base64url JSON)

### 1.1. Почему это нужно именно вам
Сейчас ваш `GET /v1/catalog` возвращает **весь** опубликованный каталог и сортирует по `o.title`, без пагинации.   
Для 1M организаций это упрётся и в DB, и в сеть, и в фронт. Поэтому нужен **limit + cursor (keyset pagination)**.

В Postgres удобнее всего делать keyset через **сравнение строк/кортежей**, например `(title, id) > (cursorTitle, cursorId)` — это штатная возможность “row comparison” в Postgres. 

### 1.2. Формат курсора (обязательная версия)
Курсор — это **base64url(JSON)**. В JSON обязательно держим:

```json
{
  "v": 1,
  "sort": "title",
  "dir": "asc",
  "k": { "title": "Acme", "id": "org_123" }
}
```

Где:
- `v` — версия формата курсора (чтобы потом расширять без поломок клиентов)
- `sort` — ключ сортировки (`title` | `rating` | `updated` | `search`)
- `dir` — направление (`asc` | `desc`)
- `k` — “ключ последней записи”, включает **все поля сортировки + tie-breaker**

**Tie-breaker обязателен** (обычно `id`), иначе при одинаковых значениях сортировки записи будут “скакать” между страницами.

### 1.3. Варианты `k` для разных сортировок

**A) sort=title (asc)**  
```json
"k": { "title": "ООО Ромашка", "id": "lazer-rezka" }
```
SQL условие:
- `WHERE (o.title, o.id) > ($title, $id)`
- `ORDER BY o.title ASC, o.id ASC`

**B) sort=rating (desc)**  
```json
"k": { "rating": 4.7, "reviews": 120, "id": "..." }
```
SQL условие:
- `WHERE (rating_key, reviews_key, id) < ($rating, $reviews, $id)`
- `ORDER BY rating_key DESC, reviews_key DESC, id DESC`

(тут `<`, потому что сортировка “сверху вниз”)

**C) sort=updated (desc)**  
```json
"k": { "updated_at": "2026-05-06T10:00:00.000Z", "id": "..." }
```
SQL:
- `WHERE (updated_at, id) < ($updated_at, $id)`
- `ORDER BY updated_at DESC, id DESC`

**D) sort=search (desc)**  
```json
"k": { "rank": 0.123456, "id": "..." }
```
SQL:
- `WHERE (rank, id) < ($rank, $id)`
- `ORDER BY rank DESC, id DESC`

### 1.4. Base64url encode/decode (JS/TS)
```ts
export function encodeCursor(obj: unknown): string {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeCursor<T>(cursor: string): T {
  const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((cursor.length + 3) % 4);
  const json = decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json) as T;
}
```

---

## 2) DDL (SQL) — новые таблицы: `organization_members`, `organization_site_extracts`, (+ опционально verification)

У вас сейчас:
- `organizations(id text primary key, ...)` 
- есть `organization_profiles` (1:1) со `slug text unique` и статусами модерации/верификации 
- есть `organization_applications` (uuid) и связь `result_org_id` 

Ниже — SQL, который можно положить отдельной миграцией, например `009_org_members_and_extracts.sql`.

### 2.1. `organization_members` (связь пользователь ↔ организация)
Зачем: без этого нельзя безопасно дать пользователю “редактировать свою организацию”, “перезапустить подтягивание”, “управлять публикацией”.

```sql
-- 009_org_members_and_extracts.sql

CREATE TABLE IF NOT EXISTS organization_members (
  org_id   text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  role     text NOT NULL DEFAULT 'owner'
           CHECK (role IN ('owner', 'editor')),

  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user
ON organization_members(user_id);
```

**Правило:** создатель заявки `/add/` после одобрения/создания `result_org_id` должен автоматически получать membership `owner`.

### 2.2. `organization_site_extracts` (результат enrichment)
Зачем: хранить “что мы нашли на сайте” отдельно от публикуемых полей профиля.

```sql
CREATE TABLE IF NOT EXISTS organization_site_extracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- можно привязываться либо к заявке, либо к уже созданной организации
  application_id uuid REFERENCES organization_applications(id) ON DELETE CASCADE,
  org_id         text REFERENCES organizations(id) ON DELETE CASCADE,

  website_url text NOT NULL,
  final_url   text,
  http_status integer,
  fetched_at  timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'ok'
         CHECK (status IN ('ok', 'error')),

  error_text text,

  extracted_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_site_extracts_app
ON organization_site_extracts(application_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_extracts_org
ON organization_site_extracts(org_id, fetched_at DESC);
```

**Важное правило:** `organization_profiles` обновляем авто-значениями только если поле пустое **или** пользователь явно нажал “применить”.

### 2.3. (Опционально, но очень рекомендую) токены верификации сайта
У вас в `organization_profiles` уже есть `verification_status`.   
Нужно место для токена и статуса процесса:

```sql
CREATE TABLE IF NOT EXISTS organization_site_verifications (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  token text NOT NULL,
  method text NOT NULL DEFAULT 'well_known'
         CHECK (method IN ('well_known', 'meta_tag', 'dns_txt')),

  status text NOT NULL DEFAULT 'pending'
         CHECK (status IN ('pending', 'verified', 'failed')),

  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_verif_status
ON organization_site_verifications(status);
```

---

## 3) Cloudflare Queues: producer/consumer пример (под ваш репозиторий)

### 3.1. Что Cloudflare Queues гарантирует (важно для логики)
- Consumer Worker получает сообщения в `queue(batch, env, ctx)` и может настраивать batch size/timeout.   
- **Если queue handler бросает исключение / не дождались промисов из `waitUntil` — весь batch считается неуспешным и будет retried**.   
- Можно управлять ack/retry на уровне сообщения (`msg.retry()`) или батча (`batch.retryAll()`), есть правила приоритета вызовов.   
- Если в батче “упало” одно сообщение, **по умолчанию переедет весь батч**, если вы заранее не ack’нули успешные сообщения.   
- Лимиты: max batch size до 100 сообщений.   

### 3.2. Wrangler config (добавить очередь)
В `worker/wrangler.toml` сейчас очередей нет.   
Добавляем (примерно так; имена подберите сами):

```toml
# wrangler.toml

[[queues.producers]]
binding = "ENRICH_QUEUE"
queue = "org-enrich"

[[queues.consumers]]
queue = "org-enrich"
max_batch_size = 20
max_batch_timeout = 10
# (опционально) retry_delay = 60
# (опционально) dead_letter_queue = "org-enrich-dlq"
```

И в `worker/src/types.ts` (Env) добавьте binding:
```ts
export interface Env {
  // ...
  ENRICH_QUEUE: Queue;
  // ...
}
```

### 3.3. Producer: постановка job на enrichment при создании заявки `/add/`
У вас уже есть обработчик `POST /v1/org/applications`.   
В конце, после успешной вставки заявки — добавляем `send` в очередь (Cloudflare показывает именно такую модель send). 

Пример патча (идея, не “точный diff”):

```ts
// после inserted.id
await env.ENRICH_QUEUE.send({
  kind: "enrich_application",
  applicationId: inserted.id,
  websiteUrl,
  requestedAt: new Date().toISOString()
});
```

**Почему так:** request от пользователя должен отработать быстро; enrichment — асинхронно.

### 3.4. Consumer: обработка batch, retries, backoff, запись в БД
Cloudflare рекомендует использовать `queue(batch, env, ctx)` и помнить про batch semantics. 

Пример consumer кода (может жить в том же worker, у Cloudflare это норм: `fetch` + `queue` в одном export). 

```ts
import { withDbClient } from "./db";

function computeBackoffSeconds(attempts: number) {
  // попытка 1 = 10 сек, 2 = 30 сек, 3 = 2 мин, 4 = 10 мин, 5 = 1 час
  const table = [10, 30, 120, 600, 3600];
  return table[Math.min(attempts - 1, table.length - 1)];
}

export default {
  async queue(batch, env, ctx): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const body = msg.body as any;
        if (body?.kind !== "enrich_application") {
          // неизвестный тип — лучше ack, чтобы не зациклить очередь
          msg.ack();
          continue;
        }

        const { applicationId, websiteUrl } = body;

        // 1) Fetch сайта (таймауты/лимиты вы добавите отдельно)
        const resp = await fetch(websiteUrl, {
          redirect: "follow",
          headers: { "User-Agent": "katalog-uslug-bot/1.0" }
        });

        const ct = resp.headers.get("content-type") || "";
        const html = ct.includes("text/html") ? await resp.text() : "";

        // 2) Мини-извлечение (MVP): title + meta description
        // (В идеале: JSON-LD + OG + icons и т.п.)
        const extracted = {
          fetch: {
            finalUrl: resp.url,
            httpStatus: resp.status,
            contentType: ct,
            bytes: html.length
          },
          title: extractTitle(html),
          descriptionShort: extractMetaDescription(html),
          ogImage: extractOgImage(html)
        };

        // 3) Записать в БД organization_site_extracts
        await withDbClient(env, async (c) => {
          await c.query(
            `INSERT INTO organization_site_extracts
              (application_id, website_url, final_url, http_status, status, extracted_json)
             VALUES
              ($1::uuid, $2, $3, $4, 'ok', $5::jsonb)`,
            [applicationId, websiteUrl, resp.url, resp.status, JSON.stringify(extracted)]
          );

          // (опционально) перевести заявку в status='enriched' если вы добавите статус
        });

        // 4) ACK успешного сообщения
        msg.ack();
      } catch (e) {
        const message = e instanceof Error ? e.message : "enrich_error";

        // записать ошибку (чтобы видеть, что происходило)
        try {
          const body = msg.body as any;
          const applicationId = body?.applicationId;

          if (applicationId) {
            await withDbClient(env, async (c) => {
              await c.query(
                `INSERT INTO organization_site_extracts
                  (application_id, website_url, status, error_text, extracted_json)
                 VALUES
                  ($1::uuid, $2, 'error', $3, $4::jsonb)`,
                [
                  applicationId,
                  String(body?.websiteUrl || ""),
                  message,
                  JSON.stringify({ error: message })
                ]
              );
            });
          }
        } catch {
          // не даём этому упасть и завалить весь batch
        }

        // retry с backoff. Важно: не throw, иначе завалится весь batch.
        const delaySeconds = computeBackoffSeconds(msg.attempts);
        msg.retry({ delaySeconds });
      }
    }

    // важно: возвращаемся нормально (без throw),
    // иначе batch будет считаться failed целиком.
  }
} satisfies ExportedHandler<Env>;
```

**Почему тут `msg.ack()` / `msg.retry()` обязательно:** Cloudflare прямо описывает, что можно ack/retry индивидуально и что иначе из-за одного сбоя может переехать весь batch. 

> Примечание: функции `extractTitle/extractMetaDescription/extractOgImage` — утилиты (regex на MVP или лучше HTMLRewriter). Вынесите в `worker/src/enrich/extract.ts`.

### 3.5. Dead Letter Queue (DLQ) (рекомендация)
Если подключите DLQ, то сообщения, исчерпавшие `max_retries`, будут уходить туда (Cloudflare это поддерживает).   
Это обязательно на масштабе, иначе “ядовитые” URL будут бесконечно мешать очереди.

---

## Бонус: как это стыкуется с вашим текущим schema/URL
Сейчас `organizations.id` — текстовый PK (по сути “id/slug”), и `CATALOG_SQL` формирует `url` как `'/org/' || o.id || '/'`.   
При переходе на настоящие страницы `/org/{slug}` лучше сделать так:
- canonical slug хранить в `organization_profiles.slug` (он уже есть и уникален). 
- `/v1/catalog` отдаёт `slug` и `url: '/org/' || p.slug || '/'`
- `/v1/org/{slug}` ищет по `organization_profiles.slug`

---
Ниже — “боевой” вариант для вашего текущего `GET /v1/catalog`, который сейчас делает `c.query(CATALOG_SQL)` и возвращает **весь** каталог без пагинации.   
Я дам:

1) готовые SQL (title и rating) **с фильтрами + поиском + keyset cursor**;  
2) пример кода, как собрать параметры и вернуть `nextCursor`;  
3) индексы/миграцию, чтобы это не умерло на 1M записей.

---

## 0) На какие таблицы/поля опираемся (как сейчас в репо)

Ваш текущий `CATALOG_SQL` выбирает данные из `organizations` + join `categories/regions`, фильтрует `o.published = true` и сортирует по `o.title`.   
Схема `organizations` (id, title, subtitle, listing_text, category_id, region_id, rating, reviews, published, …) определена в `001_init.sql`. 

При этом у вас уже есть расширенная таблица `organization_profiles` со `slug` и `moderation_status`/`verification_status`.   
Поэтому правильнее в публичном каталоге учитывать **оба** признака публикации:
- `o.published = true`
- `p.moderation_status = 'published'`

---

## 1) SQL #1: `/v1/catalog` с сортировкой по title (ASC) + cursor

Параметры запроса (рекомендую такой контракт):
- `category` — slug категории (например `metalworking`)
- `region` — slug региона
- `q` — строка поиска (MVP через `ILIKE`)
- `limit` — размер страницы (дефолт 24, max 100)
- `cursor` — base64url(JSON), где `k={title,id}` (как мы обсуждали)

### SQL (готовый)
```sql
-- $1 categorySlug (text|null)
-- $2 regionSlug   (text|null)
-- $3 q            (text|null)
-- $4 cursorTitle  (text|null)
-- $5 cursorId     (text|null)
-- $6 limit        (int)

SELECT
  o.id,
  o.title,
  o.subtitle,
  o.listing_text AS "text",
  c.slug  AS "categorySlug",
  c.label AS "categoryLabel",
  r.slug  AS "regionSlug",
  r.label AS "regionLabel",
  CAST(o.rating AS double precision) AS rating,
  o.reviews,

  -- важно: url лучше строить по профилю (там slug на будущее),
  -- но чтобы не ломать старое — fallback на o.id
  '/org/' || COALESCE(p.slug, o.id) || '/' AS url

FROM organizations o
JOIN categories c ON c.id = o.category_id
JOIN regions    r ON r.id = o.region_id
LEFT JOIN organization_profiles p ON p.org_id = o.id

WHERE
  o.published = true
  AND (p.moderation_status IS NULL OR p.moderation_status = 'published')
  AND c.is_public = true
  AND r.is_active = true

  AND ($1::text IS NULL OR c.slug = $1::text)
  AND ($2::text IS NULL OR r.slug = $2::text)

  AND (
    $3::text IS NULL OR
    o.title ILIKE ('%' || $3::text || '%') OR
    o.subtitle ILIKE ('%' || $3::text || '%') OR
    o.listing_text ILIKE ('%' || $3::text || '%')
  )

  -- keyset pagination: "после курсора"
  AND (
    $4::text IS NULL OR
    (o.title, o.id) > ($4::text, $5::text)
  )

ORDER BY o.title ASC, o.id ASC
LIMIT $6::int;
```

Почему работает `(o.title, o.id) > (cursorTitle, cursorId)`: Postgres поддерживает сравнение “row constructors” слева-направо (лексикографически), это ровно то, что нужно для keyset pagination. 

---

## 2) SQL #2: сортировка по рейтингу (DESC) + cursor

Контракт курсора:
- `k={rating,reviews,id}`

```sql
-- $1 categorySlug (text|null)
-- $2 regionSlug   (text|null)
-- $3 q            (text|null)
-- $4 cursorRating (numeric|null)  -- или double precision
-- $5 cursorReviews(int|null)
-- $6 cursorId     (text|null)
-- $7 limit        (int)

SELECT
  o.id,
  o.title,
  o.subtitle,
  o.listing_text AS "text",
  c.slug  AS "categorySlug",
  c.label AS "categoryLabel",
  r.slug  AS "regionSlug",
  r.label AS "regionLabel",
  CAST(o.rating AS double precision) AS rating,
  o.reviews,
  '/org/' || COALESCE(p.slug, o.id) || '/' AS url

FROM organizations o
JOIN categories c ON c.id = o.category_id
JOIN regions    r ON r.id = o.region_id
LEFT JOIN organization_profiles p ON p.org_id = o.id

WHERE
  o.published = true
  AND (p.moderation_status IS NULL OR p.moderation_status = 'published')
  AND c.is_public = true
  AND r.is_active = true

  AND ($1::text IS NULL OR c.slug = $1::text)
  AND ($2::text IS NULL OR r.slug = $2::text)

  AND (
    $3::text IS NULL OR
    o.title ILIKE ('%' || $3::text || '%') OR
    o.subtitle ILIKE ('%' || $3::text || '%') OR
    o.listing_text ILIKE ('%' || $3::text || '%')
  )

  -- keyset для DESC: используем "<" и сортируем DESC
  AND (
    $4::numeric IS NULL OR
    (o.rating, o.reviews, o.id) < ($4::numeric, $5::int, $6::text)
  )

ORDER BY o.rating DESC, o.reviews DESC, o.id DESC
LIMIT $7::int;
```

---

## 3) Патч в `worker/src/index.ts`: разбор query + выбор SQL + nextCursor

Сейчас у вас `GET /v1/catalog` просто делает `c.query(CATALOG_SQL)` и возвращает `rows`.   
Ниже — рабочий “скелет” замены (идею вставляете в ваш `if (path === "/v1/catalog")` блок).

### 3.1. Утилиты курсора (base64url JSON)
```ts
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return atob(b64);
}

function decodeCursor(cursor: string | null): any | null {
  if (!cursor) return null;
  try {
    const json = decodeURIComponent(escape(b64urlDecode(cursor)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function b64urlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeCursor(obj: any): string {
  return b64urlEncode(JSON.stringify(obj));
}
```

### 3.2. Пример обработчика
```ts
const CATALOG_SQL_TITLE = `...`  // SQL из секции 1
const CATALOG_SQL_RATING = `...` // SQL из секции 2

if (path === "/v1/catalog") {
  const u = new URL(request.url);

  const category = u.searchParams.get("category")?.trim() || null;
  const region   = u.searchParams.get("region")?.trim() || null;
  const q        = u.searchParams.get("q")?.trim() || null;

  const sort = (u.searchParams.get("sort") || "title").trim(); // "title" | "rating"
  const limitRaw = Number(u.searchParams.get("limit") || 24);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 24));

  const cur = decodeCursor(u.searchParams.get("cursor"));

  const rows = await withDbClient(env, async (c) => {
    if (sort === "rating") {
      const cursorRating  = cur?.k?.rating ?? null;
      const cursorReviews = cur?.k?.reviews ?? null;
      const cursorId      = cur?.k?.id ?? null;

      const r = await c.query(CATALOG_SQL_RATING, [
        category, region, q,
        cursorRating, cursorReviews, cursorId,
        limit
      ]);
      return r.rows;
    } else {
      const cursorTitle = cur?.k?.title ?? null;
      const cursorId    = cur?.k?.id ?? null;

      const r = await c.query(CATALOG_SQL_TITLE, [
        category, region, q,
        cursorTitle, cursorId,
        limit
      ]);
      return r.rows;
    }
  });

  // nextCursor: если вернули limit строк — считаем, что есть продолжение
  let nextCursor: string | null = null;
  if (rows.length === limit) {
    const last = rows[rows.length - 1];

    if (sort === "rating") {
      nextCursor = encodeCursor({
        v: 1,
        sort: "rating",
        dir: "desc",
        k: { rating: last.rating, reviews: last.reviews, id: last.id }
      });
    } else {
      nextCursor = encodeCursor({
        v: 1,
        sort: "title",
        dir: "asc",
        k: { title: last.title, id: last.id }
      });
    }
  }

  // Рекомендованный ответ:
  return Response.json({ items: rows, nextCursor }, { headers: cors });

  // Если хотите "не ломать" старых клиентов, можно временно:
  // const h = new Headers(cors);
  // if (nextCursor) h.set("X-Next-Cursor", nextCursor);
  // return Response.json(rows, { headers: h });
}
```

---

## 4) Индексы (обязательно для 1M)

У вас есть индексы на `region_id`, `category_id` и частичный на `published`.   
Но для keyset пагинации по title/рейтингу вам нужно добавить индексы под сортировку.

### 4.1. Title keyset
```sql
-- ускоряет WHERE published=true + ORDER BY title,id
CREATE INDEX IF NOT EXISTS idx_org_pub_title_id
ON organizations (title, id)
WHERE published;
```

### 4.2. Rating keyset
```sql
CREATE INDEX IF NOT EXISTS idx_org_pub_rating_reviews_id
ON organizations (rating DESC, reviews DESC, id DESC)
WHERE published;
```

---

## 5) Поиск: MVP сейчас (ILIKE), следующий шаг (pg_trgm / FTS)

`ILIKE '%q%'` на миллионе записей будет тяжёлым. Я бы зафиксировал как этап 2:

### Вариант A (быстро и эффективно для “contains”): pg_trgm
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_org_title_trgm
ON organizations USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_org_subtitle_trgm
ON organizations USING GIN (subtitle gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_org_listing_trgm
ON organizations USING GIN (listing_text gin_trgm_ops);
```

Тогда ваш `ILIKE` начнёт реально использовать индекс (в большинстве случаев).

---

## 1) БД: добавить индексы под keyset pagination (и опционально — поиск)

Создайте новую миграцию:

**`db/migrations/009_catalog_pagination_indexes.sql`**
```sql
-- Индексы для быстрого листинга при 1M+ записей

-- 1) keyset pagination по title ASC, id ASC
CREATE INDEX IF NOT EXISTS idx_org_pub_title_id
ON organizations (title, id)
WHERE published;

-- 2) keyset pagination по updated_at DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_org_pub_updated_id
ON organizations (updated_at DESC, id DESC)
WHERE published;

-- 3) keyset pagination по rating DESC, reviews DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_org_pub_rating_reviews_id
ON organizations (rating DESC, reviews DESC, id DESC)
WHERE published;

-- (опционально, этап 2) Ускорение ILIKE-поиска по текстовым полям
-- На миллионе строк ILIKE '%q%' без индекса будет тяжёлым.
-- Если включите trigram-поиск:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_org_title_trgm   ON organizations USING GIN (title gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_org_subtitle_trgm ON organizations USING GIN (subtitle gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_org_listing_trgm  ON organizations USING GIN (listing_text gin_trgm_ops);
```

Почему keyset-условия вида `(a,b) > (c,d)` корректны: Postgres поддерживает “row comparisons” (лексикографическое сравнение кортежей), что идеально для seek-pagination. 

---

## 2) Worker: обновить `/v1/catalog` на v2 (items + nextCursor)

### 2.1. Заменяем старый `CATALOG_SQL` на 3 SQL (title / rating / updated)

В `worker/src/index.ts` **вместо** текущего `const CATALOG_SQL = ...` (который сейчас просто `WHERE o.published=true ORDER BY o.title` ) вставьте блок:

```ts
type CatalogSort = "title" | "rating" | "updated";
type CursorV1 =
  | { v: 1; sort: "title"; dir: "asc"; k: { title: string; id: string } }
  | { v: 1; sort: "updated"; dir: "desc"; k: { updatedAt: string; id: string } }
  | { v: 1; sort: "rating"; dir: "desc"; k: { rating: number; reviews: number; id: string } };

const CATALOG_SQL_TITLE = `
SELECT
  o.id,
  p.slug,
  o.title,
  o.subtitle,
  o.listing_text AS "text",
  c.slug AS "categorySlug",
  c.label AS "categoryLabel",
  r.slug AS "regionSlug",
  r.label AS "regionLabel",
  CAST(o.rating AS double precision) AS rating,
  o.reviews,
  o.updated_at AS "updatedAt",
  '/org/' || COALESCE(p.slug, o.id) || '/' AS url
FROM organizations o
JOIN organization_profiles p ON p.org_id = o.id
JOIN categories c ON c.id = o.category_id
JOIN regions r ON r.id = o.region_id
WHERE
  o.published = true
  AND p.moderation_status = 'published'
  AND c.is_public = true
  AND r.is_active = true
  AND ($1::text IS NULL OR c.slug = $1::text)
  AND ($2::text IS NULL OR r.slug = $2::text)
  AND ($3::text IS NULL OR (
    o.title ILIKE ('%' || $3::text || '%')
    OR o.subtitle ILIKE ('%' || $3::text || '%')
    OR o.listing_text ILIKE ('%' || $3::text || '%')
  ))
  AND ($4::numeric IS NULL OR o.rating >= $4::numeric)
  AND ($5::text IS NULL OR (o.title, o.id) > ($5::text, $6::text))
ORDER BY o.title ASC, o.id ASC
LIMIT $7::int;
`;

const CATALOG_SQL_UPDATED = `
SELECT
  o.id,
  p.slug,
  o.title,
  o.subtitle,
  o.listing_text AS "text",
  c.slug AS "categorySlug",
  c.label AS "categoryLabel",
  r.slug AS "regionSlug",
  r.label AS "regionLabel",
  CAST(o.rating AS double precision) AS rating,
  o.reviews,
  o.updated_at AS "updatedAt",
  '/org/' || COALESCE(p.slug, o.id) || '/' AS url
FROM organizations o
JOIN organization_profiles p ON p.org_id = o.id
JOIN categories c ON c.id = o.category_id
JOIN regions r ON r.id = o.region_id
WHERE
  o.published = true
  AND p.moderation_status = 'published'
  AND c.is_public = true
  AND r.is_active = true
  AND ($1::text IS NULL OR c.slug = $1::text)
  AND ($2::text IS NULL OR r.slug = $2::text)
  AND ($3::text IS NULL OR (
    o.title ILIKE ('%' || $3::text || '%')
    OR o.subtitle ILIKE ('%' || $3::text || '%')
    OR o.listing_text ILIKE ('%' || $3::text || '%')
  ))
  AND ($4::numeric IS NULL OR o.rating >= $4::numeric)
  AND ($5::timestamptz IS NULL OR (o.updated_at, o.id) < ($5::timestamptz, $6::text))
ORDER BY o.updated_at DESC, o.id DESC
LIMIT $7::int;
`;

const CATALOG_SQL_RATING = `
SELECT
  o.id,
  p.slug,
  o.title,
  o.subtitle,
  o.listing_text AS "text",
  c.slug AS "categorySlug",
  c.label AS "categoryLabel",
  r.slug AS "regionSlug",
  r.label AS "regionLabel",
  CAST(o.rating AS double precision) AS rating,
  o.reviews,
  o.updated_at AS "updatedAt",
  '/org/' || COALESCE(p.slug, o.id) || '/' AS url
FROM organizations o
JOIN organization_profiles p ON p.org_id = o.id
JOIN categories c ON c.id = o.category_id
JOIN regions r ON r.id = o.region_id
WHERE
  o.published = true
  AND p.moderation_status = 'published'
  AND c.is_public = true
  AND r.is_active = true
  AND ($1::text IS NULL OR c.slug = $1::text)
  AND ($2::text IS NULL OR r.slug = $2::text)
  AND ($3::text IS NULL OR (
    o.title ILIKE ('%' || $3::text || '%')
    OR o.subtitle ILIKE ('%' || $3::text || '%')
    OR o.listing_text ILIKE ('%' || $3::text || '%')
  ))
  AND ($4::numeric IS NULL OR o.rating >= $4::numeric)
  AND ($5::numeric IS NULL OR (o.rating, o.reviews, o.id) < ($5::numeric, $6::int, $7::text))
ORDER BY o.rating DESC, o.reviews DESC, o.id DESC
LIMIT $8::int;
`;
```

Почему я добавил условия `c.is_public` и `r.is_active`: эти поля реально добавлены миграцией `006_foundation_v2.sql`.   
Почему добавил `p.moderation_status='published'`: это тоже в `organization_profiles`. 

---

### 2.2. Добавляем утилиты base64url cursor + строгая валидация

В `worker/src/index.ts` (рядом с вашими утилитами вроде `normalizeSlug`) добавьте:

```ts
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return atob(b64);
}
function b64urlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursorV1(raw: string | null): CursorV1 | null {
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(b64urlDecode(raw)));
    const obj = JSON.parse(json);
    if (!obj || obj.v !== 1) return null;
    if (obj.sort === "title" && obj.dir === "asc" && obj.k?.title && obj.k?.id) return obj as CursorV1;
    if (obj.sort === "updated" && obj.dir === "desc" && obj.k?.updatedAt && obj.k?.id) return obj as CursorV1;
    if (obj.sort === "rating" && obj.dir === "desc" && typeof obj.k?.rating === "number" && typeof obj.k?.reviews === "number" && obj.k?.id)
      return obj as CursorV1;
    return null;
  } catch {
    return null;
  }
}

function encodeCursorV1(obj: CursorV1): string {
  return b64urlEncode(JSON.stringify(obj));
}
```

---

### 2.3. Полностью заменяем handler `/v1/catalog`

Найдите в `worker/src/index.ts` блок:

```ts
if (path === "/v1/catalog") {
  ...
  const rows = await withDbClient(env, async (c) => {
    const r = await c.query(CATALOG_SQL);
    return r.rows;
  });
  return Response.json(rows, { headers: cors });
}
```

(он сейчас именно такой). 

И замените на:

```ts
if (path === "/v1/catalog" && request.method === "GET") {
  if (!getDbConnectionString(env)) {
    return Response.json({ error: "misconfigured", detail: "db_connection" }, { status: 503, headers: cors });
  }

  const category = url.searchParams.get("category")?.trim() || null;
  const region = url.searchParams.get("region")?.trim() || null;

  let q = url.searchParams.get("q")?.trim() || null;
  if (q && q.length < 2) q = null;
  if (q && q.length > 80) q = q.slice(0, 80);

  const sortRaw = (url.searchParams.get("sort") || "title").trim();
  const sort: CatalogSort = sortRaw === "rating" ? "rating" : sortRaw === "updated" ? "updated" : "title";

  const limitRaw = Number(url.searchParams.get("limit") || 24);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 24));

  const minRatingRaw = url.searchParams.get("minRating");
  let minRating: number | null = null;
  if (minRatingRaw != null && minRatingRaw !== "") {
    const v = Number(minRatingRaw);
    if (Number.isFinite(v)) minRating = Math.max(0, Math.min(5, v));
  }

  const cursor = decodeCursorV1(url.searchParams.get("cursor"));
  // если cursor другого sort — игнорируем
  const cursorOk = cursor && cursor.sort === sort ? cursor : null;

  try {
    const rows = await withDbClient(env, async (c) => {
      if (sort === "rating") {
        const cr = cursorOk?.sort === "rating" ? cursorOk : null;
        const cursorRating = cr?.k.rating ?? null;
        const cursorReviews = cr?.k.reviews ?? null;
        const cursorId = cr?.k.id ?? null;

        const r = await c.query(CATALOG_SQL_RATING, [
          category, region, q, minRating,
          cursorRating, cursorReviews, cursorId,
          limit
        ]);
        return r.rows;
      }

      if (sort === "updated") {
        const cu = cursorOk?.sort === "updated" ? cursorOk : null;
        const cursorUpdatedAt = cu?.k.updatedAt ?? null;
        const cursorId = cu?.k.id ?? null;

        const r = await c.query(CATALOG_SQL_UPDATED, [
          category, region, q, minRating,
          cursorUpdatedAt, cursorId,
          limit
        ]);
        return r.rows;
      }

      // sort === "title"
      const ct = cursorOk?.sort === "title" ? cursorOk : null;
      const cursorTitle = ct?.k.title ?? null;
      const cursorId = ct?.k.id ?? null;

      const r = await c.query(CATALOG_SQL_TITLE, [
        category, region, q, minRating,
        cursorTitle, cursorId,
        limit
      ]);
      return r.rows;
    });

    let nextCursor: string | null = null;
    if (rows.length === limit) {
      const last = rows[rows.length - 1];

      if (sort === "rating") {
        nextCursor = encodeCursorV1({
          v: 1, sort: "rating", dir: "desc",
          k: { rating: Number(last.rating) || 0, reviews: Number(last.reviews) || 0, id: String(last.id) }
        });
      } else if (sort === "updated") {
        nextCursor = encodeCursorV1({
          v: 1, sort: "updated", dir: "desc",
          k: { updatedAt: String(last.updatedAt), id: String(last.id) }
        });
      } else {
        nextCursor = encodeCursorV1({
          v: 1, sort: "title", dir: "asc",
          k: { title: String(last.title), id: String(last.id) }
        });
      }
    }

    const headers: HeadersInit = {
      ...cors,
      // кэш можно держать коротким, данные публичные:
      "Cache-Control": "public, max-age=0, s-maxage=60",
    };

    return Response.json(
      {
        items: rows,
        nextCursor,
        meta: { sort, limit, category, region, q, minRating }
      },
      { headers }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "db_error";
    return Response.json({ error: "catalog_unavailable", message }, { status: 502, headers: cors });
  }
}
```

---

## 3) Worker: добавить `GET /v1/org/:slug` (детальная страница из БД)

### 3.1. SQL для детальной организации (с контактами/услугами/тегами)

Добавьте в `worker/src/index.ts` рядом с SQL-константами:

```ts
const ORG_PUBLIC_BY_SLUG_SQL = `
SELECT
  o.id,
  p.slug,
  o.title,
  o.subtitle,
  o.listing_text AS "listingText",
  CAST(o.rating AS double precision) AS rating,
  o.reviews,
  o.created_at AS "createdAt",
  o.updated_at AS "updatedAt",

  c.slug AS "categorySlug",
  c.label AS "categoryLabel",
  r.slug AS "regionSlug",
  r.label AS "regionLabel",

  p.legal_name AS "legalName",
  p.description_md AS "descriptionMd",
  p.website_url AS "websiteUrl",
  p.logo_url AS "logoUrl",
  p.cover_url AS "coverUrl",
  p.address_text AS "addressText",
  p.geo_lat AS "geoLat",
  p.geo_lon AS "geoLon",
  p.work_hours_json AS "workHours",
  p.verification_status AS "verificationStatus",
  p.moderation_status AS "moderationStatus",
  p.published_at AS "publishedAt",

  COALESCE(pc.public_contacts, '[]'::jsonb) AS "publicContacts",
  COALESCE(sv.services, '[]'::jsonb) AS services,
  COALESCE(tg.tags, '[]'::jsonb) AS tags,

  '/org/' || COALESCE(p.slug, o.id) || '/' AS url

FROM organizations o
JOIN organization_profiles p ON p.org_id = o.id
JOIN categories c ON c.id = o.category_id
JOIN regions r ON r.id = o.region_id

LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'type', contact_type,
      'value', contact_value,
      'label', contact_label,
      'primary', is_primary
    )
    ORDER BY sort_order, id
  ) AS public_contacts
  FROM organization_public_contacts x
  WHERE x.org_id = o.id
) pc ON true

LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'slug', service_slug,
      'title', service_title,
      'description', service_description,
      'priceFrom', price_from,
      'priceTo', price_to,
      'currency', currency
    )
    ORDER BY sort_order, id
  ) AS services
  FROM organization_services s
  WHERE s.org_id = o.id AND s.is_active = true
) sv ON true

LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'slug', t.slug,
      'label', t.label,
      'type', t.tag_type
    )
    ORDER BY t.label
  ) AS tags
  FROM organization_tags ot
  JOIN tags t ON t.id = ot.tag_id
  WHERE ot.org_id = o.id
) tg ON true

WHERE
  p.slug = $1::text
  AND o.published = true
  AND p.moderation_status = 'published'
  AND c.is_public = true
  AND r.is_active = true
LIMIT 1;
`;

const ORG_PUBLIC_BY_ID_SQL = ORG_PUBLIC_BY_SLUG_SQL.replace("p.slug = $1::text", "o.id = $1::text");
```

**Важно про `jsonb_agg(... ORDER BY ...)`:** порядок внутри агрегатов задаётся именно `ORDER BY` внутри вызова агрегатной функции — это нормальная возможность Postgres для агрегатов, включая `jsonb_agg`. 

**Важно про типы jsonb в Node:** `pg` (node-postgres) по умолчанию парсит `json/jsonb` в JS-объекты через `JSON.parse`, поэтому `publicContacts/services/tags` придут как массивы/объекты, а не строка. 

---

### 3.2. Handler `/v1/org/:slug`

Добавьте в `worker/src/index.ts` **после** `/v1/org/meta` и **до** `/v1/org/applications` (или ниже, но обязательно исключите `meta`/`applications`) вот такой блок:

```ts
if (request.method === "GET" && path.startsWith("/v1/org/")) {
  // исключаем зарезервированные пути:
  if (path === "/v1/org/meta") {
    // пусть обработает ваш текущий handler /v1/org/meta
  } else if (path.startsWith("/v1/org/applications")) {
    // пусть обработают ваши handlers applications
  } else {
    if (!getDbConnectionString(env)) {
      return Response.json({ error: "misconfigured", detail: "db_connection" }, { status: 503, headers: cors });
    }

    const slug = path.slice("/v1/org/".length).trim();
    if (!slug || slug.includes("/")) {
      return Response.json({ error: "invalid_slug" }, { status: 400, headers: cors });
    }

    // мягкая нормализация под ваш стиль slug
    const key = slug.toLowerCase();

    try {
      const row = await withDbClient(env, async (c) => {
        const bySlug = await c.query(ORG_PUBLIC_BY_SLUG_SQL, [key]);
        if (bySlug.rows[0]) return bySlug.rows[0];

        const byId = await c.query(ORG_PUBLIC_BY_ID_SQL, [key]);
        return byId.rows[0] || null;
      });

      if (!row) {
        return Response.json({ error: "not_found" }, { status: 404, headers: cors });
      }

      return Response.json(
        { organization: row },
        {
          headers: {
            ...cors,
            "Cache-Control": "public, max-age=0, s-maxage=300",
          },
        }
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "db_error";
      return Response.json({ error: "org_unavailable", message }, { status: 502, headers: cors });
    }
  }
}
```

---

## 4) Мини-заметки по фронту (чтобы это реально “поехало” в UI)

Сейчас ваш фронт на главной грузит **статический** `/data/catalog.json`, а не API.   
Поэтому следующий шаг (уже на стороне сайта) будет:
- заменить загрузку каталога на `fetch(${apiBase}/v1/catalog?limit=...&sort=...&cursor=...)`
- научиться работать с `{items,nextCursor}` (и делать “Загрузить ещё”/infinite scroll)

Но это можно делать после того, как API начнёт отдавать страницы стабильно.

---

## 5) Быстрая проверка после внедрения

1) Накатить миграции (у вас уже есть `worker/apply-migrations.mjs`).   
2) Проверить:
- `GET /v1/catalog?limit=2` → `items.length=2`, `nextCursor != null`
- `GET /v1/catalog?limit=2&cursor=...` → следующая страница
- `GET /v1/org/lazer-rezka` → объект с `publicContacts/services/tags` как массивы
3) Нагрузочно: `sort=title` и `sort=updated` должны идти по индексам.

---
Ниже — “следующий шаг до рабочего результата”: **каталог грузится из БД постранично**, **фильтры работают серверно**, а **страница организации** открывается по одному шаблону и тянет данные из API (без `org/<slug>/index.html` на каждую организацию).

Я опираюсь на текущее состояние репо:

- сейчас Worker `GET /v1/catalog` просто выполняет `CATALOG_SQL` и возвращает **все строки** без пагинации.   
- фронт (`js/main.js`) грузит **статический** `/data/catalog.json` и фильтрует его локально.   
- плюс он “догидрирует” текст карточек, **скачивая HTML страниц организаций** и парся `.org-article`, `.org-showcase-aside` — это станет невозможным/дорогим при миллионах страниц.   
- структуры для профиля/контактов/услуг уже есть в БД: `organization_profiles`, `organization_public_contacts`, `organization_services`, `tags/...`.   
- статические страницы организаций сейчас реально лежат в репо в `/org/<slug>/index.html`.   

---

## Часть 1. Worker/API: делаем `/v1/catalog?v=2` (pagination + фильтры + cursor), не ломая текущий v1

### 1) Оставляем текущее поведение как v1
Текущий `GET /v1/catalog` возвращает массив `rows`.   
Чтобы не ломать ничего внезапно, делаем так:

- `GET /v1/catalog` → **как сейчас** (v1)
- `GET /v1/catalog?v=2` → **новый формат**:
  ```json
  { "items": [...], "nextCursor": "...", "meta": {...} }
  ```

### 2) Индексы под keyset pagination (миграция)
Добавьте миграцию, например `db/migrations/009_catalog_pagination_indexes.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_org_pub_title_id
ON organizations (title, id)
WHERE published;

CREATE INDEX IF NOT EXISTS idx_org_pub_updated_id
ON organizations (updated_at DESC, id DESC)
WHERE published;

CREATE INDEX IF NOT EXISTS idx_org_pub_rating_reviews_id
ON organizations (rating DESC, reviews DESC, id DESC)
WHERE published;
```

`updated_at`/`created_at` в `organizations` уже есть в `001_init.sql`.   

### 3) В `worker/src/index.ts`: добавляем v2 SQL (с JOIN на профили и фильтрами публичности)
Сейчас `CATALOG_SQL` не учитывает `categories.is_public`/`regions.is_active`/`organization_profiles.moderation_status` и строит url как `/org/${o.id}/`.   
Но мета-эндпоинт `/v1/org/meta` уже отдаёт только `categories.is_public=true` и `regions.is_active=true`, т.е. публичность у вас уже в модели заложена.   

Добавьте новые SQL-константы для v2 и курсор (base64url JSON). (Код я уже присылал ранее; тут главное правило интеграции: **ветка `if (v !== "2")` оставляет старое поведение**.)

---

## Часть 2. Worker/API: добавляем `GET /v1/org/:slug` (данные для шаблонной страницы)

### Почему это ключевое
Сейчас фронт умеет “вынимать” текст для карточки, скачивая HTML `/org/.../` и парся `.org-article`/контакты.   
Как только вы убираете миллион HTML-страниц — этот механизм должен умереть, а данные должны приходить **из БД**.

### Что вернуть в JSON
Минимум для страницы:
- `title/subtitle/rating/reviews/category/region`
- `description_md`, `website_url`, `logo_url`, `cover_url`, `address_text`, `work_hours_json`
- `publicContacts[]`, `services[]`, `tags[]`

Таблицы/поля под это у вас уже есть в миграции `006_foundation_v2.sql`.   

### Где вставить handler
В `worker/src/index.ts` добавьте обработку **после** `/v1/org/meta` и **до** админского `handleOrgAdmin` (он вызывается в конце файла).   

---

## Часть 3. Frontend: переделываем `js/main.js` на серверные фильтры и пагинацию

### Что именно меняем
Сейчас `initCatalogFilters()`:
- грузит `/data/catalog.json` целиком   
- фильтрует локально (`applyLocalFilters(catalog)`)   
- при неудаче пытается фильтровать уже готовые HTML-карточки в DOM   

Вам нужно заменить ветку “каталог грузим целиком” на:

1) собрать query из:
   - select’ов `#filter-region/#filter-category/#filter-rating/#filter-search`   
   - и атрибутов страницы (`data-page-region` уже используется)   
2) вызвать API:
   - `GET {apiBase}/v1/catalog?v=2&limit=24&region=...&category=...&minRating=...&q=...&cursor=...`
3) отрендерить `items` тем же `cardHtml(item)` (он уже есть).   
4) показывать кнопку “Показать ещё” пока есть `nextCursor`.

### Обязательная правка: убрать hydration карточек из HTML страниц организаций
Удаляйте/отключайте:
- `loadOrgCardText()` + `hydrateCatalogCardsFromOrgPages()` (они делают `fetch(orgUrl)` и парсят HTML).   

Иначе при 1M организаций вы получите лавину запросов к страницам.

---

## Часть 4. Шаблонная страница организации без миллиона файлов

### MVP (быстро): один `org/index.html` + `js/org.js` (CSR)
Создаёте **один** файл:

- `org/index.html` — каркас страницы (можно взять структуру из ваших текущих org-страниц: там есть `.org-article`, `.org-showcase-aside`, блоки `.content-block` и т.д.).   
- `js/org.js`:
  - берёт slug из `location.pathname` (например `/org/lazer-rezka/` → `lazer-rezka`)
  - делает `GET {apiBase}/v1/org/{slug}`
  - вставляет данные в DOM

### Роутинг (обязательно, иначе не будет работать без файлов)
На GitHub Pages “красиво” сделать `/org/<slug>/` без файла нельзя: Pages просто мапит URL на существующие файлы в репозитории.   
Поэтому для настоящего масштаба вам нужно хранилище с rewrite’ами.

#### Вариант для Cloudflare Pages (самый простой)
Добавляете файл `_redirects` в корень сборки:

```txt
/org/*  /org/index.html  200
```

Cloudflare Pages поддерживает `_redirects` и формат правил, включая “200 rewrite”.   

### Следующий шаг (лучше для SEO): SSR через Pages Functions
Если хотите, чтобы поисковик видел готовый HTML без выполнения JS:
- делаете Pages Functions роут `/org/:slug` и рендерите HTML на edge
- Cloudflare описывает роутинг Pages Functions и управление через `_routes.json`.   

---

## Часть 5. “Долг” после запуска MVP (чтобы дойти до вашей цели «миллион организаций»)
1) **Enrichment очередь**: после `/add/` (у вас уже есть `POST /v1/org/applications`) ставить job на сбор меты сайта.   
2) **Хранение медиа**: сейчас карточка умеет `portfolioImages` (слайдер), но в БД этого нет — нужно добавить таблицу медиа или JSONB-массив ссылок.   
3) **Поиск**: `ILIKE '%q%'` как MVP, затем `pg_trgm` или FTS.
4) **Sitemap** батчами (sitemap index).

---
Ниже — готовые файлы и конкретные правки, чтобы:

- **каталог (карточки)** грузился **постранично из БД через API** (а не `/data/catalog.json`), потому что сейчас `initCatalogFilters()` тянет статический JSON целиком.   
- **страница организации** стала **одной шаблонной** (`/org/index.html` + `js/org.js`) и строилась из `GET /v1/org/:slug`, без хранения `org/<slug>/index.html` на каждую организацию. (Сейчас у вас каждая организация — отдельная папка `org/<slug>/index.html`.)   
- сохранить вашу текущую вёрстку (классы `org-header`, `org-showcase-aside`, `data-portfolio` и т. д.).   

---

## 1) Новый файл: `org/index.html` (универсальный шаблон страницы организации)

Создайте **`/org/index.html`** (именно в папке `org/`), с режимом “контент между маркерами”. Ваш `scripts/inject-layout.mjs` как раз поддерживает режим, когда вы правите только блок между `<!-- katalog:page-main --> … <!-- katalog:page-main-end -->`, а шапка/подвал подставляются из `partials` при `npm run build:layout`.   

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>Организация — katalog-uslug.pro</title>
  <meta name="description" content="Страница организации в каталоге услуг.">

  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css?v=20260521">
</head>

<body>
<!-- katalog:page-main -->

<!-- Org header -->
<section class="org-header" data-org-page>
  <div class="container">
    <nav class="breadcrumbs" id="org-breadcrumbs">
      <a href="/">Главная</a><span>/</span><span>Организация</span>
    </nav>

    <h1 class="org-title" id="org-title">Загрузка…</h1>

    <div class="org-meta" id="org-meta">
      <span class="tag" id="org-category-tag" hidden></span>
      <span class="tag tag-green" id="org-region-tag" hidden></span>
      <span class="tag tag-accent" id="org-rating-tag" hidden></span>
    </div>
  </div>
</section>

<!-- Org body -->
<section class="org-body">
  <div class="container">
    <div class="org-portfolio-slot" aria-labelledby="org-portfolio-sr-heading" id="org-portfolio-slot" hidden>
      <h2 id="org-portfolio-sr-heading" class="sr-only">Портфолио организации</h2>

      <div data-portfolio class="org-portfolio-wrap">
        <div class="org-showcase org-showcase--layout">

          <div class="org-showcase-card org-showcase-card--hero">
            <div class="portfolio-pixel portfolio-pixel-hero" data-portfolio-hero role="img" aria-label=""></div>
          </div>

          <div class="org-showcase-minis" data-portfolio-desk-side></div>

          <div class="org-showcase-mob portfolio-mob">
            <div class="portfolio-mob-strip" data-portfolio-mob-strip></div>
            <div class="portfolio-mob-controls">
              <button type="button" class="portfolio-mob-nav" data-portfolio-mob-prev aria-label="Предыдущее фото">‹</button>
              <span class="portfolio-mob-indicator" data-portfolio-mob-indicator>1/1</span>
              <button type="button" class="portfolio-mob-nav" data-portfolio-mob-next aria-label="Следующее фото">›</button>
            </div>
          </div>

          <aside class="org-showcase-aside sidebar">
            <div class="sidebar-card" id="org-contacts-card">
              <h3>Контакты</h3>
              <div id="org-contacts-rows"></div>

              <a id="org-website-btn" href="#" target="_blank" rel="noopener" class="btn btn-primary mt-16" hidden>
                Перейти на сайт →
              </a>
            </div>

            <div class="sidebar-card" id="org-verification-card" hidden>
              <h3>Статус верификации</h3>
              <div class="sidebar-row" id="org-verification-row"></div>
            </div>
          </aside>

        </div>

        <!-- Источник слайдов для портфолио (заполняет js/org.js) -->
        <div data-portfolio-source hidden id="org-portfolio-source"></div>
      </div>
    </div>

    <div class="org-article" id="org-article">
      <div class="content-block" id="org-about-block">
        <h2>О компании</h2>
        <div id="org-about-text"><p>Загрузка…</p></div>
      </div>

      <div class="content-block mt-32" id="org-services-block" hidden>
        <h2>Услуги</h2>
        <ul id="org-services-list"></ul>
      </div>

      <div class="content-block mt-32" id="org-tags-block" hidden>
        <h2>Теги</h2>
        <div class="tag-row" id="org-tags-row"></div>
      </div>
    </div>
  </div>
</section>

<!-- katalog:page-main-end -->

<script src="/js/main.js?v=20260521"></script>
<script src="/js/org.js?v=20260521"></script>
</body>
</html>
```

---

## 2) Новый файл: `js/org.js` (загрузка организации из БД + рендер по шаблону)

Создайте **`/js/org.js`**:

- берёт `slug` из URL (`/org/<slug>/`) или из `?slug=...` (удобно для локальной отладки),
- грузит `GET {API_BASE}/v1/org/{slug}`,
- заполняет блоки страницы,
- если есть картинки (cover/logo или массив `images`/`media` если вы добавите позже) — строит `data-portfolio-source` и **сам** инициализирует портфолио (потому что `main.js` инициализирует портфолио слишком рано — до окончания fetch).  
  В `main.js` портфолио инициализируется по `[data-portfolio]` и кнопкам внутри `[data-portfolio-source]`.   

```js
document.addEventListener('DOMContentLoaded', () => {
  const page = document.querySelector('[data-org-page]');
  if (!page) return;

  const apiBase =
    (document.querySelector('meta[name="katalog-catalog-api"]')?.getAttribute('content') || '')
      .trim()
      .replace(/\/$/, '');

  const setText = (sel, v) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.textContent = v == null ? '' : String(v);
  };

  const clear = (sel) => {
    const el = document.querySelector(sel);
    if (el) el.innerHTML = '';
    return el;
  };

  function detectSlug() {
    const u = new URL(window.location.href);
    const qp = (u.searchParams.get('slug') || u.searchParams.get('id') || '').trim();
    if (qp) return qp;

    // ожидаем /org/<slug>/  или /org/<slug>
    const parts = u.pathname.split('/').filter(Boolean);
    const orgIdx = parts.indexOf('org');
    if (orgIdx !== -1 && parts[orgIdx + 1]) return parts[orgIdx + 1];

    return '';
  }

  const slug = detectSlug();

  if (!apiBase) {
    setText('#org-title', 'Ошибка: не настроен API');
    setText('#org-about-text', 'Не найден meta[name="katalog-catalog-api"].');
    return;
  }

  if (!slug || slug === 'index.html') {
    setText('#org-title', 'Ошибка: не указан slug');
    const about = document.querySelector('#org-about-text');
    if (about) about.innerHTML = '<p>Откройте страницу как <code>/org/slug/</code> или используйте <code>/org/index.html?slug=slug</code>.</p>';
    return;
  }

  const svgPhone = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>`;
  const svgMail  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>`;
  const svgPin   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const svgClock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
  const svgCheck = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>`;

  function formatWorkHours(workHours) {
    if (!workHours) return '';
    if (typeof workHours === 'string') return workHours;
    if (Array.isArray(workHours)) return workHours.filter(Boolean).join(', ');
    if (typeof workHours === 'object') {
      try { return JSON.stringify(workHours); } catch { return ''; }
    }
    return String(workHours);
  }

  function setParagraphs(container, text) {
    container.innerHTML = '';
    const raw = (text || '').trim();
    if (!raw) {
      container.innerHTML = '<p>Описание не заполнено.</p>';
      return;
    }

    // безопасный рендер: только текст
    const blocks = raw.split(/\n\s*\n/g);
    blocks.forEach((b) => {
      const p = document.createElement('p');
      p.textContent = b.replace(/\s+/g, ' ').trim();
      if (p.textContent) container.appendChild(p);
    });
  }

  function addSidebarRow(host, svg, text, href) {
    if (!host || !text) return;

    const row = document.createElement('div');
    row.className = 'sidebar-row';

    const iconWrap = document.createElement('span');
    iconWrap.innerHTML = svg;
    row.appendChild(iconWrap);

    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = text;
      a.rel = 'nofollow noopener';
      a.target = href.startsWith('http') ? '_blank' : '';
      row.appendChild(document.createTextNode(' '));
      row.appendChild(a);
    } else {
      row.appendChild(document.createTextNode(' ' + text));
    }

    host.appendChild(row);
  }

  // Инициализация портфолио (копия логики из main.js, но вызывается после того, как мы добавили кнопки)
  function initPortfolio(root) {
    if (!root || root.dataset.portfolioReady === '1') return;

    const source = root.querySelector('[data-portfolio-source]');
    const hero = root.querySelector('[data-portfolio-hero]');
    const deskSide = root.querySelector('[data-portfolio-desk-side]');
    const mobStrip = root.querySelector('[data-portfolio-mob-strip]');
    const mobPrev = root.querySelector('[data-portfolio-mob-prev]');
    const mobNext = root.querySelector('[data-portfolio-mob-next]');
    const mobIndicator = root.querySelector('[data-portfolio-mob-indicator]');

    if (!source || !hero || !deskSide || !mobStrip) return;

    const meta = Array.from(source.querySelectorAll('button[type="button"]'));
    if (meta.length === 0) return;

    const n = meta.length;
    const captions = meta.map((btn, i) => btn.getAttribute('data-slide-caption') || `Слайд ${i + 1}`);

    const slideSrc = (i) => {
      const raw = meta[i]?.getAttribute?.('data-slide-src');
      let t = (raw || '').trim();
      if (t.startsWith('images/')) t = `/${t}`;
      return t;
    };

    const applyPortfolioBg = (el, url) => {
      if (!(el instanceof HTMLElement)) return;
      if (url) {
        const esc = encodeURI(url.trim());
        el.classList.add('portfolio-pixel--photo');
        el.style.setProperty('background-image', `url("${esc}")`, 'important');
        el.style.setProperty('background-size', 'cover', 'important');
        el.style.setProperty('background-position', 'center', 'important');
        el.style.setProperty('background-repeat', 'no-repeat', 'important');
      } else {
        el.classList.remove('portfolio-pixel--photo');
        el.style.removeProperty('background-image');
        el.style.removeProperty('background-size');
        el.style.removeProperty('background-position');
        el.style.removeProperty('background-repeat');
      }
    };

    mobStrip.innerHTML = '';
    const mobSlides = meta.map((_btn, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'portfolio-pixel portfolio-pixel-slide';
      b.dataset.slideIndex = String(i);
      b.setAttribute('aria-label', captions[i]);
      b.addEventListener('click', () => setIdx(i, { scrollMob: true }));
      mobStrip.appendChild(b);
      applyPortfolioBg(b, slideSrc(i));
      return b;
    });

    let idx = 0;
    let suppressScrollEmit = false;
    let scrollTimer = null;

    const syncHero = () => {
      hero.removeAttribute('aria-hidden');
      hero.setAttribute('role', 'img');
      hero.setAttribute('aria-label', captions[idx] || `Фото ${idx + 1}`);
      hero.dataset.activeSlide = String(idx);
      hero.classList.add('is-current');
      applyPortfolioBg(hero, slideSrc(idx));
    };

    const rebuildDesktopRail = () => {
      deskSide.innerHTML = '';
      for (let i = 0; i < n; i += 1) {
        if (i === idx) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'org-showcase-card org-showcase-card--mini portfolio-pixel portfolio-pixel-mini';
        b.dataset.slideTarget = String(i);
        b.setAttribute('aria-label', captions[i] || `Фото ${i + 1}`);
        b.addEventListener('click', (e) => {
          e.preventDefault();
          setIdx(i, { scrollMob: true });
        });
        applyPortfolioBg(b, slideSrc(i));
        deskSide.appendChild(b);
      }
    };

    const syncMobScroll = () => {
      const slide = mobSlides[idx];
      if (!slide || mobStrip.clientHeight < 2) return;
      suppressScrollEmit = true;
      slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      window.setTimeout(() => { suppressScrollEmit = false; }, 420);
    };

    const setIdx = (next, opts = {}) => {
      idx = ((next % n) + n) % n;
      syncHero();
      rebuildDesktopRail();
      mobSlides.forEach((el, i) => el.classList.toggle('is-current', i === idx));
      if (mobIndicator) mobIndicator.textContent = `${idx + 1}/${n}`;
      if (opts.scrollMob) syncMobScroll();
    };

    mobPrev?.addEventListener('click', () => setIdx(idx - 1, { scrollMob: true }));
    mobNext?.addEventListener('click', () => setIdx(idx + 1, { scrollMob: true }));

    mobStrip.addEventListener('scroll', () => {
      if (mobStrip.clientHeight < 2) return;
      if (suppressScrollEmit) return;
      if (scrollTimer) window.clearTimeout(scrollTimer);

      scrollTimer = window.setTimeout(() => {
        const stripMid = mobStrip.getBoundingClientRect().left + mobStrip.clientWidth / 2;
        let best = 0;
        let bestDist = Infinity;

        mobSlides.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          const mid = r.left + r.width / 2;
          const d = Math.abs(mid - stripMid);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });

        if (best !== idx) setIdx(best, { scrollMob: false });
      }, 96);
    }, { passive: true });

    setIdx(0, { scrollMob: false });
    root.dataset.portfolioReady = '1';
  }

  async function run() {
    setText('#org-title', 'Загрузка…');

    const about = document.querySelector('#org-about-text');
    if (about) about.innerHTML = '<p>Загрузка…</p>';

    const url = `${apiBase}/v1/org/${encodeURIComponent(slug)}`;

    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('not_found');

    const j = await r.json();
    const org = j.organization || j.org || j;

    // Заголовок + meta
    const title = org.title || org.name || slug;
    document.title = `${title} — katalog-uslug.pro`;
    setText('#org-title', title);

    // Breadcrumbs
    const bc = clear('#org-breadcrumbs');
    if (bc) {
      const addSep = () => {
        const s = document.createElement('span');
        s.textContent = '/';
        bc.appendChild(s);
      };
      const addLink = (href, text) => {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = text;
        bc.appendChild(a);
      };
      addLink('/', 'Главная');
      addSep();

      if (org.categorySlug) {
        addLink(`/c/${org.categorySlug}/`, org.categoryLabel || 'Категория');
        addSep();
      }

      const last = document.createElement('span');
      last.textContent = title;
      bc.appendChild(last);
    }

    // Теги в шапке
    const catTag = document.querySelector('#org-category-tag');
    if (catTag) {
      if (org.categoryLabel) { catTag.hidden = false; catTag.textContent = org.categoryLabel; }
      else catTag.hidden = true;
    }

    const regTag = document.querySelector('#org-region-tag');
    if (regTag) {
      const txt = org.regionLabel || '';
      if (txt) { regTag.hidden = false; regTag.textContent = txt; } else regTag.hidden = true;
    }

    const ratingTag = document.querySelector('#org-rating-tag');
    if (ratingTag) {
      if (org.rating != null) {
        const rr = Number(org.rating);
        const reviews = Number(org.reviews || 0);
        ratingTag.hidden = false;
        ratingTag.textContent = `★ ${Number.isFinite(rr) ? rr.toFixed(1) : org.rating} · ${reviews} отзывов`;
      } else {
        ratingTag.hidden = true;
      }
    }

    // О компании
    if (about) setParagraphs(about, org.descriptionMd || org.listingText || org.subtitle || '');

    // Услуги
    const servicesBlock = document.querySelector('#org-services-block');
    const servicesList = document.querySelector('#org-services-list');
    const services = Array.isArray(org.services) ? org.services : [];
    if (servicesBlock && servicesList) {
      servicesList.innerHTML = '';
      if (services.length) {
        servicesBlock.hidden = false;
        services.forEach((s) => {
          const li = document.createElement('li');
          const title = (s.title || '').trim();
          const desc = (s.description || '').trim();
          const pf = s.priceFrom != null ? Number(s.priceFrom) : null;
          const cur = (s.currency || 'RUB').trim();

          const bits = [];
          if (title) bits.push(title);
          if (Number.isFinite(pf)) bits.push(`от ${pf} ${cur}`);
          if (desc) bits.push(`— ${desc}`);

          li.textContent = bits.filter(Boolean).join(' ');
          if (li.textContent) servicesList.appendChild(li);
        });
      } else {
        servicesBlock.hidden = true;
      }
    }

    // Теги
    const tagsBlock = document.querySelector('#org-tags-block');
    const tagsRow = document.querySelector('#org-tags-row');
    const tags = Array.isArray(org.tags) ? org.tags : [];
    if (tagsBlock && tagsRow) {
      tagsRow.innerHTML = '';
      if (tags.length) {
        tagsBlock.hidden = false;
        tags.forEach((t) => {
          const s = document.createElement('span');
          s.className = 'tag';
          s.textContent = t.label || t.slug || '';
          if (s.textContent) tagsRow.appendChild(s);
        });
      } else {
        tagsBlock.hidden = true;
      }
    }

    // Контакты в сайдбаре
    const contactsHost = clear('#org-contacts-rows');
    const websiteBtn = document.querySelector('#org-website-btn');

    const publicContacts = Array.isArray(org.publicContacts) ? org.publicContacts : [];
    publicContacts.forEach((c) => {
      const type = (c.type || '').toLowerCase();
      const value = (c.value || '').trim();
      if (!value) return;

      if (type === 'phone') {
        const tel = 'tel:' + value.replace(/[^\d+]/g, '');
        addSidebarRow(contactsHost, svgPhone, value, tel);
      } else if (type === 'email') {
        addSidebarRow(contactsHost, svgMail, value, `mailto:${value}`);
      } else {
        // прочие мессенджеры/ссылки/поля
        const isUrl = /^https?:\/\//i.test(value);
        addSidebarRow(contactsHost, svgCheck, value, isUrl ? value : '');
      }
    });

    if (org.addressText) addSidebarRow(contactsHost, svgPin, org.addressText, '');
    const wh = formatWorkHours(org.workHours);
    if (wh) addSidebarRow(contactsHost, svgClock, wh, '');

    if (websiteBtn) {
      const w = (org.websiteUrl || '').trim();
      if (w) {
        websiteBtn.hidden = false;
        websiteBtn.href = w;
      } else {
        websiteBtn.hidden = true;
      }
    }

    // Верификация (минимум)
    const verCard = document.querySelector('#org-verification-card');
    const verRow = document.querySelector('#org-verification-row');
    if (verCard && verRow) {
      const vs = (org.verificationStatus || '').toLowerCase();
      if (vs === 'verified') {
        verCard.hidden = false;
        verRow.className = 'sidebar-row';
        verRow.innerHTML = svgCheck + ' Подтверждено';
      } else {
        verCard.hidden = true;
      }
    }

    // Портфолио: MVP — берём cover/logo + (если позже добавите) org.images/org.media
    const slot = document.querySelector('#org-portfolio-slot');
    const source = document.querySelector('#org-portfolio-source');
    const portfolioRoot = document.querySelector('[data-portfolio]');

    const images = [];
    if (org.coverUrl) images.push({ src: org.coverUrl, caption: 'Обложка' });
    if (org.logoUrl) images.push({ src: org.logoUrl, caption: 'Логотип' });

    const extra = Array.isArray(org.images) ? org.images : Array.isArray(org.media) ? org.media : [];
    extra.forEach((x, i) => {
      const src = (typeof x === 'string' ? x : x?.url) || '';
      if (src) images.push({ src, caption: (typeof x === 'object' && x.caption) ? x.caption : `Фото ${i + 1}` });
    });

    if (slot && source && portfolioRoot && images.length) {
      slot.hidden = false;
      source.innerHTML = '';
      images.slice(0, 12).forEach((im) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('data-slide-src', im.src);
        b.setAttribute('data-slide-caption', im.caption || 'Фото');
        source.appendChild(b);
      });
      initPortfolio(portfolioRoot);
    } else if (slot) {
      slot.hidden = true;
    }
  }

  run().catch(() => {
    setText('#org-title', 'Организация не найдена');
    const about = document.querySelector('#org-about-text');
    if (about) about.innerHTML = '<p>Проверьте ссылку или попробуйте позже.</p>';
  });
});
```

---

## 3) Патч: `js/main.js` — переделать каталог на API v2 (pagination + server filters)

Сейчас ваш `initCatalogFilters()` делает:

- локальную фильтрацию массива,
- а сам массив тянет из `/data/catalog.json` целиком.   

Ниже — готовая **замена** функции `initCatalogFilters()` (вставьте вместо старой). Она:

- читает базу API из `meta[name="katalog-catalog-api"]` (у вас она уже вставлена в `<head>` на главной).   
- делает запросы **к `GET /v1/catalog?v=2`** с фильтрами `region/category/q/minRating`,  
- рендерит карточки тем же `cardHtml(item)`,  
- поддерживает кнопку **«Показать ещё»** через `nextCursor`.

> Важно: этот код предполагает, что вы уже добавили на Worker формат `{items,nextCursor}` для `v=2`, как мы обсуждали ранее.

### Замените `function initCatalogFilters() { ... }` целиком на это:

```js
function initCatalogFilters() {
  const section = document.querySelector('[data-catalog-section]');
  const host = document.getElementById('catalog-cards-host');

  const filterApply = document.querySelector('[data-filter-apply]');
  const selRegion = document.getElementById('filter-region');
  const selCategory = document.getElementById('filter-category');
  const selRating = document.getElementById('filter-rating');
  const searchInput = document.getElementById('filter-search');

  if (!section || !host) return;

  const pageRegion = (section.getAttribute('data-page-region') || '').trim();

  // чтобы не затирать кнопку "Показать ещё" при render:
  let list = host.querySelector('[data-catalog-list]');
  if (!list) {
    list = document.createElement('div');
    list.setAttribute('data-catalog-list', '');
    while (host.firstChild) list.appendChild(host.firstChild);
    host.appendChild(list);
  }

  let moreRow = host.querySelector('[data-catalog-more]');
  if (!moreRow) {
    moreRow = document.createElement('div');
    moreRow.setAttribute('data-catalog-more', '');
    moreRow.className = 'mt-24';
    moreRow.style.textAlign = 'center';
    host.appendChild(moreRow);
  }

  let moreBtn = moreRow.querySelector('button');
  if (!moreBtn) {
    moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'btn btn-outline';
    moreBtn.textContent = 'Показать ещё';
    moreRow.appendChild(moreBtn);
  }

  const EMPTY_BLOCK = `
<div class="catalog-empty" role="status">
  <p class="catalog-empty-title">Ничего не найдено</p>
  <p class="catalog-empty-text">Попробуйте другой регион, категорию или запрос.</p>
</div>`;

  function reviewsLabelRu(n) {
    const x = Number(n) || 0;
    const mod10 = x % 10;
    const mod100 = x % 100;
    if (mod10 === 1 && mod100 !== 11) return `${x} отзыв`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${x} отзыва`;
    return `${x} отзывов`;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function catalogMediaSlidesHtml(item) {
    const imgs = Array.isArray(item.portfolioImages) ? item.portfolioImages.filter(Boolean) : [];
    const gradients = ['s1', 's2', 's3'];
    const n = imgs.length === 0 ? 3 : Math.min(4, Math.max(3, imgs.length));
    const slides = [];

    for (let i = 0; i < n; i++) {
      const isActive = i === 0 ? ' is-active' : '';
      const url = imgs.length ? imgs[i % imgs.length] : null;

      if (url) {
        const u = esc(url);
        slides.push(
          `<span class="catalog-slide catalog-slide-photo${isActive}" style="background-image:url(&quot;${u}&quot;)"></span>`
        );
      } else {
        slides.push(`<span class="catalog-slide ${gradients[i % 3]}${isActive}"></span>`);
      }
    }
    return slides.map((line) => ` ${line}`).join('\n');
  }

  function cardHtml(item) {
    const rating = typeof item.rating === 'number' ? item.rating.toFixed(1) : esc(item.rating);
    const href = esc(item.url || '#');
    const rs = esc(item.regionSlug || '');
    const cs = esc(item.categorySlug || '');

    const subtitleHtml = esc(item.subtitle || '').replace(/\n/g, '<br>');
    const textHtml = esc(item.text || '').replace(/\n/g, '<br>');

    return `<article class="card catalog-card-wide" data-region-slug="${rs}" data-category-slug="${cs}" data-org-url="${href}">
      <div class="catalog-card-layout">
        <div class="catalog-media" data-auto-slider>
${catalogMediaSlidesHtml(item)}
          <span class="catalog-media-label">Фото</span>
        </div>

        <div class="catalog-card-content">
          <div class="tag-row">
            <span class="tag">${esc(item.categoryLabel)}</span>
            <span class="tag tag-green">${esc(item.regionLabel)}</span>
          </div>

          <h3 class="card-title">${esc(item.title)}</h3>
          <p class="catalog-card-text catalog-card-text-main">${subtitleHtml}</p>
          <p class="catalog-card-text catalog-card-about"><strong>О компании:</strong> ${textHtml}</p>

          <div class="catalog-card-footer">
            <span class="tag tag-accent">★ ${rating} · ${reviewsLabelRu(item.reviews)}</span>
            <a href="${href}" class="btn btn-sm btn-primary">Подробнее →</a>
          </div>
        </div>
      </div>
    </article>`;
  }

  const initAutoSliders = initCatalogStaticSliders;

  function katalogApiBase() {
    return (
      document
        .querySelector('meta[name="katalog-catalog-api"]')
        ?.getAttribute('content')
        ?.trim()
        ?.replace(/\/$/, '') || ''
    );
  }

  const apiBase = katalogApiBase();
  const apiUrl = apiBase ? `${apiBase}/v1/catalog` : '';

  const state = {
    loading: false,
    nextCursor: null,
    lastKey: ''
  };

  function readFilters() {
    const regionSel = (selRegion?.value || '').trim();
    const region = regionSel || pageRegion || '';

    const category = (selCategory?.value || '').trim();
    const q = (searchInput?.value || '').trim();

    const minR = parseFloat((selRating?.value || '').trim());
    const minRating = (!Number.isNaN(minR) && minR > 0) ? minR : null;

    return { region, category, q, minRating };
  }

  function keyOf(f) {
    return JSON.stringify([f.region, f.category, f.q, f.minRating]);
  }

  function render(items) {
    if (!items.length) {
      list.innerHTML = EMPTY_BLOCK;
      initAutoSliders();
      return;
    }
    list.innerHTML = items.map(cardHtml).join('\n');
    initAutoSliders();
  }

  function append(items) {
    if (!items.length) return;
    // если сейчас пустой блок — заменяем
    if (!list.querySelector('.card')) {
      render(items);
      return;
    }
    list.insertAdjacentHTML('beforeend', '\n' + items.map(cardHtml).join('\n'));
    initAutoSliders();
  }

  function updateMoreBtn() {
    moreBtn.disabled = state.loading;
    moreRow.hidden = !state.nextCursor;
  }

  async function loadPage(reset) {
    if (!apiUrl) return; // можно оставить legacy fallback, но в проде apiUrl должен быть

    const f = readFilters();
    const key = keyOf(f);

    if (reset) {
      state.nextCursor = null;
      state.lastKey = key;
    } else {
      // если фильтры поменялись — делаем reset
      if (state.lastKey !== key) {
        return loadPage(true);
      }
    }

    if (state.loading) return;
    state.loading = true;
    updateMoreBtn();

    try {
      const p = new URLSearchParams();
      p.set('v', '2');
      p.set('limit', '24');
      p.set('sort', 'title');

      if (f.region) p.set('region', f.region);
      if (f.category) p.set('category', f.category);
      if (f.q) p.set('q', f.q);
      if (f.minRating != null) p.set('minRating', String(f.minRating));

      if (!reset && state.nextCursor) p.set('cursor', state.nextCursor);

      const r = await fetch(`${apiUrl}?${p.toString()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('catalog_api');

      const j = await r.json();
      const items = Array.isArray(j.items) ? j.items : [];
      const nextCursor = (j.nextCursor || null);

      if (reset) render(items);
      else append(items);

      state.nextCursor = nextCursor;
    } catch (e) {
      // fallback: если на странице уже есть статические карточки — можно оставить dom-only фильтр
      // но для 1M записей это временный режим.
      console.warn('Catalog API error:', e);
      if (!list.querySelector('.card')) list.innerHTML = EMPTY_BLOCK;
      state.nextCursor = null;
    } finally {
      state.loading = false;
      updateMoreBtn();
    }
  }

  // handlers
  let searchTimer = null;
  const scheduleSearch = () => {
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadPage(true), 260);
  };

  filterApply?.addEventListener('click', (e) => { e.preventDefault(); loadPage(true); });
  selRegion?.addEventListener('change', () => loadPage(true));
  selCategory?.addEventListener('change', () => loadPage(true));
  selRating?.addEventListener('change', () => loadPage(true));
  searchInput?.addEventListener('input', scheduleSearch);

  moreBtn.addEventListener('click', () => loadPage(false));

  // первый запуск
  loadPage(true);
}
```

---

## 4) Роутинг: чтобы `/org/<slug>/` работал без папок `org/<slug>/index.html`

Это критично: **одного `org/index.html` недостаточно**, если хостинг не умеет rewrite.

### Вариант (рекомендую): Cloudflare Pages `_redirects`
Добавьте файл **`_redirects`** в корень сборки (в репо — в корень сайта):

```txt
/org/*   /org/index.html   200
```

Тогда запросы вида `/org/any-slug/` будут отдавать **один** шаблон `/org/index.html`, а `js/org.js` возьмёт slug из URL и подтянет данные из БД.

> На GitHub Pages “нормального” rewrite `200` нет, поэтому для реального масштаба (миллион) вам почти неизбежно нужно переехать на хостинг с rewrites/SSR.

---

## 5) Что дальше (коротко, чтобы “дожать” до цели «не хранить статические org/*»)

1) После включения rewrite удаляете папки `org/<slug>/` из репозитория (они больше не нужны). Сейчас они есть (`org/lazer-rezka`, `org/svk-avto` и т.д.).   
2) Убираете генерацию этих папок в своих скриптах сборки (отдельный шаг).  
3) Расширяете `GET /v1/org/:slug`, чтобы возвращать **галерею** (из `organization_media` или JSONB-массива), и тогда портфолио будет полноценным, а не только cover/logo.

Продолжаю и довожу до “полного цикла”: **медиа (галерея/портфолио) из БД**, **каталог отдаёт картинки для слайдера**, **claim flow (“это моя компания”)** + где это лучше всего включать, и что убрать из текущей статической сборки.

---

## 1) Медиа/портфолио: схема БД + индексы

Сейчас у вас в статике портфолио живёт в HTML (кнопки `data-slide-src="..."`), а фронт/сборка это парсили. Для миллиона компаний это нужно перенести в БД.

### 1.1. Миграция: `db/migrations/010_organization_media.sql`

```sql
CREATE TABLE IF NOT EXISTS organization_media (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- logo/cover/gallery (можно расширять: certificate, team, etc.)
  kind text NOT NULL CHECK (kind IN ('logo', 'cover', 'gallery')),

  url text NOT NULL,               -- публичный URL (R2/S3/CDN)
  width integer,
  height integer,
  alt text,

  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,

  source text NOT NULL DEFAULT 'user'
         CHECK (source IN ('user', 'enrichment', 'admin')),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_media_org_active
ON organization_media (org_id, is_active, kind, sort_order, id);

-- (полезно для дедупа, опционально)
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_media_org_url
ON organization_media (org_id, url);
```

**Идея:**  
- `logo` и `cover` можно хранить в `organization_profiles` как поля (как у вас уже сделано), **или** полностью перенести в `organization_media`.  
- На практике удобно иметь и поля в профиле (быстро), и галерею в `organization_media`. Но чтобы не дублировать, можно договориться:  
  - `organization_profiles.logo_url/cover_url` = “основные”  
  - `organization_media(kind='gallery')` = портфолио.

---

## 2) API: отдаём портфолио в `GET /v1/org/:slug`

Вы уже добавили (или добавите) `GET /v1/org/:slug`, который возвращает `publicContacts/services/tags`. Теперь расширяем его: добавляем `media` (и/или просто `images`).

### 2.1. Правильная агрегация JSON в Postgres с порядком
Для стабильного порядка картинок используйте `jsonb_agg(... ORDER BY ...)` **внутри** агрегата, иначе порядок элементов не гарантирован. Postgres прямо отмечает, что агрегаты (включая `jsonb_agg`) дают разные результаты в зависимости от порядка входных строк. 

### 2.2. Патч SQL (добавить LATERAL с media)

Добавьте в ваш `ORG_PUBLIC_BY_SLUG_SQL` ещё один `LEFT JOIN LATERAL`:

```sql
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'kind', m.kind,
      'url', m.url,
      'width', m.width,
      'height', m.height,
      'alt', m.alt,
      'sortOrder', m.sort_order,
      'source', m.source
    )
    ORDER BY m.kind, m.sort_order, m.id
  ) AS media
  FROM organization_media m
  WHERE m.org_id = o.id AND m.is_active = true
) md ON true
```

И добавьте в `SELECT`:

```sql
COALESCE(md.media, '[]'::jsonb) AS media
```

Теперь `js/org.js` сможет брать `org.media` и строить слайдер (в моём шаблоне он уже это умеет: если `org.media` массив, берёт `url`).

---

## 3) API каталога: отдаём `portfolioImages` (3–4 ссылки) прямо из `/v1/catalog?v=2`

Сейчас ваш фронт строит слайдер карточки из `item.portfolioImages`, но эти данные исторически брались из статического `data/catalog.json` или из парсинга org-html. Для масштаба надо, чтобы `/v1/catalog?v=2` сразу отдавал 0–4 картинки.

### 3.1. Почему не надо отдавать “все картинки”
Для списка на странице достаточно:
- 1 cover (или первая gallery)
- + 2–3 дополнительных  
Отдавать 30 картинок на карточку *в листинге* — огромный трафик и JSON.

### 3.2. SQL-паттерн: “взять топ N картинок” через LATERAL + LIMIT
В каждую запись листинга добавляем LATERAL подзапрос:

```sql
LEFT JOIN LATERAL (
  SELECT jsonb_agg(x.url ORDER BY x.sort_order, x.id) AS portfolio_images
  FROM (
    SELECT m.url, m.sort_order, m.id
    FROM organization_media m
    WHERE m.org_id = o.id AND m.is_active = true AND m.kind = 'gallery'
    ORDER BY m.sort_order, m.id
    LIMIT 4
  ) x
) pm ON true
```

И в `SELECT`:
```sql
COALESCE(pm.portfolio_images, '[]'::jsonb) AS "portfolioImages"
```

**Важно:** сортировать внутри агрегата (или в подзапросе), чтобы порядок был стабильным. Про важность `ORDER BY` внутри агрегатов для `jsonb_agg` см. доки/описания агрегатов. 

### 3.3. Что делать, если `organization_media` ещё пустая
Можно временно “склеить fallback”:
- если gallery пустая → использовать `organization_profiles.cover_url` как единственную картинку  
Но лучше держать это логикой в API:

```sql
COALESCE(
  pm.portfolio_images,
  CASE WHEN p.cover_url IS NOT NULL THEN jsonb_build_array(p.cover_url) ELSE '[]'::jsonb END
) AS "portfolioImages"
```

---

## 4) Claim flow (“Это моя компания”): таблицы + endpoints + сценарий

Цель: пользователь должен уметь “забрать” организацию себе в кабинет без ручной модерации по письмам.

### 4.1. Модель: `organization_claims` (рекомендую отдельно от verifications)
Создайте миграцию **`db/migrations/011_organization_claims.sql`**:

```sql
CREATE TABLE IF NOT EXISTS organization_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  token text NOT NULL,
  method text NOT NULL CHECK (method IN ('well_known', 'meta_tag', 'dns_txt')),

  status text NOT NULL DEFAULT 'pending'
         CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),

  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_org_claims_org_status
ON organization_claims (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_claims_user
ON organization_claims (user_id, created_at DESC);
```

### 4.2. Endpoint 1: старт claim
`POST /v1/org/:id/claim/start` (auth required)

Логика:
1) проверить, что org существует и опубликована
2) создать claim со случайным `token`
3) вернуть инструкции пользователю, например:
   - well-known: `/.well-known/katalog-uslug-verify.txt` с текстом `token=...`
   - meta-tag: `<meta name="katalog-uslug-verification" content="...">`
   - dns: `TXT _katalog-uslug-verification = ...`

### 4.3. Endpoint 2: verify claim
`POST /v1/org/:id/claim/verify` (auth required)

Логика:
1) взять активный claim (pending) этого user+org
2) сделать fetch на `organization_profiles.website_url` и проверить токен:
   - для well-known: запросить `https://site/.well-known/katalog-uslug-verify.txt`
   - для meta-tag: запросить главную и найти meta
   - для dns: (если реализуете) — нужен DNS resolver/внешний сервис; можно оставить на потом
3) если ok:
   - `organization_claims.status='verified'`
   - добавить `organization_members(org_id,user_id,role='owner')`
   - (опционально) `organization_profiles.verification_status='verified'` (у вас поле уже есть)

> Здесь важно сразу заложить SSRF-защиту (private IP/localhost/лимиты), потому что вы делаете fetch по пользовательскому URL.

---

## 5) Где и как включить динамический роутинг `/org/*` → `/org/index.html`

Если вы делаете CSR-шаблон (как мы сделали), чтобы `/org/slug/` не требовал файла, нужен rewrite.

### 5.1. `_redirects` (Cloudflare Pages)
Добавьте файл **`_redirects`** в корень статики:

```txt
/org/*   /org/index.html   200
```

Cloudflare Pages поддерживает файл `_redirects` и rewrites со статусом `200`. 

### 5.2. SSR-альтернатива (лучше для SEO)
Cloudflare Pages Functions поддерживают динамические роуты и маршрутизацию функций.   
Если пойдёте в SSR, `/org/:slug` будет отдавать HTML сразу (и уже потом — JS для интерактивности).

---

## 6) Очередь enrichment: как “обновлять” портфолио/логотипы с сайта

Если вы хотите, чтобы платформа сама тянула картинки:
- лучше тянуть **только метаданные** (logo/og:image) и сохранять как ссылки,
- а “перезаливку” в своё хранилище (R2) делать отдельно (из-за авторских прав/веса).

Cloudflare Queues поддерживают batch delivery, retries и задержки (`delaySeconds`) — это удобно для backoff при временных сбоях сайта. 

---

## 7) Что удалить/выключить в текущей статической сборке (чтобы не откатиться назад)

Чтобы реально уйти от статических орг-страниц и статических карточек:

1) **Перестать хранить org-страницы**  
   - удалить `org/<slug>/index.html` из репо после включения rewrite + API
   - больше не генерировать их

2) **Выключить “hydration” карточек из org HTML**  
   - в `js/main.js` убрать функции, которые `fetch('/org/...')` и парсят HTML (они не нужны и не масштабируются)

3) **Перестать вклеивать карточки в HTML категориями при сборке**  
   - `scripts/build-from-data.mjs` сейчас инъектит карточки в `<!-- katalog:category-cards -->` / `<!-- katalog:catalog-grid -->`  
   - при переходе на API это надо выключать (оставить только контейнер `#catalog-cards-host`)

---

## 8) Мини-роадмап “до продакшена”
1) Миграции `010_organization_media` + обновить `/v1/org/:slug` (media)  
2) Обновить `/v1/catalog?v=2` чтобы отдавал `portfolioImages` (top 4)  
3) Включить `_redirects` rewrite (и уйти с GitHub Pages на Pages/хостинг с rewrites)   
4) Удалить статические `org/<slug>/index.html`  
5) Добавить claim flow (`organization_claims` + 2 endpoints)  
6) Затем: SSR (если нужен SEO уровня “как у маркетплейса”)   

---
