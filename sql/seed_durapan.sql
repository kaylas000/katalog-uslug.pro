-- seed_durapan.sql (UPSERT)

-- РљР°С‚РµРіРѕСЂРёСЏ
INSERT INTO categories (slug, label, is_public)
VALUES ('wood-materials', 'РњР°С‚РµСЂРёР°Р»С‹ Рё РєРѕРјРїР»РµРєС‚СѓСЋС‰РёРµ РёР· С†РµРЅРЅС‹С… РїРѕСЂРѕРґ', true)
ON CONFLICT (slug) DO UPDATE
SET label = EXCLUDED.label,
    is_public = EXCLUDED.is_public;

-- РћСЂРіР°РЅРёР·Р°С†РёСЏ (Р±РµСЂС‘Рј СЂРµРіРёРѕРЅ moskva, РµСЃР»Рё РЅРµС‚ вЂ” moskovskaya-oblast)
WITH reg AS (
  SELECT id
  FROM regions
  WHERE slug IN ('moskva', 'moskovskaya-oblast')
    AND is_active = true
  ORDER BY CASE WHEN slug='moskva' THEN 0 ELSE 1 END
  LIMIT 1
),
cat AS (
  SELECT id FROM categories WHERE slug='wood-materials' LIMIT 1
)
INSERT INTO organizations (
  id, title, subtitle, listing_text,
  category_id, region_id,
  rating, reviews,
  published
)
SELECT
  'durapan',
  'Penrod — материалы из ценных пород',
  '+7 (495) 663-93-29' || E'\n' || 'penrod@penrod.ru' || E'\n' || 'Москва',
  'Поставки материалов и комплектующих из древесины ценных пород для производителей мебели и дверей по РФ. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг.',
  cat.id,
  reg.id,
  0, 0,
  true
FROM reg, cat
ON CONFLICT (id) DO UPDATE
SET title       = EXCLUDED.title,
    subtitle    = EXCLUDED.subtitle,
    listing_text= EXCLUDED.listing_text,
    category_id = EXCLUDED.category_id,
    region_id   = EXCLUDED.region_id,
    published   = EXCLUDED.published,
    updated_at  = now();

-- РџСЂРѕС„РёР»СЊ (Р’РђР–РќРћ: moderation_status='published', РёРЅР°С‡Рµ /v1/catalog?v=2 РЅРµ РїРѕРєР°Р¶РµС‚)
INSERT INTO organization_profiles (
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
  'Москва',
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

-- РљРѕРЅС‚Р°РєС‚С‹ (РїРµСЂРµСЃРѕР·РґР°С‘Рј)
DELETE FROM organization_public_contacts WHERE org_id='durapan';

INSERT INTO organization_public_contacts
(org_id, contact_type, contact_value, contact_label, is_primary, sort_order)
VALUES
('durapan','phone','+7 (495) 663-93-29','РўРµР»РµС„РѕРЅ', true, 10),
('durapan','email','penrod@penrod.ru','E-mail', false, 20),
('durapan','website','https://www.durapan.ru/','РЎР°Р№С‚', false, 30);

-- РђСЃСЃРѕСЂС‚РёРјРµРЅС‚ РєР°Рє offers (С‡РµСЂРµР· organization_services)
DELETE FROM organization_services WHERE org_id='durapan';

INSERT INTO organization_services
(org_id, service_slug, service_title, service_description, price_from, price_to, currency, is_active, sort_order)
VALUES
('durapan','veneer','РЁРїРѕРЅ','РќР°С‚СѓСЂР°Р»СЊРЅС‹Р№ / СЂРµР±СЂРѕСЃРєР»РµРµРЅРЅС‹Р№ / СЂРµРєРѕРЅСЃС‚СЂСѓРёСЂРѕРІР°РЅРЅС‹Р№.',NULL,NULL,'RUB',true,10),
('durapan','plywood','Р¤Р°РЅРµСЂР°','Р“РёР±РєР°СЏ / РјРѕСЂСЃРєР°СЏ / СЃРІРµСЂС…Р»РµРіРєР°СЏ.',NULL,NULL,'RUB',true,20),
('durapan','lumber','РџРёР»РѕРјР°С‚РµСЂРёР°Р»С‹','РўРІРµСЂРґРѕРїРѕСЂРѕРґРЅС‹Рµ РїРёР»РѕРјР°С‚РµСЂРёР°Р»С‹ РёР· С†РµРЅРЅС‹С… РїРѕСЂРѕРґ.',NULL,NULL,'RUB',true,30),
('durapan','mdf','Р¤Р°РЅРµСЂРѕРІР°РЅРЅРѕРµ РњР”Р¤','РњР”Р¤ РїР°РЅРµР»Рё СЃ РЅР°С‚СѓСЂР°Р»СЊРЅС‹Рј С€РїРѕРЅРѕРј.',NULL,NULL,'RUB',true,40),
('durapan','decking','Р”РµРєРёРЅРі','РџР°Р»СѓР±РЅР°СЏ РґРѕСЃРєР° (С‚РµСЂСЂР°СЃРЅР°СЏ).',NULL,NULL,'RUB',true,50);

