-- Additive migration. Existing two-player rooms retain their mode and deck.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS multiplayer boolean NOT NULL DEFAULT false;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS group_state jsonb;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
