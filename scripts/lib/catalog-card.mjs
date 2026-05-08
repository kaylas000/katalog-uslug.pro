/**
 * Единственное место в репозитории, где задаётся HTML карточки каталога для сборки.
 *
 * Данные: data/catalog.json — по одной записи на организацию (title, text, categorySlug, …).
 * Сборка: scripts/build-from-data.mjs подставляет результат в index.html, r/…/, c/…/ через cardHtml().
 *
 * Для очень больших объёмов (миллионы записей) в git статику не кладут: Worker + БД отдают JSON/API,
 * а карточки рисуются на клиенте или на edge той же разметкой (логика — здесь или зеркально в JS).
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function telHref(display) {
  const raw = String(display ?? '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[^\d+]/g, '');
  if (!compact) return '';
  let num = compact.startsWith('+')
    ? '+' + compact.slice(1).replace(/\D/g, '')
    : compact.replace(/\D/g, '');
  const digits = num.startsWith('+') ? num.slice(1) : num;
  if (digits.length < 10) return '';
  return num.startsWith('+') ? `tel:${num}` : `tel:${num}`;
}

/** Подзаголовок карточки: каждый распознанный телефон — кнопка (как на странице орг.). */
export function catalogCardSubtitleMainHtml(subtitle) {
  const lines = String(subtitle || '')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0)
    return '<p class="catalog-card-text catalog-card-text-main"></p>';
  const parts = [];
  for (const line of lines) {
    const th = telHref(line);
    if (th) {
      parts.push(
        `<div class="catalog-card-tel-wrap"><a href="${escapeHtml(th)}" class="btn btn-primary catalog-card-tel" aria-label="Позвонить: ${escapeHtml(line)}">${escapeHtml(line)}</a></div>`
      );
    } else if (/^[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+$/i.test(line)) {
      parts.push(
        `<div class="catalog-card-line"><a href="mailto:${escapeHtml(line)}" class="catalog-card-link">${escapeHtml(line)}</a></div>`
      );
    } else {
      parts.push(`<div class="catalog-card-line">${escapeHtml(line)}</div>`);
    }
  }
  return `<div class="catalog-card-text catalog-card-text-main">${parts.join('')}</div>`;
}

function reviewsLabel(n) {
  const x = Number(n) || 0;
  const mod10 = x % 10;
  const mod100 = x % 100;
  if (mod10 === 1 && mod100 !== 11) return `${x} отзыв`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${x} отзыва`;
  return `${x} отзывов`;
}

function catalogMediaSlidesHtml(portfolioImages) {
  const imgs = Array.isArray(portfolioImages) ? portfolioImages.filter(Boolean) : [];
  const gradients = ['s1', 's2', 's3'];
  const n = imgs.length === 0 ? 3 : Math.min(4, Math.max(3, imgs.length));
  const slides = [];
  for (let i = 0; i < n; i++) {
    const isActive = i === 0 ? ' is-active' : '';
    const url = imgs.length ? imgs[i % imgs.length] : null;
    if (url) {
      const u = escapeHtml(url);
      slides.push(
        `<span class="catalog-slide catalog-slide-photo${isActive}" style="background-image:url(&quot;${u}&quot;)"></span>`
      );
    } else {
      slides.push(`<span class="catalog-slide ${gradients[i % 3]}${isActive}"></span>`);
    }
  }
  return slides.map((s) => `              ${s}`).join('\n');
}

/** HTML одной карточки каталога для организации (запись из catalog.json). */
export function cardHtml(item) {
  const rating = typeof item.rating === 'number' ? item.rating.toFixed(1) : escapeHtml(item.rating);
  const href = escapeHtml(item.url || '#');
  const rs = escapeHtml(item.regionSlug || '');
  const cs = escapeHtml(item.categorySlug || '');
  const textHtml = escapeHtml(item.text || '').replace(/\n/g, '<br>');
  return `        <article class="card catalog-card-wide" data-region-slug="${rs}" data-category-slug="${cs}" data-org-url="${href}">
          <div class="catalog-card-layout">
            <div class="catalog-media" data-auto-slider>
${catalogMediaSlidesHtml(item.portfolioImages)}
            </div>
            <div class="catalog-card-content">
              <div class="tag-row">
                <span class="tag">${escapeHtml(item.categoryLabel)}</span>
                <span class="tag tag-green">${escapeHtml(item.regionLabel)}</span>
              </div>
              <h3 class="card-title">${escapeHtml(item.title)}</h3>
              ${catalogCardSubtitleMainHtml(item.subtitle || '')}
              <p class="catalog-card-text catalog-card-about"><strong>О компании:</strong> ${textHtml}</p>
              <div class="catalog-card-footer">
                <span class="tag tag-accent">★ ${rating} · ${reviewsLabel(item.reviews)}</span>
                <a href="${href}" class="btn btn-sm btn-primary">Подробнее →</a>
              </div>
            </div>
          </div>
        </article>`;
}

export function catalogEmptyInner() {
  return `        <div class="catalog-empty" role="status">
          <p class="catalog-empty-title">Ничего не найдено</p>
          <p class="catalog-empty-text">Смените регион, категорию или поисковый запрос — либо откройте <a href="/regions/">список всех субъектов РФ</a>.</p>
        </div>`;
}

/** Пустой контейнер каталога — карточки подгружает API `/v1/catalog?v=2`. */
export function buildCardsGridInner(_items) {
  void _items;
  return `\n      <div class="catalog-split">\n        <div class="catalog-main" id="catalog-cards-host">\n        </div>\n        <aside class="catalog-side"><div class="catalog-side-placeholder"></div></aside>\n      </div>\n      `;
}

/** Контент между маркерами katalog:category-cards (тот же cardHtml). */
export function buildCategoryCardsInner(items) {
  if (!items.length) {
    return `
          <div class="catalog-empty" role="status">
          <p class="catalog-empty-title">Пока нет организаций</p>
          <p class="catalog-empty-text">Откройте <a href="/#catalog">главный каталог</a>.</p>
        </div>
        `;
  }
  return `\n${items.map(cardHtml).join('\n')}\n        `;
}
