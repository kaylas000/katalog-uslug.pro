import bcrypt from "bcryptjs";
import type { Client } from "pg";
import { withDbClient } from "./db";
import type { Env } from "./types";
import {
  passwordResetEmailHtml,
  sendResendEmail,
  sendSmsRu,
  verificationEmailHtml,
} from "./notify";
import {
  exchangeYandexCode,
  fetchYandexLoginInfo,
  pkceS256Challenge,
  randomPkceVerifier,
  upsertYandexUser,
  yandexCallbackUrl,
} from "./oauth-yandex";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 11;
const EMAIL_TOKEN_HOURS = 48;
const RESET_TOKEN_HOURS = 2;
const OTP_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 6;

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function otpCodeHash(env: Env, phone: string, code: string): Promise<string> {
  const pepper =
    env.AUTH_PEPPER?.trim() || "dev-auth-pepper-set-AUTH_PEPPER-in-prod";
  return sha256hex(`${pepper}:sms:${phone}:${code}`);
}

function randomToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomOtp6(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  const v = n[0]! % 1_000_000;
  return String(v).padStart(6, "0");
}

function parseCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const p = part.trim();
    const i = p.indexOf("=");
    if (i === -1) continue;
    const k = p.slice(0, i).trim();
    if (k === name) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(pw: string): string | null {
  if (pw.length < 10) return "Пароль не короче 10 символов";
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(pw)) return "Пароль должен содержать букву";
  if (!/\d/.test(pw)) return "Пароль должен содержать цифру";
  return null;
}

function publicSiteUrl(env: Env): string {
  return (
    env.PUBLIC_SITE_URL?.replace(/\/$/, "").trim() ||
    env.ALLOWED_ORIGIN?.replace(/\/$/, "").trim() ||
    "https://katalog-uslug.pro"
  );
}

const ALLOWED_BROWSER_ORIGINS = new Set([
  "https://katalog-uslug.pro",
  "https://www.katalog-uslug.pro",
]);

function allowedOrigins(env: Env, request: Request): Set<string> {
  const s = new Set(ALLOWED_BROWSER_ORIGINS);
  const base = env.ALLOWED_ORIGIN?.replace(/\/$/, "").trim();
  if (base) s.add(base);
  const host = new URL(request.url).hostname;
  if (host.endsWith(".workers.dev")) {
    s.add(`https://${host}`);
  }
  return s;
}

function isForbiddenBrowserOrigin(request: Request, env: Env): boolean {
  const o = request.headers.get("Origin");
  if (!o) return false;
  return !allowedOrigins(env, request).has(o);
}

export function corsAuthHeaders(env: Env, request: Request): Headers {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env, request);
  const allow = allowed.has(origin) ? origin : "https://katalog-uslug.pro";
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", allow);
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Cookie");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

function json(
  body: unknown,
  status: number,
  headers: Headers,
  setCookie?: string
): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  if (setCookie) h.append("Set-Cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers: h });
}

function buildSessionCookie(token: string, requestUrl: string): string {
  const secure =
    requestUrl.startsWith("https:") || !requestUrl.startsWith("http");
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_DAYS * 86400}`,
    "HttpOnly",
    "SameSite=None",
    secure ? "Secure" : "",
  ].filter(Boolean);
  return parts.join("; ");
}

function buildClearSessionCookie(requestUrl: string): string {
  const secure =
    requestUrl.startsWith("https:") || !requestUrl.startsWith("http");
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=None",
    secure ? "Secure" : "",
  ].filter(Boolean);
  return parts.join("; ");
}

async function insertEmailToken(
  c: Client,
  userId: string,
  purpose: "email_verify" | "password_reset",
  rawToken: string
): Promise<number> {
  const token_hash = await sha256hex(rawToken);
  const exp = new Date(
    Date.now() +
      (purpose === "password_reset"
        ? RESET_TOKEN_HOURS
        : EMAIL_TOKEN_HOURS) *
        3600000
  ).toISOString();
  const ins = await c.query(
    `INSERT INTO auth_email_tokens (user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4::timestamptz)
     RETURNING id`,
    [userId, token_hash, purpose, exp]
  );
  return Number((ins.rows[0] as { id: number }).id);
}

async function consumeEmailToken(
  c: Client,
  rawToken: string,
  purpose: "email_verify" | "password_reset"
): Promise<{ userId: string } | null> {
  const token_hash = await sha256hex(rawToken);
  const r = await c.query(
    `UPDATE auth_email_tokens t
     SET consumed_at = now()
     FROM (
       SELECT id FROM auth_email_tokens
       WHERE token_hash = $1 AND purpose = $2
         AND consumed_at IS NULL AND expires_at > now()
       ORDER BY id DESC LIMIT 1
     ) x
     WHERE t.id = x.id
     RETURNING t.user_id`,
    [token_hash, purpose]
  );
  if (!r.rows.length) return null;
  return { userId: String((r.rows[0] as { user_id: string }).user_id) };
}

async function createSessionForUser(
  c: Client,
  userId: string
): Promise<string> {
  const token = randomToken();
  const token_hash = await sha256hex(token);
  const exp = new Date(
    Date.now() + SESSION_DAYS * 86400000
  ).toISOString();
  await c.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3::timestamptz)`,
    [userId, token_hash, exp]
  );
  return token;
}

function normalizePhoneRu(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) return `+7${d.slice(1)}`;
  if (d.length === 11 && d.startsWith("7")) return `+${d}`;
  if (d.length === 10) return `+7${d}`;
  if (d.length === 12 && d.startsWith("7")) return `+${d}`;
  return null;
}

function authConfig(env: Env, requestUrl: string) {
  const yandexOk = Boolean(
    env.YANDEX_CLIENT_ID?.trim() && env.YANDEX_CLIENT_SECRET?.trim()
  );
  const esiaConfigured = Boolean(env.ESIA_CLIENT_ID?.trim());
  const esiaReady = env.ESIA_FULL_IMPLEMENTATION === "true";
  return {
    emailPassword: true,
    emailVerificationRequired: true,
    resendEmail: Boolean(env.RESEND_API_KEY?.trim()),
    smsLogin: Boolean(env.SMSRU_API_ID?.trim()),
    yandex: yandexOk,
    yandexAuthorizeUrl:
      yandexOk && requestUrl
        ? `${new URL(requestUrl).origin}/v1/auth/oauth/yandex/start`
        : null,
    esiaConfigured,
    esiaReady,
    esiaAuthorizeUrl:
      esiaReady && requestUrl
        ? `${new URL(requestUrl).origin}/v1/auth/oauth/esia/start`
        : null,
    devEmailLink: env.DEV_RETURN_EMAIL_LINK === "true",
  };
}

export async function handleAuth(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  let path = url.pathname.replace(/\/$/, "") || "/";
  if (!path.startsWith("/v1/auth")) return null;

  const cors = corsAuthHeaders(env, request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  function enforceAuthOrigin(p: string, method: string): boolean {
    if (p === "/v1/auth/config") return false;
    if (method === "GET" && p === "/v1/auth/verify-email") return false;
    if (method === "GET" && p.startsWith("/v1/auth/oauth/")) return false;
    return true;
  }
  if (
    enforceAuthOrigin(path, request.method) &&
    isForbiddenBrowserOrigin(request, env)
  ) {
    return json({ error: "forbidden_origin" }, 403, cors);
  }

  if (path === "/v1/auth/config" && request.method === "GET") {
    return json(authConfig(env, request.url), 200, cors);
  }

  const reqUrl = request.url;

  try {
    if (path === "/v1/auth/verify-email" && request.method === "GET") {
      const raw = url.searchParams.get("token") || "";
      if (raw.length < 16) {
        return Response.redirect(
          `${publicSiteUrl(env)}/account/?error=invalid_token`,
          302
        );
      }
      const done = await withDbClient(env, async (c) => {
        const row = await consumeEmailToken(c, raw, "email_verify");
        if (!row) return null;
        await c.query(
          `UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL`,
          [row.userId]
        );
        const token = await createSessionForUser(c, row.userId);
        return token;
      });
      if (!done) {
        return Response.redirect(
          `${publicSiteUrl(env)}/account/?error=expired_or_used`,
          302
        );
      }
      const cookie = buildSessionCookie(done, reqUrl);
      const h = new Headers();
      h.set("Location", `${publicSiteUrl(env)}/account/?verified=1`);
      h.append("Set-Cookie", cookie);
      return new Response(null, { status: 302, headers: h });
    }

    if (path === "/v1/auth/oauth/yandex/start" && request.method === "GET") {
      if (!env.YANDEX_CLIENT_ID?.trim() || !env.YANDEX_CLIENT_SECRET?.trim()) {
        return json({ error: "yandex_not_configured" }, 503, cors);
      }
      let next = url.searchParams.get("next")?.trim() || "/account/";
      if (!next.startsWith("/")) next = `/${next}`;
      if (next.length > 512) next = "/account/";
      const verifier = randomPkceVerifier();
      const challenge = await pkceS256Challenge(verifier);
      const redirectUri = yandexCallbackUrl(reqUrl, env);
      const stateRow = await withDbClient(env, async (c) => {
        await c.query(
          `DELETE FROM oauth_transient_state WHERE created_at < now() - interval '30 minutes'`
        );
        const ins = await c.query(
          `INSERT INTO oauth_transient_state (provider, code_verifier, redirect_after)
           VALUES ('yandex', $1, $2) RETURNING id`,
          [verifier, next.slice(0, 512)]
        );
        return String((ins.rows[0] as { id: string }).id);
      });
      const authUrl = new URL("https://oauth.yandex.ru/authorize");
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", env.YANDEX_CLIENT_ID.trim());
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", "login:email login:info");
      authUrl.searchParams.set("state", stateRow);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      return Response.redirect(authUrl.toString(), 302);
    }

    if (path === "/v1/auth/oauth/yandex/callback" && request.method === "GET") {
      const code = url.searchParams.get("code") || "";
      const state = (url.searchParams.get("state") || "").trim();
      if (!code || !state) {
        return Response.redirect(
          `${publicSiteUrl(env)}/account/?error=yandex_denied`,
          302
        );
      }
      if (!/^[0-9a-f-]{36}$/i.test(state)) {
        return Response.redirect(
          `${publicSiteUrl(env)}/account/?error=yandex_state`,
          302
        );
      }
      const redirectUri = yandexCallbackUrl(reqUrl, env);
      const row = await withDbClient(env, async (c) => {
        const r = await c.query(
          `DELETE FROM oauth_transient_state WHERE id = $1::uuid AND provider = 'yandex'
           RETURNING code_verifier, redirect_after`,
          [state]
        );
        return r.rows[0] as
          | { code_verifier: string; redirect_after: string }
          | undefined;
      });
      if (!row) {
        return Response.redirect(
          `${publicSiteUrl(env)}/account/?error=yandex_state`,
          302
        );
      }
      const tok = await exchangeYandexCode(
        env,
        code,
        redirectUri,
        row.code_verifier
      );
      if (!tok.ok) {
        return Response.redirect(
          `${publicSiteUrl(env)}/account/?error=yandex_token`,
          302
        );
      }
      const info = await fetchYandexLoginInfo(tok.access_token);
      if (!info) {
        return Response.redirect(
          `${publicSiteUrl(env)}/account/?error=yandex_profile`,
          302
        );
      }
      const sessionTok = await withDbClient(env, async (c) => {
        const { userId } = await upsertYandexUser(
          c,
          info.id,
          info.default_email,
          info.display_name || info.login
        );
        return createSessionForUser(c, userId);
      });
      const cookie = buildSessionCookie(sessionTok, reqUrl);
      const safeNext = row.redirect_after.startsWith("/")
        ? row.redirect_after
        : "/account/";
      const h = new Headers();
      h.set("Location", `${publicSiteUrl(env)}${safeNext}?oauth=yandex`);
      h.append("Set-Cookie", cookie);
      return new Response(null, { status: 302, headers: h });
    }

    if (path === "/v1/auth/oauth/esia/start" && request.method === "GET") {
      if (!env.ESIA_CLIENT_ID?.trim()) {
        return json(
          {
            error: "esia_not_configured",
            message:
              "Вход через Госуслуги (ЕСИА) требует регистрации приложения, сертификатов и отдельного контура. Добавьте ESIA_CLIENT_ID и настройте redirect в панели ЕСИА.",
          },
          503,
          cors
        );
      }
      return json(
        {
          error: "esia_stub",
          message:
            "Клиент ЕСИА задан, но обмен кода на токен в этом шаблоне не подключён: нужен криптопровайдер и согласование с оператором ЕСИА. Используйте Яндекс или почту.",
        },
        501,
        cors
      );
    }

    if (path === "/v1/auth/oauth/esia/callback" && request.method === "GET") {
      return Response.redirect(
        `${publicSiteUrl(env)}/account/?error=esia_stub`,
        302
      );
    }

    if (path === "/v1/auth/register" && request.method === "POST") {
      let body: { email?: string; password?: string };
      try {
        body = (await request.json()) as { email?: string; password?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const email = normalizeEmail(String(body.email || ""));
      const password = String(body.password || "");
      if (!isValidEmail(email)) {
        return json({ error: "validation", field: "email" }, 400, cors);
      }
      const pwErr = validatePassword(password);
      if (pwErr) return json({ error: "validation", message: pwErr }, 400, cors);

      const password_hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
      const rawVerify = randomToken();

      const created = await withDbClient(env, async (c) => {
        try {
          const ins = await c.query(
            `INSERT INTO users (email, password_hash, email_verified_at)
             VALUES ($1, $2, NULL)
             RETURNING id, email`,
            [email, password_hash]
          );
          const u = ins.rows[0] as { id: string; email: string };
          await insertEmailToken(c, u.id, "email_verify", rawVerify);
          return u;
        } catch (e: unknown) {
          const err = e as { code?: string };
          if (err.code === "23505") return null;
          throw e;
        }
      });
      if (!created) {
        return json({ error: "email_taken" }, 409, cors);
      }

      const verifyUrl = `${new URL(reqUrl).origin}/v1/auth/verify-email?token=${encodeURIComponent(rawVerify)}`;
      const devLink =
        env.DEV_RETURN_EMAIL_LINK === "true" ? verifyUrl : undefined;
      const send = await sendResendEmail(env, {
        to: email,
        subject: "Подтвердите почту — katalog-uslug.pro",
        html: verificationEmailHtml(env, verifyUrl),
      });

      if (!send.ok && !devLink) {
        await withDbClient(env, async (c) => {
          await c.query(`DELETE FROM users WHERE id = $1`, [created.id]);
        });
        return json(
          {
            error: "email_not_configured",
            message:
              "Почтовый сервис не настроен (RESEND_API_KEY). Укажите ключ в Worker или включите DEV_RETURN_EMAIL_LINK=true только для разработки.",
          },
          503,
          cors
        );
      }

      return json(
        {
          ok: true,
          needsEmailVerification: true,
          devVerificationLink: devLink,
          emailSent: send.ok,
        },
        201,
        cors
      );
    }

    if (path === "/v1/auth/resend-verification" && request.method === "POST") {
      let body: { email?: string };
      try {
        body = (await request.json()) as { email?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const email = normalizeEmail(String(body.email || ""));
      if (!isValidEmail(email)) {
        return json({ error: "validation", field: "email" }, 400, cors);
      }

      const rawVerify = randomToken();
      const sent = await withDbClient(env, async (c) => {
        const u = await c.query(
          `SELECT id FROM users WHERE lower(trim(email)) = $1 AND email_verified_at IS NULL`,
          [email]
        );
        if (!u.rows.length) return { kind: "noop" as const };
        const userId = String((u.rows[0] as { id: string }).id);
        const cnt = await c.query(
          `SELECT COUNT(*)::int AS n FROM auth_email_tokens
           WHERE user_id = $1 AND purpose = 'email_verify' AND created_at > now() - interval '1 hour'`,
          [userId]
        );
        const n = (cnt.rows[0] as { n: number }).n;
        if (n >= 5) return { kind: "rate_limited" as const };
        const tokenRowId = await insertEmailToken(
          c,
          userId,
          "email_verify",
          rawVerify
        );
        return { kind: "ok" as const, tokenRowId };
      });
      if (sent.kind === "rate_limited") {
        return json({ error: "rate_limited" }, 429, cors);
      }
      if (sent.kind === "noop") {
        return json({ ok: true }, 200, cors);
      }
      const verifyUrl = `${new URL(reqUrl).origin}/v1/auth/verify-email?token=${encodeURIComponent(rawVerify)}`;
      const devLink =
        env.DEV_RETURN_EMAIL_LINK === "true" ? verifyUrl : undefined;
      const mail = await sendResendEmail(env, {
        to: email,
        subject: "Подтвердите почту — katalog-uslug.pro",
        html: verificationEmailHtml(env, verifyUrl),
      });
      if (!mail.ok && !devLink) {
        await withDbClient(env, async (c) => {
          await c.query(`DELETE FROM auth_email_tokens WHERE id = $1`, [
            sent.tokenRowId,
          ]);
        });
        return json({ error: "email_not_configured" }, 503, cors);
      }
      return json(
        { ok: true, devVerificationLink: devLink, emailSent: mail.ok },
        200,
        cors
      );
    }

    if (path === "/v1/auth/login" && request.method === "POST") {
      let body: { email?: string; password?: string };
      try {
        body = (await request.json()) as { email?: string; password?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const email = normalizeEmail(String(body.email || ""));
      const password = String(body.password || "");

      const row = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id, email, password_hash, email_verified_at FROM users WHERE lower(trim(email)) = $1`,
          [email]
        );
        if (!r.rows.length) return null;
        return r.rows[0] as {
          id: string;
          email: string;
          password_hash: string | null;
          email_verified_at: string | null;
        };
      });

      if (!row || !row.password_hash) {
        return json({ error: "invalid_credentials" }, 401, cors);
      }
      if (!row.email_verified_at) {
        return json(
          {
            error: "email_not_verified",
            message: "Подтвердите почту по ссылке из письма или запросите повторную отправку.",
          },
          403,
          cors
        );
      }
      if (!bcrypt.compareSync(password, row.password_hash)) {
        return json({ error: "invalid_credentials" }, 401, cors);
      }

      const token = await withDbClient(env, async (c) =>
        createSessionForUser(c, row.id)
      );
      const cookie = buildSessionCookie(token, reqUrl);
      return json(
        { ok: true, user: { id: row.id, email: row.email } },
        200,
        cors,
        cookie
      );
    }

    if (path === "/v1/auth/forgot-password" && request.method === "POST") {
      let body: { email?: string };
      try {
        body = (await request.json()) as { email?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const email = normalizeEmail(String(body.email || ""));
      if (!isValidEmail(email)) {
        return json({ ok: true }, 200, cors);
      }
      const raw = randomToken();
      const prep = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE lower(trim(email)) = $1 AND password_hash IS NOT NULL`,
          [email]
        );
        if (!r.rows.length) return { kind: "noop" as const };
        const userId = String((r.rows[0] as { id: string }).id);
        const cnt = await c.query(
          `SELECT COUNT(*)::int AS n FROM auth_email_tokens
           WHERE user_id = $1 AND purpose = 'password_reset' AND created_at > now() - interval '1 hour'`,
          [userId]
        );
        if (((cnt.rows[0] as { n: number }).n ?? 0) >= 4) {
          return { kind: "rate" as const };
        }
        const tokenRowId = await insertEmailToken(
          c,
          userId,
          "password_reset",
          raw
        );
        return { kind: "ok" as const, tokenRowId };
      });
      if (prep.kind === "noop" || prep.kind === "rate") {
        return json({ ok: true }, 200, cors);
      }
      const resetUrl = `${publicSiteUrl(env)}/account/#reset=${encodeURIComponent(raw)}`;
      const mail = await sendResendEmail(env, {
        to: email,
        subject: "Сброс пароля — katalog-uslug.pro",
        html: passwordResetEmailHtml(env, resetUrl),
      });
      if (!mail.ok) {
        await withDbClient(env, async (c) => {
          await c.query(`DELETE FROM auth_email_tokens WHERE id = $1`, [
            prep.tokenRowId,
          ]);
        });
        return json(
          {
            error: "email_not_configured",
            message:
              "Почта для сброса пароля не настроена на сервере (RESEND_API_KEY).",
          },
          503,
          cors
        );
      }
      return json({ ok: true }, 200, cors);
    }

    if (path === "/v1/auth/reset-password" && request.method === "POST") {
      let body: { token?: string; password?: string };
      try {
        body = (await request.json()) as { token?: string; password?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const token = String(body.token || "");
      const password = String(body.password || "");
      const pwErr = validatePassword(password);
      if (!token || pwErr) {
        return json(
          { error: "validation", message: pwErr || "invalid_token" },
          400,
          cors
        );
      }
      const userId = await withDbClient(env, async (c) => {
        const row = await consumeEmailToken(c, token, "password_reset");
        if (!row) return null;
        const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        await c.query(
          `UPDATE users SET password_hash = $2 WHERE id = $1`,
          [row.userId, hash]
        );
        await c.query(`DELETE FROM sessions WHERE user_id = $1`, [row.userId]);
        return row.userId;
      });
      if (!userId) {
        return json({ error: "invalid_or_expired_token" }, 400, cors);
      }
      const sessionTok = await withDbClient(env, async (c) =>
        createSessionForUser(c, userId)
      );
      const cookie = buildSessionCookie(sessionTok, reqUrl);
      return json({ ok: true }, 200, cors, cookie);
    }

    if (path === "/v1/auth/password/set" && request.method === "POST") {
      const sess = await getSessionUser(request, env);
      if (!sess) return json({ error: "unauthorized" }, 401, cors);
      let body: { password?: string };
      try {
        body = (await request.json()) as { password?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const password = String(body.password || "");
      const pwErr = validatePassword(password);
      if (pwErr) return json({ error: "validation", message: pwErr }, 400, cors);
      const ok = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT password_hash FROM users WHERE id = $1::uuid`,
          [sess.id]
        );
        if (!r.rows.length) return false;
        const ph = (r.rows[0] as { password_hash: string | null })
          .password_hash;
        if (ph != null) return false;
        const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        await c.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
          sess.id,
          hash,
        ]);
        return true;
      });
      if (!ok) {
        return json(
          { error: "password_already_set", message: "Пароль уже задан — смена через «Изменить пароль»." },
          409,
          cors
        );
      }
      return json({ ok: true }, 200, cors);
    }

    if (path === "/v1/auth/password/change" && request.method === "POST") {
      const sess = await getSessionUser(request, env);
      if (!sess) return json({ error: "unauthorized" }, 401, cors);
      let body: { currentPassword?: string; newPassword?: string };
      try {
        body = (await request.json()) as {
          currentPassword?: string;
          newPassword?: string;
        };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      const pwErr = validatePassword(newPassword);
      if (pwErr) return json({ error: "validation", message: pwErr }, 400, cors);
      const result = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT password_hash FROM users WHERE id = $1::uuid`,
          [sess.id]
        );
        if (!r.rows.length) return { kind: "bad" as const };
        const ph = (r.rows[0] as { password_hash: string | null })
          .password_hash;
        if (!ph) return { kind: "no_password" as const };
        if (!bcrypt.compareSync(currentPassword, ph)) {
          return { kind: "wrong" as const };
        }
        const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
        await c.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
          sess.id,
          hash,
        ]);
        await c.query(`DELETE FROM sessions WHERE user_id = $1::uuid`, [
          sess.id,
        ]);
        const tok = await createSessionForUser(c, sess.id);
        return { kind: "ok" as const, token: tok };
      });
      if (result.kind === "no_password") {
        return json(
          {
            error: "use_password_set",
            message: "Сначала задайте пароль (раздел «Установить пароль»).",
          },
          400,
          cors
        );
      }
      if (result.kind === "wrong") {
        return json({ error: "invalid_current_password" }, 401, cors);
      }
      if (result.kind !== "ok") {
        return json({ error: "server_error" }, 500, cors);
      }
      const cookie = buildSessionCookie(result.token, reqUrl);
      return json({ ok: true }, 200, cors, cookie);
    }

    if (path === "/v1/auth/phone/send-login" && request.method === "POST") {
      let body: { phone?: string };
      try {
        body = (await request.json()) as { phone?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const phone = normalizePhoneRu(String(body.phone || ""));
      if (!phone) {
        return json({ error: "validation", field: "phone" }, 400, cors);
      }
      if (!env.SMSRU_API_ID?.trim()) {
        return json({ error: "sms_not_configured" }, 503, cors);
      }

      const recent = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id FROM auth_phone_otp
           WHERE phone_e164 = $1 AND purpose = 'login' AND created_at > now() - interval '55 seconds'
           ORDER BY id DESC LIMIT 1`,
          [phone]
        );
        return r.rows.length > 0;
      });
      if (recent) return json({ error: "rate_limited" }, 429, cors);

      const userRow = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE phone_e164 = $1 AND phone_verified_at IS NOT NULL`,
          [phone]
        );
        return r.rows[0] as { id: string } | undefined;
      });
      if (!userRow) {
        return json({ ok: true, normalizedPhone: phone }, 200, cors);
      }

      const code = randomOtp6();
      const code_hash = await otpCodeHash(env, phone, code);
      const exp = new Date(Date.now() + OTP_MINUTES * 60000).toISOString();
      await withDbClient(env, async (c) => {
        await c.query(
          `INSERT INTO auth_phone_otp (phone_e164, user_id, purpose, code_hash, expires_at)
           VALUES ($1, $2, 'login', $3, $4::timestamptz)`,
          [phone, userRow.id, code_hash, exp]
        );
      });
      const sms = await sendSmsRu(env, phone, `Код входа katalog-uslug.pro: ${code}`);
      if (!sms.ok) return json({ error: sms.error }, 502, cors);
      return json({ ok: true, normalizedPhone: phone }, 200, cors);
    }

    if (path === "/v1/auth/phone/verify-login" && request.method === "POST") {
      let body: { phone?: string; code?: string };
      try {
        body = (await request.json()) as { phone?: string; code?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const phone = normalizePhoneRu(String(body.phone || ""));
      const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
      if (!phone || code.length !== 6) {
        return json({ error: "validation" }, 400, cors);
      }
      const match = await otpCodeHash(env, phone, code);
      const result = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id, user_id, code_hash, attempts FROM auth_phone_otp
           WHERE phone_e164 = $1 AND purpose = 'login' AND consumed_at IS NULL AND expires_at > now()
           ORDER BY id DESC LIMIT 1`,
          [phone]
        );
        if (!r.rows.length) return { kind: "bad" as const };
        const row = r.rows[0] as {
          id: string;
          user_id: string;
          code_hash: string;
          attempts: number;
        };
        if (row.attempts >= MAX_OTP_ATTEMPTS) {
          return { kind: "bad" as const };
        }
        if (row.code_hash !== match) {
          await c.query(
            `UPDATE auth_phone_otp SET attempts = attempts + 1 WHERE id = $1`,
            [row.id]
          );
          return { kind: "bad" as const };
        }
        await c.query(
          `UPDATE auth_phone_otp SET consumed_at = now() WHERE id = $1`,
          [row.id]
        );
        const tok = await createSessionForUser(c, row.user_id);
        const u = await c.query(`SELECT email FROM users WHERE id = $1`, [
          row.user_id,
        ]);
        const email = String((u.rows[0] as { email: string }).email);
        return { kind: "ok" as const, token: tok, userId: row.user_id, email };
      });
      if (result.kind !== "ok") {
        return json({ error: "invalid_code" }, 401, cors);
      }
      const cookie = buildSessionCookie(result.token, reqUrl);
      return json(
        {
          ok: true,
          user: { id: result.userId, email: result.email },
        },
        200,
        cors,
        cookie
      );
    }

    if (path === "/v1/auth/phone/send-attach" && request.method === "POST") {
      const sess = await getSessionUser(request, env);
      if (!sess) return json({ error: "unauthorized" }, 401, cors);
      let body: { phone?: string };
      try {
        body = (await request.json()) as { phone?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const phone = normalizePhoneRu(String(body.phone || ""));
      if (!phone) return json({ error: "validation", field: "phone" }, 400, cors);
      if (!env.SMSRU_API_ID?.trim()) {
        return json({ error: "sms_not_configured" }, 503, cors);
      }
      const taken = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE phone_e164 = $1 AND id <> $2::uuid`,
          [phone, sess.id]
        );
        return r.rows.length > 0;
      });
      if (taken) return json({ error: "phone_taken" }, 409, cors);

      const recent = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id FROM auth_phone_otp
           WHERE phone_e164 = $1 AND purpose = 'attach' AND created_at > now() - interval '55 seconds'
           ORDER BY id DESC LIMIT 1`,
          [phone]
        );
        return r.rows.length > 0;
      });
      if (recent) return json({ error: "rate_limited" }, 429, cors);

      const code = randomOtp6();
      const code_hash = await otpCodeHash(env, phone, code);
      const exp = new Date(Date.now() + OTP_MINUTES * 60000).toISOString();
      await withDbClient(env, async (c) => {
        await c.query(
          `INSERT INTO auth_phone_otp (phone_e164, user_id, purpose, code_hash, expires_at)
           VALUES ($1, $2, 'attach', $3, $4::timestamptz)`,
          [phone, sess.id, code_hash, exp]
        );
      });
      const sms = await sendSmsRu(
        env,
        phone,
        `Код привязки телефона katalog-uslug.pro: ${code}`
      );
      if (!sms.ok) return json({ error: sms.error }, 502, cors);
      return json({ ok: true, normalizedPhone: phone }, 200, cors);
    }

    if (path === "/v1/auth/phone/verify-attach" && request.method === "POST") {
      const sess = await getSessionUser(request, env);
      if (!sess) return json({ error: "unauthorized" }, 401, cors);
      let body: { phone?: string; code?: string };
      try {
        body = (await request.json()) as { phone?: string; code?: string };
      } catch {
        return json({ error: "invalid_json" }, 400, cors);
      }
      const phone = normalizePhoneRu(String(body.phone || ""));
      const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
      if (!phone || code.length !== 6) {
        return json({ error: "validation" }, 400, cors);
      }
      const match = await otpCodeHash(env, phone, code);
      const ok = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id, user_id, code_hash, attempts FROM auth_phone_otp
           WHERE phone_e164 = $1 AND purpose = 'attach' AND user_id = $2::uuid
             AND consumed_at IS NULL AND expires_at > now()
           ORDER BY id DESC LIMIT 1`,
          [phone, sess.id]
        );
        if (!r.rows.length) return false;
        const row = r.rows[0] as {
          id: string;
          code_hash: string;
          attempts: number;
        };
        if (row.attempts >= MAX_OTP_ATTEMPTS) return false;
        if (row.code_hash !== match) {
          await c.query(
            `UPDATE auth_phone_otp SET attempts = attempts + 1 WHERE id = $1`,
            [row.id]
          );
          return false;
        }
        await c.query(
          `UPDATE auth_phone_otp SET consumed_at = now() WHERE id = $1`,
          [row.id]
        );
        await c.query(
          `UPDATE users SET phone_e164 = $1, phone_verified_at = now() WHERE id = $2::uuid`,
          [phone, sess.id]
        );
        return true;
      });
      if (!ok) return json({ error: "invalid_code" }, 400, cors);
      return json({ ok: true }, 200, cors);
    }

    if (path === "/v1/auth/logout" && request.method === "POST") {
      const token = parseCookie(request, SESSION_COOKIE);
      if (token) {
        const token_hash = await sha256hex(token);
        await withDbClient(env, async (c) => {
          await c.query(`DELETE FROM sessions WHERE token_hash = $1`, [
            token_hash,
          ]);
        });
      }
      const clear = buildClearSessionCookie(reqUrl);
      return json({ ok: true }, 200, cors, clear);
    }

    if (path === "/v1/auth/me" && request.method === "GET") {
      const u = await loadFullUser(request, env);
      if (!u) return json({ error: "unauthorized" }, 401, cors);
      return json({ user: u }, 200, cors);
    }

    return json({ error: "not_found" }, 404, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return json(
        {
          error: "db_not_ready",
          message:
            "Таблицы auth не созданы или устарели. Запустите миграции (в т.ч. 003_identity_providers.sql).",
        },
        503,
        cors
      );
    }
    return json({ error: "server_error", message: msg }, 500, cors);
  }
}

async function getSessionUser(
  request: Request,
  env: Env
): Promise<{ id: string } | null> {
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const token_hash = await sha256hex(token);
  return withDbClient(env, async (c) => {
    const r = await c.query(
      `SELECT u.id FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [token_hash]
    );
    const row = r.rows[0] as { id: string } | undefined;
    return row || null;
  });
}

async function loadFullUser(request: Request, env: Env) {
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const token_hash = await sha256hex(token);
  return withDbClient(env, async (c) => {
    const r = await c.query(
      `SELECT u.id, u.email, u.email_verified_at, u.phone_e164, u.phone_verified_at, u.display_name,
              (u.password_hash IS NOT NULL) AS "hasPassword"
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [token_hash]
    );
    const row = r.rows[0] as
      | {
          id: string;
          email: string;
          email_verified_at: string | null;
          phone_e164: string | null;
          phone_verified_at: string | null;
          display_name: string | null;
          hasPassword: boolean;
        }
      | undefined;
    if (!row) return null;
    const prov = await c.query(
      `SELECT provider FROM user_oauth_accounts WHERE user_id = $1`,
      [row.id]
    );
    const providers = (
      prov.rows as { provider: string }[]
    ).map((x) => x.provider);
    const phoneLast4 = row.phone_e164
      ? row.phone_e164.replace(/\D/g, "").slice(-4)
      : null;
    return {
      id: row.id,
      email: row.email,
      emailVerified: Boolean(row.email_verified_at),
      phoneVerified: Boolean(row.phone_verified_at),
      phoneLast4,
      displayName: row.display_name,
      hasPassword: Boolean(row.hasPassword),
      providers,
    };
  });
}
