document.addEventListener('DOMContentLoaded', () => {
  const orgCardTextCache = new Map();
  const escHtml = (value) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const withBreaks = (value) => escHtml(value).replace(/\n/g, '<br>');

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

  /* Portfolio: desktop = 1 квадрат + 3 мини; mobile = квадратный слайдер */
  document.querySelectorAll('[data-portfolio]').forEach((root) => {
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
      let t = raw?.trim() || '';
      /* Страницы в подпапках: относительный images/… иначе указывает на slug/images/… */
      if (t.startsWith('images/')) t = `/${t}`;
      return t;
    };

    const applyPortfolioBg = (el, url) => {
      if (!(el instanceof HTMLElement)) return;
      if (url) {
        const esc = encodeURI(url.trim());
        el.classList.add('portfolio-pixel--photo');
        /* !important — иначе шортхэнд `background:` и hover-кнопки перебивают фото в части браузеров */
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
      for (let i = 0; i < n; i += 1) {
        if (i === idx) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
          'org-showcase-card org-showcase-card--mini portfolio-pixel portfolio-pixel-mini';
        b.dataset.slideTarget = String(i);
        b.setAttribute('aria-label', captions[i] || `Фото ${i + 1}`);
        /* Вся карточка — одна большая цель для клика (без обёртки-div) */
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
      /* На мобилке лента скрыта CSS — не вызывать scrollIntoView по скрытому ряду */
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
        if (best !== idx) {
          idx = best;
          syncHero();
          rebuildDesktopRail();
          mobSlides.forEach((el, i) => el.classList.toggle('is-current', i === idx));
          if (mobIndicator) mobIndicator.textContent = `${idx + 1}/${n}`;
        }
      }, 96);
    }, { passive: true });

    /* При загрузке не дергать scrollIntoView — иначе «прыжок» и лишнее пустое место в потоке */
    setIdx(0, { scrollMob: false });
  });

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

  async function loadOrgCardText(orgUrl) {
    if (!orgUrl) return null;
    if (orgCardTextCache.has(orgUrl)) return orgCardTextCache.get(orgUrl);
    try {
      const res = await fetch(orgUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('org_fetch');
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const article = doc.querySelector('.org-article');
      if (!article) {
        orgCardTextCache.set(orgUrl, null);
        return null;
      }
      const firstBlock = article.querySelector('.content-block');
      const firstBlockParagraphs = firstBlock
        ? Array.from(firstBlock.querySelectorAll('p'))
            .map((p) => (p.textContent || '').trim())
            .filter(Boolean)
        : [];
      if (firstBlockParagraphs.length === 0) {
        orgCardTextCache.set(orgUrl, null);
        return null;
      }
      const contactRows = Array.from(doc.querySelectorAll('.org-showcase-aside .sidebar-card .sidebar-row'))
        .map((row) => (row.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 4);

      const firstText = contactRows.join('\n');
      const secondText = firstBlockParagraphs.join('\n\n');
      const payload = { firstText, secondText };
      orgCardTextCache.set(orgUrl, payload);
      return payload;
    } catch {
      orgCardTextCache.set(orgUrl, null);
      return null;
    }
  }

  async function hydrateCatalogCardsFromOrgPages(root = document) {
    const cards = Array.from(root.querySelectorAll('.catalog-card-wide[data-org-url]'));
    for (const card of cards) {
      const url = card.getAttribute('data-org-url') || '';
      if (!url) continue;
      const txt = await loadOrgCardText(url);
      if (!txt) continue;
      const intro = card.querySelector('.catalog-card-text-main');
      const about = card.querySelector('.catalog-card-about');
      if (intro && txt.firstText) {
        intro.innerHTML = withBreaks(txt.firstText);
      }
      if (about && txt.secondText) {
        about.innerHTML = `<strong>О компании:</strong> ${withBreaks(txt.secondText)}`;
      }
    }
  }

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
    const section = document.querySelector('[data-catalog-section]');
    const host = document.getElementById('catalog-cards-host');
    const filterApply = document.querySelector('[data-filter-apply]');
    const selRegion = document.getElementById('filter-region');
    const selCategory = document.getElementById('filter-category');
    const selRating = document.getElementById('filter-rating');
    const searchInput = document.getElementById('filter-search');
    if (!section || !host) return;

    const pageRegion = (section.getAttribute('data-page-region') || '').trim();

    const EMPTY_BLOCK = `<div class="catalog-empty" role="status">
          <p class="catalog-empty-title">Ничего не найдено</p>
          <p class="catalog-empty-text">Попробуйте другой регион, категорию или запрос. <a href="/regions/">Все субъекты РФ</a>.</p>
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
      return slides.map((line) => `              ${line}`).join('\n');
    }

    function cardHtml(item) {
      const rating = typeof item.rating === 'number' ? item.rating.toFixed(1) : esc(item.rating);
      const href = esc(item.url || '#');
      const rs = esc(item.regionSlug || '');
      const cs = esc(item.categorySlug || '');
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
              <p class="catalog-card-text catalog-card-text-main">${esc(item.subtitle || '')}</p>
              <p class="catalog-card-text catalog-card-about"><strong>О компании:</strong> ${esc(item.text || '')}</p>
              <div class="catalog-card-footer">
                <span class="tag tag-accent">★ ${rating} · ${reviewsLabelRu(item.reviews)}</span>
                <a href="${href}" class="btn btn-sm btn-primary">Подробнее →</a>
              </div>
            </div>
          </div>
        </article>`;
    }

    const initAutoSliders = initCatalogStaticSliders;

    function renderCards(items) {
      if (items.length === 0) {
        host.innerHTML = EMPTY_BLOCK;
        return;
      }
      host.innerHTML = items.map(cardHtml).join('\n');
      initAutoSliders();
    }

    function applyLocalFilters(catalog) {
      let items = catalog.slice();
      const regSel = (selRegion?.value || '').trim();
      if (regSel) {
        items = items.filter((i) => i.regionSlug === regSel);
      } else if (pageRegion) {
        items = items.filter((i) => i.regionSlug === pageRegion);
      }
      const cat = selCategory?.value || '';
      if (cat) items = items.filter((i) => i.categorySlug === cat);
      const minR = parseFloat(selRating?.value || '');
      if (!Number.isNaN(minR) && minR > 0) {
        items = items.filter((i) => (Number(i.rating) || 0) >= minR);
      }
      const q = (searchInput?.value || '').trim().toLowerCase();
      if (q) {
        items = items.filter((i) => {
          const blob = [i.title, i.subtitle, i.text, i.categoryLabel, i.regionLabel]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return blob.includes(q);
        });
      }
      renderCards(items);
    }

    function syncFromQueryParams() {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('category');
      if (selCategory && cat) {
        const opt = Array.from(selCategory.options).some((o) => o.value === cat);
        if (opt) selCategory.value = cat;
      }
    }

    function bindAndRun(catalog) {
      if (!Array.isArray(catalog)) return;
      syncFromQueryParams();
      if (pageRegion && selRegion) {
        const hasOpt = Array.from(selRegion.options).some((o) => o.value === pageRegion);
        if (hasOpt) selRegion.value = pageRegion;
      }

      let searchTimer = null;
      const scheduleSearch = () => {
        if (searchTimer) window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => applyLocalFilters(catalog), 220);
      };

      filterApply?.addEventListener('click', (e) => {
        e.preventDefault();
        applyLocalFilters(catalog);
      });

      selRegion?.addEventListener('change', () => applyLocalFilters(catalog));
      selCategory?.addEventListener('change', () => applyLocalFilters(catalog));
      selRating?.addEventListener('change', () => applyLocalFilters(catalog));
      searchInput?.addEventListener('input', scheduleSearch);
      searchInput?.addEventListener('change', () => applyLocalFilters(catalog));

      applyLocalFilters(catalog);
    }

    function domOnlyFilter() {
      const cards = host.querySelectorAll('.card');
      if (cards.length === 0) return;
      const regSel = (selRegion?.value || '').trim();
      const cat = selCategory?.value || '';
      const minR = parseFloat(selRating?.value || '');
      const q = (searchInput?.value || '').trim().toLowerCase();
      let visible = 0;
      cards.forEach((card) => {
        const rs = (card.getAttribute('data-region-slug') || '').trim();
        const cs = (card.getAttribute('data-category-slug') || '').trim();
        const ratingEl = card.querySelector('.tag-accent');
        const textBlob = card.textContent.toLowerCase();
        let ok = true;
        if (rs) {
          if (regSel && rs !== regSel) ok = false;
          else if (!regSel && pageRegion && rs !== pageRegion) ok = false;
        }
        if (ok && cat && cs && cs !== cat) ok = false;
        if (ok && !Number.isNaN(minR) && minR > 0) {
          const m = (ratingEl?.textContent || '').match(/★\s*([\d.,]+)/);
          const val = m ? parseFloat(m[1].replace(',', '.')) : 0;
          if (val < minR) ok = false;
        }
        if (ok && q && !textBlob.includes(q)) ok = false;
        card.hidden = !ok;
        if (ok) visible += 1;
      });
      host.querySelector('.catalog-empty--dom')?.remove();
      if (visible === 0) {
        const empty = document.createElement('div');
        empty.className = 'catalog-empty catalog-empty--dom';
        empty.setAttribute('role', 'status');
        empty.innerHTML =
          '<p class="catalog-empty-title">Ничего не найдено</p><p class="catalog-empty-text">Проверьте фильтры. Если список не обновляется, обновите страницу — возможно, не загрузился файл каталога.</p>';
        host.appendChild(empty);
      }
    }

    const catalogUrlStatic = '/data/catalog.json';
    const catalogPromise = fetch(catalogUrlStatic, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error('catalog');
      return r.json();
    });

    catalogPromise
      .then((catalog) => bindAndRun(catalog))
      .catch(() => {
        if (!host.querySelector('.card')) return;
        filterApply?.addEventListener('click', (e) => {
          e.preventDefault();
          domOnlyFilter();
        });
        selRegion?.addEventListener('change', domOnlyFilter);
        selCategory?.addEventListener('change', domOnlyFilter);
        selRating?.addEventListener('change', domOnlyFilter);
        searchInput?.addEventListener('input', () => {
          window.clearTimeout(domOnlyFilter._t);
          domOnlyFilter._t = window.setTimeout(domOnlyFilter, 220);
        });
        domOnlyFilter();
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

  function katalogApiBase() {
    return (
      document
        .querySelector('meta[name="katalog-catalog-api"]')
        ?.getAttribute('content')
        ?.trim()
        .replace(/\/$/, '') || ''
    );
  }

  async function initKatalogAuthHeader() {
    const base = katalogApiBase();
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
