import type { Env } from "./types";
import { withDbClient } from "./db";

function jsonPortfolio(imgs: unknown): string[] {
  if (Array.isArray(imgs)) {
    return imgs.filter((x): x is string => typeof x === "string");
  }
  return [];
}

/** Возвращает JSON и HTTP-статус для GET /v1/org/:slug. */
export async function getOrgPublicResponse(
  env: Env,
  slugParam: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const slug = slugParam.trim();
  if (!slug || slug.length > 96) {
    return { status: 400, body: { error: "invalid_slug" } };
  }

  try {
    const data = await withDbClient(env, async (c) => {
      const cols = await c.query<{ has_legacy: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'organization_profiles'
             AND column_name = 'legacy_article_html'
         ) AS has_legacy`
      );
      const hasLegacy = Boolean(cols.rows[0]?.has_legacy);
      const legacySelect = hasLegacy
        ? `, p.legacy_article_html AS "legacyArticleHtml",
           p.legacy_sidebar_html AS "legacySidebarHtml"`
        : `, ''::text AS "legacyArticleHtml",
           ''::text AS "legacySidebarHtml"`;

      const core = await c.query(
        `SELECT
           o.id,
           o.title,
           o.subtitle,
           o.listing_text AS "listingText",
           c.slug AS "categorySlug",
           c.label AS "categoryLabel",
           r.slug AS "regionSlug",
           r.label AS "regionLabel",
           CAST(o.rating AS double precision) AS rating,
           o.reviews,
           coalesce(nullif(trim(p.slug), ''), o.id) AS slug,
           p.legal_name AS "legalName",
           p.description_md AS "descriptionMd",
           p.website_url AS "websiteUrl",
           p.logo_url AS "logoUrl",
           p.cover_url AS "coverUrl",
           p.address_text AS "addressText",
           p.work_hours_json AS "workHours",
           p.verification_status AS "verificationStatus",
           p.moderation_status AS "moderationStatus",
           coalesce(p.portfolio_images, '[]'::jsonb) AS "portfolioImages"
           ${legacySelect}
         FROM organizations o
         JOIN categories c ON c.id = o.category_id
         JOIN regions r ON r.id = o.region_id
         JOIN organization_profiles p ON p.org_id = o.id
         WHERE coalesce(nullif(trim(p.slug), ''), o.id) = $1
           AND o.published = true
           AND c.is_public = true
           AND r.is_active = true
           AND p.moderation_status = 'published'
         LIMIT 1`,
        [slug]
      );
      const row = core.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        return null;
      }

      const orgId = String(row.id);

      const [contactsRes, servicesRes, tagsRes] = await Promise.all([
        c.query(
          `SELECT contact_type AS "contactType", contact_value AS "contactValue",
                  contact_label AS "contactLabel", is_primary AS "isPrimary",
                  sort_order AS "sortOrder"
           FROM organization_public_contacts
           WHERE org_id = $1
           ORDER BY is_primary DESC, sort_order ASC, id ASC`,
          [orgId]
        ),
        c.query(
          `SELECT service_slug AS "slug", service_title AS "title",
                  service_description AS "description",
                  price_from AS "priceFrom", price_to AS "priceTo", currency AS "currency"
           FROM organization_services
           WHERE org_id = $1 AND is_active = true
           ORDER BY sort_order ASC, id ASC`,
          [orgId]
        ),
        c.query(
          `SELECT t.slug AS "slug", t.label AS "label", t.tag_type AS "tagType"
           FROM organization_tags ot
           JOIN tags t ON t.id = ot.tag_id
           WHERE ot.org_id = $1
           ORDER BY t.label ASC`,
          [orgId]
        ),
      ]);

      const publicSlug = String(row.slug ?? orgId);
      const portfolioImages = jsonPortfolio(row.portfolioImages);

      return {
        id: orgId,
        slug: publicSlug,
        title: row.title,
        subtitle: row.subtitle,
        listingText: row.listingText,
        category: {
          slug: row.categorySlug,
          label: row.categoryLabel,
        },
        region: {
          slug: row.regionSlug,
          label: row.regionLabel,
        },
        rating: row.rating,
        reviews: row.reviews,
        url: `/org/${publicSlug}/`,
        profile: {
          legalName: row.legalName ?? null,
          descriptionMd: row.descriptionMd ?? "",
          websiteUrl: row.websiteUrl ?? null,
          logoUrl: row.logoUrl ?? null,
          coverUrl: row.coverUrl ?? null,
          addressText: row.addressText ?? null,
          workHours: row.workHours ?? [],
          verificationStatus: row.verificationStatus,
          moderationStatus: row.moderationStatus,
          portfolioImages,
        },
        legacy: {
          articleHtml:
            typeof row.legacyArticleHtml === "string"
              ? row.legacyArticleHtml
              : "",
          sidebarHtml:
            typeof row.legacySidebarHtml === "string"
              ? row.legacySidebarHtml
              : "",
        },
        contacts: contactsRes.rows,
        services: servicesRes.rows,
        tags: tagsRes.rows,
        media: portfolioImages.map((src) => ({ kind: "image", url: src })),
      } as Record<string, unknown>;
    });

    if (data === null) {
      return { status: 404, body: { error: "not_found" } };
    }
    return { status: 200, body: data };
  } catch {
    return { status: 502, body: { error: "org_detail_unavailable" } };
  }
}
