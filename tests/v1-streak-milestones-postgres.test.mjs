// Couple streak + milestones (MVP Layer B) over isolated in-memory PGlite (never Neon): pure rules,
// schema record, GET /api/v1/today (streak, unseenMilestones), GET /api/v1/milestones, POST .../seen.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const foundation = read('../drizzle/0008_v1_foundation.sql');
const lifecycleSql = read('../drizzle/0012_couple_lifecycle.sql');
const migration = read('../drizzle/0013_streak_milestones.sql');
const plan = read('../drizzle/proposed/0008-0011_mvp_v1.sql');
const lineStart = (marker) => plan.lastIndexOf('\n', plan.indexOf(marker)) + 1;
const w2a = plan.slice(lineStart('0009_photos_push (W2a)'), lineStart('0010_calendar_entitlements (W3)'));
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`;

// server-auth reads DATABASE_URL once at import: every import in this file goes through the PGlite stub.
process.env.DATABASE_URL = 'postgres://isolated-test';
let activeDb = null;
globalThis.__hontoTestSql = async (parts, ...values) => (await activeDb.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
const columns = async (db) => (await db.query(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name IN ('couple_streaks', 'couple_milestones', 'couple_milestone_seen') ORDER BY table_name, column_name`)).rows;

const hooks = () => module.registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
  if (specifier === 'next/server') return next('next/server.js', context);
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
  return next(specifier, context);
} });

test('streak and milestone rules (pure)', async () => {
  const registered = hooks();
  try {
    const m = await import('../api/v1/milestones.ts');
    assert.equal(m.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(m.addYears('2024-02-29', 1), '2025-02-28', 'Feb 29 falls on Feb 28');
    assert.equal(m.addYears('2024-02-29', 4), '2028-02-29');
    assert.deepEqual(m.completeDays([{ author: 'a', day: '2026-10-02' }, { author: 'b', day: '2026-10-02' }, { author: 'a', day: '2026-10-03' }, { author: 'x', day: '2026-10-03' }], ['a', 'b']), ['2026-10-02'], 'both members, never a third author');
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06'];
    assert.deepEqual(m.computeStreak(days, '2026-10-06'), { current: 2, best: 3, bestEndedOn: '2026-10-03', lastCompleteDay: '2026-10-06' });
    assert.equal(m.computeStreak(days, '2026-10-07').current, 2, 'yesterday complete, today still open');
    assert.equal(m.computeStreak(days, '2026-10-08').current, 0, 'a full day without both photos resets');
    assert.deepEqual(m.computeStreak([], '2026-10-08'), { current: 0, best: 0, bestEndedOn: null, lastCompleteDay: null });
    assert.equal(m.dayStreakReached(days, 3), '2026-10-03');
    assert.equal(m.dayStreakReached(days, 4), null);

    const base = { today: '2026-10-19', pairedDay: '2026-10-02', startedOn: null, reunionDay: null, firstPhotoDay: null, completeDays: [] };
    assert.deepEqual(m.milestoneCandidates(base), []);
    // Together since 2023: only anniversaries on or after the pairing day count (none yet), 100 days long gone.
    assert.deepEqual(m.milestoneCandidates({ ...base, startedOn: '2023-10-20' }), []);
    assert.deepEqual(m.milestoneCandidates({ ...base, startedOn: '2023-10-10' }), [{ type: 'anniversary', key: '3', value: 3, localDay: '2026-10-10' }]);
    assert.deepEqual(m.milestoneCandidates({ ...base, startedOn: '2026-07-01' }), [{ type: 'days_together', key: '100', value: 100, localDay: '2026-10-09' }]);
    assert.deepEqual(m.milestoneCandidates({ ...base, reunionDay: '2026-10-19' }), [{ type: 'reunion', key: '2026-10-19', value: null, localDay: '2026-10-19' }]);
    assert.deepEqual(m.milestoneCandidates({ ...base, reunionDay: '2026-10-20' }), [], 'countdown not reached yet');
    const thirty = Array.from({ length: 30 }, (_, i) => m.addDays('2026-09-01', i));
    assert.deepEqual(m.milestoneCandidates({ ...base, pairedDay: '2026-09-01', firstPhotoDay: '2026-09-01', completeDays: thirty }).map((c) => [c.type, c.value, c.localDay]),
      [['first_photo', null, '2026-09-01'], ['streak', 7, '2026-09-07'], ['streak', 30, '2026-09-30']]);
  } finally {
    registered.deregister();
  }
});

test('drizzle/0013_streak_milestones.sql is idempotent, unique per couple and cascades', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const fromFile = new PGlite();
  await fromFile.exec(baseTables);
  await fromFile.exec(foundation);
  await fromFile.exec(lifecycleSql);
  await fromFile.exec(migration);
  await fromFile.exec(migration);
  try {
    await fromFile.exec("INSERT INTO users (id, email, display_name) VALUES ('u1', 'u1@x.co', 'U1'); INSERT INTO couples (id, legacy) VALUES ('c1', false); INSERT INTO couple_milestones (id, couple_id, type, dedupe_key, local_day) VALUES ('ms1', 'c1', 'first_photo', 'first', '2026-10-01')");
    await assert.rejects(fromFile.query("INSERT INTO couple_milestones (id, couple_id, type, dedupe_key, local_day) VALUES ('ms2', 'c1', 'first_photo', 'first', '2026-10-02')"), 'once per couple');
    await assert.rejects(fromFile.query("INSERT INTO couple_milestones (id, couple_id, type, dedupe_key, local_day) VALUES ('ms3', 'c1', 'badge', 'x', '2026-10-02')"), 'known types only');
    await fromFile.exec("INSERT INTO couple_milestone_seen (milestone_id, user_id) VALUES ('ms1', 'u1'); DELETE FROM couples WHERE id = 'c1'");
    assert.equal((await fromFile.query('SELECT count(*)::int AS n FROM couple_milestone_seen')).rows[0].n, 0, 'deleting the couple cascades');
  } finally {
    await fromFile.close();
  }
});

test('streak and milestones over the real route handlers', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  activeDb = db;
  const registered = hooks();
  try {
    await db.exec(baseTables);
    const auth = await import('../app/server-auth.ts');
    const couple = await import('../api/v1/couple.ts');
    const milestones = await import('../api/v1/milestones.ts');
    const listRoute = await import('../app/api/v1/milestones/route.ts');
    const seenRoute = await import('../app/api/v1/milestones/[milestoneId]/seen/route.ts');
    const lifecycle = await import('../api/v1/lifecycle.ts');
    await lifecycle.ensureLifecycleSchema(auth.database());
    await milestones.ensureMilestonesSchema(auth.database());
    await milestones.ensureMilestonesSchema(auth.database());
    // The lazy schema and drizzle/0013 define the same columns.
    const fromFile = new PGlite();
    await fromFile.exec(baseTables + foundation + lifecycleSql + migration);
    assert.deepEqual(await columns(db), await columns(fromFile));
    await fromFile.close();

    const people = ['ana', 'kenji', 'zoe', 'yuki', 'solo'];
    await db.query(`INSERT INTO users (id, email, display_name) VALUES ${people.map((p) => `('usr_${p}', '${p}@example.com', '${p}')`).join(', ')}`);
    await db.query("UPDATE users SET time_zone = 'America/Sao_Paulo' WHERE id IN ('usr_ana', 'usr_zoe')");
    await db.query("UPDATE users SET time_zone = 'Asia/Tokyo' WHERE id IN ('usr_kenji', 'usr_yuki')");
    await db.exec(`INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_ak', false, '2026-10-01T12:00:00Z'), ('cpl_zy', false, '2026-10-01T12:00:00Z');
      INSERT INTO couple_members (couple_id, user_id, role, joined_at) VALUES ('cpl_ak', 'usr_ana', 'a', '2026-10-01T12:00:00Z'), ('cpl_ak', 'usr_kenji', 'b', '2026-10-01T12:00:00Z'), ('cpl_zy', 'usr_zoe', 'a', '2026-10-01T12:00:00Z'), ('cpl_zy', 'usr_yuki', 'b', '2026-10-01T12:00:00Z');`);
    const tokens = {};
    for (const p of people) tokens[p] = await auth.createMobileToken({ kind: 'user', userId: `usr_${p}`, platform: 'ios' });
    const at = (iso) => new Date(iso);
    const req = (who, path = '/api/v1/x', init = {}) => new Request(`https://hontogame.com${path}`, { ...init, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });
    const today = async (who, iso) => {
      const response = await couple.todayResponse(req(who), at(iso));
      assert.equal(response.status, 200);
      const json = await response.json();
      assertContract('Today', json);
      return json;
    };
    const list = async (who, iso, query = '') => {
      const response = await milestones.listMilestonesResponse(req(who, `/api/v1/milestones${query}`), at(iso));
      const json = await response.json();
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      if (response.status === 200) assertContract('MilestoneList', json); else assertContract('Error', json);
      return { status: response.status, json };
    };
    const seen = async (who, id) => {
      const response = await seenRoute.POST(req(who, `/api/v1/milestones/${id}/seen`, { method: 'POST' }), { params: Promise.resolve({ milestoneId: id }) });
      const json = await response.json();
      if (response.status === 200) assertContract('Milestone', json); else assertContract('Error', json);
      return { status: response.status, json };
    };

    await t.test('before W2a photos exist: empty streak, no milestones, never a 500', async () => {
      const res = await today('ana', '2026-10-05T12:00:00Z');
      assert.deepEqual(res.streak, { current: 0, best: 0, todayComplete: false, meDoneToday: false, partnerDoneToday: false, lastCompleteDay: null });
      assert.deepEqual(res.unseenMilestones, []);
      assert.deepEqual((await list('ana', '2026-10-05T12:00:00Z')).json, { milestones: [] });
    });

    await db.exec(w2a);
    const photo = async (author, day, { coupleOf = 'cpl_ak', status = 'ready' } = {}) => {
      const id = `ph_${author}_${day}_${Math.random().toString(36).slice(2, 8)}`;
      await db.query(`INSERT INTO couple_photos (id, couple_id, role, author_name, phrase, content_type, size_bytes, storage, author_user_id, local_day, is_daily, status, object_key, thumb_key, width, height, created_at, ready_at)
        VALUES ($1, $2, 'v1', $3, '', 'image/jpeg', 3, 's3', $4, $5, true, $6, $7, $8, 1080, 1440, $9, $10)`, [id, coupleOf, author, `usr_${author}`, day, status, `couples/${coupleOf}/photos/${id}/full.jpg`, `couples/${coupleOf}/photos/${id}/thumb.jpg`, `${day}T12:00:00Z`, status === 'ready' ? `${day}T12:00:00Z` : null]);
      return id;
    };

    await t.test('7 days with both photos: streak 7, first photo + 7-day milestones recorded once', async () => {
      for (let i = 5; i <= 11; i++) {
        await photo('ana', `2026-10-${String(i).padStart(2, '0')}`);
        await photo('kenji', `2026-10-${String(i).padStart(2, '0')}`);
      }
      await photo('ana', '2026-10-04');
      await photo('kenji', '2026-10-03', { status: 'pending' });
      await photo('zoe', '2026-10-04', { coupleOf: 'cpl_zy' });
      // 12:00Z: São Paulo 09:00 Oct 11, Tokyo 21:00 Oct 11.
      const res = await today('ana', '2026-10-11T12:00:00Z');
      assert.deepEqual(res.streak, { current: 7, best: 7, todayComplete: true, meDoneToday: true, partnerDoneToday: true, lastCompleteDay: '2026-10-11' });
      assert.deepEqual(res.unseenMilestones.map((m) => [m.type, m.value, m.localDay, m.seenAt]), [['first_photo', null, '2026-10-04', null], ['streak', 7, '2026-10-11', null]]);
      await today('kenji', '2026-10-11T12:00:01Z');
      await list('ana', '2026-10-11T12:00:02Z');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_milestones WHERE couple_id = 'cpl_ak'")).rows[0].n, 2, 'idempotent across readers and calls');
      const other = await today('zoe', '2026-10-11T12:00:00Z');
      assert.equal(other.streak.current, 0);
      assert.deepEqual(other.unseenMilestones.map((m) => m.type), ['first_photo'], 'milestones are per couple');
    });

    await t.test('each partner\'s own day: the partner a day ahead never sees an early reset', async () => {
      // 16:00Z: São Paulo 13:00 Oct 11, Tokyo 01:00 Oct 12 (Kenji has not posted for Oct 12 yet).
      const kenji = await today('kenji', '2026-10-11T16:00:00Z');
      assert.deepEqual([kenji.me.localDay, kenji.partner.localDay], ['2026-10-12', '2026-10-11']);
      assert.deepEqual(kenji.streak, { current: 7, best: 7, todayComplete: false, meDoneToday: false, partnerDoneToday: true, lastCompleteDay: '2026-10-11' });
      // Oct 12 16:00Z: São Paulo Oct 12 (open), Tokyo Oct 13. Oct 12 is not over for Ana yet.
      assert.equal((await today('ana', '2026-10-12T16:00:00Z')).streak.current, 7);
      await photo('ana', '2026-10-12');
      const half = await today('ana', '2026-10-12T16:00:00Z');
      assert.deepEqual([half.streak.current, half.streak.meDoneToday, half.streak.partnerDoneToday, half.streak.todayComplete], [7, true, false, false]);
      // Oct 13 04:00Z: São Paulo 01:00 Oct 13, Tokyo 13:00 Oct 13. Oct 12 is over for both without Kenji's photo.
      const reset = await today('ana', '2026-10-13T04:00:00Z');
      assert.deepEqual([reset.streak.current, reset.streak.best, reset.streak.lastCompleteDay], [0, 7, '2026-10-11']);
      // Partner zone unknown: only my day decides, partner not done.
      await db.query("UPDATE users SET time_zone = NULL WHERE id = 'usr_kenji'");
      const unknown = await today('ana', '2026-10-11T12:00:00Z');
      assert.deepEqual([unknown.streak.partnerDoneToday, unknown.streak.todayComplete, unknown.streak.current], [false, false, 7]);
      await db.query("UPDATE users SET time_zone = 'Asia/Tokyo' WHERE id = 'usr_kenji'");
    });

    await t.test('best streak is kept when photos are deleted', async () => {
      await db.query("DELETE FROM couple_photos WHERE couple_id = 'cpl_ak' AND author_user_id = 'usr_kenji' AND local_day = '2026-10-08'");
      const res = await today('ana', '2026-10-11T12:00:00Z');
      assert.deepEqual([res.streak.current, res.streak.best], [3, 7]);
      assert.equal((await db.query("SELECT best FROM couple_streaks WHERE couple_id = 'cpl_ak'")).rows[0].best, 7);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_milestones WHERE couple_id = 'cpl_ak' AND type = 'streak'")).rows[0].n, 1, 'a recorded milestone stays');
    });

    await t.test('seen is per user, idempotent, and scoped to my couple', async () => {
      const unseen = (await list('ana', '2026-10-11T12:00:00Z', '?unseen=true')).json.milestones;
      assert.equal(unseen.length, 2);
      const first = await seen('ana', unseen[0].id);
      assert.equal(first.status, 200);
      assert.equal(first.json.id, unseen[0].id);
      assert.match(first.json.seenAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      await db.query("UPDATE couple_milestone_seen SET seen_at = '2026-10-11T12:30:00Z' WHERE milestone_id = $1", [unseen[0].id]);
      assert.equal((await seen('ana', unseen[0].id)).json.seenAt, '2026-10-11T12:30:00Z', 'the first seenAt is kept');
      assert.deepEqual((await today('ana', '2026-10-11T12:00:00Z')).unseenMilestones.map((m) => m.id), [unseen[1].id]);
      assert.equal((await today('kenji', '2026-10-11T12:00:00Z')).unseenMilestones.length, 2, 'my partner still sees both');
      const all = (await list('ana', '2026-10-11T12:00:00Z')).json.milestones;
      assert.deepEqual(all.map((m) => m.seenAt === null), [false, true]);
      const zoeMilestone = (await list('zoe', '2026-10-11T12:00:00Z')).json.milestones[0];
      const foreign = await seen('ana', zoeMilestone.id);
      assert.deepEqual([foreign.status, foreign.json.code], [404, 'not_found']);
      assert.deepEqual([(await seen('ana', 'ms_missing')).status], [404]);
      assert.deepEqual([(await seen(null, unseen[0].id)).json.code], ['unauthorized']);
      assert.deepEqual([(await seen('solo', unseen[0].id)).json.code], ['not_paired']);
      const bad = await list('ana', '2026-10-11T12:00:00Z', '?unseen=yes');
      assert.deepEqual([bad.status, bad.json.code], [400, 'bad_request']);
      assert.equal((await list('solo', '2026-10-11T12:00:00Z')).status, 409);
      const route = await listRoute.GET(req('ana', '/api/v1/milestones'));
      assert.equal(route.status, 200);
      assertContract('MilestoneList', await route.json());
    });

    await t.test('date milestones: 100 days together, anniversary, reunion day; nothing before pairing', async () => {
      await db.query("UPDATE couples SET started_on = '2026-07-01' WHERE id = 'cpl_ak'");
      assert.equal((await today('ana', '2026-10-08T12:00:00Z')).unseenMilestones.some((m) => m.type === 'days_together'), false, 'day 99');
      const hundred = (await today('ana', '2026-10-09T12:00:00Z')).unseenMilestones.find((m) => m.type === 'days_together');
      assert.deepEqual([hundred.value, hundred.localDay, hundred.achievedAt], [100, '2026-10-09', '2026-10-09T12:00:00Z']);
      // Together since 2024-10-10: the 2nd anniversary (after pairing) counts, the 1st (2025) and the old 100 days do not.
      await db.query("UPDATE couples SET started_on = '2024-10-10', reunion_at = '2026-10-11T09:30:00Z', reunion_time_zone = 'Asia/Tokyo' WHERE id = 'cpl_ak'");
      const res = await list('ana', '2026-10-11T12:00:00Z');
      const types = res.json.milestones.map((m) => [m.type, m.value, m.localDay]);
      assert.deepEqual(types.filter(([type]) => ['anniversary', 'reunion', 'days_together'].includes(type)), [['days_together', 100, '2026-10-09'], ['anniversary', 2, '2026-10-10'], ['reunion', null, '2026-10-11']]);
      // A new reunion date is a new milestone; the same one is not recorded twice.
      await list('kenji', '2026-10-11T13:00:00Z');
      await db.query("UPDATE couples SET reunion_at = '2026-10-18T09:30:00Z' WHERE id = 'cpl_ak'");
      assert.equal((await list('ana', '2026-10-17T12:00:00Z')).json.milestones.filter((m) => m.type === 'reunion').length, 1, 'countdown not reached');
      assert.equal((await list('ana', '2026-10-18T12:00:00Z')).json.milestones.filter((m) => m.type === 'reunion').length, 2);
    });

    await t.test('ETag changes when a milestone is marked seen', async () => {
      const before = await couple.todayResponse(req('kenji'), at('2026-10-18T12:00:00Z'));
      const unseen = (await before.json()).unseenMilestones;
      assert.ok(unseen.length > 0);
      await seen('kenji', unseen[0].id);
      const after = await couple.todayResponse(req('kenji', '/api/v1/x'), at('2026-10-18T12:00:00Z'));
      assert.notEqual(after.headers.get('etag'), before.headers.get('etag'));
    });
  } finally {
    registered.deregister();
    await db.close();
  }
});
