-- Добавляем updated_at в users (нужно для dev-bootstrap и единообразия аудита).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Fix: поле users.updated_at нужно для /v1/auth/dev/bootstrap (ON CONFLICT ... updated_at = now()).
-- Идемпотентно, безопасно для уже созданных таблиц.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE users
SET updated_at = COALESCE(updated_at, now())
WHERE updated_at IS NULL;

