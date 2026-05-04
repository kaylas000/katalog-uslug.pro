# katalog-uslug.pro

Статический каталог на GitHub Pages (домен в `CNAME`).

## Адреса страниц (как в плане проекта)

| Раздел | Пример URL | Папка в репозитории |
|--------|------------|---------------------|
| Главная | `/` | `index.html` |
| Рубрикатор | `/categories/` | `categories/index.html` |
| Категория | `/c/metalworking/` | `c/metalworking/index.html` |
| Организация | `/org/lazer-rezka/` | `org/lazer-rezka/index.html` |
| Поиск | `/search/` | `search/index.html` |
| Добавить компанию | `/add/` | `add/index.html` |
| Прочее (аналитика, блог, …) | `/analytics/` | `analytics/index.html` |
| Юридические | `/privacy/`, `/terms/` | `privacy/index.html`, `terms/index.html` |

Старые короткие пути (`/metalworking/`, `/org-lazer-rezka/`, `*.html` в корне) отдают **редирект** на новые.

## Одна точка для меню и категорий

Файл **`config/site.json`**: списки категорий, пункты навигации, подвал. После правок:

```bash
npm run build:site
```

Это подряд: **`build:partials`** (собирает `partials/site-header.html` и `partials/site-footer.html` из шаблонов + `site.json`) и **`build:layout`** (вставляет их во все страницы).

Только вёрстка шапки/подвала без смены структуры ссылок: можно вызывать только `npm run build:layout`, если `partials/*.html` уже правили руками (обычно не нужно — правьте `*.template.html` или `site.json`).

## Подключение новых скриптов («блоков»)

Файл **`config/extensions.json`**: массив `bodyScripts` — URLы скриптов (`/js/...`). При `build:layout` они добавляются перед `</body>` на каждой странице. Новый бот/виджет: положили скрипт в `js/`, добавили строку в конфиг — **страницы править не нужно**.

## Новая страница с шапкой/подвалом из partials

1. Папка с путём URL, например `usluga-nazvanie/` (или `c/…` / `org/…` по правилам выше).
2. Скопировать **`templates/page-blank.html`** → `usluga-nazvanie/index.html`.
3. Менять только блок между `<!-- katalog:page-main -->` и `<!-- katalog:page-main-end -->`.
4. `npm run build:site`.

Если страница должна быть в меню — добавьте запись в **`config/site.json`** (категория или блок `desktopNavAfterCategories` / `mobileNavAfterCategories` / `footerTools`) и снова `npm run build:site`.

## Одноразовая миграция URL (уже сделана в main)

Скрипт `scripts/migrate-ia-urls.mjs` оставлен для справки / пустого клона; на актуальном репозитории повторно гонять не нужно.

## База и Worker: одна схема без «переездов кода»

Идея: **везде один PostgreSQL** и файлы в `db/migrations/`. Меняется только **строка подключения** (Neon → домашний ПК → облако РФ), код воркера тот же.

| Где | Что настроить |
|-----|----------------|
| **Прод** (Cloudflare) | В [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) в панели Cloudflare указываете строку на текущую БД. В `worker/wrangler.toml` раскомментируйте `[[hyperdrive]]` и вставьте `id` конфига. Деплой как обычно. |
| **Смена хоста БД** (Neon → свой сервер) | В том же конфиге Hyperdrive меняете origin / строку — **репозиторий не трогаете**. |
| **Локально, пока нет Hyperdrive** | Проще всего: в корне проекта скопировать `neon.local.example.txt` → `neon.local.txt`, вставить внутрь одну строку Connection string из Neon, выполнить `npm run neon:paste` — скрипт сам заполнит `worker/.dev.vars`. Затем `npm run worker:dev`. Либо вручную: `worker/.dev.vars.example` → `.dev.vars`. |
| **Локально, как в проде** | `worker/wrangler.local.toml.example` → `worker/wrangler.local.toml`: тот же `id` Hyperdrive, что в проде, плюс `local_connection_string` на `127.0.0.1` или на Neon. Команда: `npm run worker:dev`. |

**Миграции схемы:** любым клиентом `psql` (или GUI) выполнить SQL из `db/migrations/` по порядку номеров на ту БД, куда сейчас смотрит строка подключения.

**GitHub + Neon (автоматом из репозитория):** в настройках репозитория GitHub → **Secrets** → **Actions** добавьте секрет **`NEON_DATABASE_URL`** (тот же Connection string, что в Neon). При пуше в `main`, если менялись файлы в `db/migrations/`, workflow **Neon DB migrations** сам выполнит все `*.sql` по порядку. Интеграция «Neon ↔ GitHub» в панели Neon (приложение GitHub) **опциональна**: она для их сценариев (ветки, превью и т.д.); для этого workflow достаточно секрета — подключать приложение Neon в GitHub нужно только если сами хотите эти фичи.

**Импорт данных в Neon:** после миграций в Actions запустите вручную workflow **Neon import data** (тот же секрет `NEON_DATABASE_URL`). Он зальёт `data/regions.json` и `data/catalog.json`. Локально: `neon.local.txt` с URI в корне проекта или переменная `NEON_DATABASE_URL`, затем **`npm run db:import`** из корня репозитория.

**Домашний ПК как БД для прод-API:** Worker из интернета не ходит на `192.168.*` напрямую — нужен [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) (или аналог) до Postgres; строка в Hyperdrive тогда ведёт на хост туннеля.

Подробности по установке Postgres на ВМ: `scripts/cloudru-install-postgres.sh` в репозитории.

### Статус по базе и каталогу (v1)

| Шаг | Состояние |
|-----|-----------|
| Схема Postgres (`db/migrations/001_init.sql`) | Готово; CI **Neon DB migrations** при пушах |
| Данные из `data/*.json` в Neon | Скрипт + workflow **Neon import data** (ручной запуск в Actions после миграций) |
| API Worker `/v1/catalog`, `/v1/regions` | Готово; **Hyperdrive** в `wrangler.toml` |
| **Проверка Neon** | Если `/v1/catalog` пишет `relation "organizations" does not exist` — в GitHub **Actions → Neon DB migrations** дождаться зелёного, затем **Neon import data** (ручной запуск). |
| **Авторизация** | См. ниже; миграция **`003_identity_providers.sql`**. Страница **`/account/`**. |
| Сайт: каталог с API или fallback на JSON | `config/site.json` → **`catalogApiBaseUrl`**; при сборке `npm run build:layout` в страницы вставляется `<meta name="katalog-catalog-api">`; `main.js` сначала дергает API, при ошибке — `/data/catalog.json` |

Большой файл `описание проекта с комментариями.txt` — дорожная карта на будущее (кабинеты, ORT, аналитика); для текущего v1 достаточно таблиц выше.

### Авторизация и провайдеры (Worker + UI)

**Cookie-сессия** как раньше: `session`, HttpOnly, `SameSite=None`, `Secure` в HTTPS.

| Возможность | API / UI | Секреты и настройки |
|-------------|----------|---------------------|
| Почта + пароль, подтверждение письмом | `POST /v1/auth/register` (без сессии до клика), `GET /v1/auth/verify-email?token=…`, `POST /v1/auth/resend-verification`, `POST /v1/auth/login` | **Resend**: `RESEND_API_KEY`, `EMAIL_FROM`. Локально: `DEV_RETURN_EMAIL_LINK=true` — ссылка в JSON ответа вместо письма. |
| Сброс пароля | `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password` | Resend; лимит писем сброса на аккаунт; при ошибке отправки токен удаляется, ответ `503 email_not_configured`. |
| Пароль в кабинете | `POST /v1/auth/password/set` (только если пароля ещё не было, напр. после Яндекса), `POST /v1/auth/password/change` (текущий + новый; остальные сессии сбрасываются, выдаётся новая cookie) | Сессия в cookie |
| Яндекс ID (OAuth 2 + PKCE) | `GET /v1/auth/oauth/yandex/start`, `GET …/callback` | `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`; в консоли Яндекса redirect = `…/v1/auth/oauth/yandex/callback` (или `YANDEX_REDIRECT_URI`). |
| Госуслуги (ЕСИА) | Кнопка на сайте активна только при **`ESIA_FULL_IMPLEMENTATION=true`** и реализованном обмене; иначе `GET …/esia/start` — заглушка | `ESIA_CLIENT_ID`, сертификаты, контур ЕСИА; до готовности флаг не включать. |
| Вход по SMS | `POST /v1/auth/phone/send-login` (в ответе `normalizedPhone` для ввода кода), `POST /v1/auth/phone/verify-login` | **SMS.RU** `SMSRU_API_ID`; номер должен быть привязан в кабинете. |
| Привязка телефона (после входа) | `POST /v1/auth/phone/send-attach`, `POST /v1/auth/phone/verify-attach` | SMS.RU |
| Публичная конфигурация | `GET /v1/auth/config` — какие методы включены | — |

Дополнительно: **`PUBLIC_SITE_URL`** (редиректы после верификации/OAuth), **`AUTH_PEPPER`** (хэш SMS-кода; задайте в проде).

Секреты в проде задаются через **Wrangler secrets** / переменные окружения в Cloudflare, не коммитьте их в репозиторий.
