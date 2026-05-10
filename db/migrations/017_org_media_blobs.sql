-- Хранение физических изображений организаций прямо в БД.
-- Источник истины: organization_media_blobs.data (bytea).

CREATE TABLE IF NOT EXISTS organization_media_blobs (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  media_index integer NOT NULL CHECK (media_index >= 1 AND media_index <= 64),
  source_url text,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  sha256_hex text,
  byte_size integer NOT NULL DEFAULT 0,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, media_index)
);

CREATE INDEX IF NOT EXISTS idx_org_media_blobs_org ON organization_media_blobs(org_id, media_index);
