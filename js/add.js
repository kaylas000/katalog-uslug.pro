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
    if (st && !headers.Authorization) headers.Authorization = `Bearer ${st}`;
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

  document.addEventListener("DOMContentLoaded", async () => {
    const form = document.getElementById("org-apply-form");
    const msg = document.getElementById("org-apply-msg");
    const lock = document.getElementById("org-auth-lock");
    const box = document.getElementById("org-form-box");
    if (!form || !msg || !lock || !box) return;

    const me = await jfetch("/v1/auth/me", { method: "GET" });
    if (!me.r.ok) {
      lock.style.display = "block";
      box.style.display = "none";
      return;
    }
    lock.style.display = "none";
    box.style.display = "block";

    const meta = await jfetch("/v1/org/meta", { method: "GET" });
    if (meta.r.ok) {
      const catEl = document.getElementById("org-category");
      const regEl = document.getElementById("org-region");
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

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showMsg(msg, "", "");
      const payload = {
        orgTitle: document.getElementById("org-title")?.value || "",
        orgSlug: document.getElementById("org-slug")?.value || "",
        categorySlug: document.getElementById("org-category")?.value || "",
        regionSlug: document.getElementById("org-region")?.value || "",
        websiteUrl: document.getElementById("org-site")?.value || "",
        publicDescription: document.getElementById("org-description")?.value || "",
        publicContacts: document.getElementById("org-contacts")?.value || "",
        ownerPhone: document.getElementById("org-owner-phone")?.value || "",
        moderationNote: document.getElementById("org-note")?.value || "",
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
      showMsg(
        msg,
        "Заявка отправлена. Статус можно смотреть в личном кабинете.",
        "ok"
      );
    });
  });
})();
