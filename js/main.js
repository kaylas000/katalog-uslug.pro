function getKatalogApiBase() {
  return (
    document
      .querySelector('meta[name="katalog-catalog-api"]')
      ?.getAttribute('content')
      ?.trim()
      .replace(/\/$/, '') || ''
  );
}

function resolveApiMediaUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('images/')) return `/${t}`;
  if (t.startsWith('/v1/') || t.startsWith('v1/')) {
    const base = getKatalogApiBase();
    if (!base) return t.startsWith('/') ? t : `/${t}`;
    return `${base}${t.startsWith('/') ? t : `/${t}`}`;
  }
  return t;
}

window.bindPortfolioWidgets =
  window.bindPortfolioWidgets ||
  function bindPortfolioWidgets(scope = document) {
    scope.querySelectorAll('[data-portfolio]').forEach((root) => {
      if (root.dataset.portfolioBound === '1') return;
      const source = root.querySelector('[data-portfolio-source]');
      const hero = root.querySelector('[data-portfolio-hero]');
      const deskSide = root.querySelector('[data-portfolio-desk-side]');
      const mobStrip = root.querySelector('[data-portfolio-mob-strip]');
      const mobPrev = root.querySelector('[data-portfolio-mob-prev]');
      const mobNext = root.querySelector('[data-portfolio-mob-next]');
      const mobIndicator = root.querySelector('[data-portfolio-mob-indicator]');
      if (!source || !hero || !deskSide || !mobStrip) return;

      const meta = Array.from(source.querySelectorAll('button[type="button"]'));
      if (meta.length === 0) {
        root.classList.add('org-portfolio-wrap--empty');
        root.dataset.portfolioBound = '1';
        if (hero) {
          hero.setAttribute(
            'aria-label',
            'Фотографии не указаны'
          );
        }
        return;
      }
      root.classList.remove('org-portfolio-wrap--empty');
      root.dataset.portfolioBound = '1';
      const n = meta.length;
      const captions = meta.map((btn, i) => btn.getAttribute('data-slide-caption') || `Слайд ${i + 1}`);

      const slideSrc = (i) => {
        const raw = meta[i]?.getAttribute?.('data-slide-src');
        return resolveApiMediaUrl(raw);
      };

      const applyPortfolioBg = (el, url) => {
        if (!(el instanceof HTMLElement)) return;
        if (url) {
          const escURI = encodeURI(url.trim());
          el.classList.add('portfolio-pixel--photo');
          el.style.setProperty('background-image', `url("${escURI}")`, 'important');
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
        if (!hero) return;
        hero.removeAttribute('aria-hidden');
        hero.setAttribute('role', 'img');
        hero.setAttribute('aria-label', captions[idx] || `Фото ${idx + 1}`);
        hero.dataset.activeSlide = String(idx);
        hero.classList.add('is-current');
        applyPortfolioBg(hero, slideSrc(idx));
      };

      const rebuildDesktopRail = () => {
        deskSide.innerHTML = '';
        for (let j = 0; j < n; j += 1) {
          if (j === idx) continue;
          const b = document.createElement('button');
          b.type = 'button';
          b.className =
            'org-showcase-card org-showcase-card--mini portfolio-pixel portfolio-pixel-mini';
          b.dataset.slideTarget = String(j);
          b.setAttribute('aria-label', captions[j] || `Фото ${j + 1}`);
          b.addEventListener('click', (e) => {
            e.preventDefault();
            setIdx(j, { scrollMob: true });
          });
          applyPortfolioBg(b, slideSrc(j));
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
        mobSlides.forEach((el, i2) => el.classList.toggle('is-current', i2 === idx));
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
          mobSlides.forEach((el, i2) => {
            const r = el.getBoundingClientRect();
            const mid = r.left + r.width / 2;
            const d = Math.abs(mid - stripMid);
            if (d < bestDist) {
              bestDist = d;
              best = i2;
            }
          });
          if (best !== idx) {
            idx = best;
            syncHero();
            rebuildDesktopRail();
            mobSlides.forEach((el, i2) => el.classList.toggle('is-current', i2 === idx));
            if (mobIndicator) mobIndicator.textContent = `${idx + 1}/${n}`;
          }
        }, 96);
      }, { passive: true });

      setIdx(0, { scrollMob: false });
    });
  };

document.addEventListener('DOMContentLoaded', () => {
  const orgPathMatch = window.location.pathname.match(/^\/org\/([^/]+)\/?$/);
  if (orgPathMatch && !window.location.pathname.startsWith('/org/index.html')) {
    const slug = decodeURIComponent(orgPathMatch[1] || '').trim();
    if (slug) {
      window.location.replace(`/org/index.html?slug=${encodeURIComponent(slug)}`);
      return;
    }
  }

  /* Mobile menu */
  const burger = document.querySelector('.burger');
  const mobileNav = document.querySelector('.mobile-nav');
  const mobileClose = document.querySelector('.mobile-close');
  if (burger && mobileNav) {
    burger.addEventListener('click', () => mobileNav.classList.add('open'));
    mobileClose?.addEventListener('click', () => mobileNav.classList.remove('open'));
    mobileNav.addEventListener('click', (e) => { if (e.target === mobileNav) mobileNav.classList.remove('open'); });
  }

  /* Mobile services submenu */
  const mobileServiceLabel = document.querySelector('.mobile-menu-label');
  if (mobileServiceLabel) {
    const stopHrefs = new Set(['/analytics/', '/contacts/', '/moderation/', '/blog/', '/add/']);
    const serviceLinks = [];
    let cursor = mobileServiceLabel.nextElementSibling;
    while (cursor && cursor.tagName === 'A') {
      const href = cursor.getAttribute('href') || '';
      if (stopHrefs.has(href)) break;
      serviceLinks.push(cursor);
      cursor = cursor.nextElementSibling;
    }

    if (serviceLinks.length > 0) {
      let collapsed = true;
      mobileServiceLabel.classList.add('is-collapsed');
      mobileServiceLabel.setAttribute('role', 'button');
      mobileServiceLabel.setAttribute('tabindex', '0');
      mobileServiceLabel.setAttribute('aria-expanded', 'false');

      serviceLinks.forEach((link) => {
        link.classList.add('mobile-service-link', 'is-hidden');
      });

      const setCollapsed = (state) => {
        collapsed = state;
        mobileServiceLabel.classList.toggle('is-collapsed', collapsed);
        mobileServiceLabel.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        serviceLinks.forEach((link) => link.classList.toggle('is-hidden', collapsed));
      };

      mobileServiceLabel.addEventListener('click', () => setCollapsed(!collapsed));
      mobileServiceLabel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setCollapsed(!collapsed);
        }
      });
    }
  }

  window.bindPortfolioWidgets(document);

  /* Desktop submenu */
  const submenuToggle = document.querySelector('.nav-submenu-toggle');
  const submenuRoot = document.querySelector('.has-submenu');
  if (submenuToggle && submenuRoot) {
    let submenuCloseTimer = null;
    const openSubmenu = () => {
      if (submenuCloseTimer) clearTimeout(submenuCloseTimer);
      submenuRoot.classList.add('open');
      submenuToggle.setAttribute('aria-expanded', 'true');
    };
    const closeSubmenu = () => {
      submenuRoot.classList.remove('open');
      submenuToggle.setAttribute('aria-expanded', 'false');
    };
    const delayedClose = () => {
      if (submenuCloseTimer) clearTimeout(submenuCloseTimer);
      submenuCloseTimer = setTimeout(closeSubmenu, 180);
    };

    submenuRoot.addEventListener('mouseenter', openSubmenu);
    submenuRoot.addEventListener('mouseleave', delayedClose);

    submenuToggle.addEventListener('click', (e) => {
      e.preventDefault();
      if (submenuRoot.classList.contains('open')) {
        closeSubmenu();
      } else {
        openSubmenu();
      }
    });
    document.addEventListener('click', (e) => {
      if (!submenuRoot.contains(e.target)) {
        closeSubmenu();
      }
    });
  }

  /* Consultant widget */
  const consultBtn = document.querySelector('.consultant-btn');
  const consultPanel = document.querySelector('.consultant-panel');
  const consultClose = document.querySelector('.consultant-close');
  const consultAnswer = document.querySelector('.consultant-answer');

  if (consultBtn && consultPanel) {
    consultBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      consultPanel.classList.toggle('open');
    });
    consultClose?.addEventListener('click', () => {
      consultPanel.classList.remove('open');
      if (consultAnswer) consultAnswer.classList.remove('show');
    });
    document.addEventListener('click', (e) => {
      if (!consultPanel.contains(e.target) && !consultBtn.contains(e.target)) {
        consultPanel.classList.remove('open');
      }
    });
  }

  /* Consultant quick replies */
  const consultTriggers = document.querySelectorAll('[data-consult]');
  consultTriggers.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-consult');
      const messages = {
        'pick-service': 'Расскажите, какая услуга вам нужна — мы подберем 3 проверенных подрядчика под ваш бюджет и сроки.',
        'filters': 'Фильтры помогают найти исполнителя по категории, городу и рейтингу. Чем выше рейтинг токенов — тем больше проверенных заказов у компании.',
        'compare': 'Выберите до 4 организаций и нажмите «Сравнить». Мы покажем таблицу по ценам, срокам, гарантиям и отзывам.',
        'free-site': 'Каждая организация на платформе получает бесплатную страницу с контактами, услугами и отзывами. Добавьте компанию — остальное мы сделаем сами.'
      };
      if (consultAnswer) {
        consultAnswer.textContent = messages[key] || 'Задайте вопрос — мы ответим в ближайшее время.';
        consultAnswer.classList.add('show');
      }
    });
  });

  /* Каталог на главной и /r/…/: фильтры сразу по региону, категории, рейтингу и строке поиска */
  initCatalogStaticSliders();
  initCatalogFilters();

  function initCatalogStaticSliders() {
    document.querySelectorAll('[data-auto-slider]').forEach((media) => {
      if (media.dataset.sliderReady === '1') return;
      const slides = Array.from(media.querySelectorAll('.catalog-slide'));
      if (slides.length < 2) return;
      let idx = 0;
      const tick = () => {
        idx = (idx + 1) % slides.length;
        slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      };
      media.dataset.sliderReady = '1';
      window.setInterval(tick, 2600);
    });
  }

  function initCatalogFilters() {
    const host = document.getElementById('catalog-cards-host');
    if (!host) return;
    const section =
      host.closest('[data-catalog-section]') ||
      document.querySelector('[data-catalog-section]');
    const filterApply = document.querySelector('[data-filter-apply]');
    const selRegion = document.getElementById('filter-region');
    const selCategory = document.getElementById('filter-category');
    const selRating = document.getElementById('filter-rating');
    const selSort = document.getElementById('filter-sort');
    const searchInput = document.getElementById('filter-search');
    const whereInput = document.getElementById('filter-where');
    const whereSuggest = document.getElementById('where-suggest');

    const pageRegion =
      (section?.getAttribute('data-page-region') || '').trim();
    const pageCategory =
      (section?.getAttribute('data-page-category') || '').trim();

    const EMPTY_BLOCK = `<div class="catalog-empty" role="status">
          <p class="catalog-empty-title">Ничего не найдено</p>
          <p class="catalog-empty-text">Попробуйте другой регион, категорию или запрос. <a href="/regions/">Все субъекты РФ</a>.</p>
        </div>`;

    const baseEarly = (
      document
        .querySelector('meta[name="katalog-catalog-api"]')
        ?.getAttribute('content')
        ?.trim()
        .replace(/\/$/, '') || ''
    );

    const ERR_UNAVAILABLE = `<div class="catalog-empty" role="status">
          <p class="catalog-empty-title">Каталог недоступен</p>
          <p class="catalog-empty-text">Проверьте деплой API и наличие meta <strong>katalog-catalog-api</strong> в шапке страницы.</p>
        </div>`;

    if (!baseEarly) {
      host.innerHTML = ERR_UNAVAILABLE;
      return;
    }

    function reviewsLabelRu(n) {
      const x = Number(n) || 0;
      const mod10 = x % 10;
      const mod100 = x % 100;
      if (mod10 === 1 && mod100 !== 11) return `${x} отзыв`;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${x} отзыва`;
      return `${x} отзывов`;
    }

    function esc(s) {
      return String(s)
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
        const url = imgs.length ? resolveApiMediaUrl(imgs[i % imgs.length]) : null;
        if (url) {
          const u = esc(url);
          slides.push(
            `<span class="catalog-slide catalog-slide-photo${isActive}" style="background-image:url(&quot;${u}&quot;)"></span>`
          );
        } else {
          slides.push(`<span class="catalog-slide ${gradients[i % 3]}${isActive}"></span>`);
        }
      }
      return slides.map((line) => `              ${line}`).join('\n');
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

    let loadMoreBtn = host.nextElementSibling;
    if (!(loadMoreBtn instanceof HTMLButtonElement) || loadMoreBtn.id !== 'catalog-load-more') {
      loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.id = 'catalog-load-more';
      loadMoreBtn.className = 'btn btn-outline mt-24';
      loadMoreBtn.textContent = 'Показать ещё';
      loadMoreBtn.hidden = true;
      host.parentElement?.appendChild(loadMoreBtn);
    }

    let nextCursor = null;
    let loadingMore = false;
    let locationSuggestTimer = null;
    const state = { locationId: null };
    let locationSuggestItems = [];
    let locationActiveIndex = -1;

    function catalogV2Url(cursor) {
      const u = new URL(`${baseEarly}/v1/catalog`);
      u.searchParams.set('v', '2');
      u.searchParams.set('limit', '24');
      const sort = ((selSort && selSort.value) || 'title').trim();
      u.searchParams.set('sort', sort || 'title');
      const region =
        ((selRegion && selRegion.value) || '').trim() || pageRegion || '';
      if (region) u.searchParams.set('region', region);
      const category =
        ((selCategory && selCategory.value) || '').trim() || pageCategory || '';
      if (category) u.searchParams.set('category', category);
      const minR = selRating?.value?.trim?.() ?? '';
      if (minR) u.searchParams.set('minRating', minR);
      const qTerm = ((searchInput && searchInput.value) || '').trim();
      if (qTerm) u.searchParams.set('q', qTerm);
      if (state.locationId) u.searchParams.set('locationId', state.locationId);
      if (cursor) u.searchParams.set('cursor', cursor);
      return u.toString();
    }

    async function fetchPage(cursor) {
      const r = await fetch(catalogV2Url(cursor || null), { cache: 'no-store' });
      if (!r.ok) throw new Error('catalog_http');
      return r.json();
    }

    function renderAppend(items, replace) {
      if (!Array.isArray(items) || items.length === 0) {
        if (replace) {
          host.innerHTML = EMPTY_BLOCK;
        }
        return;
      }
      const frag = replace
        ? items.map(cardHtml).join('\n')
        : `\n${items.map(cardHtml).join('\n')}`;
      if (replace) {
        host.innerHTML = frag;
      } else {
        host.insertAdjacentHTML('beforeend', frag);
      }
      initAutoSliders();
    }

    async function reloadFirstPage() {
      nextCursor = null;
      loadingMore = true;
      host.innerHTML =
        '<p class="catalog-card-text-main" role="status">Загрузка каталога…</p>';
      loadMoreBtn.hidden = true;
      try {
        const payload = await fetchPage(null);
        const items = Array.isArray(payload.items) ? payload.items : [];
        nextCursor =
          typeof payload.nextCursor === 'string' ? payload.nextCursor : null;
        if (items.length === 0) {
          renderAppend([], true);
        } else {
          renderAppend(items, true);
        }
        loadMoreBtn.hidden = !nextCursor;
      } catch {
        host.innerHTML = ERR_UNAVAILABLE;
      } finally {
        loadingMore = false;
      }
    }

    async function appendNext() {
      if (!nextCursor || loadingMore) return;
      loadingMore = true;
      loadMoreBtn.disabled = true;
      try {
        const payload = await fetchPage(nextCursor);
        const items = Array.isArray(payload.items) ? payload.items : [];
        nextCursor =
          typeof payload.nextCursor === 'string'
            ? payload.nextCursor
            : null;
        renderAppend(items, false);
        loadMoreBtn.hidden = !nextCursor;
      } catch {
        loadMoreBtn.textContent = 'Повторить';
      } finally {
        loadMoreBtn.disabled = false;
        loadingMore = false;
      }
    }

    loadMoreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (loadMoreBtn.textContent === 'Повторить') {
        loadMoreBtn.textContent = 'Показать ещё';
      }
      appendNext();
    });

    function syncFromQueryParams() {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('category');
      if (selCategory && cat) {
        const opt = Array.from(selCategory.options).some((o) => o.value === cat);
        if (opt) selCategory.value = cat;
      }
      const sortParam = params.get('sort');
      if (
        selSort &&
        sortParam &&
        ['title', 'rating', 'updated'].includes(sortParam)
      ) {
        selSort.value = sortParam;
      }
      const qp = params.get('q');
      if (searchInput && qp !== null) {
        searchInput.value = qp;
      }
      const locationId = (params.get('locationId') || '').trim();
      if (/^\d+$/.test(locationId)) {
        state.locationId = locationId;
      }
    }

    function hideLocationSuggest() {
      if (!whereSuggest) return;
      whereSuggest.hidden = true;
      whereSuggest.innerHTML = '';
      locationSuggestItems = [];
      locationActiveIndex = -1;
    }

    function setLocation(locationId, label) {
      state.locationId = locationId ? String(locationId) : null;
      if (whereInput) whereInput.value = label || '';
      const u = new URL(window.location.href);
      if (state.locationId) {
        u.searchParams.set('locationId', state.locationId);
      } else {
        u.searchParams.delete('locationId');
      }
      history.replaceState(null, '', u.toString());
      reloadFirstPage();
    }

    async function restoreLocationLabel() {
      if (!whereInput || !state.locationId) return;
      try {
        const base = baseEarly.replace(/\/$/, '');
        const resp = await fetch(
          `${base}/v1/locations?id=${encodeURIComponent(state.locationId)}`,
          { cache: 'no-store' }
        );
        if (!resp.ok) return;
        const payload = await resp.json();
        const item = Array.isArray(payload.items) ? payload.items[0] : null;
        if (item && item.label) whereInput.value = item.label;
      } catch {}
    }

    function renderLocationSuggest(items) {
      if (!whereSuggest) return;
      whereSuggest.innerHTML = '';
      if (!Array.isArray(items) || items.length === 0) {
        hideLocationSuggest();
        return;
      }
      locationSuggestItems = items.slice(0, 10);
      locationActiveIndex = -1;
      locationSuggestItems.forEach((item, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'suggest-item';
        row.dataset.idx = String(idx);
        const hint = [item.kind, item.parentLabel, item.regionLabel]
          .filter(Boolean)
          .join(' • ');
        row.innerHTML = `<div class="suggest-title">${esc(item.label || '')}</div><div class="suggest-hint">${esc(hint)}</div>`;
        row.addEventListener('mouseenter', () => {
          locationActiveIndex = idx;
          updateLocationActiveItem();
        });
        row.addEventListener('click', () => {
          hideLocationSuggest();
          setLocation(item.id, item.label || '');
        });
        whereSuggest.appendChild(row);
      });
      whereSuggest.hidden = false;
    }

    function updateLocationActiveItem() {
      if (!whereSuggest) return;
      whereSuggest.querySelectorAll('.suggest-item').forEach((el, idx) => {
        el.classList.toggle('is-active', idx === locationActiveIndex);
      });
      if (locationActiveIndex >= 0) {
        const active = whereSuggest.querySelector(
          `.suggest-item[data-idx="${locationActiveIndex}"]`
        );
        active?.scrollIntoView({ block: 'nearest' });
      }
    }

    async function fetchLocationSuggest() {
      if (!whereInput) return;
      const q = (whereInput.value || '').trim();
      if (q.length < 2) {
        hideLocationSuggest();
        return;
      }
      try {
        const p = new URLSearchParams();
        p.set('q', q);
        p.set('kinds', 'city,settlement,district,region');
        p.set('limit', '10');
        const regionSlug = ((selRegion && selRegion.value) || '').trim();
        if (regionSlug) p.set('regionSlug', regionSlug);
        const base = baseEarly.replace(/\/$/, '');
        const r = await fetch(`${base}/v1/locations?${p.toString()}`, {
          cache: 'no-store',
        });
        if (!r.ok) {
          hideLocationSuggest();
          return;
        }
        const payload = await r.json();
        renderLocationSuggest(payload.items);
      } catch {
        hideLocationSuggest();
      }
    }

    async function tryResolveLocationFromInput() {
      if (!whereInput) return false;
      const q = (whereInput.value || '').trim();
      if (q.length < 2) return false;
      const p = new URLSearchParams();
      p.set('q', q);
      p.set('kinds', 'city,settlement,district,region');
      p.set('limit', '10');
      const regionSlug = ((selRegion && selRegion.value) || '').trim();
      if (regionSlug) p.set('regionSlug', regionSlug);
      const base = baseEarly.replace(/\/$/, '');
      try {
        const r = await fetch(`${base}/v1/locations?${p.toString()}`, {
          cache: 'no-store',
        });
        if (!r.ok) return false;
        const payload = await r.json();
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (!items.length) return false;
        const exact = items.find(
          (it) => String(it.label || '').trim().toLowerCase() === q.toLowerCase()
        );
        const pick = exact || (items.length === 1 ? items[0] : null);
        if (!pick) return false;
        hideLocationSuggest();
        setLocation(pick.id, pick.label || '');
        return true;
      } catch {
        return false;
      }
    }

    syncFromQueryParams();
    if (pageRegion && selRegion) {
      const hasOpt = Array.from(selRegion.options).some(
        (o) => o.value === pageRegion
      );
      if (hasOpt) selRegion.value = pageRegion;
    }
    if (pageCategory && selCategory) {
      const catOpt = Array.from(selCategory.options).some(
        (o) => o.value === pageCategory
      );
      if (catOpt) selCategory.value = pageCategory;
    }

    reloadFirstPage();
    restoreLocationLabel();

    let searchTimer = null;
    const scheduleReload = () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => reloadFirstPage(), 280);
    };

    filterApply?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!state.locationId && whereInput && whereInput.value.trim()) {
        const resolved = await tryResolveLocationFromInput();
        if (resolved) return;
      }
      reloadFirstPage();
    });
    selRegion?.addEventListener('change', () => reloadFirstPage());
    selCategory?.addEventListener('change', () => reloadFirstPage());
    selRating?.addEventListener('change', () => reloadFirstPage());
    selSort?.addEventListener('change', () => reloadFirstPage());
    searchInput?.addEventListener('input', scheduleReload);
    searchInput?.addEventListener('change', () => reloadFirstPage());
    whereInput?.addEventListener('input', () => {
      if (!whereInput) return;
      const v = (whereInput.value || '').trim();
      if (state.locationId && v === '') {
        setLocation(null, '');
        return;
      }
      window.clearTimeout(locationSuggestTimer);
      locationSuggestTimer = window.setTimeout(fetchLocationSuggest, 250);
    });
    whereInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        hideLocationSuggest();
        return;
      }
      if (e.key === 'ArrowDown') {
        if (locationSuggestItems.length === 0) return;
        e.preventDefault();
        locationActiveIndex =
          locationActiveIndex < locationSuggestItems.length - 1
            ? locationActiveIndex + 1
            : 0;
        updateLocationActiveItem();
        return;
      }
      if (e.key === 'ArrowUp') {
        if (locationSuggestItems.length === 0) return;
        e.preventDefault();
        locationActiveIndex =
          locationActiveIndex > 0
            ? locationActiveIndex - 1
            : locationSuggestItems.length - 1;
        updateLocationActiveItem();
        return;
      }
      if (e.key === 'Enter' && locationActiveIndex >= 0) {
        e.preventDefault();
        const item = locationSuggestItems[locationActiveIndex];
        if (!item) return;
        hideLocationSuggest();
        setLocation(item.id, item.label || '');
        return;
      }
      if (e.key === 'Enter' && locationActiveIndex < 0) {
        if (!state.locationId && whereInput && whereInput.value.trim()) {
          e.preventDefault();
          const resolved = await tryResolveLocationFromInput();
          if (!resolved) reloadFirstPage();
        }
        return;
      }
      if (e.key === 'Tab' && locationActiveIndex >= 0) {
        const item = locationSuggestItems[locationActiveIndex];
        if (!item) return;
        e.preventDefault();
        hideLocationSuggest();
        setLocation(item.id, item.label || '');
        const focusables = Array.from(
          document.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => {
          const h = el;
          return !h.hasAttribute('disabled') && !h.getAttribute('aria-hidden');
        });
        const idx = focusables.indexOf(whereInput);
        const next = focusables[idx + 1];
        if (next && typeof next.focus === 'function') next.focus();
      }
    });
    document.addEventListener('click', (e) => {
      if (!whereSuggest || !whereInput) return;
      if (e.target === whereInput || whereSuggest.contains(e.target)) return;
      hideLocationSuggest();
    });
  }

  /* Toast helper */
  function showToast(msg) {
    let toast = document.querySelector('.toast-msg');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast-msg';
      toast.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);background:#1E2B3A;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;z-index:300;opacity:0;transition:opacity .3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }

  /* Smooth scroll for anchor links */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const el = document.querySelector(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* Current nav highlight by URL (корень и /slug/ без .html) */
  function normalizePathname(pathname) {
    let p = pathname || '/';
    if (p.endsWith('/index.html')) {
      p = p.slice(0, -'/index.html'.length) || '/';
    }
    if (p !== '/' && p.endsWith('/')) p = p.replace(/\/+$/, '');
    return p || '/';
  }
  const current = normalizePathname(location.pathname);
  document.querySelectorAll('.nav-desktop a, .mobile-panel a').forEach((link) => {
    const raw = link.getAttribute('href');
    if (!raw || raw.startsWith('#')) return;
    let linkPath;
    try {
      linkPath = normalizePathname(new URL(raw, location.href).pathname);
    } catch {
      return;
    }
    if (linkPath === current) {
      link.classList.add('active');
    }
  });

  async function initKatalogAuthHeader() {
    const base = getKatalogApiBase();
    const out = document.querySelectorAll('[data-auth-when="logged-out"]');
    const inn = document.querySelectorAll('[data-auth-when="logged-in"]');
    const emailEl = document.querySelector('[data-auth-email]');
    if (!base || (out.length === 0 && inn.length === 0)) return;
    try {
      const r = await fetch(`${base}/v1/auth/me`, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) throw new Error('out');
      const j = await r.json();
      if (!j.user) throw new Error('out');
      const u = j.user;
      const short = u.displayName || (u.email ? String(u.email).split('@')[0] : '') || 'Аккаунт';
      out.forEach((el) => {
        el.setAttribute('hidden', '');
      });
      inn.forEach((el) => {
        el.removeAttribute('hidden');
      });
      if (emailEl instanceof HTMLElement) {
        emailEl.textContent = short;
        emailEl.setAttribute('title', u.email || '');
      }
    } catch {
      inn.forEach((el) => {
        el.setAttribute('hidden', '');
      });
      out.forEach((el) => {
        el.removeAttribute('hidden');
      });
    }
  }

  initKatalogAuthHeader();
});
