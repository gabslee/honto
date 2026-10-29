// /api/v1 calendar busy/free mirror over isolated in-memory PGlite (never Neon).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const fixture = (name) => JSON.parse(readFileSync(new URL(`../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'));
const foundation = readFileSync(new URL('../drizzle/0008_v1_foundation.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../drizzle/0010_calendar_entitlements.sql', import.meta.url), 'utf8');
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** Same instant written with a fixed UTC offset in minutes (`+09:00` = 540), as a device in that zone would. */
const withOffset = (ms, minutes) => {
  const local = new Date(ms + minutes * MIN).toISOString().slice(0, 19);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

/** Neon-like `sql` over PGlite: lazy tagged queries (so `sql.transaction([...])` can run them) and a real transaction. */
function pgliteSql(db) {
  const sql = (parts, ...values) => {
    const text = parts.reduce((out, part, i) => out + (i ? `$${i}` : '') + part, '');
    let promise = null;
    const run = () => (promise ??= db.query(text, values).then((result) => result.rows));
    return { text, values, then: (ok, fail) => run().then(ok, fail), catch: (fail) => run().catch(fail), finally: (done) => run().finally(done) };
  };
  sql.transaction = (queries) => db.transaction(async (tx) => {
    const results = [];
    for (const query of queries) results.push((await tx.query(query.text, query.values)).rows);
    return results;
  });
  return sql;
}

// One isolated PGlite per file, behind the Neon client, before any app module is imported.
const { PGlite } = await import('@electric-sql/pglite');
const db = new PGlite();
globalThis.__hontoTestSql = pgliteSql(db);
const hooks = module.registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
  return next(specifier, context);
} });
const oldUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = 'postgres://isolated-test';
test.after(async () => {
  hooks.deregister();
  delete globalThis.__hontoTestSql;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  await db.close();
});

async function schemaShape(db) {
  const { rows } = await db.query("SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name IN ('calendar_busy', 'calendar_sync', 'entitlements', 'revenuecat_events') ORDER BY table_name, column_name");
  const { rows: indexes } = await db.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('calendar_busy', 'calendar_sync', 'entitlements', 'revenuecat_events') ORDER BY indexname");
  return { rows, indexes };
}

test('computePartnerStatus and input parsing (pure)', async (t) => {
  const { computePartnerStatus, parseBusyUpload, parseCalendarRange, parseInstant } = await import('../app/api/v1/calendar/calendar-service.ts');
  const now = Date.parse('2026-10-19T12:00:00Z');
  const sync = { syncedAt: Date.parse('2026-10-19T10:55:00Z'), windowFrom: Date.parse('2026-10-18T15:00:00Z'), windowTo: Date.parse('2026-11-01T15:00:00Z') };
  const at = (start, end) => ({ start: parseInstant(start), end: parseInstant(end) });

  await t.test('busy: back-to-back and overlapping blocks chain, written in any offset', () => {
    // Kenji (Tokyo, +09:00): 20:00-21:00, 21:00-22:30 and 22:00-23:00 local are one busy run.
    const blocks = [at('2026-10-19T21:00:00+09:00', '2026-10-19T22:30:00+09:00'), at('2026-10-19T20:00:00+09:00', '2026-10-19T21:00:00+09:00'), at('2026-10-19T22:00:00+09:00', '2026-10-19T23:00:00+09:00'), at('2026-10-20T09:00:00+09:00', '2026-10-20T18:00:00+09:00')];
    const status = computePartnerStatus(blocks, sync, now);
    assert.deepEqual(status, { state: 'busy', busyUntil: '2026-10-19T14:00:00Z', freeUntil: null, title: null, syncedAt: '2026-10-19T10:55:00Z' });
    // Same blocks expressed from São Paulo (-03:00) give the same answer.
    const fromSaoPaulo = [at('2026-10-19T08:00:00-03:00', '2026-10-19T10:30:00-03:00'), at('2026-10-19T10:00:00-03:00', '2026-10-19T11:00:00-03:00')];
    assert.equal(computePartnerStatus(fromSaoPaulo, sync, now).busyUntil, '2026-10-19T14:00:00Z');
    assertContract('PartnerStatus', status);
  });

  await t.test('busy across a DST change (America/New_York falls back on 2026-11-01)', () => {
    // 01:30 EDT -> 01:30 EST is one real hour; "now" is in the middle of it.
    const block = at('2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00');
    const dstSync = { syncedAt: Date.parse('2026-10-31T12:00:00Z'), windowFrom: Date.parse('2026-10-31T04:00:00Z'), windowTo: Date.parse('2026-11-14T05:00:00Z') };
    const status = computePartnerStatus([block], dstSync, Date.parse('2026-11-01T06:00:00Z'));
    assert.equal(status.state, 'busy');
    assert.equal(status.busyUntil, '2026-11-01T06:30:00Z');
  });

  await t.test('free: freeUntil is the next block start; ends exactly now = free; starts exactly now = busy', () => {
    const blocks = [at('2026-10-19T11:00:00Z', '2026-10-19T12:00:00Z'), at('2026-10-19T15:30:00Z', '2026-10-19T16:00:00Z'), at('2026-10-19T14:00:00Z', '2026-10-19T15:00:00Z')];
    assert.deepEqual(computePartnerStatus(blocks, sync, now), { state: 'free', busyUntil: null, freeUntil: '2026-10-19T14:00:00Z', title: null, syncedAt: '2026-10-19T10:55:00Z' });
    assert.equal(computePartnerStatus([at('2026-10-19T12:00:00Z', '2026-10-19T12:45:00Z')], sync, now).busyUntil, '2026-10-19T12:45:00Z');
    assert.deepEqual(computePartnerStatus([], sync, now), { state: 'free', busyUntil: null, freeUntil: null, title: null, syncedAt: '2026-10-19T10:55:00Z' });
    // A block after the uploaded window is not trusted as "next".
    assert.equal(computePartnerStatus([at('2026-11-02T00:00:00Z', '2026-11-02T01:00:00Z')], sync, now).freeUntil, null);
  });

  await t.test('unknown: never synced or now outside the uploaded window', () => {
    assert.deepEqual(computePartnerStatus([], null, now), { state: 'unknown', busyUntil: null, freeUntil: null, title: null, syncedAt: null });
    const stale = { ...sync, windowTo: now };
    assert.deepEqual(computePartnerStatus([at('2026-10-19T11:00:00Z', '2026-10-19T13:00:00Z')], stale, now).state, 'unknown');
  });

  await t.test('parseBusyUpload: window, limits, all-day and titles', () => {
    const base = { from: iso(now - HOUR), to: iso(now + 14 * DAY - HOUR), timeZone: 'Asia/Tokyo' };
    const ok = parseBusyUpload({ ...base, blocks: [
      { start: withOffset(now, 540), end: withOffset(now + HOUR, 540) },
      { start: iso(now - 3 * HOUR), end: iso(now) }, // clipped to the window start
      { start: iso(now - 3 * HOUR), end: iso(now - 2 * HOUR) }, // outside the window: skipped
      { start: iso(now), end: iso(now + DAY), allDay: true, title: 'Holiday' },
      { start: iso(now + DAY), end: iso(now + DAY + HOUR), title: 'Dentist', calendarRef: 'cal_1' },
    ] }, now);
    assert.deepEqual(ok, { from: now - HOUR, to: now + 14 * DAY - HOUR, timeZone: 'Asia/Tokyo', ignoredAllDay: 1, droppedTitles: 1, blocks: [{ start: now, end: now + HOUR }, { start: now - HOUR, end: now }, { start: now + DAY, end: now + DAY + HOUR }] });
    const bad = (body) => assert.ok('error' in parseBusyUpload(body, now), JSON.stringify(body));
    bad(null);
    bad([]);
    bad({ ...base, blocks: 'nope' });
    bad({ ...base, to: iso(now + 14 * DAY + 2 * HOUR), blocks: [] }); // more than 14 days ahead
    // Within the clock-skew allowance the window is accepted, but nothing is stored past now + 14 days.
    const edge = parseBusyUpload({ from: iso(now + HOUR), to: iso(now + 14 * DAY + 30 * MIN), timeZone: 'UTC', blocks: [
      { start: iso(now + 14 * DAY - 30 * MIN), end: iso(now + 14 * DAY + 20 * MIN) },
      { start: iso(now + 14 * DAY + 10 * MIN), end: iso(now + 14 * DAY + 20 * MIN) },
    ] }, now);
    assert.deepEqual(edge.blocks, [{ start: now + 14 * DAY - 30 * MIN, end: now + 14 * DAY }]);
    bad({ ...base, from: iso(now - 3 * DAY), to: iso(now + DAY), blocks: [] }); // too far back
    bad({ from: iso(now), to: iso(now + 15 * DAY), timeZone: 'UTC', blocks: [] }); // window longer than 14 days
    bad({ ...base, from: base.to, blocks: [] });
    bad({ ...base, timeZone: 'Mars/Base', blocks: [] });
    bad({ ...base, timeZone: undefined, blocks: [] });
    bad({ ...base, blocks: [{ start: iso(now + HOUR), end: iso(now) }] });
    bad({ ...base, blocks: [{ start: '2026-10-19 12:00', end: iso(now) }] });
    bad({ ...base, blocks: [null] });
    bad({ ...base, blocks: Array.from({ length: 501 }, () => ({ start: iso(now), end: iso(now + HOUR) })) });
    assert.equal(parseBusyUpload({ ...base, blocks: Array.from({ length: 500 }, () => ({ start: iso(now), end: iso(now + HOUR) })) }, now).blocks.length, 500);
    // The contract fixture shape (dates moved to "now").
    const request = fixture('uploadCalendarBusy.request');
    assertContract('CalendarBusyUpload', request);
  });

  await t.test('parseCalendarRange', () => {
    const range = (query) => parseCalendarRange(new URL(`https://x/api/v1/calendar?${query}`));
    assert.deepEqual(range('from=2026-10-19T00:00:00-03:00&to=2026-10-26T00:00:00-03:00'), { from: Date.parse('2026-10-19T03:00:00Z'), to: Date.parse('2026-10-26T03:00:00Z') });
    assert.ok('error' in range('from=2026-10-19T00:00:00Z'));
    assert.ok('error' in range('from=2026-10-19T00:00:00Z&to=2026-11-03T00:00:01Z'));
    assert.ok('error' in range('from=2026-10-20T00:00:00Z&to=2026-10-19T00:00:00Z'));
    assert.ok('error' in range('from=yesterday&to=today'));
  });
});

test('drizzle/0010_calendar_entitlements.sql is idempotent', async () => {
  const fresh = new PGlite();
  await fresh.exec(baseTables);
  await fresh.exec(foundation);
  await fresh.exec(migration);
  await fresh.exec(migration);
  await fresh.exec("INSERT INTO users (id, email, display_name) VALUES ('ua', 'a@x', 'A'); INSERT INTO couples (id, legacy) VALUES ('c1', false)");
  await assert.rejects(fresh.exec("INSERT INTO calendar_busy (couple_id, user_id, starts_at, ends_at) VALUES ('c1', 'ua', '2026-10-19T12:00Z', '2026-10-19T11:00Z')"), 'inverted ranges are rejected');
  await assert.rejects(fresh.exec("INSERT INTO entitlements (user_id, source) VALUES ('ua', 'paypal')"));
  const { rows } = await fresh.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'calendar_busy' AND column_name IN ('title', 'calendar_ref')");
  assert.deepEqual(rows, [{ column_name: 'title', is_nullable: 'YES' }], 'title is reserved (nullable, never written yet)');
  await fresh.close();
});

test('PUT /api/v1/calendar/busy, GET /api/v1/calendar and pruneCalendar', async (t) => {
  await db.exec(baseTables);
  const auth = await import('../app/server-auth.ts');
  const { ensureFoundationSchema } = await import('../server/v1/foundation-schema.ts');
  const { ensureCalendarSchema, pruneCalendar } = await import('../server/v1/calendar-schema.ts');
  const { ensureEntitlementsSchema } = await import('../app/entitlements.ts');
  const service = await import('../app/api/v1/calendar/calendar-service.ts');
  const busyRoute = await import('../app/api/v1/calendar/busy/route.ts');
  const calendarRoute = await import('../app/api/v1/calendar/route.ts');
  const { partnerStatus: todayPartnerStatus } = await import('../server/v1/couple.ts');
  const sql = auth.database();

  await ensureFoundationSchema(sql);
  await ensureCalendarSchema(sql);
  await ensureCalendarSchema(sql);
  await ensureEntitlementsSchema(sql);
  await db.query("INSERT INTO users (id, email, display_name, time_zone) VALUES ('usr_ana', 'ana@example.com', 'Ana', 'America/Sao_Paulo'), ('usr_kenji', 'kenji@example.com', 'Kenji', NULL), ('usr_zoe', 'zoe@example.com', 'Zoe', NULL), ('usr_lia', 'lia@example.com', 'Lia', NULL), ('usr_max', 'max@example.com', 'Max', NULL)");
  await db.query("INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_01', false, now()), ('cpl_02', false, now())");
  await db.query("INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_01', 'usr_ana', 'a'), ('cpl_01', 'usr_kenji', 'b'), ('cpl_02', 'usr_lia', 'a'), ('cpl_02', 'usr_max', 'b')");
  const token = {
    ana: await auth.createMobileToken({ kind: 'user', userId: 'usr_ana', platform: 'ios' }),
    kenji: await auth.createMobileToken({ kind: 'user', userId: 'usr_kenji', platform: 'android' }),
    zoe: await auth.createMobileToken({ kind: 'user', userId: 'usr_zoe', platform: 'ios' }),
    lia: await auth.createMobileToken({ kind: 'user', userId: 'usr_lia', platform: 'ios' }),
  };
  const anaCookie = await auth.createUserSession('usr_ana');

  const read = async (response) => {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, json: await response.json() };
  };
  const put = async (who, body, headers = {}) => read(await busyRoute.PUT(new Request('https://x/api/v1/calendar/busy', { method: 'PUT', headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${token[who]}` } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })));
  const get = async (who, query, headers = {}) => read(await calendarRoute.GET(new Request(`https://x/api/v1/calendar?${new URLSearchParams(query)}`, { headers: { ...(who ? { authorization: `Bearer ${token[who]}` } : {}), ...headers } })));
  const expectError = (result, status, code) => {
    assert.equal(result.status, status, JSON.stringify(result.json));
    assertContract('Error', result.json);
    assert.equal(result.json.code, code);
  };
  const premium = (on) => db.query(on ? "INSERT INTO entitlements (user_id, source, expires_at) VALUES ('usr_kenji', 'revenuecat', now() + interval '30 days') ON CONFLICT DO NOTHING" : "DELETE FROM entitlements");

  const now = Date.now();
  const hour = Math.floor(now / HOUR) * HOUR;
  const window = { from: iso(hour - HOUR), to: iso(hour + 14 * DAY - HOUR) };
  const range = { from: iso(hour - HOUR), to: iso(hour + 7 * DAY) };
  const stored = async (userId) => (await db.query('SELECT couple_id, starts_at, ends_at FROM calendar_busy WHERE user_id = $1 ORDER BY starts_at', [userId])).rows.map((row) => [row.couple_id, iso(row.starts_at.getTime()), iso(row.ends_at.getTime())]);

  await t.test('auth and pairing: 401 anonymous, 409 not paired, for both endpoints', async () => {
    expectError(await put(null, { ...window, timeZone: 'UTC', blocks: [] }), 401, 'unauthorized');
    expectError(await get(null, range), 401, 'unauthorized');
    expectError(await put('zoe', { ...window, timeZone: 'UTC', blocks: [] }), 409, 'not_paired');
    expectError(await get('zoe', range), 409, 'not_paired');
  });

  await t.test('upload works on Free and answers the contract shape (contract fixture moved to now)', async () => {
    const request = fixture('uploadCalendarBusy.request');
    request.from = window.from;
    request.to = window.to;
    request.blocks[0] = { ...request.blocks[0], start: iso(hour + 2 * HOUR), end: iso(hour + 3 * HOUR + 30 * MIN) };
    request.blocks[1] = { ...request.blocks[1], start: iso(hour + 7 * HOUR), end: iso(hour + 8 * HOUR) };
    request.blocks[2] = { ...request.blocks[2], start: iso(hour + DAY), end: iso(hour + 2 * DAY) };
    const result = await put('ana', request);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assertContract('CalendarBusyResult', result.json);
    assert.deepEqual({ ...result.json, syncedAt: undefined }, { syncedAt: undefined, stored: 2, ignoredAllDay: 1, droppedTitles: 1 });
    assert.ok(Math.abs(Date.parse(result.json.syncedAt) - Date.now()) < 5000);
    assert.deepEqual(await stored('usr_ana'), [['cpl_01', iso(hour + 2 * HOUR), iso(hour + 3 * HOUR + 30 * MIN)], ['cpl_01', iso(hour + 7 * HOUR), iso(hour + 8 * HOUR)]]);
    // Nothing of the title is stored anywhere.
    const dump = JSON.stringify((await db.query('SELECT * FROM calendar_busy')).rows) + JSON.stringify((await db.query('SELECT * FROM calendar_sync')).rows);
    assert.ok(!dump.includes('Pilates'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM calendar_busy WHERE title IS NOT NULL')).rows[0].n, 0);
    // The cookie works too.
    assert.equal((await put(null, { ...window, timeZone: 'America/Sao_Paulo', blocks: request.blocks }, { cookie: `honto_session=${anaCookie}` })).status, 200);
  });

  await t.test('402 premium_required for a free couple; 400 for a bad range', async () => {
    const free = await get('ana', range);
    expectError(free, 402, 'premium_required');
    assert.deepEqual(free.json, fixture('getCalendar.402'));
    await premium(true);
    expectError(await get('ana', { from: range.from }), 400, 'bad_request');
    expectError(await get('ana', { from: range.from, to: iso(hour + 15 * DAY) }), 400, 'bad_request');
  });

  await t.test('the partner sees my blocks, never titles; uploads are invisible to other couples', async () => {
    const view = await get('kenji', range);
    assert.equal(view.status, 200, JSON.stringify(view.json));
    assertContract('CalendarView', view.json);
    assert.deepEqual(view.json.partner, { timeZone: 'America/Sao_Paulo', syncedAt: view.json.partner.syncedAt, blocks: [{ start: iso(hour + 2 * HOUR), end: iso(hour + 3 * HOUR + 30 * MIN), title: null }, { start: iso(hour + 7 * HOUR), end: iso(hour + 8 * HOUR), title: null }] });
    assert.match(view.json.partner.syncedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(view.json.me, { timeZone: null, syncedAt: null, blocks: [] }, 'Kenji never synced');
    assert.deepEqual([view.json.from, view.json.to], [range.from, range.to]);
    assert.ok(!JSON.stringify(view.json).includes('Pilates'));
    const mine = await get('ana', range);
    assert.deepEqual(mine.json.me.blocks, view.json.partner.blocks);
    assert.deepEqual(mine.json.partnerStatus, { state: 'unknown', busyUntil: null, freeUntil: null, title: null, syncedAt: null });
    // Another (free) couple cannot read; once Premium it sees only its own (empty) calendar.
    expectError(await get('lia', range), 402, 'premium_required');
    await db.query("INSERT INTO entitlements (user_id, source, expires_at) VALUES ('usr_max', 'revenuecat', NULL)");
    const other = await get('lia', range);
    assert.equal(other.status, 200);
    assert.deepEqual([other.json.me.blocks, other.json.partner.blocks], [[], []]);
  });

  await t.test('atomic replace: the new upload removes every stale block in its window, keeps the rest', async () => {
    // A far block outside the next window must survive.
    const late = { from: iso(hour + 10 * DAY), to: iso(hour + 12 * DAY), timeZone: 'America/Sao_Paulo', blocks: [{ start: iso(hour + 11 * DAY), end: iso(hour + 11 * DAY + HOUR) }] };
    assert.equal((await put('ana', late)).status, 200);
    const next = { from: iso(hour - HOUR), to: iso(hour + 9 * DAY), timeZone: 'America/Sao_Paulo', blocks: [{ start: iso(hour + 4 * HOUR), end: iso(hour + 5 * HOUR) }, { start: iso(hour - 3 * HOUR), end: iso(hour) }] };
    assert.equal((await put('ana', next)).json.stored, 2);
    assert.deepEqual(await stored('usr_ana'), [['cpl_01', iso(hour - HOUR), iso(hour)], ['cpl_01', iso(hour + 4 * HOUR), iso(hour + 5 * HOUR)], ['cpl_01', iso(hour + 11 * DAY), iso(hour + 11 * DAY + HOUR)]]);
    // An empty upload clears the window.
    assert.equal((await put('ana', { ...next, blocks: [] })).json.stored, 0);
    assert.deepEqual(await stored('usr_ana'), [['cpl_01', iso(hour + 11 * DAY), iso(hour + 11 * DAY + HOUR)]]);
    // A rejected request changes nothing.
    for (const bad of [{ ...next, blocks: [{ start: iso(hour + 2 * HOUR), end: iso(hour + HOUR) }] }, { ...next, to: iso(hour + 15 * DAY) }, { ...next, blocks: Array.from({ length: 501 }, () => ({ start: iso(hour), end: iso(hour + HOUR) })) }, { ...next, timeZone: 'Nowhere/City' }, 'not json']) {
      expectError(await put('ana', bad), 400, 'bad_request');
    }
    assert.deepEqual(await stored('usr_ana'), [['cpl_01', iso(hour + 11 * DAY), iso(hour + 11 * DAY + HOUR)]]);
    // A failure inside the transaction (invalid row reaching the database) rolls back the delete and the sync row.
    const syncBefore = (await db.query("SELECT * FROM calendar_sync WHERE user_id = 'usr_ana'")).rows;
    const broken = { from: hour + 10 * DAY, to: hour + 12 * DAY, timeZone: 'UTC', ignoredAllDay: 0, droppedTitles: 0, blocks: [{ start: hour + 11 * DAY + 2 * HOUR, end: hour + 11 * DAY + HOUR }] };
    await assert.rejects(service.replaceBusyBlocks(sql, 'cpl_01', 'usr_ana', broken, Date.now()));
    assert.deepEqual(await stored('usr_ana'), [['cpl_01', iso(hour + 11 * DAY), iso(hour + 11 * DAY + HOUR)]]);
    assert.deepEqual((await db.query("SELECT * FROM calendar_sync WHERE user_id = 'usr_ana'")).rows, syncBefore);
  });

  await t.test('partnerStatus busyUntil across zones (Tokyo uploads in +09:00, São Paulo reads in -03:00)', async () => {
    const start = now - 30 * MIN;
    const tokyo = {
      from: withOffset(hour - HOUR, 540), to: withOffset(hour + 14 * DAY - HOUR, 540), timeZone: 'Asia/Tokyo',
      blocks: [
        { start: withOffset(start, 540), end: withOffset(hour + 2 * HOUR, 540) },
        { start: withOffset(hour + 2 * HOUR, 540), end: withOffset(hour + 3 * HOUR, 540) }, // back to back
        { start: withOffset(hour + 5 * HOUR, 540), end: withOffset(hour + 6 * HOUR, 540) },
      ],
    };
    assert.equal((await put('kenji', tokyo)).json.stored, 3);
    const fromSaoPaulo = { from: withOffset(hour - HOUR, -180), to: withOffset(hour + 7 * DAY, -180) };
    const view = await get('ana', fromSaoPaulo);
    assert.equal(view.status, 200);
    assertContract('CalendarView', view.json);
    assert.deepEqual(view.json.partnerStatus, { state: 'busy', busyUntil: iso(hour + 3 * HOUR), freeUntil: null, title: null, syncedAt: view.json.partner.syncedAt });
    // W1b's Today partner status reads the same tables (including the reserved title column) and agrees.
    assert.deepEqual(await todayPartnerStatus(sql, 'usr_kenji', new Date()), view.json.partnerStatus);
    assert.equal(view.json.partner.timeZone, 'Asia/Tokyo', 'zone of the upload when the profile has none');
    assert.deepEqual(view.json.partner.blocks.map((block) => block.start), [iso(start), iso(hour + 2 * HOUR), iso(hour + 5 * HOUR)]);
    // The status ignores the requested window: next week's view still reports "now".
    const later = await get('ana', { from: iso(hour + 7 * DAY), to: iso(hour + 8 * DAY) });
    assert.equal(later.json.partnerStatus.busyUntil, iso(hour + 3 * HOUR));
    assert.deepEqual(later.json.partner.blocks, []);
    // Free now: freeUntil = next block start.
    assert.equal((await put('kenji', { ...tokyo, blocks: tokyo.blocks.slice(2) })).status, 200);
    const free = await get('ana', fromSaoPaulo);
    assert.deepEqual(free.json.partnerStatus, { state: 'free', busyUntil: null, freeUntil: iso(hour + 5 * HOUR), title: null, syncedAt: free.json.partner.syncedAt });
    assert.deepEqual(await todayPartnerStatus(sql, 'usr_kenji', new Date()), free.json.partnerStatus);
  });

  await t.test('pruneCalendar: old blocks and blocks of members who left', async () => {
    await db.query("INSERT INTO calendar_busy (couple_id, user_id, starts_at, ends_at) VALUES ('cpl_01', 'usr_ana', now() - interval '3 days', now() - interval '3 days' + interval '1 hour'), ('cpl_01', 'usr_ana', now() - interval '20 hours', now() - interval '19 hours')");
    const before = (await db.query("SELECT count(*)::int AS n FROM calendar_busy WHERE user_id = 'usr_ana'")).rows[0].n;
    assert.equal(await pruneCalendar(sql), 1, 'only the block that ended more than a day ago');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM calendar_busy WHERE user_id = 'usr_ana'")).rows[0].n, before - 1);
    const kenjiBlocks = (await db.query("SELECT count(*)::int AS n FROM calendar_busy WHERE user_id = 'usr_kenji'")).rows[0].n;
    await db.query("UPDATE couple_members SET left_at = now() WHERE user_id = 'usr_kenji'");
    assert.equal(await pruneCalendar(sql), kenjiBlocks);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM calendar_sync WHERE user_id = 'usr_kenji'")).rows[0].n, 0);
    await db.query("UPDATE couples SET unpaired_at = now() WHERE id = 'cpl_01'");
    assert.equal(await pruneCalendar(sql), before - 1);
    assert.equal(await pruneCalendar(sql), 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM calendar_busy')).rows[0].n, 0);
  });

  await t.test('schema: the ensure path matches the migration file', async () => {
    const fresh = new PGlite();
    await fresh.exec(baseTables);
    await fresh.exec(foundation);
    await fresh.exec(migration);
    const expected = await schemaShape(fresh);
    assert.equal(expected.rows.length, 30);
    assert.deepEqual(await schemaShape(db), expected);
    await db.exec(migration);
    assert.deepEqual(await schemaShape(db), expected);
    await fresh.close();
  });
});
