-- API v2: портфолио в профиле и индекс под фильтры каталога

ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS portfolio_images jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_organizations_cat_reg_pub
  ON organizations (category_id, region_id)
  WHERE published = true;

COMMENT ON COLUMN organization_profiles.portfolio_images IS 'Массив URL изображений для карточки (как portfolioImages в catalog.json)';
