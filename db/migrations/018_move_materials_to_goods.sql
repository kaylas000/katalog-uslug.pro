-- 018_move_materials_to_goods.sql
-- Перенос категории "Материалы и комплектующие" из услуг в товары

-- 1. Добавляем поле is_goods_category в таблицу categories если его нет
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'categories' AND column_name = 'is_goods_category'
  ) THEN
    ALTER TABLE categories ADD COLUMN is_goods_category boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 2. Создаем новую категорию для товаров (если еще не существует)
INSERT INTO categories (slug, label, is_public, is_goods_category)
VALUES ('materials-goods', 'Материалы и комплектующие (Товары)', true, true)
ON CONFLICT (slug) DO UPDATE
SET label = EXCLUDED.label,
    is_public = EXCLUDED.is_public,
    is_goods_category = EXCLUDED.is_goods_category;

-- 3. Обновляем организации из категории wood-materials на новую категорию
UPDATE organizations o
SET category_id = (
  SELECT id FROM categories WHERE slug = 'materials-goods'
)
WHERE o.category_id = (
  SELECT id FROM categories WHERE slug = 'wood-materials'
);

-- 4. Обновляем старую категорию, чтобы она не отображалась в услугах
UPDATE categories 
SET is_public = false, 
    label = 'Материалы и комплектующие (архив)',
    is_goods_category = false
WHERE slug = 'wood-materials';

-- 5. Создаем индекс для быстрого фильтра по типу категории
CREATE INDEX IF NOT EXISTS idx_categories_is_goods ON categories(is_goods_category);