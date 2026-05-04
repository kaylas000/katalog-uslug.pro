-- Расширенная идентификация: подтверждение почты, телефон (SMS), OAuth (Яндекс / ЕСИА), токены сброса пароля.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164
  ON users (phone_e164) WHERE phone_e164 IS NOT NULL;

-- Существующие локальные учётки считаем с подтверждённой почтой (до появления колонки).
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at)
WHERE password_hash IS NOT NULL AND email_verified_at IS NULL;

COMMENT ON COLUMN users.email_verified_at IS 'NULL — почта не подтверждена; вход по паролю запрещён';
COMMENT ON COLUMN users.password_hash IS 'NULL — только соц.вход; пароль можно задать позже';

CREATE TABLE IF NOT EXISTS user_oauth_accounts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('yandex', 'esia')),
  provider_user_id text NOT NULL,
  email_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_oauth_user ON user_oauth_accounts (user_id);

CREATE TABLE IF NOT EXISTS oauth_transient_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  code_verifier text NOT NULL,
  redirect_after text NOT NULL DEFAULT '/account/',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_transient_created ON oauth_transient_state (created_at);

CREATE TABLE IF NOT EXISTS auth_email_tokens (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_active
  ON auth_email_tokens (token_hash)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_phone_otp (
  id bigserial PRIMARY KEY,
  phone_e164 text NOT NULL,
  user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('login', 'attach')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_phone_otp_lookup
  ON auth_phone_otp (phone_e164, purpose, created_at DESC);
