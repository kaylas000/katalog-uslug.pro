-- Penrod (durapan): убрать внешние картинки с durapan.ru; новые — в /images/portfolio/durapan/ на сайте каталога.

UPDATE organization_profiles
SET
  portfolio_images = '[]'::jsonb,
  cover_url = NULL,
  updated_at = now()
WHERE org_id = 'durapan';
