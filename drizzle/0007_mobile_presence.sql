-- Presence and idempotency primitives shared by web and future native clients.
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS room_action_receipts (
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_room_action_receipts_created
  ON room_action_receipts(created_at);
