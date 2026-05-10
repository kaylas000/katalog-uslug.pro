-- Связь одобренной/опубликованной заявки с итоговой карточкой организации.
ALTER TABLE organization_applications
  ADD COLUMN IF NOT EXISTS result_org_id text REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_applications_result_org
  ON organization_applications (result_org_id)
  WHERE result_org_id IS NOT NULL;

