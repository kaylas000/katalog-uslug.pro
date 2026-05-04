import { Client } from "pg";
import { handleAuth } from "./auth";
import type { Env } from "./types";

export type { Env } from "./types";

function getDbConnectionString(env: Env): string | undefined {
  return env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
}

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

async function withClient<T>(
  env: Env,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const cs = getDbConnectionString(env);
  if (!cs) {
    throw new Error("Database URL missing: set Hyperdrive or DATABASE_URL for dev");
  }
  const client = new Client({
    connectionString: cs,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
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
      return Response.json(
        {
          ok: true,
          service: "katalog-uslug-api",
          db: Boolean(getDbConnectionString(env)),
        },
        { headers: cors }
      );
    }

    if (path === "/v1/catalog") {
      if (!getDbConnectionString(env)) {
        return Response.json(
          { error: "misconfigured", detail: "db_connection" },
          { status: 503, headers: cors }
        );
      }
      try {
        const rows = await withClient(env, async (c) => {
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

    if (path === "/v1/regions") {
      if (!getDbConnectionString(env)) {
        return Response.json(
          { error: "misconfigured", detail: "db_connection" },
          { status: 503, headers: cors }
        );
      }
      try {
        const rows = await withClient(env, async (c) => {
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

    return Response.json(
      { error: "not_found" },
      { status: 404, headers: cors }
    );
  },
};
