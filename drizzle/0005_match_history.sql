CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  room_id text UNIQUE NOT NULL,
  room_code text NOT NULL,
  mode text NOT NULL,
  player_count integer NOT NULL,
  card_count integer NOT NULL,
  started_at timestamptz,
  ended_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  sips integer NOT NULL DEFAULT 0,
  placement integer NOT NULL,
  is_winner boolean NOT NULL DEFAULT false,
  PRIMARY KEY(match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id, match_id);
CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at DESC);
