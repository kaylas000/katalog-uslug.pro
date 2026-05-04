import type { Client } from "pg";
import type { Env } from "./types";

function b64urlFromBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomPkceVerifier(): string {
  const a = new Uint8Array(48);
  crypto.getRandomValues(a);
  return b64urlFromBytes(a.buffer);
}

export async function pkceS256Challenge(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return b64urlFromBytes(buf);
}

export function yandexCallbackUrl(requestUrl: string, env: Env): string {
  const explicit = env.YANDEX_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const u = new URL(requestUrl);
  u.pathname = "/v1/auth/oauth/yandex/callback";
  u.search = "";
  u.hash = "";
  return u.toString();
}

export async function exchangeYandexCode(
  env: Env,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<
  | { ok: true; access_token: string }
  | { ok: false; error: string }
> {
  const id = env.YANDEX_CLIENT_ID?.trim();
  const sec = env.YANDEX_CLIENT_SECRET?.trim();
  if (!id || !sec) return { ok: false, error: "yandex_not_configured" };
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: id,
    client_secret: sec,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const r = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: t.slice(0, 400) };
  }
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) return { ok: false, error: "no_access_token" };
  return { ok: true, access_token: j.access_token };
}

export async function fetchYandexLoginInfo(accessToken: string): Promise<{
  id: string;
  default_email?: string;
  login?: string;
  display_name?: string;
} | null> {
  const r = await fetch(
    "https://login.yandex.ru/info?format=json",
    {
      headers: { Authorization: `OAuth ${accessToken}` },
    }
  );
  if (!r.ok) return null;
  const j = (await r.json()) as {
    id?: string | number;
    default_email?: string;
    login?: string;
    display_name?: string;
  };
  const id = j.id != null ? String(j.id) : "";
  if (!id) return null;
  return {
    id,
    default_email: j.default_email,
    login: j.login,
    display_name: j.display_name,
  };
}

export async function upsertYandexUser(
  c: Client,
  yandexId: string,
  emailRaw: string | undefined,
  displayName: string | undefined
): Promise<{ userId: string; email: string }> {
  const existingLink = await c.query(
    `SELECT user_id FROM user_oauth_accounts
     WHERE provider = 'yandex' AND provider_user_id = $1`,
    [yandexId]
  );
  if (existingLink.rows.length) {
    const userId = String(
      (existingLink.rows[0] as { user_id: string }).user_id
    );
    const u = await c.query(`SELECT email FROM users WHERE id = $1`, [
      userId,
    ]);
    const email = String((u.rows[0] as { email: string }).email);
    return { userId, email };
  }

  const emailNorm = (emailRaw || "").trim().toLowerCase();
  const email =
    emailNorm && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)
      ? emailNorm
      : `yandex-${yandexId}@oauth.katalog-uslug.local`;

  const byEmail = await c.query(
    `SELECT id, email_verified_at FROM users WHERE lower(trim(email)) = $1`,
    [email]
  );
  if (byEmail.rows.length) {
    const row = byEmail.rows[0] as {
      id: string;
      email_verified_at: string | null;
    };
    await c.query(
      `INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id, email_snapshot)
       VALUES ($1, 'yandex', $2, $3)
       ON CONFLICT (provider, provider_user_id) DO NOTHING`,
      [row.id, yandexId, emailRaw || null]
    );
    if (!row.email_verified_at) {
      await c.query(
        `UPDATE users SET email_verified_at = now() WHERE id = $1`,
        [row.id]
      );
    }
    if (displayName) {
      await c.query(
        `UPDATE users SET display_name = COALESCE(display_name, $2) WHERE id = $1`,
        [row.id, displayName]
      );
    }
    const u2 = await c.query(`SELECT email FROM users WHERE id = $1`, [
      row.id,
    ]);
    return {
      userId: row.id,
      email: String((u2.rows[0] as { email: string }).email),
    };
  }

  const ins = await c.query(
    `INSERT INTO users (email, password_hash, email_verified_at, display_name)
     VALUES ($1, NULL, now(), $2)
     RETURNING id, email`,
    [email, displayName || null]
  );
  const u = ins.rows[0] as { id: string; email: string };
  await c.query(
    `INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id, email_snapshot)
     VALUES ($1, 'yandex', $2, $3)`,
    [u.id, yandexId, emailRaw || null]
  );
  return { userId: u.id, email: u.email };
}
