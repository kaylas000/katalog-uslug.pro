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
    const { credentials: credentialsOpt, ...rest } = opts;
    const headers = { ...(rest.headers || {}) };
    if (rest.body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const st = storedSessionToken();
    const skipAuthHeader = path === "/v1/auth/config";
    if (!skipAuthHeader && st && !headers.Authorization) {
      headers.Authorization = `Bearer ${st}`;
    }
    /** `omit`: без куки — не нужен заголовок `Access-Control-Allow-Credentials` (старый воркер / кэш CORS). */
    const credentials = credentialsOpt === "omit" ? "omit" : "include";
    const r = await fetch(`${base}${path}`, {
      ...rest,
      headers,
      credentials,
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
  /** Не ниже типичного превью в каталоге; 800×600 — ориентир, не жёсткий порог. */
  const MIN_WIDTH = 600;
  const MIN_HEIGHT = 450;
  const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

  /** Браузеры и ОС часто отдают пустой `file.type` или `image/jpg` — проверяем по имени файла. */
  function normalizeImageMime(file) {
    let t = String(file.type || "")
      .trim()
      .toLowerCase();
    if (t === "image/jpg" || t === "image/pjpeg") t = "image/jpeg";
    if (ALLOWED_MIME.has(t)) return t;
    const n = (file.name || "").toLowerCase();
    if (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".jpe") || n.endsWith(".jfif")) {
      return "image/jpeg";
    }
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".webp")) return "image/webp";
    return "";
  }

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

  function initOrgLocationPicker(base) {
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

    return { tryResolveExact, hide };
  }

  /** Только категории; регион определяется по выбранной локации на сервере. */
  async function loadOrgCategoryList() {
    let categories = null;
    try {
      const meta = await jfetch("/v1/org/meta", {
        method: "GET",
        credentials: "omit",
      });
      if (meta.r.ok && meta.body && typeof meta.body === "object") {
        categories = meta.body.categories;
      }
    } catch {
      /* fallback */
    }
    if (!Array.isArray(categories)) {
      try {
        const c = await jfetch("/v1/categories", {
          method: "GET",
          credentials: "omit",
        });
        if (c.r.ok && Array.isArray(c.body)) categories = c.body;
      } catch {
        /* ignore */
      }
    }
    return Array.isArray(categories) ? categories : [];
  }

  function bindCategoryNew(catEl, catNewWrap, catNewInput) {
    if (!(catEl instanceof HTMLSelectElement)) return;
    if (catEl.dataset.katalogCatNewBind === "1") return;
    catEl.dataset.katalogCatNewBind = "1";
    catEl.addEventListener("change", () => {
      const isNew = catEl.value === "__new__";
      if (catNewWrap) catNewWrap.style.display = isNew ? "" : "none";
      if (catNewInput instanceof HTMLInputElement) {
        catNewInput.required = isNew;
        if (!isNew) catNewInput.value = "";
      }
    });
  }

  function applyOrgCategories(categories) {
    const catEl = document.getElementById("org-category");
    const catNewWrap = document.getElementById("org-category-new-wrap");
    const catNewInput = document.getElementById("org-category-new");
    if (!(catEl instanceof HTMLSelectElement)) return;
    catEl.innerHTML = '<option value="">Выберите категорию</option>';
    for (const c of categories) {
      if (!c || typeof c.slug !== "string") continue;
      const opt = document.createElement("option");
      opt.value = c.slug;
      opt.textContent = c.label != null ? String(c.label) : c.slug;
      catEl.appendChild(opt);
    }
    const createOpt = document.createElement("option");
    createOpt.value = "__new__";
    createOpt.textContent = "Другая категория (создать новую)";
    catEl.appendChild(createOpt);
    bindCategoryNew(catEl, catNewWrap, catNewInput);
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

    let me;
    try {
      me = await jfetch("/v1/auth/me", { method: "GET" });
    } catch {
      showMsg(
        msg,
        "Не удалось связаться с сервером. Проверьте интернет или обновите страницу через минуту.",
        "err"
      );
      lock.style.display = "block";
      if (lockActions) lockActions.style.display = "flex";
      box.style.display = "none";
      return;
    }
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
    const photosMsg = document.getElementById("org-photo-msg");
    let selectedPhotos = [];
    renderPhotoPreview(photosPreview, selectedPhotos);

    if (photosInput instanceof HTMLInputElement) {
      photosInput.addEventListener("change", async () => {
        showMsg(msg, "", "");
        showMsg(photosMsg, "", "");
        const list = Array.from(photosInput.files || []);
        if (list.length > MAX_PHOTOS) {
          photosInput.value = "";
          selectedPhotos = [];
          renderPhotoPreview(photosPreview, selectedPhotos);
          const text = `Можно загрузить максимум ${MAX_PHOTOS} фотографии.`;
          showMsg(photosMsg, text, "err");
          try {
            photosMsg?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch {
            /* ignore */
          }
          return;
        }
        const next = [];
        try {
          for (const file of list) {
            const mime = normalizeImageMime(file);
            if (!mime) {
              throw new Error(
                `Файл «${file.name}» — не JPG, PNG или WEBP (если это фото, сохраните как JPEG и попробуйте снова).`
              );
            }
            if (file.size > MAX_FILE_BYTES) {
              throw new Error(`Файл «${file.name}» больше 8 МБ.`);
            }
            const dataUrl = await readAsDataUrl(file);
            const size = await loadImageSize(dataUrl);
            if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
              throw new Error(
                `Файл «${file.name}» слишком маленький: минимум ${MIN_WIDTH}×${MIN_HEIGHT} px (у вас ${size.width}×${size.height}).`
              );
            }
            next.push({
              name: file.name,
              contentType: mime,
              dataUrl,
              width: size.width,
              height: size.height,
            });
          }
          selectedPhotos = next;
          renderPhotoPreview(photosPreview, selectedPhotos);
          try {
            photosPreview?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch {
            /* ignore */
          }
        } catch (e) {
          photosInput.value = "";
          selectedPhotos = [];
          renderPhotoPreview(photosPreview, selectedPhotos);
          const message = e instanceof Error ? e.message : "Не удалось обработать фотографии.";
          showMsg(photosMsg, message, "err");
          try {
            photosMsg?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch {
            /* ignore */
          }
        }
      });
    }

    const locPicker = base ? initOrgLocationPicker(base) : null;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showMsg(msg, "", "");
      showMsg(photosMsg, "", "");
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
      const pubPhone = (document.getElementById("org-contact-phone")?.value || "").trim();
      const pubEmail = (document.getElementById("org-contact-email")?.value || "").trim();
      if (!pubPhone && !pubEmail) {
        showMsg(msg, "Укажите публичный телефон и/или email.", "err");
        return;
      }
      const addressText = (
        document.getElementById("org-address") instanceof HTMLInputElement
          ? document.getElementById("org-address").value
          : ""
      ).trim();
      if (!addressText || addressText.length > 500) {
        showMsg(msg, "Укажите фактический адрес (до 500 символов).", "err");
        return;
      }
      const publicContacts = [pubPhone, pubEmail].filter(Boolean).join("\n");
      const payload = {
        orgTitle: document.getElementById("org-title")?.value || "",
        categorySlug: document.getElementById("org-category")?.value || "",
        categoryNewLabel: document.getElementById("org-category-new")?.value || "",
        locationId,
        websiteUrl: document.getElementById("org-site")?.value || "",
        publicDescription: document.getElementById("org-description")?.value || "",
        publicContacts,
        addressText,
        addressIsPublic: true,
        legalForm: document.getElementById("org-legal-form")?.value || "",
        inn: document.getElementById("org-inn")?.value || "",
        ogrn: "",
        legalAddress: "",
        contactPersonName: document.getElementById("org-contact-person")?.value || "",
        ownerPhone: "",
        moderationNote: "",
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

    try {
      const cats = await loadOrgCategoryList();
      applyOrgCategories(cats);
      if (!cats.length) {
        showMsg(
          msg,
          "Не удалось загрузить категории — обновите страницу или проверьте доступ к API.",
          "err"
        );
      }
    } catch {
      applyOrgCategories([]);
      showMsg(msg, "Категории не загрузились. Обновите страницу.", "err");
    }
  });
})();
