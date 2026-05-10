import { withDbClient } from "./db";
import type { Env } from "./types";

type LocationKind = "region" | "district" | "city" | "settlement";
type CursorV1 = { v: 1; k: { labelNorm: string; id: string } };

function b64urlEncode(str: string): string {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str: string): string {
  const b64 =
    str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

function decodeCursor(raw: string | null): CursorV1 | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(b64urlDecode(raw));
    if (obj?.v !== 1 || !obj?.k?.labelNorm || !obj?.k?.id) return null;
    return obj as CursorV1;
  } catch {
    return null;
  }
}

function encodeCursor(cur: CursorV1): string {
  return b64urlEncode(JSON.stringify(cur));
}

function normLabel(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function parseLimit(v: string | null, def = 10, max = 50): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function parseBigintString(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  return t;
}

function parseKinds(v: string | null): LocationKind[] | null {
  if (!v) return null;
  const allowed: LocationKind[] = ["region", "district", "city", "settlement"];
  const set = new Set<LocationKind>();
  for (const part of v.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (allowed.includes(part as LocationKind)) set.add(part as LocationKind);
  }
  return set.size ? Array.from(set) : null;
}

export async function handleLocations(
  request: Request,
  env: Env,
  cors: HeadersInit
): Promise<Response> {
  const url = new URL(request.url);
  const id = parseBigintString(url.searchParams.get("id"));
  const qRaw = (url.searchParams.get("q") || "").trim();
  const q = qRaw.length >= 2 ? normLabel(qRaw).slice(0, 80) : null;
  const kinds = parseKinds(url.searchParams.get("kinds"));
  const limit = parseLimit(url.searchParams.get("limit"), 10, 50);

  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const cursorLabelNorm = cursor?.k?.labelNorm ?? null;
  const cursorId = cursor?.k?.id ?? null;

  const regionIdParam = parseBigintString(url.searchParams.get("regionId"));
  const regionSlug = (url.searchParams.get("regionSlug") || "").trim() || null;

  try {
    const result = await withDbClient(env, async (c) => {
      if (id) {
        const r = await c.query(
          `
          SELECT
            l.id::text AS id, l.kind, l.slug, l.label,
            l.parent_id::text AS "parentId",
            p.label AS "parentLabel",
            l.region_id::text AS "regionId",
            rg.label AS "regionLabel"
          FROM locations l
          LEFT JOIN locations p ON p.id = l.parent_id
          LEFT JOIN locations rg ON rg.id = l.region_id
          WHERE l.id = $1::bigint
          LIMIT 1
          `,
          [id]
        );
        const item = r.rows[0] || null;
        return { items: item ? [item] : [], nextCursor: null };
      }

      let regionId = regionIdParam;
      if (!regionId && regionSlug) {
        const rr = await c.query(
          `SELECT id::text AS id FROM locations WHERE kind='region' AND slug=$1::text LIMIT 1`,
          [regionSlug]
        );
        regionId = rr.rows[0]?.id ?? null;
      }

      const r = await c.query(
        `
        SELECT
          l.id::text AS id,
          l.kind,
          l.slug,
          l.label,
          l.parent_id::text AS "parentId",
          p.label AS "parentLabel",
          l.region_id::text AS "regionId",
          rg.label AS "regionLabel"
        FROM locations l
        LEFT JOIN locations p ON p.id = l.parent_id
        LEFT JOIN locations rg ON rg.id = l.region_id
        WHERE
          ($1::text IS NULL OR l.label_norm ILIKE ('%' || $1::text || '%'))
          AND ($2::bigint IS NULL OR l.region_id = $2::bigint)
          AND ($3::text[] IS NULL OR l.kind = ANY($3::text[]))
          AND ($4::text IS NULL OR (l.label_norm, l.id) > ($4::text, $5::bigint))
        ORDER BY l.label_norm ASC, l.id ASC
        LIMIT $6::int
        `,
        [q, regionId, kinds, cursorLabelNorm, cursorId, limit]
      );

      const items = r.rows;
      let nextCursor: string | null = null;
      if (items.length === limit) {
        const last = items[items.length - 1] as { label: string; id: string };
        nextCursor = encodeCursor({
          v: 1,
          k: { labelNorm: normLabel(last.label), id: String(last.id) },
        });
      }

      return { items, nextCursor };
    });

    return Response.json(
      {
        items: result.items,
        nextCursor: result.nextCursor,
        meta: {
          limit,
          q: qRaw || null,
          kinds,
          regionId: regionIdParam || null,
          regionSlug,
        },
      },
      { headers: { ...cors, "Cache-Control": "public, max-age=0, s-maxage=60" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "locations_error";
    return Response.json(
      { error: "locations_unavailable", message },
      { status: 502, headers: cors }
    );
  }
}
