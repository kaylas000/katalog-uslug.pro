-- seed_durapan.sql (UPSERT)
-- Organization 'durapan' (Penrod)

INSERT INTO organizations
(id, title, subtitle, listing_text, category_id, region_id, rating, reviews, published, created_at, updated_at)
SELECT
  'durapan',
  'Penrod — материалы из ценных пород',
  '+7 (495) 663-93-29' || E'\n' || 'penrod@penrod.ru' || E'\n' ||
  'г. Железнодорожный, ул. Гидрогородок д.15' || E'\n' || 'Ежедневно 09:00–18:00',
  'Поставки материалов и комплектующих из древесины ценных пород для производителей мебели и дверей по РФ. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг.',
  c.id,
  r.id,
  5.0,
  24,
  true,
  now(),
  now()
FROM categories c, regions r
WHERE c.slug = 'materials' AND r.slug = 'moskva'
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  listing_text = EXCLUDED.listing_text,
  category_id = EXCLUDED.category_id,
  region_id = EXCLUDED.region_id,
  updated_at = now();

INSERT INTO organization_profiles
(
  org_id, slug,
  legal_name,
  description_md,
  website_url,
  cover_url,
  address_text,
  moderation_status,
  verification_status,
  published_at,
  portfolio_images
)
VALUES (
  'durapan', 'durapan',
  'Penrod',
  'Компания Penrod — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.',
  'https://www.durapan.ru/',
  NULL,
  'г. Железнодорожный, ул. Гидрогородок д.15',
  'published',
  'unverified',
  now(),
  '[]'::jsonb
)
ON CONFLICT (org_id) DO UPDATE
SET slug = EXCLUDED.slug,
    legal_name = EXCLUDED.legal_name,
    description_md = EXCLUDED.description_md,
    website_url = EXCLUDED.website_url,
    cover_url = EXCLUDED.cover_url,
    address_text = EXCLUDED.address_text,
    moderation_status = EXCLUDED.moderation_status,
    verification_status = EXCLUDED.verification_status,
    published_at = EXCLUDED.published_at,
    portfolio_images = EXCLUDED.portfolio_images,
    updated_at = now();

-- Контакты (пересоздаём)
DELETE FROM organization_public_contacts WHERE org_id='durapan';

INSERT INTO organization_public_contacts
(org_id, contact_type, contact_value, contact_label, is_primary, sort_order)
VALUES
('durapan','phone','+7 (495) 663-93-29',NULL, true, 10),
('durapan','email','penrod@penrod.ru',NULL, false, 20),
('durapan','website','https://www.durapan.ru/',NULL, false, 30);

-- Ассортимент как offers (через organization_services)
DELETE FROM organization_services WHERE org_id='durapan';

INSERT INTO organization_services
(org_id, service_slug, service_title, service_description, price_from, price_to, currency, is_active, sort_order)
VALUES
('durapan', 'shpon', 'Шпон ценных пород', 'Натуральный шпон, реконструированный шпон (fine-line).', NULL, NULL, 'RUB', true, 10),
('durapan', 'fanera', 'Фанера березовая и хвойная', 'Сортовая фанера ФК, ФСФ для мебели и отделки.', NULL, NULL, 'RUB', true, 20),
('durapan', 'mdf-faner', 'МДФ фанерованный', 'Плиты МДФ, облицованные шпоном дуба, ясеня, бука.', NULL, NULL, 'RUB', true, 30);
