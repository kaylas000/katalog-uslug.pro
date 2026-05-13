-- 020_fix_penrod_data.sql
-- Исправление данных организации Penrod

-- 1. Обновляем категорию для организации durapan
UPDATE organizations 
SET category_id = (SELECT id FROM categories WHERE slug = 'materials')
WHERE id = 'durapan';

-- 2. Обновляем данные организации durapan
UPDATE organizations 
SET 
  title = 'Penrod — материалы из ценных пород',
  subtitle = '+7 (495) 663-93-29\npenrod@penrod.ru\nг. Железнодорожный, ул. Гидрогородок д.15\nЕжедневно 09:00–18:00',
  listing_text = 'Компания Penrod — поставщик шпона, фанеры, пиломатериалов, фанерованного МДФ и террасного декинга из древесины ценных пород. Работаем с производителями мебели и дверей по всей России: консультируем по подбору материала, обеспечиваем стабильные поставки.',
  rating = 5.0,
  reviews = 24
WHERE id = 'durapan';