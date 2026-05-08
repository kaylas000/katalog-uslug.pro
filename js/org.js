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
    const lb = contactLabelRaw(c);
    const type = contactTypeRaw(c);
    const labelPrefix =
      lb && lb !== v ? `<strong class="sidebar-contact-label">${esc(lb)}</strong> ` : '';

    if (type === 'phone') {
      return phoneStackRow(v, lb && lb !== v ? lb : '');
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
      return phoneStackRow(v, lb && lb !== v ? lb : '');
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

  function articleBlocks(payload) {
    if (
      typeof payload.legacy?.articleHtml === 'string' &&
      payload.legacy.articleHtml.trim()
    ) {
      return payload.legacy.articleHtml;
    }
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
    let servicesUl = '';
    if (srv.length > 0) {
      servicesUl = `<div class="content-block mt-32"><h2>Услуги из каталога</h2><ul>${srv
        .map((s) => {
          const t = typeof s.title === 'string' ? s.title : '';
          const d = typeof s.description === 'string' ? s.description : '';
          const line = `${t}${t && d ? ' — ' : ''}${d}`;
          return `<li>${withBreaks(line)}</li>`;
        })
        .join('')}</ul></div>`;
    }

    return `<div class="org-article">
<div class="content-block"><h2>О компании</h2>${paras}${addrHtml}</div>
${servicesUl}
<div class="content-block mt-32"><div class="content-block-heading"><h2>Отзывы</h2><a href="/contacts/" class="btn btn-sm btn-outline">Оставить отзыв</a></div><p class="section-sub mb-0">Публичные отзывы с платформы появятся здесь после публикации модераторами.</p></div>
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
    const catHref =
      typeof cat.slug === 'string' && cat.slug
        ? `/c/${encodeURIComponent(cat.slug)}/`
        : '/';
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
        btnHtml += `<button type="button" data-slide-caption="${esc(
          captionForSlide(i)
        )}" data-slide-src="${esc(src.trim())}"></button>`;
      });
    } else if (cover) {
      btnHtml = `<button type="button" data-slide-caption="" data-slide-src="${esc(cover)}"></button>`;
    }

    const contactsAside = contactAsideHtml(payload);

    root.innerHTML = `
<section class="org-header">
<div class="container">
<nav class="breadcrumbs">
<a href="/">Главная</a><span>/</span><a href="${esc(catHref)}">${esc(cat.label || 'Категория')}</a><span>/</span><span>${titleEsc}</span>
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
