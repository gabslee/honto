-- Account deletion and unpair hardening. Builds on 0008_v1_foundation.sql and 0012_couple_lifecycle.sql.
-- Applied lazily by ensureLifecycleSchema() (api/v1/lifecycle.ts); this file is the reviewable record.
-- Idempotent: safe to run before or after the app created any of it, and safe to run twice.

-- Why a v1 couple ended. 'unpaired' = DELETE /api/v1/couple, 'partner_deleted' = a member deleted their
-- account. NULL on couples unpaired before this column existed (GET /api/v1/me reports them as 'unpaired').
ALTER TABLE couples ADD COLUMN IF NOT EXISTS unpair_reason text CHECK (unpair_reason IN ('unpaired', 'partner_deleted'));

-- Sign in with Apple refresh tokens (web callback, or the native authorizationCode exchanged at sign-in), one
-- per user and client id (services id for the web, bundle id for the app). Revoked through
-- https://appleid.apple.com/auth/revoke when the account is deleted (App Store guideline 5.1.1(v)).
CREATE TABLE IF NOT EXISTS apple_tokens (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  refresh_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

-- Legacy web game link players.user_id: was REFERENCES users(id) with NO ACTION, which made deleting any user
-- who ever played fail. Now ON DELETE SET NULL (the player row and its match history stay, unlinked).
-- NOT VALID + VALIDATE keeps the lock short; existing rows already satisfy the old constraint.
DO $$
DECLARE fk record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'players' AND column_name = 'user_id') THEN
    FOR fk IN SELECT con.conname FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.conrelid = 'players'::regclass AND con.contype = 'f' AND a.attname = 'user_id' AND con.confdeltype <> 'n' LOOP
      EXECUTE format('ALTER TABLE players DROP CONSTRAINT %I', fk.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.conrelid = 'players'::regclass AND con.contype = 'f' AND a.attname = 'user_id') THEN
      ALTER TABLE players ADD CONSTRAINT players_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
      ALTER TABLE players VALIDATE CONSTRAINT players_user_id_fkey;
    END IF;
  END IF;
END $$;

-- Repair of couples a raw user delete left half-ended (couple not unpaired, fewer than 2 active members):
-- the daily retention cron and the pairing endpoints run repairHalfCouples() (unpair with reason
-- 'partner_deleted' and notify the remaining member). One-off equivalent, without the push:
--   WITH c AS (UPDATE couples SET unpaired_at = now(), unpair_reason = 'partner_deleted', updated_at = now(),
--                started_on = NULL, reunion_at = NULL, reunion_city = NULL, reunion_time_zone = NULL
--              WHERE legacy = false AND unpaired_at IS NULL
--                AND (SELECT count(*) FROM couple_members a WHERE a.couple_id = couples.id AND a.left_at IS NULL) < 2
--              RETURNING id, unpaired_at)
--   UPDATE couple_members SET left_at = c.unpaired_at FROM c WHERE couple_members.couple_id = c.id AND couple_members.left_at IS NULL;
