import type { NeonQueryFunction } from "@neondatabase/serverless";
import { coupleKeyFor, roomCoupleId, validPartnerKey } from "../app/couple-identity.js";

type Sql = NeonQueryFunction<false, false>;
let ready: Promise<void> | null = null;

/** Idempotent schema + safe migration of room-scoped daily/history data to couple-scoped data. */
export function ensureCoupleSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS partner_key text`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS couple_id text`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS reunion_date text`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS daily_adult_confirmed_at timestamptz`;
    await sql`CREATE TABLE IF NOT EXISTS couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_couples_pair ON couples(host_user_id, partner_key) WHERE host_user_id IS NOT NULL AND partner_key IS NOT NULL`;
    await sql`CREATE TABLE IF NOT EXISTS daily_cards (room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, day text NOT NULL, slot integer NOT NULL, deck text NOT NULL, card_index integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, day, slot))`;
    await sql`CREATE TABLE IF NOT EXISTS daily_answers (room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, day text NOT NULL, slot integer NOT NULL, player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE, answer text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, day, slot, player_id))`;
    await sql`CREATE TABLE IF NOT EXISTS couple_moments (card_id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, type text NOT NULL, prompt text NOT NULL, answer text, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE daily_cards ADD COLUMN IF NOT EXISTS couple_id text`;
    await sql`ALTER TABLE daily_answers ADD COLUMN IF NOT EXISTS couple_id text`;
    await sql`ALTER TABLE daily_answers ADD COLUMN IF NOT EXISTS role text`;
    await sql`ALTER TABLE daily_answers ADD COLUMN IF NOT EXISTS author_name text`;
    await sql`CREATE TABLE IF NOT EXISTS couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_photos_couple ON couple_photos(couple_id, created_at DESC)`;
    await sql`ALTER TABLE couple_moments ADD COLUMN IF NOT EXISTS couple_id text`;
    // Migration: anything created before couples existed belongs to a room-scoped couple.
    await sql`INSERT INTO couples (id, reunion_date, adult_confirmed_at) SELECT 'room:' || r.id, r.reunion_date, r.daily_adult_confirmed_at FROM rooms r WHERE r.couple_id IS NULL AND (EXISTS (SELECT 1 FROM daily_cards c WHERE c.room_id = r.id) OR EXISTS (SELECT 1 FROM couple_moments m WHERE m.room_id = r.id) OR r.reunion_date IS NOT NULL OR r.daily_adult_confirmed_at IS NOT NULL) ON CONFLICT (id) DO NOTHING`;
    await sql`UPDATE rooms SET couple_id = 'room:' || id WHERE couple_id IS NULL AND EXISTS (SELECT 1 FROM couples c WHERE c.id = 'room:' || rooms.id)`;
    await sql`UPDATE daily_cards c SET couple_id = r.couple_id FROM rooms r WHERE c.room_id = r.id AND c.couple_id IS NULL AND r.couple_id IS NOT NULL`;
    await sql`UPDATE daily_answers a SET couple_id = r.couple_id, role = CASE WHEN p.is_host THEN 'host' ELSE 'partner' END, author_name = p.name FROM rooms r, players p WHERE a.room_id = r.id AND p.id = a.player_id AND a.couple_id IS NULL AND r.couple_id IS NOT NULL`;
    await sql`UPDATE couple_moments m SET couple_id = r.couple_id FROM rooms r WHERE m.room_id = r.id AND m.couple_id IS NULL AND r.couple_id IS NOT NULL`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_cards_couple ON daily_cards(couple_id, day, slot)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_answers_couple ON daily_answers(couple_id, day, slot, role)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_moments_couple ON couple_moments(couple_id, created_at DESC)`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

/** Remember the partner's browser key (set when they join via the link). Never overwrites an existing key. */
export async function rememberPartnerKey(sql: Sql, room: Record<string, unknown>, me: Record<string, unknown>, partnerKey: unknown) {
  if (me.is_host || !validPartnerKey(partnerKey) || me.partner_key) return;
  await ensureCoupleSchema(sql);
  await sql`UPDATE players SET partner_key = ${partnerKey} WHERE id = ${me.id} AND room_id = ${room.id} AND partner_key IS NULL`;
  me.partner_key = partnerKey;
}

async function mergeCouple(sql: Sql, from: string, into: string) {
  await sql`UPDATE couples SET reunion_date = COALESCE(couples.reunion_date, f.reunion_date), adult_confirmed_at = COALESCE(couples.adult_confirmed_at, f.adult_confirmed_at), updated_at = now() FROM couples f WHERE couples.id = ${into} AND f.id = ${from}`;
  await sql`UPDATE daily_cards c SET couple_id = ${into} WHERE c.couple_id = ${from} AND NOT EXISTS (SELECT 1 FROM daily_cards x WHERE x.couple_id = ${into} AND x.day = c.day AND x.slot = c.slot)`;
  await sql`UPDATE daily_answers a SET couple_id = ${into} WHERE a.couple_id = ${from} AND NOT EXISTS (SELECT 1 FROM daily_answers x WHERE x.couple_id = ${into} AND x.day = a.day AND x.slot = a.slot AND x.role = a.role)`;
  await sql`UPDATE couple_moments SET couple_id = ${into} WHERE couple_id = ${from}`;
  await sql`UPDATE couple_photos SET couple_id = ${into} WHERE couple_id = ${from}`;
}

/** Returns the couple row for this 2-player room, creating/linking it as needed. */
export async function resolveCouple(sql: Sql, room: Record<string, unknown>) {
  await ensureCoupleSchema(sql);
  const players = await sql`SELECT id, is_host, user_id, partner_key FROM players WHERE room_id = ${room.id}`;
  const key = coupleKeyFor(players as Record<string, unknown>[]);
  const current = (await sql`SELECT couple_id FROM rooms WHERE id = ${room.id}`)[0] as { couple_id?: string } | undefined;
  let target: string;
  if (key) {
    const found = await sql`SELECT id FROM couples WHERE host_user_id = ${key.hostUserId} AND partner_key = ${key.partnerKey}`;
    if (found[0]) target = String(found[0].id);
    else {
      target = crypto.randomUUID();
      await sql`INSERT INTO couples (id, host_user_id, partner_key) VALUES (${target}, ${key.hostUserId}, ${key.partnerKey}) ON CONFLICT DO NOTHING`;
      target = ((await sql`SELECT id FROM couples WHERE host_user_id = ${key.hostUserId} AND partner_key = ${key.partnerKey}`)[0] as { id: string }).id;
    }
  } else {
    target = current?.couple_id ?? roomCoupleId(room.id);
    await sql`INSERT INTO couples (id) VALUES (${target}) ON CONFLICT (id) DO NOTHING`;
  }
  if (current?.couple_id && current.couple_id !== target) await mergeCouple(sql, current.couple_id, target);
  if (current?.couple_id !== target) await sql`UPDATE rooms SET couple_id = ${target} WHERE id = ${room.id}`;
  room.couple_id = target;
  return (await sql`SELECT id, reunion_date AS "reunionDate", adult_confirmed_at AS "adultConfirmedAt" FROM couples WHERE id = ${target}`)[0] as { id: string; reunionDate: string | null; adultConfirmedAt: string | null };
}
