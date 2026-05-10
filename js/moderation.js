(() => {
  function apiBase() {
    return (
      document
        .querySelector('meta[name="katalog-catalog-api"]')
        ?.getAttribute('content')
        ?.trim()
        .replace(/\/$/, '') || ''
    );
  }

  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error('http'), { status: r.status, body: j });
    return j;
  }

  async function boot() {
    const root = document.getElementById('moderation-app');
    if (!root) return;
    const base = apiBase();
    if (!base) {
      root.innerHTML =
        '<div class="stub-card"><h2>Модерация</h2><p>Не задан API (meta <code>katalog-catalog-api</code>).</p></div>';
      return;
    }

    root.innerHTML = `
      <div class="stub-card">
        <h2>Модерация заявок</h2>
        <p class="section-sub" style="margin-top:8px">Bearer ключ берётся из секрета Worker <code>ADMIN_MODERATION_KEY</code>.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:flex-end">
          <label style="flex:1;min-width:260px">
            <div style="font-size:13px;color:#5b6b7a;margin-bottom:6px">Admin key</div>
            <input id="mod-key" class="input" type="password" placeholder="Bearer …" style="width:100%;padding:10px 12px;border:1px solid #d7dee6;border-radius:10px">
          </label>
          <label style="min-width:220px">
            <div style="font-size:13px;color:#5b6b7a;margin-bottom:6px">Статус</div>
            <select id="mod-status" class="input" style="width:100%;padding:10px 12px;border:1px solid #d7dee6;border-radius:10px">
              <option value="pending_moderation">pending_moderation</option>
              <option value="">все</option>
              <option value="published">published</option>
              <option value="rejected">rejected</option>
            </select>
          </label>
          <button id="mod-refresh" class="btn btn-primary" type="button">Обновить</button>
        </div>
        <div id="mod-out" style="margin-top:16px"></div>
      </div>
    `;

    const keyEl = $('#mod-key');
    const statusEl = $('#mod-status');
    const out = $('#mod-out');
    const refreshBtn = $('#mod-refresh');

    const getKey = () => String(keyEl?.value || '').trim();

    async function refresh() {
      if (!out) return;
      const key = getKey();
      if (!key) {
        out.innerHTML = '<p class="section-sub">Введите admin key.</p>';
        return;
      }
      out.innerHTML = '<p class="section-sub" role="status">Загрузка…</p>';
        const u = new URL(`${base}/v1/admin/applications`);
      const st = String(statusEl?.value || '').trim();
      if (st) u.searchParams.set('status', st);
      try {
        const j = await fetchJson(u.toString(), {
          headers: { Authorization: `Bearer ${key}` },
          cache: 'no-store',
        });
        const items = Array.isArray(j.items) ? j.items : [];
        if (items.length === 0) {
          out.innerHTML = '<p class="section-sub">Ничего нет.</p>';
          return;
        }
        out.innerHTML = items
          .map((it) => {
            const id = esc(it.id);
            const title = esc(it.org_title || it.orgTitle || '');
            const slug = esc(it.org_slug || it.orgSlug || '');
            const cat = esc(it.category_slug || '');
            const reg = esc(it.region_slug || '');
            const status = esc(it.status || '');
            return `
              <div class="card" style="padding:14px 14px;margin-top:10px">
                <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
                  <div>
                    <div style="font-weight:700">${title}</div>
                    <div style="font-size:13px;color:#5b6b7a;margin-top:4px">
                      <code>${slug}</code> · ${cat} · ${reg} · <strong>${status}</strong>
                    </div>
                    <div style="font-size:12px;color:#7b8a98;margin-top:6px"><code>${id}</code></div>
                  </div>
                  <div style="display:flex;gap:10px;align-items:center">
                    <button class="btn btn-sm btn-primary" data-approve="${id}" type="button">Approve</button>
                    <button class="btn btn-sm btn-outline" data-reject="${id}" type="button">Reject</button>
                  </div>
                </div>
              </div>
            `;
          })
          .join('');
      } catch (e) {
        out.innerHTML = `<p class="section-sub">Ошибка загрузки: ${esc(
          e?.body?.error || e?.message || 'request'
        )}</p>`;
      }
    }

    out?.addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const approveId = t.getAttribute('data-approve');
      const rejectId = t.getAttribute('data-reject');
      const key = getKey();
      if (!key) return;
      if (approveId) {
        t.setAttribute('disabled', '');
        try {
          await fetchJson(`${base}/v1/admin/applications/${encodeURIComponent(approveId)}/approve`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
            cache: 'no-store',
          });
          await refresh();
        } catch (err) {
          alert(`Approve failed: ${err?.body?.error || err?.message || 'request'}`);
        } finally {
          t.removeAttribute('disabled');
        }
      }
      if (rejectId) {
        const reason = window.prompt('Причина отклонения (будет видна заявителю):', 'Не хватает данных.');
        if (!reason) return;
        t.setAttribute('disabled', '');
        try {
          await fetchJson(`${base}/v1/admin/applications/${encodeURIComponent(rejectId)}/reject`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reason }),
            cache: 'no-store',
          });
          await refresh();
        } catch (err) {
          alert(`Reject failed: ${err?.body?.error || err?.message || 'request'}`);
        } finally {
          t.removeAttribute('disabled');
        }
      }
    });

    refreshBtn?.addEventListener('click', () => refresh());
    await refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

