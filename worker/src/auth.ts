import { Client } from "pg";
import bcrypt from "bcryptjs";
import type { Env } from "./types";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 11;

function getDbConnectionString(env: Env): string | undefined {
  return env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
}

async function withClient<T>(
  env: Env,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const cs = getDbConnectionString(env);
  if (!cs) throw new Error("Database URL missing");
  const client = new Client({ connectionString: cs });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
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

export function corsAuthHeaders(env: Env, request: Request): Headers {
  const origin = request.headers.get("Origin") || "";
  const allowedBase =
    env.ALLOWED_ORIGIN?.replace(/\/$/, "") || "https://katalog-uslug.pro";
  const allowed = new Set([
    allowedBase,
    "https://katalog-uslug.pro",
    "https://www.katalog-uslug.pro",
  ]);
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

export async function handleAuth(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (!path.startsWith("/v1/auth")) return null;

  const cors = corsAuthHeaders(env, request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const reqUrl = request.url;

  try {
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
      const token = randomToken();
      const token_hash = await sha256hex(token);
      const exp = new Date(
        Date.now() + SESSION_DAYS * 86400000
      ).toISOString();

      const result = await withClient(env, async (c) => {
        try {
          const ins = await c.query(
            `INSERT INTO users (email, password_hash) VALUES ($1, $2)
             RETURNING id, email`,
            [email, password_hash]
          );
          const u = ins.rows[0] as { id: string; email: string };
          await c.query(
            `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3::timestamptz)`,
            [u.id, token_hash, exp]
          );
          return { kind: "ok" as const, user: u, token };
        } catch (e: unknown) {
          const err = e as { code?: string };
          if (err.code === "23505") return { kind: "conflict" as const };
          throw e;
        }
      });

      if (result.kind === "conflict") {
        return json({ error: "email_taken" }, 409, cors);
      }

      const cookie = buildSessionCookie(result.token, reqUrl);
      return json(
        { ok: true, user: { id: result.user.id, email: result.user.email } },
        201,
        cors,
        cookie
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

      const row = await withClient(env, async (c) => {
        const r = await c.query(
          `SELECT id, email, password_hash FROM users WHERE lower(trim(email)) = $1`,
          [email]
        );
        if (!r.rows.length) return null;
        const u = r.rows[0] as {
          id: string;
          email: string;
          password_hash: string;
        };
        const ok = bcrypt.compareSync(password, u.password_hash);
        if (!ok) return null;
        return u;
      });

      if (!row) {
        return json({ error: "invalid_credentials" }, 401, cors);
      }

      const token = randomToken();
      const token_hash = await sha256hex(token);
      const exp = new Date(
        Date.now() + SESSION_DAYS * 86400000
      ).toISOString();
      await withClient(env, async (c) => {
        await c.query(
          `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3::timestamptz)`,
          [row.id, token_hash, exp]
        );
      });

      const cookie = buildSessionCookie(token, reqUrl);
      return json(
        { ok: true, user: { id: row.id, email: row.email } },
        200,
        cors,
        cookie
      );
    }

    if (path === "/v1/auth/logout" && request.method === "POST") {
      const token = parseCookie(request, SESSION_COOKIE);
      if (token) {
        const token_hash = await sha256hex(token);
        await withClient(env, async (c) => {
          await c.query(`DELETE FROM sessions WHERE token_hash = $1`, [
            token_hash,
          ]);
        });
      }
      const clear = buildClearSessionCookie(reqUrl);
      return json({ ok: true }, 200, cors, clear);
    }

    if (path === "/v1/auth/me" && request.method === "GET") {
      const token = parseCookie(request, SESSION_COOKIE);
      if (!token) {
        return json({ error: "unauthorized" }, 401, cors);
      }
      const token_hash = await sha256hex(token);
      const user = await withClient(env, async (c) => {
        const r = await c.query(
          `SELECT u.id, u.email FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now()`,
          [token_hash]
        );
        return r.rows[0] as { id: string; email: string } | undefined;
      });
      if (!user) {
        return json({ error: "unauthorized" }, 401, cors);
      }
      return json({ user }, 200, cors);
    }

    return json({ error: "not_found" }, 404, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return json(
        {
          error: "db_not_ready",
          message:
            "Таблицы auth или каталога не созданы. Запустите миграции в Neon (GitHub Actions → Neon DB migrations).",
        },
        503,
        cors
      );
    }
    return json({ error: "server_error", message: msg }, 500, cors);
  }
}
