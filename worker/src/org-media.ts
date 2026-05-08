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

export async function resolveOrgMediaSource(
  env: Env,
  slugRaw: string,
  imageIndexOneBased: number
): Promise<string | null> {
  const slug = slugRaw.trim();
  if (!slug || slug.length > 96) return null;
  if (!Number.isInteger(imageIndexOneBased) || imageIndexOneBased < 1) {
    return null;
  }

  const row = await withDbClient(env, async (c) => {
    const r = await c.query<{
      org_id: string;
      portfolio_images: unknown;
      cover_url: string | null;
    }>(
      `SELECT
         o.id AS org_id,
         COALESCE(p.portfolio_images, '[]'::jsonb) AS portfolio_images,
         p.cover_url
       FROM organizations o
       JOIN categories c2 ON c2.id = o.category_id
       JOIN regions r2 ON r2.id = o.region_id
       JOIN organization_profiles p ON p.org_id = o.id
       WHERE COALESCE(NULLIF(trim(p.slug), ''), o.id) = $1
         AND o.published = true
         AND c2.is_public = true
         AND r2.is_active = true
         AND p.moderation_status = 'published'
       LIMIT 1`,
      [slug]
    );
    return r.rows[0];
  });
  if (!row) return null;

  const rawPortfolio = Array.isArray(row.portfolio_images)
    ? row.portfolio_images
    : [];
  const portfolio = rawPortfolio
    .map((v) => normalizeMediaUrl(v))
    .filter((v): v is string => Boolean(v));
  const all = portfolio.length > 0 ? portfolio : [normalizeMediaUrl(row.cover_url)].filter((v): v is string => Boolean(v));
  if (all.length === 0) return null;

  const idx = imageIndexOneBased - 1;
  if (idx < 0 || idx >= all.length) return null;
  return all[idx];
}
