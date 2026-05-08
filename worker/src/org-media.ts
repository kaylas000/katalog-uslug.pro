import type { Env } from "./types";
import { withDbClient } from "./db";

function normalizeMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/")) return `https://katalog-uslug.pro${v}`;
  return null;
}

function mediaPathFor(slug: string, indexZeroBased: number): string {
  return `/v1/org/${encodeURIComponent(slug)}/media/${indexZeroBased + 1}`;
}

export function mediaUrlsFor(slug: string, rawUrls: string[]): string[] {
  const clean = rawUrls
    .map((v) => normalizeMediaUrl(v))
    .filter((v): v is string => Boolean(v));
  return clean.map((_src, i) => mediaPathFor(slug, i));
}

export async function getOrgMediaBlob(
  env: Env,
  slugRaw: string,
  imageIndexOneBased: number
): Promise<{ contentType: string; data: Uint8Array } | null> {
  const slug = slugRaw.trim();
  if (!slug || slug.length > 96) return null;
  if (!Number.isInteger(imageIndexOneBased) || imageIndexOneBased < 1) {
    return null;
  }

  const row = await withDbClient(env, async (c) => {
    const r = await c.query<{
      content_type: string;
      data: Uint8Array;
    }>(
      `SELECT
         b.content_type,
         b.data
       FROM organizations o
       JOIN categories c2 ON c2.id = o.category_id
       JOIN regions r2 ON r2.id = o.region_id
       JOIN organization_profiles p ON p.org_id = o.id
       JOIN organization_media_blobs b ON b.org_id = o.id
       WHERE COALESCE(NULLIF(trim(p.slug), ''), o.id) = $1
         AND b.media_index = $2
         AND o.published = true
         AND c2.is_public = true
         AND r2.is_active = true
         AND p.moderation_status = 'published'
       LIMIT 1`,
      [slug, imageIndexOneBased]
    );
    return r.rows[0];
  });
  if (!row) return null;
  return {
    contentType:
      typeof row.content_type === "string" && row.content_type.trim()
        ? row.content_type.trim()
        : "application/octet-stream",
    data: row.data,
  };
}
