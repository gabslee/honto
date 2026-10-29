-- Couple chat ("Just between you"). Text, comments on the partner's photo/video of the day and view-once
-- tombstones. Media bytes never live here: view-once rows keep only the id (SET NULL once opened/expired).
CREATE TABLE IF NOT EXISTS couple_messages (id text PRIMARY KEY, couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, author_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, client_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('text','photo_comment','video_comment','view_once')), body text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000), photo_id text REFERENCES couple_photos(id) ON DELETE SET NULL, private_media_id text REFERENCES private_media(id) ON DELETE SET NULL, media_expires_at timestamptz, media_opened_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(author_user_id, client_id), CHECK ((kind = 'view_once') = (body IS NULL)));

CREATE INDEX IF NOT EXISTS idx_couple_messages_couple ON couple_messages(couple_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_couple_messages_media ON couple_messages(private_media_id) WHERE private_media_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_couple_messages_photo ON couple_messages(photo_id) WHERE photo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS couple_chat_reads (couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, last_read_message_id text NOT NULL, last_read_created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(couple_id, user_id));
