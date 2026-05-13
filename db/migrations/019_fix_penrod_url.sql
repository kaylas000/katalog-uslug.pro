-- 019_fix_penrod_url.sql
-- Исправление URL для организации Penrod после переноса в товары

-- 1. Добавляем поле custom_url если его нет (для переопределения стандартного URL /org/{id}/)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organizations' AND column_name = 'custom_url'
  ) THEN
    ALTER TABLE organizations ADD COLUMN custom_url text;
  END IF;
END $$;

-- 2. Устанавливаем правильный URL для организации Penrod
UPDATE organizations 
SET custom_url = '/goods/materials/penrod/'
WHERE id = 'durapan';

-- 3. Обновляем SQL запрос в Worker для использования custom_url
-- (Это нужно сделать вручную в коде Worker, здесь только комментарий)
-- Нужно изменить строку в worker/src/index.ts:
-- Было: '/org/' || o.id || '/' AS url
-- Стало: COALESCE(o.custom_url, '/org/' || o.id || '/') AS url

-- 4. Создаем индекс для быстрого поиска по custom_url
CREATE INDEX IF NOT EXISTS idx_organizations_custom_url ON organizations(custom_url) WHERE custom_url IS NOT NULL;