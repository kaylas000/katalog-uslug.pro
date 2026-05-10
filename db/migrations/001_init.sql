-- Схема под API в формате data/catalog.json и data/regions.json
-- Запуск на VM: psql -U ... -d ... -f 001_init.sql

CREATE TABLE IF NOT EXISTS regions (
  id         bigserial PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  label      text NOT NULL,
  intro      text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id    bigserial PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id           text PRIMARY KEY,
  title        text NOT NULL,
  subtitle     text NOT NULL DEFAULT '',
  listing_text text NOT NULL DEFAULT '',
  category_id  bigint NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  region_id    bigint NOT NULL REFERENCES regions (id) ON DELETE RESTRICT,
  rating       numeric(2, 1) NOT NULL DEFAULT 0,
  reviews      integer NOT NULL DEFAULT 0,
  published    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_region ON organizations (region_id);
CREATE INDEX IF NOT EXISTS idx_organizations_category ON organizations (category_id);
CREATE INDEX IF NOT EXISTS idx_organizations_published ON organizations (published) WHERE published;

COMMENT ON TABLE organizations IS 'Публичные карточки; listing_text отдаётся в JSON как поле text';

-- schema v1 (комментарий для повторного прогона CI миграций при необходимости)
