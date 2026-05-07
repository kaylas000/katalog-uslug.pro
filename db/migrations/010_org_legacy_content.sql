-- Временная совместимость: сохраняем подробные блоки старых org-страниц в БД,
-- чтобы единый /org/index.html (SPA) рендерил полный контент без org/<slug>/index.html.

ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS legacy_article_html text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS legacy_sidebar_html text NOT NULL DEFAULT '';
