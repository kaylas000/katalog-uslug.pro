-- Org submission & moderation: locations on applications, address visibility, blocked status, audit/rate-limit prep.

ALTER TABLE organization_profiles DROP CONSTRAINT IF EXISTS organization_profiles_moderation_status_check;

ALTER TABLE organization_profiles ADD CONSTRAINT organization_profiles_moderation_status_check
  CHECK (moderation_status IN ('draft', 'pending', 'published', 'rejected', 'suspended', 'blocked'));

ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS address_is_public boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN organization_profiles.address_is_public IS 'If false, physical address is not exposed in public org API.';

ALTER TABLE organization_applications
  ADD COLUMN IF NOT EXISTS location_id bigint REFERENCES locations(id) ON DELETE SET NULL;

ALTER TABLE organization_applications
  ADD COLUMN IF NOT EXISTS submitter_ip text;

CREATE INDEX IF NOT EXISTS idx_org_applications_location_id ON organization_applications (location_id);
