(function () {
  function apiBase() {
    return (
      document
        .querySelector('meta[name="katalog-catalog-api"]')
        ?.getAttribute('content')
        ?.trim()
        .replace(/\/$/, '') || ''
    );
  }

  function showMsg(el, text, kind) {
    if (!el) return;
    el.style.display = text ? 'block' : 'none';
    el.textContent = text || '';
    el.classList.remove('is-error', 'is-ok');
    if (kind === 'ok') el.classList.add('is-ok');
    if (kind === 'err') el.classList.add('is-error');
  }

  async function jfetch(path, opts = {}) {
    const base = apiBase();
    if (!base) throw new Error('no_api');
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(`${base}${path}`, {
      credentials: 'include',
      ...opts,
      headers,
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
      body = {};
    }
    return { r, body };
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function setTab(name) {
    document.querySelectorAll('.auth-tab').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-auth-tab') === name);
    });
    document.querySelectorAll('[data-auth-panel]').forEach((p) => {
      p.style.display = p.getAttribute('data-auth-panel') === name ? 'block' : 'none';
    });
  }

  async function refreshLoggedUi(cfg) {
    const base = apiBase();
    const panelLogged = document.getElementById('auth-panel-logged');
    const panelForms = document.getElementById('auth-panel-forms');
    const panelProv = document.getElementById('auth-panel-providers');
    const attach = document.getElementById('auth-panel-attach');
    const setPw = document.getElementById('auth-panel-set-password');
    const chPw = document.getElementById('auth-panel-change-password');
    const sum = document.getElementById('auth-logged-summary');
    if (!base || !panelLogged || !panelForms) return;

    const { r, body } = await jfetch('/v1/auth/me', { method: 'GET' });
    if (r.ok && body.user) {
      const u = body.user;
      panelLogged.style.display = 'block';
      panelForms.style.display = 'none';
      if (panelProv) panelProv.style.display = 'none';
      const parts = [];
      parts.push(`Почта: ${u.email}${u.emailVerified ? ' (подтверждена)' : ' (не подтверждена)'}`);
      if (u.phoneVerified) parts.push('Телефон привязан.');
      else parts.push('Телефон не привязан — можно привязать в форме ниже.');
      if (u.providers && u.providers.length) {
        parts.push('Способы входа: ' + u.providers.join(', '));
      }
      if (u.hasPassword) parts.push('Пароль для входа по почте задан.');
      else parts.push('Пароль по почте не задан — можно добавить ниже.');
      if (sum) sum.textContent = parts.join(' ');
      if (setPw) setPw.style.display = u.hasPassword ? 'none' : 'block';
      if (chPw) chPw.style.display = u.hasPassword ? 'block' : 'none';
      if (attach && cfg && cfg.smsLogin && !u.phoneVerified) {
        attach.style.display = 'block';
      } else if (attach) attach.style.display = 'none';
      return;
    }
    panelLogged.style.display = 'none';
    panelForms.style.display = 'block';
    if (panelProv) panelProv.style.display = 'block';
    if (attach) attach.style.display = 'none';
    if (setPw) setPw.style.display = 'none';
    if (chPw) chPw.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const gmsg = document.getElementById('auth-global-msg');
    const cfgRes = await jfetch('/v1/auth/config', { method: 'GET' });
    const cfg = cfgRes.r.ok ? cfgRes.body : {};

    const err = qs('error');
    const verified = qs('verified');
    if (verified === '1') showMsg(gmsg, 'Почта подтверждена, вы вошли в аккаунт.', 'ok');
    if (err === 'invalid_token') showMsg(gmsg, 'Неверная ссылка подтверждения.', 'err');
    if (err === 'expired_or_used') showMsg(gmsg, 'Ссылка устарела или уже использована.', 'err');
    if (err && err.startsWith('yandex_')) showMsg(gmsg, 'Не удалось войти через Яндекс. Попробуйте снова или используйте почту.', 'err');
    if (err === 'esia_stub') showMsg(gmsg, 'Вход через Госуслуги пока в подключении.', 'err');

    const btnY = document.getElementById('auth-btn-yandex');
    const btnE = document.getElementById('auth-btn-esia');
    if (btnY && cfg.yandexAuthorizeUrl) {
      btnY.addEventListener('click', () => {
        const next = encodeURIComponent('/account/');
        window.location.href = `${cfg.yandexAuthorizeUrl}?next=${next}`;
      });
    } else if (btnY) {
      btnY.classList.add('is-disabled');
      btnY.disabled = true;
      btnY.title = 'Не настроен YANDEX_CLIENT_ID в Worker';
    }
    if (btnE) {
      if (cfg.esiaReady && cfg.esiaAuthorizeUrl) {
        btnE.disabled = false;
        btnE.classList.remove('is-disabled');
        btnE.addEventListener('click', () => {
          window.location.href = cfg.esiaAuthorizeUrl;
        });
      } else if (cfg.esiaConfigured) {
        btnE.title = 'ЕСИА: задайте ESIA_FULL_IMPLEMENTATION=true после реализации обмена кода';
      }
    }

    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        setTab(tab.getAttribute('data-auth-tab') || 'login');
      });
    });

    if (location.hash === '#register') setTab('register');

    const hash = location.hash || '';
    const resetMatch = hash.match(/^#reset=(.+)$/);
    if (resetMatch) {
      const tok = decodeURIComponent(resetMatch[1]);
      const pr = document.getElementById('auth-panel-reset');
      const hid = document.getElementById('reset-token');
      if (pr) pr.style.display = 'block';
      if (hid) hid.value = tok;
    }

    document.getElementById('auth-btn-logout')?.addEventListener('click', async () => {
      await jfetch('/v1/auth/logout', { method: 'POST', body: '{}' });
      window.location.href = '/account/';
    });

    document.getElementById('form-login')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email')?.value?.trim() || '';
      const password = document.getElementById('login-password')?.value || '';
      const resendWrap = document.getElementById('auth-resend-wrap');
      if (resendWrap) resendWrap.style.display = 'none';
      const { r, body } = await jfetch('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) {
        window.location.reload();
        return;
      }
      if (body.error === 'email_not_verified') {
        showMsg(gmsg, body.message || 'Подтвердите почту.', 'err');
        if (resendWrap) {
          resendWrap.style.display = 'block';
          const re = document.getElementById('resend-email');
          if (re) re.value = email;
        }
        return;
      }
      showMsg(gmsg, body.message || 'Неверная почта или пароль.', 'err');
    });

    document.getElementById('form-resend-verify')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('resend-email')?.value?.trim() || '';
      const { r, body } = await jfetch('/v1/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (r.status === 429) {
        showMsg(gmsg, 'Слишком много запросов. Подождите час.', 'err');
        return;
      }
      if (!r.ok) {
        showMsg(gmsg, body.message || body.error || 'Ошибка отправки', 'err');
        return;
      }
      let t = 'Если адрес зарегистрирован и не подтверждён, письмо отправлено.';
      if (body.devVerificationLink) t += ' (dev) ' + body.devVerificationLink;
      showMsg(gmsg, t, 'ok');
    });

    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('reg-email')?.value?.trim() || '';
      const password = document.getElementById('reg-password')?.value || '';
      const { r, body } = await jfetch('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (r.status === 201 && body.needsEmailVerification) {
        let t =
          'Проверьте почту: мы отправили ссылку для подтверждения.' +
          (body.devVerificationLink
            ? ' (dev) Ссылка: ' + body.devVerificationLink
            : '');
        showMsg(gmsg, t, 'ok');
        return;
      }
      if (body.error === 'email_taken') {
        showMsg(gmsg, 'Эта почта уже зарегистрирована. Войдите или сбросьте пароль.', 'err');
        return;
      }
      showMsg(gmsg, body.message || body.error || 'Ошибка регистрации', 'err');
    });

    document.getElementById('link-forgot')?.addEventListener('click', (e) => {
      e.preventDefault();
      const p = document.getElementById('auth-panel-forgot');
      if (p) p.style.display = 'block';
    });
    document.getElementById('forgot-cancel')?.addEventListener('click', () => {
      const p = document.getElementById('auth-panel-forgot');
      if (p) p.style.display = 'none';
    });

    document.getElementById('form-forgot')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email')?.value?.trim() || '';
      const { r, body } = await jfetch('/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (!r.ok) {
        showMsg(gmsg, body.message || body.error || 'Почтовый сервис недоступен', 'err');
        return;
      }
      showMsg(gmsg, 'Если такой адрес есть в системе, мы отправили письмо со ссылкой.', 'ok');
      const p = document.getElementById('auth-panel-forgot');
      if (p) p.style.display = 'none';
    });

    document.getElementById('form-reset')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('reset-token')?.value || '';
      const password = document.getElementById('reset-password')?.value || '';
      const { r, body } = await jfetch('/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      if (r.ok) {
        showMsg(gmsg, 'Пароль обновлён.', 'ok');
        window.location.href = '/account/';
        return;
      }
      showMsg(gmsg, body.message || 'Ссылка недействительна.', 'err');
    });

    document.getElementById('form-set-password')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('set-pw-new')?.value || '';
      const { r, body } = await jfetch('/v1/auth/password/set', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        showMsg(gmsg, 'Пароль сохранён.', 'ok');
        window.location.reload();
        return;
      }
      showMsg(gmsg, body.message || body.error || 'Ошибка', 'err');
    });

    document.getElementById('form-change-password')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('ch-pw-current')?.value || '';
      const newPassword = document.getElementById('ch-pw-new')?.value || '';
      const { r, body } = await jfetch('/v1/auth/password/change', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (r.ok) {
        showMsg(gmsg, 'Пароль обновлён, сессия сохранена.', 'ok');
        window.location.reload();
        return;
      }
      if (body.error === 'invalid_current_password') {
        showMsg(gmsg, 'Неверный текущий пароль.', 'err');
        return;
      }
      showMsg(gmsg, body.message || body.error || 'Ошибка', 'err');
    });

    let phonePending = '';
    document.getElementById('form-phone-send')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('phone-num')?.value || '';
      const { r, body } = await jfetch('/v1/auth/phone/send-login', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      if (!r.ok) {
        showMsg(gmsg, body.error === 'sms_not_configured' ? 'SMS не настроен на сервере.' : (body.error || 'Ошибка'), 'err');
        return;
      }
      if (r.status === 429) {
        showMsg(gmsg, 'Подождите минуту перед повторной отправкой кода.', 'err');
        return;
      }
      phonePending = body.normalizedPhone || phone.trim();
      const fc = document.getElementById('form-phone-code');
      if (fc) fc.style.display = 'flex';
      showMsg(gmsg, 'Если номер привязан к аккаунту, код отправлен.', 'ok');
    });

    document.getElementById('form-phone-code')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('phone-otp')?.value?.trim() || '';
      const { r, body } = await jfetch('/v1/auth/phone/verify-login', {
        method: 'POST',
        body: JSON.stringify({ phone: phonePending, code }),
      });
      if (r.ok) {
        window.location.reload();
        return;
      }
      showMsg(gmsg, 'Неверный код.', 'err');
    });

    let attachPhone = '';
    document.getElementById('form-attach-send')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('attach-phone')?.value || '';
      const { r, body } = await jfetch('/v1/auth/phone/send-attach', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      if (!r.ok) {
        showMsg(gmsg, body.error === 'unauthorized' ? 'Сессия сброшена — обновите страницу.' : (body.message || body.error), 'err');
        return;
      }
      const norm = body.normalizedPhone;
      attachPhone = (typeof norm === 'string' && norm.length > 0 ? norm : phone).trim();
      const fc = document.getElementById('form-attach-code');
      if (fc) fc.style.display = 'flex';
      showMsg(gmsg, 'Код отправлен на телефон.', 'ok');
    });

    document.getElementById('form-attach-code')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('attach-otp')?.value?.trim() || '';
      const { r, body } = await jfetch('/v1/auth/phone/verify-attach', {
        method: 'POST',
        body: JSON.stringify({ phone: attachPhone, code }),
      });
      if (r.ok) {
        showMsg(gmsg, 'Телефон привязан.', 'ok');
        window.location.reload();
        return;
      }
      showMsg(gmsg, body.error || 'Ошибка', 'err');
    });

    await refreshLoggedUi(cfg);
  });
})();
