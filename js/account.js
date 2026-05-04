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

  function el(id) {
    return document.getElementById(id);
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

    const regState = {
      pendingRegistrationId: '',
      channel: 'email',
      smsPhone: '',
    };

    const dlgReg = el('dialog-reg-confirm');

    async function cancelRegistrationPending() {
      const id = regState.pendingRegistrationId;
      if (!id) return;
      try {
        await jfetch('/v1/auth/register/cancel', {
          method: 'POST',
          body: JSON.stringify({ pendingRegistrationId: id }),
        });
      } catch {
        /* ignore */
      }
      regState.pendingRegistrationId = '';
    }

    function resetRegDialogPanels() {
      const stepSend = el('dialog-reg-step-send');
      const stepCode = el('dialog-reg-step-code');
      const back = el('dialog-reg-back');
      const resend = el('dialog-reg-resend');
      const otp = el('dialog-reg-otp');
      const emailRad = el('dialog-reg-ch-email');
      const smsRad = el('dialog-reg-ch-sms');
      const phoneWrap = el('dialog-reg-phone-wrap');
      if (emailRad) emailRad.checked = true;
      if (smsRad) smsRad.checked = false;
      if (phoneWrap) phoneWrap.style.display = 'none';
      if (stepSend) stepSend.style.display = 'block';
      if (stepCode) stepCode.style.display = 'none';
      if (back) back.style.display = 'none';
      if (resend) resend.style.display = 'none';
      if (otp) otp.value = '';
    }

    function syncRegDialogPhoneWrap() {
      const sms = Boolean(el('dialog-reg-ch-sms')?.checked);
      const wrap = el('dialog-reg-phone-wrap');
      if (wrap) wrap.style.display = sms ? 'block' : 'none';
    }

    async function closeRegDialog() {
      await cancelRegistrationPending();
      if (dlgReg && dlgReg.open) dlgReg.close();
      resetRegDialogPanels();
    }

    function openRegConfirmDialog(emailText, pendingId) {
      regState.pendingRegistrationId = pendingId;
      regState.channel = 'email';
      regState.smsPhone = '';
      const line = el('dialog-reg-email-line');
      if (line) line.textContent = 'Почта: ' + emailText;
      const phoneIn = el('dialog-reg-phone');
      if (phoneIn) phoneIn.value = '';
      resetRegDialogPanels();
      const smsLabel = el('dialog-reg-ch-sms-label');
      const smsRad = el('dialog-reg-ch-sms');
      if (smsLabel && smsRad) {
        if (!cfg.registrationSms) {
          smsLabel.style.display = 'none';
          smsRad.checked = false;
          el('dialog-reg-ch-email') && (el('dialog-reg-ch-email').checked = true);
        } else {
          smsLabel.style.display = '';
        }
      }
      syncRegDialogPhoneWrap();
      if (dlgReg && typeof dlgReg.showModal === 'function') {
        dlgReg.showModal();
      }
    }

    function regDialogShowCodeStep() {
      const stepSend = el('dialog-reg-step-send');
      const stepCode = el('dialog-reg-step-code');
      const back = el('dialog-reg-back');
      const resend = el('dialog-reg-resend');
      const lbl = el('dialog-reg-otp-label');
      if (stepSend) stepSend.style.display = 'none';
      if (stepCode) stepCode.style.display = 'block';
      if (back) back.style.display = 'inline-flex';
      if (resend) resend.style.display = 'inline-flex';
      if (lbl) {
        lbl.textContent =
          regState.channel === 'email'
            ? 'Код из письма (6 цифр)'
            : 'Код из SMS (6 цифр)';
      }
      if (resend) {
        resend.textContent =
          regState.channel === 'email'
            ? 'Отправить код на почту снова'
            : 'Отправить SMS снова';
      }
      const otp = el('dialog-reg-otp');
      if (otp) {
        otp.value = '';
        otp.focus();
      }
    }

    async function sendPendingEmailCode() {
      const pid = regState.pendingRegistrationId;
      if (!pid) return false;
      const { r, body } = await jfetch('/v1/auth/register/send-email-code', {
        method: 'POST',
        body: JSON.stringify({ pendingRegistrationId: pid }),
      });
      if (r.status === 429) {
        showMsg(gmsg, 'Слишком много запросов. Подождите час.', 'err');
        return false;
      }
      if (!r.ok) {
        showMsg(
          gmsg,
          body.message || body.error || 'Не удалось отправить код на почту',
          'err'
        );
        return false;
      }
      let t = 'Код отправлен на почту.';
      if (body.devVerificationCode) {
        t += ' (dev) Код: ' + body.devVerificationCode;
      }
      showMsg(gmsg, t, 'ok');
      return true;
    }

    const wrapPhLogin = el('auth-phone-login-wrap');
    const linkPhLogin = el('link-toggle-phone-login');
    const hintPhLogin = el('auth-phone-login-hint');
    function collapsePhoneLogin() {
      if (wrapPhLogin) wrapPhLogin.style.display = 'none';
      if (linkPhLogin) linkPhLogin.textContent = 'Войти по коду из SMS';
      if (hintPhLogin) hintPhLogin.style.display = '';
    }

    linkPhLogin?.addEventListener('click', () => {
      const open = wrapPhLogin && wrapPhLogin.style.display === 'block';
      if (open) collapsePhoneLogin();
      else {
        if (wrapPhLogin) wrapPhLogin.style.display = 'block';
        if (linkPhLogin) linkPhLogin.textContent = 'Скрыть вход по SMS';
        if (hintPhLogin) hintPhLogin.style.display = 'none';
      }
    });

    document.querySelectorAll('input[name="dialog-reg-channel"]').forEach((inp) => {
      inp.addEventListener('change', syncRegDialogPhoneWrap);
    });

    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.getAttribute('data-auth-tab') || 'login';
        if (name !== 'register') {
          void closeRegDialog();
        }
        if (name === 'register') collapsePhoneLogin();
        setTab(name);
      });
    });

    if (location.hash === '#register') {
      setTab('register');
    }

    dlgReg?.addEventListener('cancel', (e) => {
      e.preventDefault();
      void closeRegDialog();
    });

    el('dialog-reg-send-code')?.addEventListener('click', async () => {
      const pid = regState.pendingRegistrationId;
      if (!pid) return;
      const useEmail = Boolean(el('dialog-reg-ch-email')?.checked);
      if (useEmail) {
        regState.channel = 'email';
        const ok = await sendPendingEmailCode();
        if (ok) regDialogShowCodeStep();
        return;
      }
      regState.channel = 'sms';
      const phone = el('dialog-reg-phone')?.value || '';
      if (!phone.trim()) {
        showMsg(gmsg, 'Выберите «В SMS» и укажите номер телефона.', 'err');
        const wrap = el('dialog-reg-phone-wrap');
        if (wrap) wrap.style.display = 'block';
        el('dialog-reg-phone')?.focus();
        return;
      }
      const { r, body } = await jfetch('/v1/auth/register/send-sms-code', {
        method: 'POST',
        body: JSON.stringify({ pendingRegistrationId: pid, phone }),
      });
      if (r.status === 429) {
        showMsg(gmsg, 'Подождите минуту перед повторной отправкой.', 'err');
        return;
      }
      if (!r.ok) {
        showMsg(
          gmsg,
          body.error === 'phone_taken'
            ? 'Этот номер уже занят другим аккаунтом.'
            : body.message || body.error || 'Ошибка SMS',
          'err'
        );
        return;
      }
      regState.smsPhone = body.normalizedPhone || phone.trim();
      let t = 'Код отправлен в SMS.';
      if (body.devVerificationCode) {
        t += ' (dev) Код: ' + body.devVerificationCode;
      }
      showMsg(gmsg, t, 'ok');
      regDialogShowCodeStep();
    });

    el('dialog-reg-resend')?.addEventListener('click', async () => {
      if (regState.channel === 'email') {
        const ok = await sendPendingEmailCode();
        if (ok) showMsg(gmsg, 'Код отправлен повторно.', 'ok');
      } else {
        const phone = regState.smsPhone || el('dialog-reg-phone')?.value || '';
        const { r, body } = await jfetch('/v1/auth/register/send-sms-code', {
          method: 'POST',
          body: JSON.stringify({
            pendingRegistrationId: regState.pendingRegistrationId,
            phone,
          }),
        });
        if (!r.ok) {
          showMsg(gmsg, body.message || body.error || 'Ошибка', 'err');
          return;
        }
        regState.smsPhone = body.normalizedPhone || phone.trim();
        showMsg(gmsg, 'SMS отправлено снова.', 'ok');
      }
    });

    el('dialog-reg-back')?.addEventListener('click', () => {
      resetRegDialogPanels();
    });

    el('dialog-reg-cancel')?.addEventListener('click', () => {
      void closeRegDialog();
    });

    el('form-dialog-reg-code')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code =
        el('dialog-reg-otp')?.value?.trim().replace(/\D/g, '').slice(0, 6) || '';
      if (code.length !== 6) {
        showMsg(gmsg, 'Введите 6 цифр кода.', 'err');
        return;
      }
      const payload = {
        pendingRegistrationId: regState.pendingRegistrationId,
        channel: regState.channel,
        code,
      };
      if (regState.channel === 'sms') {
        payload.phone = regState.smsPhone;
      }
      const { r, body } = await jfetch('/v1/auth/register/verify-code', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        regState.pendingRegistrationId = '';
        window.location.reload();
        return;
      }
      showMsg(
        gmsg,
        body.error === 'invalid_code'
          ? 'Неверный или просроченный код.'
          : body.message || 'Ошибка',
        'err'
      );
    });

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
      const loginCodeWrap = document.getElementById('auth-login-verify-code-wrap');
      if (resendWrap) resendWrap.style.display = 'none';
      if (loginCodeWrap) loginCodeWrap.style.display = 'none';
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
        if (loginCodeWrap) loginCodeWrap.style.display = 'block';
        return;
      }
      showMsg(gmsg, body.message || 'Неверная почта или пароль.', 'err');
    });

    document.getElementById('form-login-email-code')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email')?.value?.trim() || '';
      const password = document.getElementById('login-password')?.value || '';
      const code = el('login-email-otp')?.value?.trim().replace(/\D/g, '').slice(0, 6) || '';
      if (code.length !== 6) {
        showMsg(gmsg, 'Введите 6 цифр кода.', 'err');
        return;
      }
      const { r, body } = await jfetch('/v1/auth/register/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email, password, channel: 'email', code }),
      });
      if (r.ok) {
        window.location.reload();
        return;
      }
      showMsg(gmsg, body.error === 'invalid_code' ? 'Неверный или просроченный код.' : (body.message || 'Ошибка'), 'err');
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
      let t =
        'Если адрес зарегистрирован и не подтверждён, на почту отправлен код.';
      if (body.devVerificationCode) {
        t += ' (dev) Код: ' + body.devVerificationCode;
      }
      showMsg(gmsg, t, 'ok');
    });

    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el('reg-email')?.value?.trim() || '';
      const password = el('reg-password')?.value || '';
      const { r, body } = await jfetch('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (r.status === 201 && body.pendingRegistrationId) {
        showMsg(
          gmsg,
          'Аккаунт ещё не создан. Подтвердите регистрацию в открывшемся окне.',
          'ok'
        );
        openRegConfirmDialog(body.email || email, body.pendingRegistrationId);
        if (!cfg.registrationSms) {
          regState.channel = 'email';
          const ok = await sendPendingEmailCode();
          if (ok) regDialogShowCodeStep();
        }
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
