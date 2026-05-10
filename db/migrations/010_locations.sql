-- 010_locations.sql

CREATE TABLE IF NOT EXISTS locations (
  id bigserial PRIMARY KEY,

  kind text NOT NULL CHECK (kind IN ('region','district','city','settlement')),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,

  label_norm text NOT NULL,

  parent_id bigint REFERENCES locations(id) ON DELETE SET NULL,

  region_id bigint REFERENCES locations(id) ON DELETE SET NULL,

  ancestor_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_region_kind_label
ON locations (region_id, kind, label_norm, id);

CREATE INDEX IF NOT EXISTS idx_locations_kind_label
ON locations (kind, label_norm, id);

CREATE INDEX IF NOT EXISTS idx_locations_ancestor_ids_gin
ON locations USING GIN (ancestor_ids);

ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS location_id bigint REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_profiles_location
ON organization_profiles (location_id);
