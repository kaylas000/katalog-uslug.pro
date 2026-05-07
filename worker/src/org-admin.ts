import { withDbClient } from "./db";
import type { Env } from "./types";

const ADMIN_BASE = "/v1/admin/org-applications";

function splitLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function guessContactType(
  value: string
): "phone" | "email" | "website" | "messenger" | "social" {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return "website";
  if (v.includes("@")) return "email";
  if (/[0-9][0-9\s()+-]{6,}/.test(v)) return "phone";
  return "messenger";
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ae = enc.encode(a);
  const be = enc.encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function hasAdminKey(env: Env): boolean {
  return Boolean(env.ADMIN_MODERATION_KEY?.trim());
}

function isAdminAuthorized(request: Request, env: Env): boolean {
  const secret = env.ADMIN_MODERATION_KEY?.trim();
  if (!secret) return false;
  const auth = request.headers.get("Authorization")?.trim() || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const token = m?.[1]?.trim();
  if (!token) return false;
  return timingSafeEqualUtf8(secret, token);
}

function parsePath(path: string): { id: string; action: "approve" | "reject" } | null {
  const m = /^\/v1\/admin\/org-applications\/([^/]+)\/(approve|reject)$/.exec(path);
  if (!m) return null;
  return { id: m[1], action: m[2] as "approve" | "reject" };
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

export async function handleOrgAdmin(
  request: Request,
  env: Env,
  path: string,
  cors: HeadersInit
): Promise<Response | null> {
  if (path !== ADMIN_BASE && !path.startsWith(`${ADMIN_BASE}/`)) return null;

  if (!hasAdminKey(env)) {
    return Response.json(
      { error: "admin_disabled", message: "Set ADMIN_MODERATION_KEY in Worker secrets." },
      { status: 503, headers: cors }
    );
  }
  if (!isAdminAuthorized(request, env)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: cors });
  }

  if (path === ADMIN_BASE && request.method === "GET") {
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || "").trim();
    try {
      const rows = await withDbClient(env, async (c) => {
        const r = await c.query(
          `SELECT id, applicant_user_id, org_title, org_slug, category_slug, region_slug,
                  status, rejection_reason, created_at, updated_at
           FROM organization_applications
           WHERE ($1::text = '' OR status = $1)
           ORDER BY created_at DESC
           LIMIT 200`,
          [status]
        );
        return r.rows;
      });
      return Response.json({ items: rows }, { headers: cors });
    } catch (e) {
      const message = e instanceof Error ? e.message : "db_error";
      return Response.json(
        { error: "admin_list_failed", message },
        { status: 502, headers: cors }
      );
    }
  }

  const details = parsePath(path);
  if (!details || request.method !== "POST" || !isUuid(details.id)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: cors });
  }

  if (details.action === "approve") {
    try {
      const updated = await withDbClient(env, async (c) => {
        await c.query("BEGIN");
        try {
          const appRes = await c.query<{
            id: string;
            org_slug: string | null;
            org_title: string;
            category_slug: string | null;
            region_slug: string | null;
            website_url: string | null;
            public_payload: unknown;
            status: string;
          }>(
            `SELECT id, org_slug, org_title, category_slug, region_slug, website_url, public_payload, status
             FROM organization_applications
             WHERE id = $1::uuid
             FOR UPDATE`,
            [details.id]
          );
          const app = appRes.rows[0];
          if (!app) {
            await c.query("ROLLBACK");
            return { ok: false as const, status: null };
          }
          if (app.status !== "pending_moderation") {
            await c.query("ROLLBACK");
            return { ok: false as const, status: app.status };
          }
          const orgId = (app.org_slug || "").trim();
          if (!orgId) {
            await c.query("ROLLBACK");
            return { ok: false as const, status: "invalid_org_slug" };
          }
          const [catRes, regRes] = await Promise.all([
            c.query<{ id: string }>(`SELECT id::text FROM categories WHERE slug = $1`, [app.category_slug || ""]),
            c.query<{ id: string }>(`SELECT id::text FROM regions WHERE slug = $1`, [app.region_slug || ""]),
          ]);
          const categoryId = catRes.rows[0]?.id;
          const regionId = regRes.rows[0]?.id;
          if (!categoryId || !regionId) {
            await c.query("ROLLBACK");
            return { ok: false as const, status: "invalid_taxonomy" };
          }

          const payload =
            app.public_payload && typeof app.public_payload === "object"
              ? (app.public_payload as Record<string, unknown>)
              : {};
          const listingTextRaw = payload.description;
          const listingText =
            typeof listingTextRaw === "string" && listingTextRaw.trim().length > 0
              ? listingTextRaw.trim()
              : app.org_title;

          const contactsRaw = payload.contacts;
          const contactLines =
            typeof contactsRaw === "string" ? splitLines(contactsRaw) : [];
          const subtitle = contactLines.slice(0, 4).join("\n");

          const existing = await c.query(`SELECT id FROM organizations WHERE id = $1`, [orgId]);
          if (!existing.rows.length) {
            await c.query(
              `INSERT INTO organizations
                (id, title, subtitle, listing_text, category_id, region_id, rating, reviews, published, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, 0, 0, true, now(), now())`,
              [orgId, app.org_title, subtitle, listingText, categoryId, regionId]
            );
          } else {
            await c.query(
              `UPDATE organizations
               SET title = $2,
                   subtitle = $3,
                   listing_text = $4,
                   category_id = $5::bigint,
                   region_id = $6::bigint,
                   published = true,
                   updated_at = now()
               WHERE id = $1`,
              [orgId, app.org_title, subtitle, listingText, categoryId, regionId]
            );
          }

          await c.query(
            `INSERT INTO organization_profiles
              (org_id, slug, description_md, website_url, moderation_status, published_at, updated_at)
             VALUES ($1, $1, $2, $3, 'published', now(), now())
             ON CONFLICT (org_id) DO UPDATE SET
               slug = EXCLUDED.slug,
               description_md = EXCLUDED.description_md,
               website_url = EXCLUDED.website_url,
               moderation_status = 'published',
               published_at = COALESCE(organization_profiles.published_at, now()),
               updated_at = now()`,
            [orgId, listingText, app.website_url]
          );

          if (contactLines.length > 0) {
            for (let i = 0; i < contactLines.length; i += 1) {
              const v = contactLines[i]!;
              const t = guessContactType(v);
              await c.query(
                `INSERT INTO organization_public_contacts
                  (org_id, contact_type, contact_value, contact_label, is_primary, sort_order)
                 VALUES ($1, $2, $3, NULL, $4, $5)
                 ON CONFLICT (org_id, contact_type, contact_value) DO UPDATE SET
                   sort_order = LEAST(organization_public_contacts.sort_order, EXCLUDED.sort_order),
                   is_primary = organization_public_contacts.is_primary OR EXCLUDED.is_primary`,
                [orgId, t, v, i === 0, 100 + i]
              );
            }
          }

          await c.query(
            `UPDATE organization_applications
             SET status = 'published',
                 rejection_reason = NULL,
                 result_org_id = $2,
                 updated_at = now()
             WHERE id = $1::uuid`,
            [details.id, orgId]
          );

          await c.query("COMMIT");
          return { ok: true as const, orgId };
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      });
      if (!updated.ok) {
        if (!updated.status) return Response.json({ error: "not_found" }, { status: 404, headers: cors });
        if (updated.status === "invalid_org_slug") {
          return Response.json({ error: "invalid_org_slug" }, { status: 400, headers: cors });
        }
        if (updated.status === "invalid_taxonomy") {
          return Response.json({ error: "invalid_category_or_region" }, { status: 400, headers: cors });
        }
        return Response.json(
          { error: "invalid_status", status: updated.status },
          { status: 409, headers: cors }
        );
      }
      return Response.json(
        { ok: true, id: details.id, status: "published", organizationId: updated.orgId },
        { headers: cors }
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "db_error";
      return Response.json({ error: "approve_failed", message }, { status: 502, headers: cors });
    }
  }

  let payload: { reason?: string };
  try {
    payload = (await request.json()) as { reason?: string };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: cors });
  }
  const reason = (payload.reason || "").trim();
  if (reason.length < 3 || reason.length > 2000) {
    return Response.json(
      { error: "invalid_reason", message: "Reason length must be 3..2000 symbols." },
      { status: 400, headers: cors }
    );
  }
  try {
    const updated = await withDbClient(env, async (c) => {
      const r = await c.query(
        `UPDATE organization_applications
         SET status = 'rejected',
             rejection_reason = $2,
             updated_at = now()
         WHERE id = $1::uuid AND status = 'pending_moderation'
         RETURNING id, status`,
        [details.id, reason]
      );
      if (r.rows.length > 0) return { ok: true as const };
      const cur = await c.query(`SELECT status FROM organization_applications WHERE id = $1::uuid`, [
        details.id,
      ]);
      return { ok: false as const, status: cur.rows[0]?.status || null };
    });
    if (!updated.ok) {
      if (!updated.status) return Response.json({ error: "not_found" }, { status: 404, headers: cors });
      return Response.json(
        { error: "invalid_status", status: updated.status },
        { status: 409, headers: cors }
      );
    }
    return Response.json({ ok: true, id: details.id, status: "rejected" }, { headers: cors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "db_error";
    return Response.json({ error: "reject_failed", message }, { status: 502, headers: cors });
  }
}

