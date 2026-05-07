import type { Env } from "./types";
import { withDbClient } from "./db";
import {
  encodeCatalogCursor,
  type CatalogCursor,
} from "./catalog-cursor";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

export type SortKey = "title" | "rating" | "updated";

export interface CatalogQueryParams {
  limit: number;
  sort: SortKey;
  categorySlug: string | null;
  regionSlug: string | null;
  locationId: string | null;
  minRating: number | null;
  qRaw: string | null;
}

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function parseSort(raw: string | null): SortKey {
  const s = (raw || "title").toLowerCase().trim();
  if (s === "rating" || s === "updated" || s === "title") return s;
  return "title";
}

function parseFloatOrNull(raw: string | null): number | null {
  if (!raw || !raw.trim()) return null;
  const x = Number.parseFloat(raw);
  return Number.isFinite(x) ? x : null;
}

function parseLocationId(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return /^\d+$/.test(value) ? value : null;
}

/** Паттерн для ILIKE с ESCAPE '\' */
export function sqlIlike(term: string): string {
  return `%${term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

export function parseCatalogV2Query(
  searchParams: URLSearchParams
): CatalogQueryParams {
  return {
    limit: parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT),
    sort: parseSort(searchParams.get("sort")),
    categorySlug:
      typeof searchParams.get("category") === "string"
        ? (searchParams.get("category") || "").trim() || null
        : null,
    regionSlug:
      typeof searchParams.get("region") === "string"
        ? (searchParams.get("region") || "").trim() || null
        : null,
    locationId: parseLocationId(searchParams.get("locationId")),
    minRating: parseFloatOrNull(searchParams.get("minRating")),
    qRaw:
      typeof searchParams.get("q") === "string"
        ? (searchParams.get("q") || "").trim() || null
        : null,
  };
}

function orderClause(sort: SortKey): string {
  switch (sort) {
    case "rating":
      return "ORDER BY o.rating DESC NULLS LAST, o.id ASC";
    case "updated":
      return "ORDER BY o.updated_at DESC NULLS LAST, o.id ASC";
    default:
      return "ORDER BY o.title ASC, o.id ASC";
  }
}

async function fetchPage(
  env: Env,
  params: CatalogQueryParams,
  cursor: CatalogCursor | null
): Promise<Record<string, unknown>[]> {
  const whereParts = [
    "o.published = true",
    "c.is_public = true",
    "r.is_active = true",
    "p.moderation_status = 'published'",
  ];
  const values: unknown[] = [];

  let n = 0;
  function ph(v: unknown): string {
    n += 1;
    values.push(v);
    return `$${n}`;
  }

  if (params.categorySlug) {
    whereParts.push(`c.slug = ${ph(params.categorySlug)}`);
  }
  if (params.regionSlug) {
    whereParts.push(`r.slug = ${ph(params.regionSlug)}`);
  }
  if (params.locationId) {
    const locA = ph(params.locationId);
    const locB = ph(params.locationId);
    whereParts.push(`(
      loc_org.id = ${locA}::bigint
      OR loc_org.ancestor_ids @> ARRAY[${locB}::bigint]
    )`);
  }
  if (
    params.minRating !== null &&
    params.minRating > 0 &&
    params.minRating <= 5
  ) {
    whereParts.push(`o.rating >= ${ph(String(params.minRating))}::numeric`);
  }

  if (params.qRaw && params.qRaw.length > 0) {
    const words = params.qRaw
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0 && w.length <= 80)
      .slice(0, 8);
    const needle =
      `(o.title || ' ' || o.subtitle || ' ' || o.listing_text || ' ' || c.label || ' ' || r.label)`;
    for (const w of words) {
      whereParts.push(`${needle} ILIKE ${ph(sqlIlike(w))} ESCAPE CHR(92)`);
    }
  }

  if (cursor) {
    if (params.sort === "title" && cursor.s === "t") {
      const a = ph(cursor.t);
      const b = ph(cursor.t);
      const cid = ph(cursor.id);
      whereParts.push(`(
        o.title > ${a}
        OR (o.title = ${b} AND o.id > ${cid}::text)
      )`);
    } else if (params.sort === "rating" && cursor.s === "r") {
      const a = ph(String(cursor.r));
      const b = ph(String(cursor.r));
      const cid = ph(cursor.id);
      whereParts.push(`(
        o.rating < ${a}::numeric
        OR (
          o.rating = ${b}::numeric AND o.id > ${cid}::text
        )
      )`);
    } else if (params.sort === "updated" && cursor.s === "u") {
      const a = ph(cursor.u);
      const b = ph(cursor.u);
      const cid = ph(cursor.id);
      whereParts.push(`(
        o.updated_at < ${a}::timestamptz
        OR (
          o.updated_at = ${b}::timestamptz AND o.id > ${cid}::text
        )
      )`);
    } else {
      const mismatch = new Error("cursor_mismatch");
      (mismatch as { status?: number }).status = 400;
      throw mismatch;
    }
  }

  const order = orderClause(params.sort);
  const fetchLimit = params.limit + 1;
  const locationJoin = params.locationId
    ? "LEFT JOIN locations loc_org ON loc_org.id = p.location_id"
    : "";

  const sql = `
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
    COALESCE(nullif(trim(p.slug), ''), o.id) AS "publicSlug",
    COALESCE(p.portfolio_images, '[]'::jsonb) AS "portfolioImages",
    o.updated_at
  FROM organizations o
  JOIN categories c ON c.id = o.category_id
  JOIN regions r ON r.id = o.region_id
  JOIN organization_profiles p ON p.org_id = o.id
  ${locationJoin}
  WHERE ${whereParts.join(" AND ")}
  ${order}
  LIMIT ${fetchLimit}
  `;

  return await withDbClient(env, async (client) => {
    const res = await client.query(sql, values);
    return res.rows as Record<string, unknown>[];
  });
}

function mapItem(row: Record<string, unknown>): Record<string, unknown> {
  const slug = String(row.publicSlug || row.id || "");
  const imgs = row.portfolioImages;
  let portfolioImages: string[] = [];
  if (Array.isArray(imgs)) {
    portfolioImages = imgs.filter((x): x is string => typeof x === "string");
  } else if (typeof imgs === "string") {
    try {
      const p = JSON.parse(imgs) as unknown;
      if (Array.isArray(p)) {
        portfolioImages = p.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* ignore */
    }
  }
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    text: row.text,
    categorySlug: row.categorySlug,
    categoryLabel: row.categoryLabel,
    regionSlug: row.regionSlug,
    regionLabel: row.regionLabel,
    rating: row.rating,
    reviews: row.reviews,
    url: `/org/${slug}/`,
    portfolioImages,
  };
}

function makeCursor(
  sort: SortKey,
  row: Record<string, unknown>
): CatalogCursor | null {
  const id = String(row.id ?? "");
  if (!id) return null;
  if (sort === "title") {
    return {
      s: "t",
      t: typeof row.title === "string" ? row.title : String(row.title ?? ""),
      id,
    };
  }
  if (sort === "rating") {
    const r = typeof row.rating === "number" ? row.rating : Number(row.rating);
    return { s: "r", r: Number.isFinite(r) ? r : 0, id };
  }
  const u =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at ?? "");
  return { s: "u", u, id };
}

export async function runCatalogV2(
  env: Env,
  searchParams: URLSearchParams,
  cursorDecoded: CatalogCursor | null
): Promise<{
  items: Record<string, unknown>[];
  nextCursor: string | null;
  meta: Record<string, unknown>;
}> {
  const params = parseCatalogV2Query(searchParams);
  const rows = await fetchPage(env, params, cursorDecoded);
  let nextCursorStr: string | null = null;
  let page = rows.map(mapItem);
  if (page.length > params.limit) {
    const boundary = rows[params.limit - 1] as Record<string, unknown>;
    const cur = makeCursor(params.sort, boundary);
    if (cur) nextCursorStr = encodeCatalogCursor(cur);
    page = page.slice(0, params.limit);
  }
  return {
    items: page,
    nextCursor: nextCursorStr,
    meta: {
      limit: params.limit,
      sort: params.sort,
      category: params.categorySlug,
      region: params.regionSlug,
      locationId: params.locationId,
      minRating: params.minRating,
      q: params.qRaw,
    },
  };
}

