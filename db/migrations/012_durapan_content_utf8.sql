-- DURAPAN (org_id durapan): fix mojibake labels + distinct profile text vs catalog listing.

INSERT INTO categories (slug, label, is_public)
VALUES ('wood-materials', 'Материалы и комплектующие из ценных пород', true)
ON CONFLICT (slug) DO UPDATE
SET label = EXCLUDED.label,
    is_public = EXCLUDED.is_public,
    updated_at = now();

UPDATE organizations
SET title = 'Penrod (DURAPAN) — материалы из ценных пород',
    subtitle = '+7 (495) 663-93-29' || E'\n' || 'penrod@penrod.ru' || E'\n' || 'Москва',
    listing_text = 'Поставки материалов и комплектующих из древесины ценных пород для производителей мебели и дверей по РФ. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг.',
    updated_at = now()
WHERE id = 'durapan';

UPDATE organization_profiles
SET description_md = 'Компания Penrod (DURAPAN) — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.',
    website_url = 'https://www.durapan.ru/',
    address_text = 'Москва',
    moderation_status = 'published',
    updated_at = now()
WHERE org_id = 'durapan';

UPDATE organization_public_contacts
SET contact_label = CASE contact_type
  WHEN 'phone' THEN 'Телефон'
  WHEN 'email' THEN 'E-mail'
  WHEN 'website' THEN 'Сайт'
  ELSE contact_label
END
WHERE org_id = 'durapan';

UPDATE organization_services
SET service_title = 'Шпон',
    service_description = 'Натуральный / сращённый / реконструированный.',
    updated_at = now()
WHERE org_id = 'durapan' AND service_slug = 'veneer';

UPDATE organization_services
SET service_title = 'Фанера',
    service_description = 'Гибкая / морская / сверхлёгкая.',
    updated_at = now()
WHERE org_id = 'durapan' AND service_slug = 'plywood';

UPDATE organization_services
SET service_title = 'Пиломатериалы',
    service_description = 'Твёрдопородные пиломатериалы из ценных пород.',
    updated_at = now()
WHERE org_id = 'durapan' AND service_slug = 'lumber';

UPDATE organization_services
SET service_title = 'Фанерованное МДФ',
    service_description = 'МДФ-панели с натуральным шпоном.',
    updated_at = now()
WHERE org_id = 'durapan' AND service_slug = 'mdf';

UPDATE organization_services
SET service_title = 'Декинг',
    service_description = 'Палубная (террасная) доска.',
    updated_at = now()
WHERE org_id = 'durapan' AND service_slug = 'decking';
