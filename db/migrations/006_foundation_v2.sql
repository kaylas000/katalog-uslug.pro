-- Foundation v2: расширение схемы под roadmap (без ломающих изменений).
-- Цель: заложить базовые сущности заранее, чтобы дальше расширять без переделки ядра.

-- 0) Общие расширения/поля (совместимо с текущим кодом)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE regions
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'RU',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id bigint REFERENCES categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS short_label text,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_h1 text,
  ADD COLUMN IF NOT EXISTS seo_intro_md text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_public ON categories(is_public);

-- 1) Таксономия и синонимы
CREATE TABLE IF NOT EXISTS category_aliases (
  id bigserial PRIMARY KEY,
  category_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_category_aliases_alias ON category_aliases (lower(alias));

-- seed: базовые алиасы из существующих label/slug (идемпотентно)
INSERT INTO category_aliases (category_id, alias)
SELECT c.id, c.label
FROM categories c
WHERE c.label IS NOT NULL
ON CONFLICT (category_id, alias) DO NOTHING;

INSERT INTO category_aliases (category_id, alias)
SELECT c.id, replace(c.slug, '-', ' ')
FROM categories c
ON CONFLICT (category_id, alias) DO NOTHING;

-- 2) Расширенный профиль организации (1:1 к существующей organizations)
CREATE TABLE IF NOT EXISTS organization_profiles (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  slug text UNIQUE,
  legal_name text,
  description_md text NOT NULL DEFAULT '',
  website_url text,
  logo_url text,
  cover_url text,
  address_text text,
  geo_lat numeric(9,6),
  geo_lon numeric(9,6),
  work_hours_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  moderation_status text NOT NULL DEFAULT 'published' CHECK (moderation_status IN ('draft', 'pending', 'published', 'rejected', 'suspended')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_profiles_verification ON organization_profiles(verification_status);
CREATE INDEX IF NOT EXISTS idx_org_profiles_moderation ON organization_profiles(moderation_status);

-- seed из текущих данных каталога
INSERT INTO organization_profiles (org_id, slug, description_md, website_url, moderation_status, published_at)
SELECT
  o.id,
  o.id,
  o.listing_text,
  NULL,
  CASE WHEN o.published THEN 'published' ELSE 'draft' END,
  CASE WHEN o.published THEN now() ELSE NULL END
FROM organizations o
ON CONFLICT (org_id) DO UPDATE SET
  description_md = EXCLUDED.description_md,
  moderation_status = EXCLUDED.moderation_status,
  updated_at = now();

-- 3) Контакты, услуги, теги организаций
CREATE TABLE IF NOT EXISTS organization_public_contacts (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('phone', 'email', 'messenger', 'website', 'social')),
  contact_value text NOT NULL,
  contact_label text,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contact_type, contact_value)
);

CREATE INDEX IF NOT EXISTS idx_org_public_contacts_org ON organization_public_contacts(org_id);

CREATE TABLE IF NOT EXISTS organization_private_contacts (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('phone', 'email', 'telegram', 'whatsapp', 'other')),
  contact_value text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_private_contacts_org ON organization_private_contacts(org_id);

CREATE TABLE IF NOT EXISTS organization_services (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_slug text NOT NULL,
  service_title text NOT NULL,
  service_description text NOT NULL DEFAULT '',
  price_from numeric(12,2),
  price_to numeric(12,2),
  currency text NOT NULL DEFAULT 'RUB',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, service_slug)
);

CREATE INDEX IF NOT EXISTS idx_org_services_org_active ON organization_services(org_id, is_active);

CREATE TABLE IF NOT EXISTS tags (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  tag_type text NOT NULL DEFAULT 'generic' CHECK (tag_type IN ('generic', 'feature', 'material', 'speed', 'legal')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_tags (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tag_id bigint NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, tag_id)
);

-- 4) Модерация и регистрационные заявки каталога
CREATE TABLE IF NOT EXISTS organization_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  org_slug text,
  org_title text NOT NULL,
  category_slug text,
  region_slug text,
  website_url text,
  public_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  private_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending_email' CHECK (status IN ('pending_email', 'pending_moderation', 'approved', 'rejected', 'published')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_applications_status ON organization_applications(status, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_events (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('organization', 'application', 'review', 'article', 'category')),
  entity_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'submit', 'approve', 'reject', 'publish', 'unpublish', 'edit')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_events_entity ON moderation_events(entity_type, entity_id, created_at DESC);

-- 5) Лиды и воронка
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'site_form' CHECK (source IN ('site_form', 'chat', 'phone', 'partner_api', 'manual')),
  customer_name text,
  customer_phone text,
  customer_email text,
  message text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'rejected', 'closed_won', 'closed_lost')),
  is_billable boolean NOT NULL DEFAULT false,
  dispute_status text NOT NULL DEFAULT 'none' CHECK (dispute_status IN ('none', 'requested', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_org_created ON leads(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- 6) Контент/статьи (под AI-конвейер)
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category_id bigint REFERENCES categories(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  summary text NOT NULL DEFAULT '',
  body_md text NOT NULL DEFAULT '',
  source_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score numeric(5,2),
  generated_by text,
  published_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_status_published ON articles(status, published_at DESC);

-- 7) Отзывы/доверие
CREATE TABLE IF NOT EXISTS organization_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_name text,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_reviews_org_status ON organization_reviews(org_id, status, created_at DESC);

-- 8) Токены/баланс/монетизация (фундамент)
CREATE TABLE IF NOT EXISTS org_token_accounts (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_token_ledger (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delta bigint NOT NULL,
  reason text NOT NULL,
  ref_type text,
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_token_ledger_org_created ON org_token_ledger(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_plans (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  monthly_price_rub integer NOT NULL DEFAULT 0,
  lead_price_rub integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_subscriptions (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id bigint NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org_status ON org_subscriptions(org_id, status);

CREATE TABLE IF NOT EXISTS invoices (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id bigint REFERENCES org_subscriptions(id) ON DELETE SET NULL,
  amount_rub integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),
  due_at timestamptz,
  paid_at timestamptz,
  external_payment_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices(org_id, status, created_at DESC);

-- seed минимального плана
INSERT INTO billing_plans (code, title, monthly_price_rub, lead_price_rub, is_active)
VALUES ('trial', 'Trial', 0, 0, true)
ON CONFLICT (code) DO NOTHING;

-- seed счетов токенов для уже существующих организаций
INSERT INTO org_token_accounts (org_id, balance)
SELECT o.id, 0
FROM organizations o
ON CONFLICT (org_id) DO NOTHING;

-- 9) Актуализация updated_at в базовых таблицах для старых записей
UPDATE regions SET updated_at = now() WHERE updated_at IS NULL;
UPDATE categories SET updated_at = now() WHERE updated_at IS NULL;

