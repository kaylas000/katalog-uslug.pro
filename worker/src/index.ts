import { Client } from "pg";

type Hyperdrive = { connectionString: string };

export interface Env {
  HYPERDRIVE?: Hyperdrive;
  ALLOWED_ORIGIN?: string;
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
  const cs = env.HYPERDRIVE?.connectionString;
  if (!cs) {
    throw new Error("HYPERDRIVE binding is not configured");
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
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/v1/health") {
      return Response.json(
        {
          ok: true,
          service: "katalog-uslug-api",
          db: Boolean(env.HYPERDRIVE?.connectionString),
        },
        { headers: cors }
      );
    }

    if (path === "/v1/catalog") {
      if (!env.HYPERDRIVE?.connectionString) {
        return Response.json(
          { error: "misconfigured", detail: "hyperdrive" },
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
      if (!env.HYPERDRIVE?.connectionString) {
        return Response.json(
          { error: "misconfigured", detail: "hyperdrive" },
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
