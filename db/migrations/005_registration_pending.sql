-- Регистрация без создания users до подтверждения кода (черновик + OTP).

CREATE TABLE IF NOT EXISTS registration_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_registration_pending_email
  ON registration_pending (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_registration_pending_expires
  ON registration_pending (expires_at);

CREATE TABLE IF NOT EXISTS registration_pending_otp (
  id bigserial PRIMARY KEY,
  pending_id uuid NOT NULL REFERENCES registration_pending (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  phone_e164 text,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_pending_otp_lookup
  ON registration_pending_otp (pending_id, channel, phone_e164, consumed_at);
