-- Расширение purpose для пошаговой регистрации: код на почту и код в SMS.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'auth_email_tokens'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE auth_email_tokens DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE auth_email_tokens
  ADD CONSTRAINT auth_email_tokens_purpose_check
  CHECK (purpose IN ('email_verify', 'password_reset', 'registration_email_code'));

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'auth_phone_otp'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE auth_phone_otp DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE auth_phone_otp
  ADD CONSTRAINT auth_phone_otp_purpose_check
  CHECK (purpose IN ('login', 'attach', 'register_verify'));
