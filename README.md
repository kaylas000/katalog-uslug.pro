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
