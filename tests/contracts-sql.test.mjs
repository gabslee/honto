// The W0 schema plan (drizzle/proposed) is valid Postgres and idempotent. In-memory PGlite only, never Neon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('drizzle/proposed/0008-0011_mvp_v1.sql applies twice on top of the current schema', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  // Current production shapes (from app/server-auth.ts and api/couple.ts ensure*Schema).
  await db.exec(`CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', plan text NOT NULL DEFAULT 'free', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO users (id, email, display_name) VALUES ('ua', 'a@x.co', 'Ana'), ('uk', 'k@x.co', 'Kenji'), ('uz', 'z@x.co', 'Zoe');
    INSERT INTO couples (id, host_user_id, partner_key) VALUES ('legacy1', 'ua', 'pk-1');
    INSERT INTO couple_photos VALUES ('old1', 'legacy1', NULL, 'host', 'Ana', 'https://blob/x.jpg', 'x.jpg', NULL, 'hi', 'image/jpeg', 10, now());`);
  const plan = readFileSync(new URL('../drizzle/proposed/0008-0011_mvp_v1.sql', import.meta.url), 'utf8');
  await db.exec(plan);
  await db.exec(plan);
  const one = async (q, p = []) => (await db.query(q, p)).rows[0];
  assert.deepEqual(await one("SELECT legacy, storage FROM couples c JOIN couple_photos p ON p.couple_id = c.id WHERE c.id = 'legacy1'"), { legacy: true, storage: 'blob' });
  // v1 couple: one active couple per user.
  await db.exec(`INSERT INTO couples (id, legacy, paired_at) VALUES ('c1', false, now());
    INSERT INTO couple_members (couple_id, user_id, role) VALUES ('c1', 'ua', 'a'), ('c1', 'uk', 'b');`);
  await db.exec("INSERT INTO couples (id, legacy) VALUES ('c2', false)");
  await assert.rejects(db.exec("INSERT INTO couple_members (couple_id, user_id, role) VALUES ('c2', 'ua', 'a')"));
  // Daily photo uniqueness per author per local day; object-storage rows have no url.
  const photo = (id, daily) => `INSERT INTO couple_photos (id, couple_id, role, author_name, phrase, content_type, size_bytes, storage, author_user_id, local_day, is_daily, status, object_key) VALUES ('${id}', 'c1', 'a', 'Ana', '', 'image/jpeg', 200000, 's3', 'ua', '2026-10-19', ${daily}, 'ready', 'couples/c1/photos/${id}/full.jpg')`;
  await db.exec(photo('p1', true));
  await db.exec(photo('p2', false));
  await assert.rejects(db.exec(photo('p3', true)));
  // Push tokens unique per kind; calendar blocks reject inverted ranges; trips max 48h.
  await db.exec("INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token, env) VALUES ('d1', 'ua', 'i1', 'ios', 'apns_alert', 'tok', 'production')");
  await assert.rejects(db.exec("INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token) VALUES ('d2', 'uk', 'i2', 'android', 'apns_alert', 'tok')"));
  await assert.rejects(db.exec("INSERT INTO calendar_busy (user_id, starts_at, ends_at) VALUES ('ua', '2026-10-19T12:00Z', '2026-10-19T11:00Z')"));
  await assert.rejects(db.exec("INSERT INTO trips (id, couple_id, traveler_user_id, created_by, departs_at, arrives_at, la_starts_at, la_ends_at) VALUES ('t1', 'c1', 'ua', 'ua', '2026-11-10T00:00Z', '2026-11-14T00:00Z', now(), now())"));
  await db.exec("INSERT INTO trips (id, couple_id, traveler_user_id, created_by, departs_at, arrives_at, la_starts_at, la_ends_at) VALUES ('t1', 'c1', 'ua', 'ua', '2026-11-13T15:00Z', '2026-11-14T09:30Z', '2026-11-14T01:30Z', '2026-11-14T10:30Z')");
  await db.exec("INSERT INTO couple_nudges (id, couple_id, from_user_id, to_user_id, source, client_id) VALUES ('n1', 'c1', 'ua', 'uk', 'widget', 'abc')");
  await assert.rejects(db.exec("INSERT INTO couple_nudges (id, couple_id, from_user_id, to_user_id, source, client_id) VALUES ('n2', 'c1', 'ua', 'uk', 'widget', 'abc')"));
  // Deleting the couple cascades shared history.
  await db.exec("DELETE FROM couples WHERE id = 'c1'");
  assert.equal((await one('SELECT count(*)::int AS n FROM trips')).n, 0);
  assert.equal((await one('SELECT count(*)::int AS n FROM couple_members')).n, 0);
  await db.close();
});
