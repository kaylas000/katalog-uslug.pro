-- Penrod (durapan): один раз убрать внешние картинки с durapan.ru.
-- Повторный прогон всех миграций не должен стирать уже залитые URL на katalog-uslug.pro.

UPDATE organization_profiles
SET
  portfolio_images = '[]'::jsonb,
  cover_url = NULL,
  updated_at = now()
WHERE org_id = 'durapan'
  AND (
    cover_url ILIKE '%durapan.ru%'
    OR portfolio_images::text ILIKE '%durapan.ru%'
  );
