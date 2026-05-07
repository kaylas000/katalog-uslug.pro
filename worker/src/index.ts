import { handleAuth } from "./auth";
import { decodeCatalogCursor } from "./catalog-cursor";
import { runCatalogV2 } from "./catalog-v2";
import { getDbConnectionString, withDbClient } from "./db";
import { handleOrgAdmin } from "./org-admin";
import { getOrgPublicResponse } from "./org-public";
import type { Env } from "./types";

export type { Env } from "./types";

const CATALOG_SQL = `
  SELECT
    o.id,
    o.title,
    o.subtitle,
    o.listing_text AS "text",
    c.slug AS "categorySlug",
    c.label AS "categoryLabel",
    r.slug AS "regionSlug",
    r.label AS "regionLabel",
    CAST(o.rating AS double precision) AS rating,
    o.reviews,
    '/org/' || o.id || '/' AS url
  FROM organizations o
  JOIN categories c ON c.id = o.category_id
  JOIN regions r ON r.id = o.region_id
  WHERE o.published = true
  ORDER BY o.title
`;

const REGIONS_SQL = `
  SELECT slug, label, intro
  FROM regions
  ORDER BY label
`;

const ORG_META_SQL = {
  categories: `
    SELECT slug, label
    FROM categories
    WHERE is_public = true
    ORDER BY sort_order, label
  `,
  regions: `
    SELECT slug, label
    FROM regions
    WHERE is_active = true
    ORDER BY label
  `,
};

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const p = part.trim();
    const i = p.indexOf("=");
    if (i === -1) continue;
    if (p.slice(0, i).trim() === name) {
      return decodeURIComponent(p.slice(i + 1).trim());
    }
  }
  return null;
}

function parseSessionToken(req: Request): string | null {
  const fromCookie = parseCookie(req, "session");
  if (fromCookie) return fromCookie;
  const auth = req.headers.get("Authorization")?.trim();
  if (!auth) return null;
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

async function getSessionUserId(
  request: Request,
  env: Env
): Promise<string | null> {
  const token = parseSessionToken(request);
  if (!token) return null;
  const token_hash = await sha256hex(token);
  return withDbClient(env, async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT u.id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [token_hash]
    );
    return r.rows[0]?.id || null;
  });
}

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function corsHeaders(env: Env, request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "";
  const allowed =
    env.ALLOWED_ORIGIN ||
    "https://katalog-uslug.pro";
  const allow =
    origin === allowed || origin === "https://www.katalog-uslug.pro"
      ? origin
      : allowed;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path.startsWith("/v1/auth")) {
      const authRes = await handleAuth(request, env);
      if (authRes) return authRes;
    }

    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (path === "/v1/health") {
      const hasConn = Boolean(getDbConnectionString(env));
      let authSchemaOk: boolean | null = null;
      if (hasConn) {
        try {
          const row = await withDbClient(env, async (c) => {
            const r = await c.query<{
              users: boolean;
              sessions: boolean;
            }>(
              `SELECT
                 EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS users,
                 EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions') AS sessions`
            );
            return r.rows[0];
          });
          authSchemaOk = Boolean(row?.users && row?.sessions);
        } catch {
          authSchemaOk = false;
        }
      }
      return Response.json(
        {
          ok: true,
          service: "katalog-uslug-api",
          db: hasConn,
          /** false = миграции не накатили на эту БД или Hyperdrive смотрит не туда */
          authSchemaOk,
          /** Без секретов регистрация по коду на сайте недоступна */
          resendEmailConfigured: Boolean(env.RESEND_API_KEY?.trim()),
          smsRuConfigured: Boolean(env.SMSRU_API_ID?.trim()),
        },
        {
          headers: {
            ...cors,
            "Cache-Control": "no-store",
          },
        }
      );
    }

    if (path === "/v1/catalog") {
      if (!getDbConnectionString(env)) {
        return Response.json(
          { error: "misconfigured", detail: "db_connection" },
          { status: 503, headers: cors }
        );
      }
      if (url.searchParams.get("v") === "2") {
        const curRaw = url.searchParams.get("cursor");
        const decoded = decodeCatalogCursor(curRaw);
        try {
          const payload = await runCatalogV2(
            env,
            url.searchParams,
            decoded
          );
          return Response.json(payload, {
            headers: {
              ...cors,
              "Cache-Control": "public, max-age=30",
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "db_error";
          const st =
            e instanceof Error ? (e as { status?: number }).status : undefined;
          if (msg === "cursor_mismatch" || st === 400) {
            return Response.json(
              { error: "bad_cursor", message: "cursor does not match query." },
              { status: 400, headers: cors }
            );
          }
          return Response.json(
            { error: "catalog_unavailable", message: msg },
            { status: 502, headers: cors }
          );
        }
      }
      try {
        const rows = await withDbClient(env, async (c) => {
          const r = await c.query(CATALOG_SQL);
          return r.rows;
        });
        return Response.json(rows, { headers: cors });
      } catch (e) {
        const message = e instanceof Error ? e.message : "db_error";
        return Response.json(
          { error: "catalog_unavailable", message },
          { status: 502, headers: cors }
        );
      }
    }

    /** GET /v1/org/:slug (не пересекается с /v1/org/meta, /v1/org/applications) */
    const orgDetail = /^\/v1\/org\/([^/]+)$/.exec(path);
    const orgDetailReserved = new Set(["meta", "applications"]);
    if (
      orgDetail &&
      !orgDetailReserved.has(orgDetail[1] || "") &&
      request.method === "GET"
    ) {
      if (!getDbConnectionString(env)) {
        return Response.json(
          { error: "misconfigured", detail: "db_connection" },
          { status: 503, headers: cors }
        );
      }
      try {
        const res = await getOrgPublicResponse(
          env,
          decodeURIComponent(orgDetail[1] || "")
        );
        return Response.json(res.body, {
          status: res.status,
          headers: {
            ...cors,
            "Cache-Control":
              res.status === 200 ? "public, max-age=120" : "no-store",
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "db_error";
        return Response.json(
          { error: "org_detail_unavailable", message },
          { status: 502, headers: cors }
        );
      }
    }

    if (path === "/v1/regions") {
      if (!getDbConnectionString(env)) {
        return Response.json(
          { error: "misconfigured", detail: "db_connection" },
          { status: 503, headers: cors }
        );
      }
      try {
        const rows = await withDbClient(env, async (c) => {
          const r = await c.query(REGIONS_SQL);
          return r.rows;
        });
        return Response.json(rows, { headers: cors });
      } catch (e) {
        const message = e instanceof Error ? e.message : "db_error";
        return Response.json(
          { error: "regions_unavailable", message },
          { status: 502, headers: cors }
        );
      }
    }

    if (path === "/v1/org/meta" && request.method === "GET") {
      if (!getDbConnectionString(env)) {
        return Response.json(
          { error: "misconfigured", detail: "db_connection" },
          { status: 503, headers: cors }
        );
      }
      try {
        const data = await withDbClient(env, async (c) => {
          const [categories, regions] = await Promise.all([
            c.query(ORG_META_SQL.categories),
            c.query(ORG_META_SQL.regions),
          ]);
          return { categories: categories.rows, regions: regions.rows };
        });
        return Response.json(data, { headers: cors });
      } catch (e) {
        const message = e instanceof Error ? e.message : "db_error";
        return Response.json(
          { error: "org_meta_unavailable", message },
          { status: 502, headers: cors }
        );
      }
    }

    if (path === "/v1/org/applications" && request.method === "POST") {
      const userId = await getSessionUserId(request, env);
      if (!userId) {
        return Response.json(
          { error: "unauthorized", message: "Нужен вход в аккаунт." },
          { status: 401, headers: cors }
        );
      }
      let payload: {
        orgTitle?: string;
        orgSlug?: string;
        categorySlug?: string;
        regionSlug?: string;
        websiteUrl?: string;
        publicDescription?: string;
        publicContacts?: string;
        ownerPhone?: string;
        moderationNote?: string;
      };
      try {
        payload = (await request.json()) as typeof payload;
      } catch {
        return Response.json(
          { error: "invalid_json" },
          { status: 400, headers: cors }
        );
      }
      const orgTitle = (payload.orgTitle || "").trim();
      const categorySlug = (payload.categorySlug || "").trim();
      const regionSlug = (payload.regionSlug || "").trim();
      const websiteUrl = (payload.websiteUrl || "").trim();
      const publicDescription = (payload.publicDescription || "").trim();
      const publicContacts = (payload.publicContacts || "").trim();
      const ownerPhone = (payload.ownerPhone || "").trim();
      const moderationNote = (payload.moderationNote || "").trim();
      const orgSlug = normalizeSlug(payload.orgSlug || orgTitle);

      if (orgTitle.length < 3 || orgTitle.length > 140) {
        return Response.json(
          { error: "invalid_org_title", message: "Название 3-140 символов." },
          { status: 400, headers: cors }
        );
      }
      if (!orgSlug || orgSlug.length < 2) {
        return Response.json(
          { error: "invalid_org_slug", message: "Укажите корректный slug." },
          { status: 400, headers: cors }
        );
      }
      if (publicDescription.length < 20 || publicDescription.length > 4000) {
        return Response.json(
          {
            error: "invalid_description",
            message: "Описание 20-4000 символов.",
          },
          { status: 400, headers: cors }
        );
      }
      if (websiteUrl && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(websiteUrl)) {
        return Response.json(
          { error: "invalid_website", message: "Сайт должен начинаться с http(s)." },
          { status: 400, headers: cors }
        );
      }

      try {
        const inserted = await withDbClient(env, async (c) => {
          const [cat, reg] = await Promise.all([
            c.query(`SELECT slug FROM categories WHERE slug = $1`, [categorySlug]),
            c.query(`SELECT slug FROM regions WHERE slug = $1`, [regionSlug]),
          ]);
          if (!cat.rows.length) {
            return { kind: "err" as const, code: "invalid_category" };
          }
          if (!reg.rows.length) {
            return { kind: "err" as const, code: "invalid_region" };
          }
          const r = await c.query<{ id: string }>(
            `INSERT INTO organization_applications
              (applicant_user_id, org_slug, org_title, category_slug, region_slug, website_url, public_payload, private_payload, status)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'pending_moderation')
             RETURNING id`,
            [
              userId,
              orgSlug,
              orgTitle,
              categorySlug,
              regionSlug,
              websiteUrl || null,
              JSON.stringify({
                title: orgTitle,
                slug: orgSlug,
                description: publicDescription,
                contacts: publicContacts,
                websiteUrl: websiteUrl || null,
              }),
              JSON.stringify({
                ownerPhone: ownerPhone || null,
                moderationNote: moderationNote || null,
              }),
            ]
          );
          return { kind: "ok" as const, id: r.rows[0].id };
        });
        if (inserted.kind === "err") {
          return Response.json(
            { error: inserted.code },
            { status: 400, headers: cors }
          );
        }
        return Response.json(
          {
            ok: true,
            applicationId: inserted.id,
            status: "pending_moderation",
            message: "Заявка отправлена. После модерации появится публикация.",
          },
          { status: 201, headers: cors }
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "db_error";
        return Response.json(
          { error: "application_create_failed", message },
          { status: 502, headers: cors }
        );
      }
    }

    if (path === "/v1/org/applications/mine" && request.method === "GET") {
      const userId = await getSessionUserId(request, env);
      if (!userId) {
        return Response.json(
          { error: "unauthorized" },
          { status: 401, headers: cors }
        );
      }
      try {
        const rows = await withDbClient(env, async (c) => {
          const r = await c.query(
            `SELECT id, org_title, org_slug, category_slug, region_slug, status, rejection_reason, created_at, updated_at
             FROM organization_applications
             WHERE applicant_user_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT 50`,
            [userId]
          );
          return r.rows;
        });
        return Response.json({ items: rows }, { headers: cors });
      } catch (e) {
        const message = e instanceof Error ? e.message : "db_error";
        return Response.json(
          { error: "applications_unavailable", message },
          { status: 502, headers: cors }
        );
      }
    }

    const adminRes = await handleOrgAdmin(request, env, path, cors);
    if (adminRes) return adminRes;

    return Response.json(
      { error: "not_found" },
      { status: 404, headers: cors }
    );
  },
};
