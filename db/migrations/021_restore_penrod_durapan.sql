-- Восстановление карточки Penrod (id в БД: durapan) после случайного удаления/обрезки данных.
-- Идемпотентно: можно прогонять повторно.

-- Категория товаров «Материалы и комплектующие» (018)
INSERT INTO categories (slug, label, is_public, is_goods_category)
VALUES ('materials', 'Материалы и комплектующие', true, true)
ON CONFLICT (slug) DO UPDATE
SET label = EXCLUDED.label,
    is_public = EXCLUDED.is_public,
    is_goods_category = EXCLUDED.is_goods_category,
    updated_at = now();

-- Если строку organizations удалили — создать до контактов и услуг (FK).
INSERT INTO organizations (
  id, title, subtitle, listing_text,
  category_id, region_id,
  rating, reviews, published, custom_url
)
SELECT
  'durapan',
  'Penrod — материалы из ценных пород',
  '+7 (495) 663-93-29' || E'\n' || 'penrod@penrod.ru' || E'\n' ||
    'г. Железнодорожный, ул. Гидрогородок д.15' || E'\n' || 'Ежедневно 09:00–18:00',
  'Компания Penrod — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.',
  (SELECT id FROM categories WHERE slug = 'materials' LIMIT 1),
  (
    SELECT id FROM regions
    WHERE slug IN ('moskva', 'moskovskaya-oblast') AND is_active = true
    ORDER BY CASE WHEN slug = 'moskva' THEN 0 ELSE 1 END
    LIMIT 1
  ),
  5.0,
  24,
  true,
  '/goods/materials/penrod/'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'durapan');

INSERT INTO organization_profiles (
  org_id, slug, legal_name, description_md, website_url, cover_url, address_text,
  moderation_status, verification_status, published_at, portfolio_images,
  legacy_article_html, legacy_sidebar_html
)
SELECT
  'durapan',
  'durapan',
  'Penrod',
  'Компания Penrod — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.' || E'\n\n' ||
  'Поставки материалов и комплектующих из древесины ценных пород для производителей мебели и дверей по РФ. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг.',
  'https://www.durapan.ru/',
  'https://katalog-uslug.pro/images/portfolio/durapan/1.jpg',
  'г. Железнодорожный, ул. Гидрогородок д.15',
  'published',
  'unverified',
  now(),
  '["https://katalog-uslug.pro/images/portfolio/durapan/1.jpg","https://katalog-uslug.pro/images/portfolio/durapan/2.jpg","https://katalog-uslug.pro/images/portfolio/durapan/3.jpg","https://katalog-uslug.pro/images/portfolio/durapan/4.jpg"]'::jsonb,
  '',
  ''
WHERE NOT EXISTS (SELECT 1 FROM organization_profiles WHERE org_id = 'durapan');

-- Актуальные поля (и исправление custom_url: в 019 ошибочно был id penrod вместо durapan)
UPDATE organizations
SET
  title = 'Penrod — материалы из ценных пород',
  subtitle = '+7 (495) 663-93-29' || E'\n' || 'penrod@penrod.ru' || E'\n' ||
    'г. Железнодорожный, ул. Гидрогородок д.15' || E'\n' || 'Ежедневно 09:00–18:00',
  listing_text = 'Компания Penrod — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.',
  category_id = (SELECT id FROM categories WHERE slug = 'materials' LIMIT 1),
  rating = 5.0,
  reviews = 24,
  published = true,
  custom_url = '/goods/materials/penrod/',
  updated_at = now()
WHERE id = 'durapan';

UPDATE organization_profiles
SET
  legal_name = 'Penrod',
  description_md =
    'Компания Penrod — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.' || E'\n\n' ||
    'Поставки материалов и комплектующих из древесины ценных пород для производителей мебели и дверей по РФ. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг.',
  website_url = 'https://www.durapan.ru/',
  address_text = 'г. Железнодорожный, ул. Гидрогородок д.15',
  cover_url = 'https://katalog-uslug.pro/images/portfolio/durapan/1.jpg',
  portfolio_images =
    '["https://katalog-uslug.pro/images/portfolio/durapan/1.jpg","https://katalog-uslug.pro/images/portfolio/durapan/2.jpg","https://katalog-uslug.pro/images/portfolio/durapan/3.jpg","https://katalog-uslug.pro/images/portfolio/durapan/4.jpg"]'::jsonb,
  legacy_article_html = '',
  legacy_sidebar_html = '',
  moderation_status = 'published',
  updated_at = now()
WHERE org_id = 'durapan';

DELETE FROM organization_public_contacts WHERE org_id = 'durapan';

INSERT INTO organization_public_contacts
  (org_id, contact_type, contact_value, contact_label, is_primary, sort_order)
VALUES
  ('durapan', 'phone', '+7 (495) 663-93-29', NULL, true, 10),
  ('durapan', 'email', 'penrod@penrod.ru', NULL, false, 20),
  ('durapan', 'website', 'https://www.durapan.ru/', NULL, false, 30);

INSERT INTO organization_services
  (org_id, service_slug, service_title, service_description, sort_order)
VALUES
  ('durapan', 'veneer', 'Шпон', 'Натуральный / сращённый / реконструированный.', 10),
  ('durapan', 'plywood', 'Фанера', 'Гибкая / морская / сверхлёгкая.', 20),
  ('durapan', 'lumber', 'Пиломатериалы', 'Твёрдопородные пиломатериалы из ценных пород.', 30),
  ('durapan', 'mdf', 'Фанерованное МДФ', 'МДФ-панели с натуральным шпоном.', 40),
  ('durapan', 'decking', 'Декинг', 'Палубная (террасная) доска.', 50)
ON CONFLICT (org_id, service_slug) DO UPDATE
SET service_title = EXCLUDED.service_title,
    service_description = EXCLUDED.service_description,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    updated_at = now();
