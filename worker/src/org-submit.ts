import type { Client } from "pg";

export function normalizeOrgSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function splitLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 24);
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

/** At least one phone or email in free-text or structured list. */
export function hasEmailOrPhoneInContacts(
  publicContactsText: string,
  structured: unknown
): boolean {
  if (Array.isArray(structured)) {
    for (const row of structured) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const pub = o.isPublic !== false;
      if (!pub) continue;
      const v = typeof o.value === "string" ? o.value.trim() : "";
      if (!v) continue;
      if (v.includes("@") && v.length > 3) return true;
      if (/[0-9][0-9\s()+-]{6,}/.test(v)) return true;
    }
  }
  for (const line of splitLines(publicContactsText)) {
    if (line.includes("@") && line.length > 3) return true;
    if (/[0-9][0-9\s()+-]{6,}/.test(line)) return true;
  }
  return false;
}

export type SubmitPayload = {
  orgTitle?: string;
  orgSlug?: string;
  categorySlug?: string;
  categoryNewLabel?: string;
  /** Устарело: регион выводится из выбранной локации на сервере. */
  regionSlug?: string;
  locationId?: string | number;
  websiteUrl?: string;
  publicDescription?: string;
  publicContacts?: string;
  contacts?: unknown;
  addressText?: string;
  addressIsPublic?: boolean;
  legalForm?: string;
  inn?: string;
  ogrn?: string;
  legalAddress?: string;
  contactPersonName?: string;
  ownerPhone?: string;
  moderationNote?: string;
  portfolioUrls?: unknown;
  portfolioImages?: unknown;
  consentProcessing?: boolean;
};

export type SubmitOk = {
  kind: "ok";
  applicationId: string;
  orgId: string;
  slug: string;
  status: string;
};

export type SubmitErr = { kind: "err"; code: string; message?: string; status?: number };

export async function submitOrganizationApplication(
  client: Client,
  userId: string,
  payload: SubmitPayload,
  submitterIp: string | null
): Promise<SubmitOk | SubmitErr> {
  const orgTitle = (payload.orgTitle || "").trim();
  const categorySlugRaw = (payload.categorySlug || "").trim();
  const categoryNewLabel = (payload.categoryNewLabel || "").trim().slice(0, 80);
  const categorySlug = categorySlugRaw === "__new__" ? "" : categorySlugRaw;
  const websiteUrl = (payload.websiteUrl || "").trim();
  const publicDescription = (payload.publicDescription || "").trim();
  const publicContacts = (payload.publicContacts || "").trim();
  const orgSlug = normalizeOrgSlug(payload.orgSlug || orgTitle);
  const locationRaw =
    payload.locationId === null || payload.locationId === undefined
      ? ""
      : String(payload.locationId).trim();
  const consent = payload.consentProcessing === true;
  const addressText = (payload.addressText || "").trim();
  const addressIsPublic = payload.addressIsPublic !== false;
  const legalForm = (payload.legalForm || "").trim().slice(0, 32);
  const inn = (payload.inn || "").trim().slice(0, 20);
  const ogrn = (payload.ogrn || "").trim().slice(0, 20);
  const legalAddress = (payload.legalAddress || "").trim().slice(0, 500);
  const contactPersonName = (payload.contactPersonName || "").trim().slice(0, 200);
  const ownerPhone = (payload.ownerPhone || "").trim().slice(0, 40);
  const moderationNote = (payload.moderationNote || "").trim().slice(0, 500);

  const allowedImageMime = new Set(["image/jpeg", "image/png", "image/webp"]);
  type UploadedImage = { contentType: string; base64: string };
  let uploadedImages: UploadedImage[] = [];

  if (Array.isArray(payload.portfolioImages)) {
    for (const row of payload.portfolioImages.slice(0, 4)) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const ct = String(rec.contentType || "").trim().toLowerCase();
      const dataUrl = String(rec.dataUrl || "");
      if (!ct || !allowedImageMime.has(ct)) {
        return {
          kind: "err",
          code: "invalid_image_type",
          message: "Поддерживаются изображения JPG, PNG, WEBP.",
          status: 400,
        };
      }
      const m = /^data:([a-z0-9/+.-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
      if (!m) {
        return {
          kind: "err",
          code: "invalid_image_data",
          message: "Некорректный формат изображения.",
          status: 400,
        };
      }
      const mimeFromDataUrl = String(m[1] || "").toLowerCase();
      if (mimeFromDataUrl !== ct) {
        return {
          kind: "err",
          code: "invalid_image_type",
          message: "MIME-тип изображения не совпадает с данными файла.",
          status: 400,
        };
      }
      const b64 = String(m[2] || "").replace(/\s+/g, "");
      const bytesEstimate = Math.floor((b64.length * 3) / 4);
      if (!b64 || bytesEstimate < 512) {
        return {
          kind: "err",
          code: "invalid_image_data",
          message: "Пустое или поврежденное изображение.",
          status: 400,
        };
      }
      if (bytesEstimate > 8 * 1024 * 1024) {
        return {
          kind: "err",
          code: "image_too_large",
          message: "Изображение больше 8 МБ. Уменьшите файл.",
          status: 400,
        };
      }
      uploadedImages.push({ contentType: ct, base64: b64 });
    }
  }
  if (uploadedImages.length > 4) uploadedImages = uploadedImages.slice(0, 4);

  let portfolioUrls: string[] = [];
  if (Array.isArray(payload.portfolioUrls)) {
    portfolioUrls = payload.portfolioUrls
      .filter((x): x is string => typeof x === "string")
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  if (!consent) {
    return {
      kind: "err",
      code: "consent_required",
      message: "Нужно согласие на обработку ПДн и публикацию контактов.",
      status: 400,
    };
  }
  if (orgTitle.length < 3 || orgTitle.length > 140) {
    return {
      kind: "err",
      code: "invalid_org_title",
      message: "Название 3–140 символов.",
      status: 400,
    };
  }
  if (!orgSlug || orgSlug.length < 2) {
    return {
      kind: "err",
      code: "invalid_org_slug",
      message: "Укажите корректный идентификатор (slug).",
      status: 400,
    };
  }
  if (!locationRaw || !/^\d+$/.test(locationRaw)) {
    return {
      kind: "err",
      code: "invalid_location",
      message: "Выберите населённый пункт из подсказок (locationId).",
      status: 400,
    };
  }
  if (publicDescription.length < 20 || publicDescription.length > 4000) {
    return {
      kind: "err",
      code: "invalid_description",
      message: "Описание 20–4000 символов.",
      status: 400,
    };
  }
  if (
    websiteUrl.length > 0 &&
    (websiteUrl.length < 8 || !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(websiteUrl))
  ) {
    return {
      kind: "err",
      code: "invalid_website",
      message: "Если указан сайт — нужен корректный URL (http или https).",
      status: 400,
    };
  }
  if (!hasEmailOrPhoneInContacts(publicContacts, payload.contacts)) {
    return {
      kind: "err",
      code: "contacts_required",
      message: "Укажите хотя бы один телефон или email в публичных контактах.",
      status: 400,
    };
  }
  if (!addressText || addressText.length > 500) {
    return {
      kind: "err",
      code: "invalid_address",
      message: "Укажите фактический адрес (до 500 символов).",
      status: 400,
    };
  }

  const legalInfoProvided =
    legalForm.length > 0 &&
    inn.length > 0 &&
    ogrn.length > 0 &&
    legalAddress.length > 0 &&
    contactPersonName.length > 0;

  const locRes = await client.query(`SELECT id FROM locations WHERE id = $1::bigint`, [
    locationRaw,
  ]);
  if (!locRes.rows.length) {
    return { kind: "err", code: "invalid_location", message: "Локация не найдена.", status: 400 };
  }

  /** Регион каталога — из дерева locations (узел kind=region), без отдельного поля в форме. */
  const regFromLoc = await client.query<{ id: string; slug: string }>(
    `SELECT r.id::text AS id, r.slug
     FROM locations l
     INNER JOIN locations lr
       ON lr.id = CASE WHEN l.kind = 'region' THEN l.id ELSE l.region_id END
       AND lr.kind = 'region'
     INNER JOIN regions r ON r.slug = lr.slug AND r.is_active = true
     WHERE l.id = $1::bigint
     LIMIT 1`,
    [locationRaw]
  );
  if (!regFromLoc.rows.length) {
    return {
      kind: "err",
      code: "location_region_mismatch",
      message:
        "Выбранная локация не сопоставлена с регионом каталога. Выберите другой пункт из подсказок.",
      status: 400,
    };
  }
  const regionId = regFromLoc.rows[0].id;
  const regionSlugResolved = regFromLoc.rows[0].slug;

  const dupPending = await client.query<{ id: string; applicant_user_id: string }>(
    `SELECT id, applicant_user_id::text FROM organization_applications
     WHERE org_slug = $1 AND status = 'pending_moderation'
     LIMIT 1`,
    [orgSlug]
  );
  if (dupPending.rows.length > 0 && dupPending.rows[0].applicant_user_id !== userId) {
    return { kind: "err", code: "slug_pending", message: "Этот slug уже на модерации.", status: 409 };
  }

  const rateUser = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM organization_applications
     WHERE applicant_user_id = $1::uuid AND created_at > now() - interval '24 hours'`,
    [userId]
  );
  if (Number(rateUser.rows[0]?.n || 0) >= 8) {
    return {
      kind: "err",
      code: "rate_limited",
      message: "Слишком много заявок за сутки. Попробуйте позже.",
      status: 429,
    };
  }
  if (submitterIp) {
    const rateIp = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organization_applications
       WHERE submitter_ip = $1 AND created_at > now() - interval '24 hours'`,
      [submitterIp]
    );
    if (Number(rateIp.rows[0]?.n || 0) >= 24) {
      return {
        kind: "err",
        code: "rate_limited",
        message: "Слишком много заявок с этого адреса. Попробуйте позже.",
        status: 429,
      };
    }
  }

  const pubJson = {
    title: orgTitle,
    slug: orgSlug,
    description: publicDescription,
    contacts: publicContacts,
    contactsStructured: Array.isArray(payload.contacts) ? payload.contacts : [],
    websiteUrl,
    addressText: addressText || null,
    addressIsPublic,
    portfolioUrls:
      uploadedImages.length > 0
        ? uploadedImages.map((_, i) => `/v1/org/${encodeURIComponent(orgSlug)}/media/${i + 1}`)
        : portfolioUrls,
  };

  const privJson = {
    ownerPhone: ownerPhone || null,
    moderationNote: moderationNote || null,
    legalForm: legalForm || null,
    inn: inn || null,
    ogrn: ogrn || null,
    legalAddress: legalAddress || null,
    contactPersonName: contactPersonName || null,
    consentAt: new Date().toISOString(),
  };

  await client.query("BEGIN");
  try {
    let effectiveCategorySlug = categorySlug;
    let categoryId = "";
    if (effectiveCategorySlug) {
      const cat = await client.query(`SELECT id::text FROM categories WHERE slug = $1`, [
        effectiveCategorySlug,
      ]);
      if (!cat.rows.length) {
        await client.query("ROLLBACK");
        return { kind: "err", code: "invalid_category", status: 400 };
      }
      categoryId = String(cat.rows[0].id);
    } else {
      if (!categoryNewLabel || categoryNewLabel.length < 2) {
        await client.query("ROLLBACK");
        return {
          kind: "err",
          code: "invalid_category",
          message: "Укажите название новой категории (минимум 2 символа).",
          status: 400,
        };
      }
      const baseSlug = normalizeOrgSlug(categoryNewLabel).slice(0, 48) || "new-category";
      let candidate = baseSlug;
      let catIns: { id: string; slug: string } | null = null;
      for (let i = 0; i < 20; i += 1) {
        const suffix = i === 0 ? "" : `-${i + 1}`;
        candidate = `${baseSlug}${suffix}`.slice(0, 64);
        const ins = await client.query<{ id: string; slug: string }>(
          `INSERT INTO categories (slug, label, is_public, sort_order, updated_at)
           VALUES ($1, $2, true, 100, now())
           ON CONFLICT (slug) DO NOTHING
           RETURNING id::text, slug`,
          [candidate, categoryNewLabel]
        );
        if (ins.rows.length) {
          catIns = { id: ins.rows[0].id, slug: ins.rows[0].slug };
          break;
        }
        const ex = await client.query<{ id: string; slug: string }>(
          `SELECT id::text, slug FROM categories WHERE slug = $1`,
          [candidate]
        );
        if (ex.rows.length) {
          categoryId = String(ex.rows[0].id);
          effectiveCategorySlug = String(ex.rows[0].slug);
          break;
        }
      }
      if (catIns) {
        categoryId = catIns.id;
        effectiveCategorySlug = catIns.slug;
      }
      if (!categoryId) {
        await client.query("ROLLBACK");
        return {
          kind: "err",
          code: "category_create_failed",
          message: "Не удалось создать новую категорию. Повторите попытку.",
          status: 500,
        };
      }
    }

    const userVerify = await client.query<{
      email_verified_at: string | null;
      phone_verified_at: string | null;
    }>(
      `SELECT email_verified_at, phone_verified_at
       FROM users
       WHERE id = $1::uuid
       LIMIT 1`,
      [userId]
    );
    const userRow = userVerify.rows[0];
    const userVerified = Boolean(
      userRow?.email_verified_at && userRow?.phone_verified_at
    );
    const autoPublish = userVerified && legalInfoProvided;

    const pubCheck = await client.query<{ published: boolean }>(
      `SELECT published FROM organizations WHERE id = $1 FOR UPDATE`,
      [orgSlug]
    );
    if (pubCheck.rows.length > 0 && pubCheck.rows[0].published) {
      await client.query("ROLLBACK");
      return {
        kind: "err",
        code: "slug_taken",
        message: "Организация с таким slug уже опубликована.",
        status: 409,
      };
    }

    let applicationId: string;
    if (dupPending.rows.length > 0 && dupPending.rows[0].applicant_user_id === userId) {
      const upd = await client.query<{ id: string }>(
        `UPDATE organization_applications
         SET org_title = $2,
             category_slug = $3,
             region_slug = $4,
             website_url = $5,
             public_payload = $6::jsonb,
             private_payload = $7::jsonb,
             location_id = $8::bigint,
             submitter_ip = COALESCE($9, submitter_ip),
            status = $10,
             rejection_reason = NULL,
             updated_at = now()
         WHERE id = $1::uuid
         RETURNING id`,
        [
          dupPending.rows[0].id,
          orgTitle,
          effectiveCategorySlug,
          regionSlugResolved,
          websiteUrl || null,
          JSON.stringify(pubJson),
          JSON.stringify(privJson),
          locationRaw,
          submitterIp,
          autoPublish ? "published" : "pending_moderation",
        ]
      );
      applicationId = upd.rows[0].id;
    } else {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO organization_applications
          (applicant_user_id, org_slug, org_title, category_slug, region_slug, website_url,
           public_payload, private_payload, status, location_id, submitter_ip)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $11, $9::bigint, $10)
         RETURNING id`,
        [
          userId,
          orgSlug,
          orgTitle,
          effectiveCategorySlug,
          regionSlugResolved,
          websiteUrl || null,
          JSON.stringify(pubJson),
          JSON.stringify(privJson),
          locationRaw,
          submitterIp,
          autoPublish ? "published" : "pending_moderation",
        ]
      );
      applicationId = ins.rows[0].id;
    }

    await client.query(
      `INSERT INTO organizations
        (id, title, subtitle, listing_text, category_id, region_id, rating, reviews, published, created_at, updated_at)
       VALUES ($1, $2, $6, $3, $4::bigint, $5::bigint, 0, 0, $7, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         subtitle = EXCLUDED.subtitle,
         listing_text = EXCLUDED.listing_text,
         category_id = EXCLUDED.category_id,
         region_id = EXCLUDED.region_id,
         published = EXCLUDED.published,
         updated_at = now()
       WHERE organizations.published = false`,
      [
        orgSlug,
        orgTitle,
        publicDescription,
        categoryId,
        regionId,
        splitLines(publicContacts).slice(0, 4).join("\n"),
        autoPublish,
      ]
    );

    if (uploadedImages.length > 0) {
      await client.query(`DELETE FROM organization_media_blobs WHERE org_id = $1`, [orgSlug]);
      for (let i = 0; i < uploadedImages.length; i += 1) {
        const img = uploadedImages[i]!;
        await client.query(
          `INSERT INTO organization_media_blobs
            (org_id, media_index, source_url, content_type, byte_size, data, updated_at)
           VALUES ($1, $2, NULL, $3, length(decode($4, 'base64')), decode($4, 'base64'), now())`,
          [orgSlug, i + 1, img.contentType, img.base64]
        );
      }
    }

    const orgStillPublished = await client.query<{ published: boolean }>(
      `SELECT published FROM organizations WHERE id = $1`,
      [orgSlug]
    );
    if (
      orgStillPublished.rows.length > 0 &&
      orgStillPublished.rows[0].published === true
    ) {
      await client.query("ROLLBACK");
      return {
        kind: "err",
        code: "slug_taken",
        message: "Организация с таким slug уже опубликована.",
        status: 409,
      };
    }

    await client.query(
      `INSERT INTO organization_profiles
        (org_id, slug, description_md, website_url, moderation_status, location_id, address_text, address_is_public, published_at, updated_at)
       VALUES ($1, $1, $2, $3, $7, $4::bigint, $5, $6, $8, now())
       ON CONFLICT (org_id) DO UPDATE SET
         slug = EXCLUDED.slug,
         description_md = EXCLUDED.description_md,
         website_url = EXCLUDED.website_url,
         moderation_status = CASE
           WHEN organization_profiles.moderation_status = 'published' THEN organization_profiles.moderation_status
           ELSE EXCLUDED.moderation_status
         END,
         location_id = EXCLUDED.location_id,
         address_text = EXCLUDED.address_text,
         address_is_public = EXCLUDED.address_is_public,
         published_at = COALESCE(organization_profiles.published_at, EXCLUDED.published_at),
         updated_at = now()`,
      [
        orgSlug,
        publicDescription,
        websiteUrl || null,
        locationRaw,
        addressText || null,
        addressIsPublic,
        autoPublish ? "published" : "pending",
        autoPublish ? new Date().toISOString() : null,
      ]
    );

    if (uploadedImages.length > 0) {
      const photoUrls = uploadedImages.map(
        (_, i) => `/v1/org/${encodeURIComponent(orgSlug)}/media/${i + 1}`
      );
      await client.query(
        `UPDATE organization_profiles
         SET portfolio_images = $2::jsonb,
             cover_url = $3,
             updated_at = now()
         WHERE org_id = $1`,
        [orgSlug, JSON.stringify(photoUrls), photoUrls[0] || null]
      );
    }

    if (autoPublish) {
      const contactLines = splitLines(publicContacts);
      await client.query(`DELETE FROM organization_public_contacts WHERE org_id = $1`, [
        orgSlug,
      ]);
      for (let i = 0; i < contactLines.length; i += 1) {
        const v = contactLines[i]!;
        const t = guessContactType(v);
        await client.query(
          `INSERT INTO organization_public_contacts
            (org_id, contact_type, contact_value, contact_label, is_primary, sort_order)
           VALUES ($1, $2, $3, NULL, $4, $5)
           ON CONFLICT (org_id, contact_type, contact_value) DO UPDATE SET
             sort_order = LEAST(organization_public_contacts.sort_order, EXCLUDED.sort_order),
             is_primary = organization_public_contacts.is_primary OR EXCLUDED.is_primary`,
          [orgSlug, t, v, i === 0, 100 + i]
        );
      }
      await client.query(
        `UPDATE organization_applications
         SET result_org_id = $2,
             updated_at = now()
         WHERE id = $1::uuid`,
        [applicationId, orgSlug]
      );
      await client.query(
        `INSERT INTO moderation_events (entity_type, entity_id, action, actor_user_id, payload)
         VALUES ('application', $1, 'approve', NULL, $2::jsonb)`,
        [applicationId, JSON.stringify({ orgSlug, source: "auto_moderator" })]
      );
    }

    await client.query(
      `INSERT INTO moderation_events (entity_type, entity_id, action, actor_user_id, payload)
       VALUES ('application', $1, 'submit', $2::uuid, $3::jsonb)`,
      [applicationId, userId, JSON.stringify({ orgSlug })]
    );

    await client.query("COMMIT");
    return {
      kind: "ok",
      applicationId,
      orgId: orgSlug,
      slug: orgSlug,
      status: autoPublish ? "published" : "pending_moderation",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

export async function getApplicationForUser(
  client: Client,
  applicationId: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  if (!isUuid(applicationId)) return null;
  const r = await client.query(
    `SELECT id, org_slug, org_title, category_slug, region_slug, website_url, location_id,
            public_payload, private_payload, status, rejection_reason, result_org_id,
            created_at, updated_at
     FROM organization_applications
     WHERE id = $1::uuid AND applicant_user_id = $2::uuid
     LIMIT 1`,
    [applicationId, userId]
  );
  return (r.rows[0] as Record<string, unknown>) || null;
}
