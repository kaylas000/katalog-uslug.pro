(function () {
  const SESSION_STORE_KEY = "katalog_catalog_api_session";

  function apiBase() {
    return (
      document
        .querySelector('meta[name="katalog-catalog-api"]')
        ?.getAttribute("content")
        ?.trim()
        .replace(/\/$/, "") || ""
    );
  }

  function storedSessionToken() {
    try {
      const a = sessionStorage.getItem(SESSION_STORE_KEY);
      if (a) return a;
    } catch {
      /* ignore */
    }
    try {
      return localStorage.getItem(SESSION_STORE_KEY) || "";
    } catch {
      return "";
    }
  }

  async function jfetch(path, opts = {}) {
    const base = apiBase();
    if (!base) throw new Error("no_api");
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const st = storedSessionToken();
    const skipAuthHeader = path === "/v1/auth/config";
    if (!skipAuthHeader && st && !headers.Authorization) {
      headers.Authorization = `Bearer ${st}`;
    }
    const r = await fetch(`${base}${path}`, {
      ...opts,
      headers,
      credentials: "include",
    });
    let body = {};
    try {
      body = await r.json();
    } catch {
      body = {};
    }
    return { r, body };
  }

  function showMsg(el, text, kind) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
    el.classList.remove("is-error", "is-ok");
    if (kind === "ok") el.classList.add("is-ok");
    if (kind === "err") el.classList.add("is-error");
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const MAX_PHOTOS = 4;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MIN_WIDTH = 800;
  const MIN_HEIGHT = 600;
  const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("read_failed"));
      fr.readAsDataURL(file);
    });
  }

  function loadImageSize(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      img.onerror = () => reject(new Error("image_decode_failed"));
      img.src = dataUrl;
    });
  }

  function renderPhotoPreview(host, photos) {
    if (!host) return;
    host.innerHTML = "";
    if (!Array.isArray(photos) || photos.length === 0) {
      for (let i = 1; i <= MAX_PHOTOS; i += 1) {
        const slot = document.createElement("div");
        slot.className = "org-photo-item";
        slot.textContent = `Фото ${i}`;
        host.appendChild(slot);
      }
      return;
    }
    for (const p of photos) {
      const slot = document.createElement("div");
      slot.className = "org-photo-item";
      const img = document.createElement("img");
      img.src = p.dataUrl;
      img.alt = p.name || "Фото организации";
      slot.appendChild(img);
      host.appendChild(slot);
    }
    for (let i = photos.length + 1; i <= MAX_PHOTOS; i += 1) {
      const slot = document.createElement("div");
      slot.className = "org-photo-item";
      slot.textContent = `Фото ${i}`;
      host.appendChild(slot);
    }
  }

  function initOrgLocationPicker(base, regionSelect) {
    const whereInput = document.getElementById("org-where");
    const whereSuggest = document.getElementById("org-where-suggest");
    const hiddenId = document.getElementById("org-location-id");
    if (
      !whereInput ||
      !whereSuggest ||
      !hiddenId ||
      !(whereInput instanceof HTMLInputElement) ||
      !(hiddenId instanceof HTMLInputElement)
    ) {
      return;
    }

    let timer = null;
    let items = [];
    let active = -1;

    function hide() {
      whereSuggest.hidden = true;
      whereSuggest.innerHTML = "";
      items = [];
      active = -1;
    }

    function setPick(id, label) {
      hiddenId.value = id ? String(id) : "";
      whereInput.value = label || "";
      hide();
    }

    function render(rows) {
      whereSuggest.innerHTML = "";
      if (!Array.isArray(rows) || !rows.length) {
        hide();
        return;
      }
      items = rows.slice(0, 10);
      active = -1;
      items.forEach((item, idx) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "suggest-item";
        row.dataset.idx = String(idx);
        const hint = [item.kind, item.parentLabel, item.regionLabel]
          .filter(Boolean)
          .join(" • ");
        row.innerHTML = `<div class="suggest-title">${esc(item.label || "")}</div><div class="suggest-hint">${esc(hint)}</div>`;
        row.addEventListener("mouseenter", () => {
          active = idx;
          updateActive();
        });
        row.addEventListener("click", () => setPick(item.id, item.label || ""));
        whereSuggest.appendChild(row);
      });
      whereSuggest.hidden = false;
    }

    function updateActive() {
      whereSuggest.querySelectorAll(".suggest-item").forEach((el, idx) => {
        el.classList.toggle("is-active", idx === active);
      });
      if (active >= 0) {
        whereSuggest.querySelector(`.suggest-item[data-idx="${active}"]`)?.scrollIntoView({
          block: "nearest",
        });
      }
    }

    async function fetchSuggest() {
      const q = (whereInput.value || "").trim();
      if (q.length < 2) {
        hide();
        return;
      }
      const p = new URLSearchParams();
      p.set("q", q);
      p.set("kinds", "city,settlement,district,region");
      p.set("limit", "10");
      const regionSlug = ((regionSelect && regionSelect.value) || "").trim();
      if (regionSlug) p.set("regionSlug", regionSlug);
      try {
        const r = await fetch(`${base.replace(/\/$/, "")}/v1/locations?${p.toString()}`, {
          cache: "no-store",
        });
        if (!r.ok) {
          hide();
          return;
        }
        const payload = await r.json();
        render(Array.isArray(payload.items) ? payload.items : []);
      } catch {
        hide();
      }
    }

    async function tryResolveExact() {
      const q = (whereInput.value || "").trim();
      if (q.length < 2) return false;
      const p = new URLSearchParams();
      p.set("q", q);
      p.set("kinds", "city,settlement,district,region");
      p.set("limit", "10");
      const regionSlug = ((regionSelect && regionSelect.value) || "").trim();
      if (regionSlug) p.set("regionSlug", regionSlug);
      try {
        const r = await fetch(`${base.replace(/\/$/, "")}/v1/locations?${p.toString()}`, {
          cache: "no-store",
        });
        if (!r.ok) return false;
        const payload = await r.json();
        const arr = Array.isArray(payload.items) ? payload.items : [];
        if (!arr.length) return false;
        const exact = arr.find(
          (it) => String(it.label || "").trim().toLowerCase() === q.toLowerCase()
        );
        const pick = exact || (arr.length === 1 ? arr[0] : null);
        if (!pick) return false;
        setPick(pick.id, pick.label || "");
        return true;
      } catch {
        return false;
      }
    }

    whereInput.addEventListener("input", () => {
      hiddenId.value = "";
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(fetchSuggest, 220);
    });

    whereInput.addEventListener("keydown", (ev) => {
      if (!whereSuggest.hidden && items.length) {
        if (ev.key === "ArrowDown") {
          ev.preventDefault();
          active = Math.min(items.length - 1, active + 1);
          updateActive();
          return;
        }
        if (ev.key === "ArrowUp") {
          ev.preventDefault();
          active = Math.max(0, active - 1);
          updateActive();
          return;
        }
        if (ev.key === "Enter" && active >= 0) {
          ev.preventDefault();
          const it = items[active];
          if (it) setPick(it.id, it.label || "");
          return;
        }
        if (ev.key === "Escape") {
          hide();
          return;
        }
        if (ev.key === "Tab" && active >= 0) {
          const it = items[active];
          if (it) setPick(it.id, it.label || "");
        }
      }
    });

    document.addEventListener("click", (ev) => {
      if (!whereSuggest.contains(ev.target) && ev.target !== whereInput) hide();
    });

    regionSelect?.addEventListener("change", () => {
      hiddenId.value = "";
    });

    return { tryResolveExact, hide };
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const form = document.getElementById("org-apply-form");
    const msg = document.getElementById("org-apply-msg");
    const lock = document.getElementById("org-auth-lock");
    const lockActions = document.getElementById("org-auth-actions");
    const verifyLock = document.getElementById("org-verify-lock");
    const verifyActions = document.getElementById("org-verify-actions");
    const btnAuthYandex = document.getElementById("org-auth-yandex");
    const btnVerifyYandex = document.getElementById("org-verify-yandex");
    const box = document.getElementById("org-form-box");
    if (!form || !msg || !lock || !box) return;

    let yandexAuthorizeUrl = "";
    try {
      const cfg = await jfetch("/v1/auth/config", { method: "GET" });
      yandexAuthorizeUrl =
        cfg.r.ok && cfg.body && cfg.body.yandexAuthorizeUrl
          ? cfg.body.yandexAuthorizeUrl
          : "";
    } catch {
      yandexAuthorizeUrl = "";
    }
    if (yandexAuthorizeUrl) {
      if (btnAuthYandex) {
        btnAuthYandex.style.display = "inline-flex";
        btnAuthYandex.addEventListener("click", () => {
          window.location.href = `${yandexAuthorizeUrl}?next=${encodeURIComponent(
            "/add/"
          )}`;
        });
      }
      if (btnVerifyYandex) {
        btnVerifyYandex.style.display = "inline-flex";
        btnVerifyYandex.addEventListener("click", () => {
          window.location.href = `${yandexAuthorizeUrl}?next=${encodeURIComponent(
            "/add/"
          )}`;
        });
      }
    }

    const me = await jfetch("/v1/auth/me", { method: "GET" });
    if (!me.r.ok) {
      lock.style.display = "block";
      if (lockActions) lockActions.style.display = "flex";
      if (verifyLock) verifyLock.style.display = "none";
      if (verifyActions) verifyActions.style.display = "none";
      box.style.display = "none";
      return;
    }

    const user = me.body?.user || {};
    const isVerified = Boolean(user.emailVerified || user.phoneVerified);
    if (!isVerified) {
      lock.style.display = "none";
      if (lockActions) lockActions.style.display = "none";
      if (verifyLock) verifyLock.style.display = "block";
      if (verifyActions) verifyActions.style.display = "flex";
      box.style.display = "block";
    } else {
      lock.style.display = "none";
      if (lockActions) lockActions.style.display = "none";
      if (verifyLock) verifyLock.style.display = "none";
      if (verifyActions) verifyActions.style.display = "none";
      box.style.display = "block";
    }

    const base = apiBase();
    const photosInput = document.getElementById("org-photos");
    const photosPreview = document.getElementById("org-photo-preview");
    let selectedPhotos = [];
    renderPhotoPreview(photosPreview, selectedPhotos);

    if (photosInput instanceof HTMLInputElement) {
      photosInput.addEventListener("change", async () => {
        showMsg(msg, "", "");
        const list = Array.from(photosInput.files || []);
        if (list.length > MAX_PHOTOS) {
          photosInput.value = "";
          selectedPhotos = [];
          renderPhotoPreview(photosPreview, selectedPhotos);
          showMsg(msg, `Можно загрузить максимум ${MAX_PHOTOS} фотографии.`, "err");
          return;
        }
        const next = [];
        try {
          for (const file of list) {
            if (!ALLOWED_MIME.has(file.type)) {
              throw new Error(
                `Файл «${file.name}» в неподдерживаемом формате. Разрешены JPG/PNG/WEBP.`
              );
            }
            if (file.size > MAX_FILE_BYTES) {
              throw new Error(`Файл «${file.name}» больше 8 МБ.`);
            }
            const dataUrl = await readAsDataUrl(file);
            const size = await loadImageSize(dataUrl);
            if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
              throw new Error(
                `Файл «${file.name}» слишком маленький: минимум ${MIN_WIDTH}x${MIN_HEIGHT}px.`
              );
            }
            next.push({
              name: file.name,
              contentType: file.type,
              dataUrl,
              width: size.width,
              height: size.height,
            });
          }
          selectedPhotos = next;
          renderPhotoPreview(photosPreview, selectedPhotos);
        } catch (e) {
          photosInput.value = "";
          selectedPhotos = [];
          renderPhotoPreview(photosPreview, selectedPhotos);
          const message = e instanceof Error ? e.message : "Не удалось обработать фотографии.";
          showMsg(msg, message, "err");
        }
      });
    }
    const meta = await jfetch("/v1/org/meta", { method: "GET" });
    let regEl = null;
    if (meta.r.ok) {
      const catEl = document.getElementById("org-category");
      regEl = document.getElementById("org-region");
      if (catEl && Array.isArray(meta.body.categories)) {
        catEl.innerHTML = '<option value="">Выберите категорию</option>';
        for (const c of meta.body.categories) {
          const opt = document.createElement("option");
          opt.value = c.slug;
          opt.textContent = c.label;
          catEl.appendChild(opt);
        }
      }
      if (regEl && Array.isArray(meta.body.regions)) {
        regEl.innerHTML = '<option value="">Выберите регион</option>';
        for (const r of meta.body.regions) {
          const opt = document.createElement("option");
          opt.value = r.slug;
          opt.textContent = r.label;
          regEl.appendChild(opt);
        }
      }
    }

    const locPicker = base ? initOrgLocationPicker(base, regEl) : null;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showMsg(msg, "", "");
      if (locPicker) await locPicker.tryResolveExact();
      const locationId = (document.getElementById("org-location-id")?.value || "").trim();
      if (!locationId) {
        showMsg(
          msg,
          "Выберите населённый пункт из подсказок или введите точное название.",
          "err"
        );
        return;
      }
      const consent = document.getElementById("org-consent");
      if (consent && consent instanceof HTMLInputElement && !consent.checked) {
        showMsg(msg, "Нужно согласие на обработку данных и публикацию контактов.", "err");
        return;
      }
      const addrPubEl = document.getElementById("org-address-public");
      const addressIsPublic =
        addrPubEl instanceof HTMLInputElement ? addrPubEl.checked : true;
      const payload = {
        orgTitle: document.getElementById("org-title")?.value || "",
        orgSlug: document.getElementById("org-slug")?.value || "",
        categorySlug: document.getElementById("org-category")?.value || "",
        regionSlug: document.getElementById("org-region")?.value || "",
        locationId,
        websiteUrl: document.getElementById("org-site")?.value || "",
        publicDescription: document.getElementById("org-description")?.value || "",
        publicContacts: document.getElementById("org-contacts")?.value || "",
        addressText: document.getElementById("org-address")?.value || "",
        addressIsPublic,
        legalForm: document.getElementById("org-legal-form")?.value || "",
        inn: document.getElementById("org-inn")?.value || "",
        ogrn: document.getElementById("org-ogrn")?.value || "",
        legalAddress: document.getElementById("org-legal-address")?.value || "",
        contactPersonName: document.getElementById("org-contact-person")?.value || "",
        ownerPhone: document.getElementById("org-owner-phone")?.value || "",
        moderationNote: document.getElementById("org-note")?.value || "",
        portfolioImages: selectedPhotos.map((p) => ({
          name: p.name,
          contentType: p.contentType,
          dataUrl: p.dataUrl,
          width: p.width,
          height: p.height,
        })),
        consentProcessing: true,
      };
      const { r, body } = await jfetch("/v1/org/applications", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        showMsg(msg, body.message || body.error || "Не удалось отправить заявку.", "err");
        return;
      }
      form.reset();
      selectedPhotos = [];
      renderPhotoPreview(photosPreview, selectedPhotos);
      if (document.getElementById("org-location-id") instanceof HTMLInputElement) {
        document.getElementById("org-location-id").value = "";
      }
      showMsg(
        msg,
        "Заявка отправлена. Статус можно смотреть в личном кабинете.",
        "ok"
      );
    });
  });
})();
