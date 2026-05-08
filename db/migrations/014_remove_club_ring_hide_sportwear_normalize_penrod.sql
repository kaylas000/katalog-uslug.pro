-- Удалить организацию club-ring (нет контента в каталоге), скрыть пустую категорию sportwear,
-- унифицировать отображение Penrod (без латиницы DURAPAN в публичном заголовке).

-- Организация и связанные строки (FK CASCADE с organizations)
DELETE FROM organizations WHERE id = 'club-ring';

-- Категория «Спортивная одежда» — не показывать в публичном API/фильтрах
UPDATE categories
SET is_public = false,
    updated_at = now()
WHERE slug = 'sportwear';

-- Penrod: как у остальных карточек (краткое название без «DURAPAN» в title)
UPDATE organizations
SET title = 'Penrod — материалы из ценных пород',
    listing_text = 'Поставки материалов и комплектующих из древесины ценных пород для производителей мебели и дверей по РФ. Ассортимент: шпон, фанера, пиломатериалы, фанерованное МДФ, декинг.',
    updated_at = now()
WHERE id = 'durapan';

UPDATE organization_profiles
SET description_md = 'Компания Penrod — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.',
    legal_name = 'Penrod',
    legacy_article_html = '',
    legacy_sidebar_html = '',
    updated_at = now()
WHERE org_id = 'durapan';
