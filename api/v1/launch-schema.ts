import type { NeonQueryFunction } from '@neondatabase/serverless';
import { ensureLifecycleSchema } from './lifecycle';
export type LaunchSql = NeonQueryFunction<false, false>;
const pending = new WeakMap<LaunchSql, Promise<void>>();
export function ensureLaunchSchema(sql: LaunchSql) {
  const existing = pending.get(sql); if (existing) return existing;
  const work = (async () => {
    await ensureLifecycleSchema(sql);
    await sql`CREATE TABLE IF NOT EXISTS user_cities (user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, country text, latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90), longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180), time_zone text, updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS private_media (id text PRIMARY KEY, couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, author_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, client_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('daily_video','view_once')), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','opening')), object_key text NOT NULL UNIQUE, upload_key text NOT NULL UNIQUE, content_type text NOT NULL, size_bytes integer NOT NULL, width integer NOT NULL, height integer NOT NULL, duration_ms integer, local_day date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, opening_at timestamptz, expires_at timestamptz, UNIQUE(author_user_id, client_id))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_private_media_inbox ON private_media(recipient_user_id, expires_at) WHERE kind = 'view_once' AND status = 'ready'`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_private_media_daily ON private_media(couple_id, author_user_id, local_day) WHERE kind = 'daily_video' AND status = 'ready'`;
    await sql`CREATE TABLE IF NOT EXISTS private_video_slots (couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, author_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, local_day date NOT NULL, PRIMARY KEY(couple_id,author_user_id,local_day))`;
  })().catch(error => { pending.delete(sql); throw error; });
  pending.set(sql, work); return work;
}
