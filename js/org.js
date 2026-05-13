(() => {
  function katalogApiBase() {
    return (
      document
        .querySelector('meta[name="katalog-catalog-api"]')
        ?.getAttribute('content')
        ?.trim()
        .replace(/\/$/, '') || ''
    );
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function withBreaks(value) {
    return esc(value).replace(/\n/g, '<br>');
  }

  function resolveOrgMediaUrl(raw) {
    const t = String(raw ?? '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (t.startsWith('/v1/') || t.startsWith('v1/')) {
      const base = katalogApiBase();
      if (!base) return t.startsWith('/') ? t : `/${t}`;
      return `${base}${t.startsWith('/') ? t : `/${t}`}`;
    }
    return t;
  }

  function orgSlugFromPath() {
    const fromQuery = new URLSearchParams(window.location.search).get('slug');
    if (fromQuery && fromQuery.trim()) {
      return decodeURIComponent(fromQuery.trim());
    }
    const seg = window.location.pathname.split('/').filter(Boolean);
    const i = seg.indexOf('org');
    if (i === -1) return '';
    return decodeURIComponent(seg[i + 1] || '');
  }

  function captionForSlide(i) {
    return `Изображение ${i + 1}`;
  }

  function contactValueRaw(c) {
    if (!c || typeof c !== 'object') return '';
    const v = c.contactValue ?? c.contact_value;
    return typeof v === 'string' ? v.trim() : '';
  }

  function contactLabelRaw(c) {
    if (!c || typeof c !== 'object') return '';
    const v = c.contactLabel ?? c.contact_label;
    return typeof v === 'string' ? v.trim() : '';
  }

  function contactTypeRaw(c) {
    const t = c.contactType ?? c.contact_type;
    return typeof t === 'string' ? t.trim().toLowerCase() : '';
  }

  /** Подписи вроде «Телефон» / «E-mail» дублируют тип — не показываем, как у карточек без structured labels. */
  function isRedundantContactLabel(lb, type) {
    const n = String(lb ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (!n) return true;
    const t = String(type ?? '').toLowerCase();
    const phoneHints = [
      'телефон',
      'тел.',
      'тел',
      'phone',
      'моб.',
      'мобильный',
      'факс',
      'fax',
    ];
    const emailHints = ['e-mail', 'email', 'e‑mail', 'почта', 'электронная почта'];
    const webHints = ['сайт', 'website', 'веб-сайт', 'веб', 'url', 'интернет-сайт'];
    const matches = (hints) =>
      hints.some((h) => n === h || n.startsWith(`${h} `) || n.startsWith(`${h}.`));
    if (t === 'phone' && matches(phoneHints)) return true;
    if (t === 'email' && matches(emailHints)) return true;
    if (t === 'website' && matches(webHints)) return true;
    return false;
  }

  function effectiveContactLabel(lb, value, type) {
    const v = String(value ?? '').trim();
    const s = typeof lb === 'string' ? lb.trim() : '';
    if (!s || s === v) return '';
    if (isRedundantContactLabel(s, type)) return '';
    return s;
  }

  function addressAlreadyInPlainLines(addrNorm, payload) {
    const list = Array.isArray(payload.contacts) ? payload.contacts : [];
    for (const c of list) {
      const v = contactValueRaw(c).trim().toLowerCase();
      if (!v) continue;
      if (v === addrNorm || v.includes(addrNorm) || addrNorm.includes(v)) return true;
    }
    if (list.length > 0) return false;
    const sub = typeof payload.subtitle === 'string' ? payload.subtitle : '';
    for (const ln of sub.split('\n')) {
      const s = ln.trim().toLowerCase();
      if (!s) continue;
      if (s === addrNorm || s.includes(addrNorm) || addrNorm.includes(s)) return true;
    }
    return false;
  }

  /** Для ссылки tel: оставляем + и только цифры (например +7 … → tel:+7495…) */
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

  function mailtoHref(display) {
    const raw = String(display ?? '').trim();
    if (!raw) return '';
    if (!/^[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+$/i.test(raw)) return '';
    return `mailto:${raw}`;
  }

  function externalSiteHref(display) {
    const raw = String(display ?? '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw.replace(/^\/+/, '')}`;
  }

  /** Телефон всегда основной кнопкой (единый вид для всех организаций). */
  function phoneStackRow(value, label) {
    const v = String(value ?? '').trim();
    if (!v) return '';
    const href = telHref(v);
    const lb = typeof label === 'string' ? label.trim() : '';
    const labelBlock =
      lb && lb !== v ? `<strong class="sidebar-contact-label">${esc(lb)}</strong>` : '';
    if (!href) {
      return `<div class="sidebar-row sidebar-row--stack">${labelBlock}${withBreaks(v)}</div>`;
    }
    return `<div class="sidebar-row sidebar-row--stack">${labelBlock}<a href="${esc(href)}" class="btn btn-primary" aria-label="Позвонить: ${esc(v)}">${esc(v)}</a></div>`;
  }

  function verificationAsideHtml(profile) {
    const raw =
      typeof profile?.verificationStatus === 'string'
        ? profile.verificationStatus.trim().toLowerCase()
        : '';
    const verified = raw === 'verified';
    const pending = raw === 'pending' || raw === 'in_review';

    let items;
    if (verified) {
      items = [
        'ИНН проверен',
        'Юридический адрес подтверждён',
        'Контактные данные актуальны',
      ];
    } else if (pending) {
      items = [
        'ИНН: проверка выполняется',
        'Юридический адрес: проверяется',
        'Контакты: проверяются',
      ];
    } else {
      items = [
        'ИНН: сверка на платформе не выполнялась',
        'Юридический адрес: по данным организации',
        'Контакты: опубликованы организацией',
      ];
    }

    const body = items
      .map((text) => {
        const check = verified
          ? '<span class="sidebar-verify-check" aria-hidden="true">✓</span>'
          : '';
        return `<div class="sidebar-verify-row${verified ? ' is-verified' : ''}">${check}<span>${esc(text)}</span></div>`;
      })
      .join('');

    return `<div class="sidebar-card sidebar-card--verification"><h3>Статус верификации</h3>${body}</div>`;
  }

  function contactRowHtml(c) {
    const v = contactValueRaw(c);
    if (!v) return '';
    const lbRaw = contactLabelRaw(c);
    const type = contactTypeRaw(c);
    const lb = effectiveContactLabel(lbRaw, v, type);
    const labelPrefix = lb ? `<strong class="sidebar-contact-label">${esc(lb)}</strong> ` : '';

    if (type === 'phone') {
      return phoneStackRow(v, lb);
    }
    if (type === 'email') {
      const href = mailtoHref(v);
      const body = href
        ? `<a href="${esc(href)}" class="sidebar-contact-link">${esc(v)}</a>`
        : withBreaks(v);
      return `<div class="sidebar-row">${labelPrefix}${body}</div>`;
    }
    if (type === 'website') {
      const href = externalSiteHref(v);
      const body = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="sidebar-contact-link">${esc(v)}</a>`
        : withBreaks(v);
      return `<div class="sidebar-row">${labelPrefix}${body}</div>`;
    }

    const mh = mailtoHref(v);
    if (mh) {
      return `<div class="sidebar-row">${labelPrefix}<a href="${esc(mh)}" class="sidebar-contact-link">${esc(v)}</a></div>`;
    }
    if (telHref(v)) {
      return phoneStackRow(v, lb);
    }
    if (/^https?:\/\//i.test(v)) {
      return `<div class="sidebar-row">${labelPrefix}<a href="${esc(v)}" target="_blank" rel="noopener" class="sidebar-contact-link">${esc(v)}</a></div>`;
    }
    return `<div class="sidebar-row">${labelPrefix}${withBreaks(v)}</div>`;
  }

  function contactAsideHtml(payload) {
    const rows = [];
    const list = Array.isArray(payload.contacts) ? payload.contacts : [];
    if (list.length > 0) {
      list.forEach((c) => {
        const row = contactRowHtml(c);
        if (row) rows.push(row);
      });
    } else if (typeof payload.subtitle === 'string' && payload.subtitle.trim()) {
      payload.subtitle.split('\n').forEach((ln) => {
        const s = ln.trim();
        if (!s) return;
        const fake = { contactValue: s, contact_type: '', contactType: '' };
        rows.push(contactRowHtml(fake));
      });
    }

    const addrRaw =
      typeof payload.profile?.addressText === 'string'
        ? payload.profile.addressText.trim()
        : '';
    const addrPublic = payload.profile?.addressIsPublic !== false;
    if (addrRaw && addrPublic) {
      const addrNorm = addrRaw.toLowerCase();
      if (!addressAlreadyInPlainLines(addrNorm, payload)) {
        rows.push(`<div class="sidebar-row">${withBreaks(addrRaw)}</div>`);
      }
    }

    let websiteBtn = '';
    const w =
      typeof payload.profile?.websiteUrl === 'string'
        ? payload.profile.websiteUrl.trim()
        : '';
    if (/^https?:\/\//i.test(w)) {
      websiteBtn = `<a href="${esc(w)}" target="_blank" rel="noopener" class="btn btn-primary">Перейти на сайт →</a>`;
    }

    const contactsInner =
      rows.length > 0
        ? rows.join('\n')
        : '<div class="sidebar-row">Контакты уточняются по запросу.</div>';

    return `<div class="sidebar-card"><h3>Контакты</h3>${contactsInner}</div>${websiteBtn}${verificationAsideHtml(payload.profile)}`;
  }

  function tagsMetaRow(payload) {
    const ts = Array.isArray(payload.tags) ? payload.tags : [];
    if (ts.length === 0) return '';
    return `<div class="org-tags-row tag-row">${ts
      .map((t) => `<span class="tag">${esc(t.label || t.slug)}</span>`)
      .join('')}</div>`;
  }

  function categoryIsGoods(cat) {
    return Boolean(cat && (cat.isGoods === true || cat.isGoodsCategory === true));
  }

  /** Хвост карточки для товарных организаций: полный текст — только Penrod (durapan), для остальных — нейтрально. */
  function goodsOrgArticleSupplement(payload) {
    const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
    const revN = typeof payload.reviews === 'number' ? payload.reviews : 0;
    const revPhrase = reviewsRu(revN);
    if (slug !== 'durapan') {
      return `<div class="content-block mt-32"><div class="content-block-heading"><h2>Отзывы</h2><a href="/contacts/" class="btn btn-sm btn-outline">Оставить отзыв</a></div><p class="section-sub mb-0">Публичные отзывы с платформы появятся здесь после публикации модераторами.</p></div>
<div class="content-block mt-32">
<h2>Подтверждённый рейтинг токенами</h2>
<p>Рейтинг компании построен на реальных токенах за выполненные заказы. Каждый токен = один завершённый проект с подтверждением от заказчика.</p>
<div class="token-bar mt-16">
<span class="token"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> токены</span>
<span class="token-desc">· ${esc(revPhrase)}</span>
</div>
</div>`;
    }
    return `<div class="content-block mt-32">
<h2>Преимущества и условия</h2>
<ul>
<li>Прямые поставки от ведущих лесозаготовительных предприятий</li>
<li>Строгий контроль влажности и качества каждой партии</li>
<li>Собственные складские площади для хранения в оптимальных условиях</li>
<li>Оперативная отгрузка и доставка по всей России</li>
<li>Гибкая система скидок для постоянных партнеров</li>
</ul>
</div>
<div class="content-block mt-32">
<div class="content-block-heading">
<h2>Отзывы</h2>
<a href="/contacts/" class="btn btn-sm btn-outline">Оставить отзыв</a>
</div>
<div class="reviews-stack">
<div class="review">
<div class="review-header">
<span class="review-author">Мебельная фабрика «Стиль»</span>
<span class="review-stars">★★★★★</span>
</div>
<p class="review-text">Сотрудничаем с Penrod уже второй год. Качество шпона всегда на высоте, без сюрпризов. Радует профессиональный подход к упаковке и логистике.</p>
</div>
<div class="review">
<div class="review-header">
<span class="review-author">ИП Васильев</span>
<span class="review-stars">★★★★★</span>
</div>
<p class="review-text">Отличный выбор фанеры и МДФ. Всегда можно получить грамотную консультацию. Рекомендую как надёжного поставщика.</p>
</div>
</div>
</div>
<div class="content-block mt-32">
<h2>Подтверждённый рейтинг токенами</h2>
<p>Рейтинг компании построен на реальных токенах за выполненные заказы. Каждый токен = один завершённый проект с подтверждением от заказчика.</p>
<div class="token-bar mt-16">
<span class="token"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> 200+ токенов</span>
<span class="token-desc">· ${esc(revPhrase)} · Верификация ИНН пройдена</span>
</div>
</div>`;
  }

  function articleBlocks(payload) {
    if (
      typeof payload.legacy?.articleHtml === 'string' &&
      payload.legacy.articleHtml.trim()
    ) {
      return payload.legacy.articleHtml;
    }
    const cat = payload.category || {};
    const isGoods = categoryIsGoods(cat);
    const md =
      typeof payload.profile?.descriptionMd === 'string'
        ? payload.profile.descriptionMd.trim()
        : '';
    const listing =
      typeof payload.listingText === 'string' ? payload.listingText : '';
    const body = md || listing;
    const paras =
      body.length > 0
        ? body
            .split(/\n\n+/)
            .map((p) => `<p>${withBreaks(p.trim())}</p>`)
            .join('\n')
        : `<p>${withBreaks(listing)}</p>`;

    const addr =
      typeof payload.profile?.addressText === 'string'
        ? payload.profile.addressText.trim()
        : '';
    const addrHtml = addr ? `<p class="catalog-card-text mt-24">${withBreaks(addr)}</p>` : '';

    const srv = Array.isArray(payload.services) ? payload.services : [];
    const listHeading = isGoods ? 'Ассортимент товаров' : 'Услуги';
    let servicesUl = '';
    if (srv.length > 0) {
      servicesUl = `<div class="content-block mt-32"><h2>${esc(listHeading)}</h2><ul>${srv
        .map((s) => {
          const t = typeof s.title === 'string' ? s.title : '';
          const d = typeof s.description === 'string' ? s.description : '';
          const line = `${t}${t && d ? ' — ' : ''}${d}`;
          return `<li>${withBreaks(line)}</li>`;
        })
        .join('')}</ul></div>`;
    }

    const tailGoods = isGoods ? goodsOrgArticleSupplement(payload) : '';
    const tailReviews =
      isGoods
        ? ''
        : `<div class="content-block mt-32"><div class="content-block-heading"><h2>Отзывы</h2><a href="/contacts/" class="btn btn-sm btn-outline">Оставить отзыв</a></div><p class="section-sub mb-0">Публичные отзывы с платформы появятся здесь после публикации модераторами.</p></div>`;

    return `<div class="org-article">
<div class="content-block"><h2>О компании</h2>${paras}${addrHtml}</div>
${servicesUl}
${tailGoods}
${tailReviews}
</div>`;
  }

  function reviewsRu(n) {
    const rev = typeof n === 'number' ? n : 0;
    const m10 = rev % 10;
    const m100 = rev % 100;
    if (m10 === 1 && m100 !== 11) return `${rev} отзыв`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${rev} отзыва`;
    return `${rev} отзывов`;
  }

  function render(root, payload) {
    const titleEsc = esc(payload.title);
    const slugSafe =
      typeof payload.slug === 'string' ? payload.slug : orgSlugFromPath();
    const cat = payload.category || {};
    const reg = payload.region || {};
    const isGoods = categoryIsGoods(cat);
    const catSlug = typeof cat.slug === 'string' ? cat.slug.trim() : '';
    let breadcrumbsInner = '';
    if (isGoods) {
      const mid = esc(cat.label || 'Товары');
      breadcrumbsInner = `<a href="/">Главная</a><span>/</span><a href="/goods/">Товары</a><span>/</span><a href="/goods/materials/">${mid}</a><span>/</span><span>${titleEsc}</span>`;
    } else {
      const catHref = catSlug ? `/c/${encodeURIComponent(catSlug)}/` : '/';
      const mid = esc(cat.label || 'Категория');
      breadcrumbsInner = `<a href="/">Главная</a><span>/</span><a href="${esc(catHref)}">${mid}</a><span>/</span><span>${titleEsc}</span>`;
    }
    document.title = `${typeof payload.title === 'string' ? payload.title : slugSafe} — katalog-uslug.pro`;

    const ratingDec =
      typeof payload.rating === 'number'
        ? payload.rating.toFixed(1)
        : esc(payload.rating);
    const revN = typeof payload.reviews === 'number' ? payload.reviews : 0;

    const imgs = payload.profile?.portfolioImages || [];
    const cover =
      typeof payload.profile?.coverUrl === 'string' ? payload.profile.coverUrl.trim() : '';
    let btnHtml = '';
    if (imgs.length > 0) {
      imgs.forEach((src, i) => {
        if (typeof src !== 'string' || !src.trim()) return;
        const mediaUrl = resolveOrgMediaUrl(src);
        if (!mediaUrl) return;
        btnHtml += `<button type="button" data-slide-caption="${esc(
          captionForSlide(i)
        )}" data-slide-src="${esc(mediaUrl)}"></button>`;
      });
    } else if (cover) {
      const mediaUrl = resolveOrgMediaUrl(cover);
      if (mediaUrl) {
        btnHtml = `<button type="button" data-slide-caption="" data-slide-src="${esc(mediaUrl)}"></button>`;
      }
    }

    const contactsAside = contactAsideHtml(payload);

    root.innerHTML = `
<section class="org-header">
<div class="container">
<nav class="breadcrumbs">
${breadcrumbsInner}
</nav>
<h1 class="org-title">${titleEsc}</h1>
<div class="org-meta">
<span class="tag">${esc(cat.label || '')}</span>
<span class="tag tag-green">${esc(reg.label || '')}</span>
<span class="tag tag-accent">★ ${ratingDec} · ${reviewsRu(revN)}</span>
</div>
${tagsMetaRow(payload)}
</div>
</section>
<section class="org-body">
<div class="container">
<div class="org-portfolio-slot" aria-labelledby="org-portfolio-sr-heading"><h2 id="org-portfolio-sr-heading" class="sr-only">Портфолио организации</h2>
<div data-portfolio class="org-portfolio-wrap">
<div class="org-showcase org-showcase--layout">
<div class="org-showcase-card org-showcase-card--hero">
<div class="portfolio-pixel portfolio-pixel-hero" data-portfolio-hero role="img" aria-label="${titleEsc}"></div>
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
<aside class="org-showcase-aside sidebar">${contactsAside}</aside>
</div>
<div data-portfolio-source hidden>${btnHtml}</div>
</div></div>
${articleBlocks(payload)}
</div>
</section>
`;
    if (typeof window.bindPortfolioWidgets === 'function') {
      window.bindPortfolioWidgets(root);
    }
  }

  async function boot() {
    const root = document.getElementById('org-app');
    const base = katalogApiBase();
    const slug = orgSlugFromPath();
    if (!root || !base || !slug) {
      const el = root || document.body;
      el.innerHTML = `<div class="container"><p class="section-sub">${!base ? 'Не задан API каталога (meta name=katalog-catalog-api).' : 'Некорректный URL организации.'}</p><p><a href="/">На главную</a></p></div>`;
      return;
    }
    try {
      const res = await fetch(`${base}/v1/org/${encodeURIComponent(slug)}`, {
        credentials: 'omit',
        cache: 'no-store',
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error('org_fetch');
      }
      render(root, j);
    } catch {
      root.innerHTML = `<div class="container"><p class="section-sub">Не удалось загрузить данные организации. Проверьте деплой API и наличие slug в базе.</p><p><a href="/">На главную</a></p></div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
