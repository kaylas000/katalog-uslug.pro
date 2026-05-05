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
    } catch {}
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
    } catch {}
    return { r, body };
  }

  function showMsg(el, text, kind) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
    el.classList.remove("is-error", "is-ok");
    if (kind === "err") el.classList.add("is-error");
    if (kind === "ok") el.classList.add("is-ok");
  }

  function statusLabel(status) {
    if (status === "pending_email") return "Ожидает подтверждения email";
    if (status === "pending_moderation") return "На модерации";
    if (status === "approved") return "Одобрена";
    if (status === "rejected") return "Отклонена";
    if (status === "published") return "Опубликована";
    return status || "Неизвестно";
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const msg = document.getElementById("org-cab-msg");
    const lock = document.getElementById("org-cab-lock");
    const content = document.getElementById("org-cab-content");
    const userSummary = document.getElementById("org-cab-user-summary");
    const apps = document.getElementById("org-cab-apps");
    if (!msg || !lock || !content || !userSummary || !apps) return;

    const me = await jfetch("/v1/auth/me", { method: "GET" });
    if (!me.r.ok || !me.body.user) {
      lock.style.display = "block";
      content.style.display = "none";
      return;
    }

    lock.style.display = "none";
    content.style.display = "block";
    const u = me.body.user;
    userSummary.textContent = `Почта: ${u.email}. Подтверждение: ${
      u.emailVerified || u.phoneVerified ? "есть" : "нет"
    }.`;

    const res = await jfetch("/v1/org/applications/mine", { method: "GET" });
    if (!res.r.ok) {
      showMsg(msg, res.body.message || res.body.error || "Не удалось загрузить заявки.", "err");
      return;
    }
    const items = Array.isArray(res.body.items) ? res.body.items : [];
    apps.innerHTML = "";
    if (!items.length) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-body"><p class="card-text" style="margin-top:0;">У вас пока нет заявок. <a href="/add/" style="text-decoration:underline;">Создать первую заявку</a>.</p></div>';
      apps.appendChild(card);
      return;
    }

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "card";
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString("ru-RU")
        : "—";
      const rejection = item.rejection_reason
        ? `<p class="card-text" style="margin-top:8px;color:#8b1a1a;">Причина отклонения: ${item.rejection_reason}</p>`
        : "";
      card.innerHTML = `
        <div class="card-body">
          <h4 class="card-title" style="font-size:15px;">${item.org_title || "Без названия"}</h4>
          <p class="card-sub">Статус: ${statusLabel(item.status)} · Slug: ${item.org_slug || "—"}</p>
          <p class="card-text">Категория: ${item.category_slug || "—"} · Регион: ${item.region_slug || "—"}</p>
          <p class="card-text">Создано: ${created}</p>
          ${rejection}
        </div>`;
      apps.appendChild(card);
    }
  });
})();
