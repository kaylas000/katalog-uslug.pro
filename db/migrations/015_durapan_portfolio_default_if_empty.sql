-- Если портфолио durapan пустое (после старой версии 013) — подставить стандартные URL на статике каталога.
-- Не трогает записи, где массив уже заполнен.

UPDATE organization_profiles
SET
  cover_url = 'https://katalog-uslug.pro/images/portfolio/durapan/1.jpg',
  portfolio_images =
    '[
      "https://katalog-uslug.pro/images/portfolio/durapan/1.jpg",
      "https://katalog-uslug.pro/images/portfolio/durapan/2.jpg",
      "https://katalog-uslug.pro/images/portfolio/durapan/3.jpg",
      "https://katalog-uslug.pro/images/portfolio/durapan/4.jpg"
    ]'::jsonb,
  updated_at = now()
WHERE org_id = 'durapan'
  AND (
    portfolio_images IS NULL
    OR portfolio_images = '[]'::jsonb
    OR jsonb_array_length(portfolio_images) = 0
  );
