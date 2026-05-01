document.addEventListener('DOMContentLoaded', () => {
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
    const stopHrefs = new Set(['analytics.html', 'contacts.html', 'moderation.html', 'blog.html', 'add-company.html']);
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

    mobStrip.innerHTML = '';
    const mobSlides = meta.map((_btn, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'portfolio-pixel portfolio-pixel-slide';
      b.dataset.slideIndex = String(i);
      b.setAttribute('aria-label', captions[i]);
      b.addEventListener('click', () => setIdx(i, { scrollMob: true }));
      mobStrip.appendChild(b);
      return b;
    });

    let idx = 0;
    let suppressScrollEmit = false;
    let scrollTimer = null;

    const rebuildDesktopRail = () => {
      deskSide.innerHTML = '';
      for (let i = 0; i < n; i += 1) {
        if (i === idx) continue;
        const wrap = document.createElement('div');
        wrap.className = 'org-showcase-card org-showcase-card--mini';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'portfolio-pixel portfolio-pixel-mini';
        b.dataset.slideTarget = String(i);
        b.setAttribute('aria-label', captions[i]);
        b.addEventListener('click', () => setIdx(i, { scrollMob: true }));
        wrap.appendChild(b);
        deskSide.appendChild(wrap);
      }
    };

    const syncMobScroll = () => {
      const slide = mobSlides[idx];
      if (!slide) return;
      suppressScrollEmit = true;
      slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      window.setTimeout(() => { suppressScrollEmit = false; }, 420);
    };

    const setIdx = (next, opts = {}) => {
      idx = ((next % n) + n) % n;
      rebuildDesktopRail();
      mobSlides.forEach((el, i) => el.classList.toggle('is-current', i === idx));
      if (mobIndicator) mobIndicator.textContent = `${idx + 1}/${n}`;
      if (opts.scrollMob) syncMobScroll();
    };

    mobPrev?.addEventListener('click', () => setIdx(idx - 1, { scrollMob: true }));
    mobNext?.addEventListener('click', () => setIdx(idx + 1, { scrollMob: true }));

    mobStrip.addEventListener('scroll', () => {
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
          rebuildDesktopRail();
          mobSlides.forEach((el, i) => el.classList.toggle('is-current', i === idx));
          if (mobIndicator) mobIndicator.textContent = `${idx + 1}/${n}`;
        }
      }, 96);
    }, { passive: true });

    setIdx(0, { scrollMob: true });
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

  /* Filter bar stub: show toast on apply */
  const filterApply = document.querySelector('[data-filter-apply]');
  if (filterApply) {
    filterApply.addEventListener('click', () => {
      showToast('Фильтр применён (заглушка)');
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

  /* Current nav highlight by URL */
  const currentPath = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-desktop a, .mobile-panel a').forEach(link => {
    const href = link.getAttribute('href');
    if (href && (href === currentPath || (currentPath === '' && href === 'index.html'))) {
      link.classList.add('active');
    }
  });
});
