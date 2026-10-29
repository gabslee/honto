// W1b over isolated in-memory PGlite (never Neon): pairing, couple, /me, /today, unpair, export, retention.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';
import { pgliteSql } from './helpers/pglite-sql.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const fixture = (name) => JSON.parse(read(`../contracts/fixtures/${name}.json`));
const foundation = read('../drizzle/0008_v1_foundation.sql');
const migration = read('../drizzle/0012_couple_lifecycle.sql');
// Other workstreams' sections of the W0 plan, applied mid-test to simulate W2a / W3 / W2b being merged.
const plan = read('../drizzle/proposed/0008-0011_mvp_v1.sql');
const lineStart = (marker) => plan.lastIndexOf('\n', plan.indexOf(marker)) + 1;
const section = (from, to) => plan.slice(lineStart(from), lineStart(to ?? '-- Unpair (DELETE /api/v1/couple)'));
const w2a = section('0009_photos_push (W2a)', '0010_calendar_entitlements (W3)');
const w3 = section('0010_calendar_entitlements (W3)', '0011_trips_nudges (W2b)');
const w2b = section('0011_trips_nudges (W2b)');
// Pre-v1 production shapes (app/server-auth.ts, api/couple.ts incl. the legacy Blob couple_photos).
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO couples (id, host_user_id, partner_key) VALUES ('legacy1', 'u-legacy', 'pk-1');`;

/** In-memory stand-in for W2a's app/storage.ts. */
function fakeStore() {
  const objects = new Map();
  return {
    objects,
    deleted: [],
    async presignGet(key, seconds) { return `https://honto-test.t3.storageapi.dev/${key}?X-Amz-Expires=${seconds}&X-Amz-Signature=test`; },
    async getObject(key) { return objects.get(key)?.body ?? null; },
    async putObject(key, body, contentType) { objects.set(key, { body, contentType, lastModified: new Date() }); },
    async listPrefix(prefix) { return [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, lastModified: value.lastModified })); },
    async deleteObjects(keys) { for (const key of keys) { objects.delete(key); this.deleted.push(key); } },
  };
}

/** Reads a stored ZIP back (central directory) and checks every CRC with node:zlib. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = bytes.slice(start, start + size);
    assert.equal(zlibCrc32(data) >>> 0, crc, `crc of ${name}`);
    files.push({ name, data: new TextDecoder().decode(data) });
    at += 46 + nameLength;
  }
  return files;
}

test('drizzle/0012_couple_lifecycle.sql is idempotent on top of 0008', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(baseTables);
  await db.exec(foundation);
  await db.exec("INSERT INTO users (id, email, display_name) VALUES ('u1', 'u1@example.com', 'U1'); INSERT INTO couple_invites (code, created_by, expires_at, created_at) VALUES ('AAAAAA', 'u1', now() + interval '1 day', now() - interval '1 hour'), ('BBBBBB', 'u1', now() + interval '1 day', now())");
  await db.exec(migration);
  await db.exec(migration);
  const open = (await db.query('SELECT code FROM couple_invites WHERE revoked_at IS NULL')).rows.map((r) => r.code);
  assert.deepEqual(open, ['BBBBBB'], 'older duplicate open codes are revoked before the unique index');
  await assert.rejects(db.query("INSERT INTO couple_invites (code, created_by, expires_at) VALUES ('CCCCCC', 'u1', now() + interval '1 day')"), 'one open code per user');
  // W2a's plan creates photo_exports with the same definition: applying it after 0012 is a no-op.
  await db.exec(w2a);
  await db.close();
});

test('drizzle/0016_account_deletion.sql and 0017_billing_tables.sql are idempotent; players.user_id becomes ON DELETE SET NULL', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  // Production shape before 0016: players.user_id REFERENCES users(id) with NO ACTION.
  await db.exec(baseTables.replace('CREATE TABLE players (id text PRIMARY KEY);', ''));
  await db.exec('CREATE TABLE players (id text PRIMARY KEY, user_id text REFERENCES users(id));');
  await db.exec(foundation);
  await db.exec("INSERT INTO users (id, email, display_name) VALUES ('u1', 'u1@example.com', 'U1'); INSERT INTO players (id, user_id) VALUES ('p1', 'u1');");
  await assert.rejects(db.query("DELETE FROM users WHERE id = 'u1'"), /foreign key/, 'NO ACTION blocks the delete before 0016');
  const m16 = read('../drizzle/0016_account_deletion.sql');
  const m17 = read('../drizzle/0017_billing_tables.sql');
  await db.exec(m16);
  await db.exec(m16);
  const fks = (await db.query("SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'players'::regclass AND contype = 'f'")).rows;
  assert.deepEqual(fks, [{ conname: 'players_user_id_fkey', confdeltype: 'n' }]);
  await db.query("DELETE FROM users WHERE id = 'u1'");
  assert.deepEqual((await db.query("SELECT user_id FROM players WHERE id = 'p1'")).rows, [{ user_id: null }]);
  await assert.rejects(db.query("UPDATE couples SET unpair_reason = 'other'"), /check constraint/);
  // 0017 after the lazy definition (0010 / ensureEntitlementsSchema created the tables first), and twice.
  await db.exec(section('0010_calendar_entitlements (W3)', '0011_trips_nudges (W2b)'));
  await db.exec("INSERT INTO users (id, email, display_name) VALUES ('u2', 'u2@example.com', 'U2'); INSERT INTO entitlements (user_id, source) VALUES ('u2', 'revenuecat'); INSERT INTO revenuecat_events (id, type, app_user_id, payload) VALUES ('e1', 'TEST', 'u2', '{}')");
  await db.exec(m17);
  await db.exec(m17);
  assert.deepEqual((await db.query('SELECT (SELECT count(*)::int FROM entitlements) AS e, (SELECT count(*)::int FROM revenuecat_events) AS r')).rows[0], { e: 1, r: 1 }, 'existing rows kept');
  // And on a database without them.
  const fresh = new PGlite();
  await fresh.exec(baseTables);
  await fresh.exec(m17);
  assert.equal((await fresh.query("SELECT to_regclass('entitlements') IS NOT NULL AND to_regclass('revenuecat_events') IS NOT NULL AS ok")).rows[0].ok, true);
  await fresh.close();
  await db.close();
});

test('W1b couple lifecycle over the real route handlers', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = pgliteSql(db);
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier === 'next/server') return next('next/server.js', context);
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const saved = { DATABASE_URL: process.env.DATABASE_URL, CRON_SECRET: process.env.CRON_SECRET };
  process.env.DATABASE_URL = 'postgres://isolated-test';
  process.env.CRON_SECRET = 'test-cron-secret';
  try {
    await db.exec(baseTables);
    const auth = await import('../app/server-auth.ts');
    const couple = await import('../api/v1/couple.ts');
    const lifecycle = await import('../api/v1/lifecycle.ts');
    const meRoute = await import('../app/api/v1/me/route.ts');
    const coupleRoute = await import('../app/api/v1/couple/route.ts');
    const inviteRoute = await import('../app/api/v1/couple/invite/route.ts');
    const joinRoute = await import('../app/api/v1/couple/join/route.ts');
    const todayRoute = await import('../app/api/v1/today/route.ts');
    const exportRoute = await import('../app/api/v1/me/export/route.ts');
    const cronRoute = await import('../app/api/cron/retention/route.ts');
    const adminRoute = await import('../app/api/admin/route.ts');
    const sql = auth.database();
    await lifecycle.ensureLifecycleSchema(sql);
    await lifecycle.ensureLifecycleSchema(sql);
    // couple.unpaired pushes are recorded here instead of going to APNs / FCM.
    const pushes = [];
    lifecycle.setUnpairNotifier(async (coupleId, fromUserId, toUserId, event) => { pushes.push({ coupleId, fromUserId, toUserId, event }); });

    const people = ['ana', 'kenji', 'zoe', 'yuki', 'max', 'lee', 'solo'];
    await db.query(`INSERT INTO users (id, email, display_name, created_at) VALUES ${people.map((p) => `('usr_${p}', '${p}@example.com', '${p[0].toUpperCase()}${p.slice(1)}', '2026-10-01T13:20:00Z')`).join(', ')}`);
    await db.query("UPDATE users SET time_zone = 'America/Sao_Paulo', time_zone_updated_at = '2026-10-19T11:50:00Z' WHERE id = 'usr_ana'");
    await db.query("UPDATE users SET time_zone = 'Asia/Tokyo', time_zone_updated_at = '2026-10-19T11:58:00Z' WHERE id = 'usr_kenji'");
    const tokens = {};
    for (const p of people) tokens[p] = await auth.createMobileToken({ kind: 'user', userId: `usr_${p}`, platform: 'ios' });

    const call = async (handler, who, { method = 'GET', body, headers = {}, path = '/api/v1/x' } = {}) => {
      const init = { method, headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...headers } };
      if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
      const response = await handler(new Request(`https://hontogame.com${path}`, init));
      const text = await response.text();
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers };
    };
    const expectError = (res, status, code) => {
      assert.equal(res.status, status, JSON.stringify(res.json));
      assertContract('Error', res.json);
      assert.equal(res.json.code, code);
    };
    const invite = (who) => call(inviteRoute.POST, who, { method: 'POST' });
    const join = (who, code) => call(joinRoute.POST, who, { method: 'POST', body: { code } });
    const NOW = new Date('2026-10-19T12:00:00Z');
    const at = (iso) => new Date(iso);
    const req = (who, headers = {}) => new Request('https://hontogame.com/api/v1/x', { headers: { authorization: `Bearer ${tokens[who]}`, ...headers } });
    const body = async (response) => ({ status: response.status, json: response.status === 304 ? null : await response.json(), etag: response.headers.get('etag') });

    // Fills the current and the next fixed window of a limiter, so the next call is limited even if the
    // clock crosses a window boundary mid-test (looping up to the limit would flake at :00 / :15 / ...).
    const fillWindows = (scope, subject, hits, seconds) => db.query(`INSERT INTO v1_rate_limits (scope, subject, window_start, hits)
      SELECT $1, $2, to_timestamp(floor(extract(epoch FROM now()) / $3::int) * $3::int) + k * make_interval(secs => $3::int), $4::int FROM generate_series(0, 1) k
      ON CONFLICT (scope, subject, window_start) DO UPDATE SET hits = EXCLUDED.hits`, [scope, subject, seconds, hits]);

    let anaCode;
    await t.test('invite: create, replace, read; 401 without a session', async () => {
      expectError(await invite(null), 401, 'unauthorized');
      expectError(await call(inviteRoute.GET, 'ana'), 404, 'not_found');
      const first = await invite('ana');
      assert.equal(first.status, 201);
      assertContract('Invite', first.json);
      assert.match(first.json.code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
      assert.equal(first.json.url, `https://hontogame.com/j/${first.json.code}`);
      const hours = (Date.parse(first.json.expiresAt) - Date.now()) / 3_600_000;
      assert.ok(hours > 47.9 && hours <= 48, `48h expiry, got ${hours}`);
      const second = await invite('ana');
      assert.notEqual(second.json.code, first.json.code);
      assert.deepEqual((await call(inviteRoute.GET, 'ana')).json, second.json, 'GET returns the newest open code');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_invites WHERE created_by = 'usr_ana' AND used_at IS NULL AND revoked_at IS NULL")).rows[0].n, 1, 'one active invite per user');
      expectError(await join('kenji', first.json.code), 410, 'code_expired');
      anaCode = second.json.code;
      for (let i = 0; i < 200; i++) assert.match(couple.newInviteCode(), /^[0-9A-HJKMNP-TV-Z]{6}$/);
    });

    await t.test('join: every error code', async () => {
      expectError(await join('ana', anaCode), 422, 'own_invite');
      expectError(await join('kenji', 'ZZZZZZ'), 404, 'invalid_code');
      expectError(await join('kenji', 'abc'), 404, 'invalid_code');
      expectError(await call(joinRoute.POST, 'kenji', { method: 'POST', body: {} }), 400, 'bad_request');
      expectError(await call(joinRoute.POST, 'kenji', { method: 'POST', body: 'nope' }), 400, 'bad_request');
      await db.query("INSERT INTO couple_invites (code, created_by, expires_at, created_at) VALUES ('EXP222', 'usr_zoe', now() - interval '1 minute', now() - interval '49 hours')");
      expectError(await join('yuki', 'EXP222'), 410, 'code_expired');
      expectError(await join(null, anaCode), 401, 'unauthorized');
    });

    let coupleId;
    await t.test('join: happy path pairs both accounts', async () => {
      const typed = `${anaCode.slice(0, 3).toLowerCase()} - ${anaCode.slice(3).toLowerCase()}`;
      const res = await join('kenji', typed);
      assert.equal(res.status, 201, JSON.stringify(res.json));
      assertContract('Couple', res.json);
      coupleId = res.json.id;
      assert.match(coupleId, /^cpl_/);
      assert.deepEqual({ ...res.json, id: 'cpl_01', pairedAt: 'x' }, { ...fixture('joinCouple.201'), partner: { ...fixture('joinCouple.201').partner, userId: 'usr_ana', displayName: 'Ana', timeZone: 'America/Sao_Paulo', utcOffsetMinutes: -180, timeZoneUpdatedAt: '2026-10-19T11:50:00Z' }, pairedAt: 'x' });
      const members = (await db.query('SELECT user_id, role FROM couple_members WHERE couple_id = $1 ORDER BY role', [coupleId])).rows;
      assert.deepEqual(members, [{ user_id: 'usr_ana', role: 'a' }, { user_id: 'usr_kenji', role: 'b' }]);
      const used = (await db.query('SELECT used_by, couple_id FROM couple_invites WHERE code = $1', [anaCode])).rows[0];
      assert.deepEqual(used, { used_by: 'usr_kenji', couple_id: coupleId });
      const ana = await call(coupleRoute.GET, 'ana');
      assert.equal(ana.status, 200);
      assert.equal(ana.json.partner.userId, 'usr_kenji');
      assert.equal((await db.query('SELECT legacy FROM couples WHERE id = $1', [coupleId])).rows[0].legacy, false);
    });

    await t.test('a user cannot be in two couples', async () => {
      expectError(await invite('ana'), 409, 'already_paired');
      expectError(await call(inviteRoute.GET, 'kenji'), 409, 'already_paired');
      expectError(await join('yuki', anaCode), 410, 'code_expired');
      const zoe = await invite('zoe');
      expectError(await join('ana', zoe.json.code), 409, 'already_paired');
      expectError(await join('kenji', zoe.json.code), 409, 'already_paired');
      // A code whose creator is already paired (inserted directly; the API never issues one).
      await db.query("INSERT INTO couple_invites (code, created_by, expires_at) VALUES ('PRD234', 'usr_kenji', now() + interval '1 day')");
      expectError(await join('max', 'PRD234'), 409, 'already_paired');
      await assert.rejects(db.query("INSERT INTO couple_members (couple_id, user_id, role) VALUES ('legacy1', 'usr_ana', 'a')"), 'unique active membership');
      // Joining revokes the joiner's own open code: zoe pairs with yuki, so zoe's code can no longer be used.
      const yuki = await invite('yuki');
      assert.equal((await join('zoe', yuki.json.code)).status, 201);
      expectError(await join('max', zoe.json.code), 410, 'code_expired');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_members WHERE left_at IS NULL AND user_id IN ('usr_zoe', 'usr_yuki')")).rows[0].n, 2);
    });

    await t.test('join: 10 tries per 10 minutes', async () => {
      for (let i = 0; i < 3; i++) expectError(await join('lee', 'QQQQQQ'), 404, 'invalid_code');
      await fillWindows('join', 'usr_lee', 10, 600);
      const limited = await join('lee', 'QQQQQQ');
      expectError(limited, 429, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal(limited.json.retryAfterSeconds, Number(limited.headers.get('retry-after')));
    });

    await t.test('GET / PATCH /api/v1/couple: start date, reunion, counters in each viewer zone', async () => {
      const patch = (who, payload) => couple.patchCoupleResponse(new Request('https://hontogame.com/api/v1/couple', { method: 'PATCH', headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }), NOW).then(body);
      const ok = await patch('ana', fixture('updateCouple.request'));
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assertContract('Couple', ok.json);
      // Same numbers as the W0 fixture (Ana in São Paulo at 2026-10-19T12:00Z).
      assert.deepEqual({ ...ok.json, id: 'cpl_01', pairedAt: fixture('getCouple.200').pairedAt, premium: true }, fixture('getCouple.200'));
      const kenji = await body(await couple.getCoupleResponse(req('kenji'), NOW));
      assert.equal(kenji.json.daysTogether, 961);
      assert.equal(kenji.json.reunion.daysUntil, 26);
      assert.equal(kenji.json.partner.utcOffsetMinutes, -180);
      // At 2026-10-19T16:00Z it is already Oct 20 in Tokyo: Kenji's counters move, Ana's do not.
      const late = at('2026-10-19T16:00:00Z');
      assert.equal((await body(await couple.getCoupleResponse(req('kenji'), late))).json.daysTogether, 962);
      assert.equal((await body(await couple.getCoupleResponse(req('kenji'), late))).json.reunion.daysUntil, 25);
      assert.equal((await body(await couple.getCoupleResponse(req('ana'), late))).json.daysTogether, 961);

      for (const bad of [{}, { startedOn: '2026-13-01' }, { startedOn: '2027-01-01' }, { startedOn: 20240302 }, { reunion: { city: 'Tokyo' } }, { reunion: { at: 'tomorrow' } }, { reunion: { at: '2026-11-14T09:30:00Z', city: 'x'.repeat(81) } }, { reunion: { at: '2026-11-14T09:30:00Z', timeZone: 'Mars/Base' } }, { reunion: [] }]) {
        const res = await patch('ana', bad);
        assert.equal(res.status, 400, JSON.stringify(bad));
        assertContract('Error', res.json);
      }
      const cleared = await patch('kenji', fixture('updateCouple.request.clear_reunion'));
      assert.equal(cleared.json.reunion, null);
      assert.equal(cleared.json.startedOn, '2024-03-02', 'omitted keys are kept');
      const past = await patch('kenji', { reunion: { at: '2026-10-01T10:00:00+09:00', city: '  ' } });
      assert.deepEqual(past.json.reunion, { at: '2026-10-01T01:00:00Z', city: null, timeZone: null, daysUntil: -18 });
      await patch('ana', fixture('updateCouple.request'));
      expectError(await call(coupleRoute.GET, 'max'), 409, 'not_paired');
      expectError(await call(coupleRoute.PATCH, 'max', { method: 'PATCH', body: { startedOn: null } }), 409, 'not_paired');
    });

    await t.test('GET /api/v1/me: paired, unpaired with an open code, entitlement', async () => {
      const ana = await body(await couple.meResponse(req('ana'), NOW));
      assert.equal(ana.status, 200);
      assertContract('Me', ana.json);
      assert.deepEqual(ana.json.user, { ...fixture('getMe.200').user, id: 'usr_ana', city: null });
      assert.deepEqual({ ...ana.json.couple, id: 'cpl_01', pairedAt: fixture('getMe.200').couple.pairedAt }, { ...fixture('getMe.200').couple, premium: false });
      assert.deepEqual(ana.json.entitlement, fixture('getMe.200.unpaired').entitlement, 'free couple');
      assert.deepEqual([ana.json.pendingUnpair, ana.json.hasPendingInvite], [null, false]);

      const max = await body(await couple.meResponse(req('max'), NOW));
      assert.deepEqual([max.json.couple, max.json.pendingUnpair, max.json.hasPendingInvite], [null, null, false]);
      await invite('max');
      assert.equal((await body(await couple.meResponse(req('max'), NOW))).json.hasPendingInvite, true);
      expectError(await call(meRoute.GET, null), 401, 'unauthorized');

      // Premium from the partner's legacy Stripe subscription.
      await db.query("UPDATE users SET plan = 'premium', subscription_status = 'active', subscription_expires_at = '2027-01-01T00:00:00Z' WHERE id = 'usr_kenji'");
      const premium = await body(await couple.meResponse(req('ana'), NOW));
      assert.deepEqual(premium.json.entitlement, { premium: true, source: 'stripe', productId: null, periodType: 'normal', expiresAt: '2027-01-01T00:00:00Z', willRenew: null, grantedBy: 'partner', trialEligible: true, features: fixture('getMe.200').entitlement.features });
      assert.equal(premium.json.couple.premium, true);
      assert.equal((await call(coupleRoute.GET, 'ana')).json.premium, true, 'matches isCouplePremium');
      await db.query("UPDATE users SET plan = 'free', subscription_status = 'inactive', subscription_expires_at = NULL WHERE id = 'usr_kenji'");
    });

    const store = fakeStore();
    await t.test('GET /api/v1/today before W2a / W3 / W2b tables exist', async () => {
      const res = await body(await couple.todayResponse(req('ana'), NOW));
      assert.equal(res.status, 200);
      assertContract('Today', res.json);
      assert.equal(res.json.me.localDay, '2026-10-19');
      assert.deepEqual([res.json.me.dailyPhoto, res.json.partner.dailyPhoto, res.json.partner.latestPhoto, res.json.partner.status, res.json.activeTrip], [null, null, null, null, null]);
      assert.deepEqual(res.json.nudges, { lastSentAt: null, lastReceivedAt: null, nextAllowedAt: null });
      assert.equal(res.json.partner.timeZone, 'Asia/Tokyo');
      assert.equal(res.json.partner.utcOffsetMinutes, 540);
      expectError(await call(todayRoute.GET, 'max'), 409, 'not_paired');
      expectError(await call(todayRoute.GET, null), 401, 'unauthorized');
    });

    await db.exec(w2a);
    await db.exec(w3);
    await db.exec(w2b);
    const photo = async (id, author, day, zone, createdAt, { daily = false, status = 'ready', readyAt = createdAt, coupleOf = coupleId } = {}) => {
      await db.query(`INSERT INTO couple_photos (id, couple_id, role, author_name, phrase, content_type, size_bytes, storage, author_user_id, local_day, time_zone, is_daily, status, object_key, thumb_key, width, height, created_at, ready_at)
        VALUES ($1, $2, 'v1', $3, '', 'image/jpeg', 3, 's3', $4, $5, $6, $7, $8, $9, $10, 1080, 1440, $11, $12)`, [id, coupleOf, author, `usr_${author}`, day, zone, daily, status, `couples/${coupleOf}/photos/${id}/full.jpg`, `couples/${coupleOf}/photos/${id}/thumb.jpg`, createdAt, status === 'ready' ? readyAt : null]);
      store.objects.set(`couples/${coupleOf}/photos/${id}/full.jpg`, { body: new TextEncoder().encode(`full ${id}`), lastModified: new Date() });
      store.objects.set(`couples/${coupleOf}/photos/${id}/thumb.jpg`, { body: new TextEncoder().encode(`thumb ${id}`), lastModified: new Date() });
    };

    await t.test('GET /api/v1/today: each author\'s day in their own zone across midnight (São Paulo vs Tokyo)', async () => {
      lifecycle.setObjectStore(store);
      await photo('ph_kenji_1018', 'kenji', '2026-10-18', 'Asia/Tokyo', '2026-10-18T03:00:00Z', { daily: true });
      await photo('ph_kenji_1019', 'kenji', '2026-10-19', 'Asia/Tokyo', '2026-10-19T10:05:00Z', { daily: true });
      await photo('ph_ana_1019', 'ana', '2026-10-19', 'America/Sao_Paulo', '2026-10-19T11:42:00Z', { daily: true });
      await photo('ph_ana_1019b', 'ana', '2026-10-19', 'America/Sao_Paulo', '2026-10-19T11:50:00Z');
      await photo('ph_ana_pending', 'ana', '2026-10-19', 'America/Sao_Paulo', '2026-10-19T11:55:00Z', { status: 'pending' });

      // 12:00Z: São Paulo 09:00 Oct 19, Tokyo 21:00 Oct 19.
      const noon = await body(await couple.todayResponse(req('ana'), NOW));
      assertContract('Today', noon.json);
      assert.deepEqual([noon.json.me.localDay, noon.json.partner.localDay], ['2026-10-19', '2026-10-19']);
      assert.equal(noon.json.me.dailyPhoto.id, 'ph_ana_1019');
      assert.equal(noon.json.me.dailyPhoto.author, 'me');
      assert.equal(noon.json.me.photoCount, 2, 'pending photos are not counted');
      assert.equal(noon.json.partner.dailyPhoto.id, 'ph_kenji_1019');
      assert.equal(noon.json.partner.dailyPhoto.author, 'partner');
      assert.equal(noon.json.partner.photoCount, 1);
      assert.equal(noon.json.partner.latestPhoto.id, 'ph_kenji_1019');
      assert.equal(noon.json.me.dailyPhoto.urls.full, 'https://honto-test.t3.storageapi.dev/couples/' + coupleId + '/photos/ph_ana_1019/full.jpg?X-Amz-Expires=86400&X-Amz-Signature=test');
      assert.equal(noon.json.me.dailyPhoto.urls.expiresAt, '2026-10-20T12:00:00Z');

      // 16:00Z: São Paulo 13:00 Oct 19, Tokyo 01:00 Oct 20. Kenji's Oct 19 photo is no longer his photo of today.
      const late = await body(await couple.todayResponse(req('ana'), at('2026-10-19T16:00:00Z')));
      assert.deepEqual([late.json.me.localDay, late.json.partner.localDay], ['2026-10-19', '2026-10-20']);
      assert.equal(late.json.me.dailyPhoto.id, 'ph_ana_1019');
      assert.deepEqual([late.json.partner.dailyPhoto, late.json.partner.photoCount], [null, 0]);
      assert.equal(late.json.partner.latestPhoto.id, 'ph_kenji_1019', 'the widget stays filled');
      // Kenji's own view at the same instant: his day is Oct 20 (empty), Ana's is still Oct 19.
      const kenji = await body(await couple.todayResponse(req('kenji'), at('2026-10-19T16:00:00Z')));
      assert.deepEqual([kenji.json.me.localDay, kenji.json.me.dailyPhoto, kenji.json.partner.localDay, kenji.json.partner.dailyPhoto.id], ['2026-10-20', null, '2026-10-19', 'ph_ana_1019']);

      // São Paulo midnight: 02:59Z is still Oct 19 there, 03:00Z is Oct 20.
      assert.equal((await body(await couple.todayResponse(req('ana'), at('2026-10-20T02:59:00Z')))).json.me.dailyPhoto.id, 'ph_ana_1019');
      const midnight = await body(await couple.todayResponse(req('ana'), at('2026-10-20T03:00:00Z')));
      assert.deepEqual([midnight.json.me.localDay, midnight.json.me.dailyPhoto, midnight.json.me.photoCount], ['2026-10-20', null, 0]);

      // Without W2a's is_daily flag, the first photo of the local day to become ready is the photo of the day.
      await photo('ph_ana_1020_late', 'ana', '2026-10-20', 'America/Sao_Paulo', '2026-10-20T10:00:00Z', { readyAt: '2026-10-20T10:30:00Z' });
      await photo('ph_ana_1020_first', 'ana', '2026-10-20', 'America/Sao_Paulo', '2026-10-20T10:05:00Z', { readyAt: '2026-10-20T10:06:00Z' });
      const next = await body(await couple.todayResponse(req('ana'), at('2026-10-20T12:00:00Z')));
      assert.deepEqual([next.json.me.dailyPhoto.id, next.json.me.photoCount], ['ph_ana_1020_first', 2]);

      // Partner without a known zone: no partner day yet, latest photo still shown.
      await db.query("UPDATE users SET time_zone = NULL WHERE id = 'usr_kenji'");
      const unknown = await body(await couple.todayResponse(req('ana'), NOW));
      assertContract('Today', unknown.json);
      assert.deepEqual([unknown.json.partner.localDay, unknown.json.partner.dailyPhoto, unknown.json.partner.utcOffsetMinutes, unknown.json.partner.latestPhoto.id], [null, null, null, 'ph_kenji_1019']);
      await db.query("UPDATE users SET time_zone = 'Asia/Tokyo' WHERE id = 'usr_kenji'");

      lifecycle.setObjectStore(null);
      assert.equal((await body(await couple.todayResponse(req('ana'), NOW))).json.me.dailyPhoto.urls, null, 'no storage wired: no URLs');
      lifecycle.setObjectStore(store);
    });

    await t.test('GET /api/v1/today: partner calendar status (Premium), nudges, trip, countdown', async () => {
      const t0 = at('2026-10-19T12:00:00Z');
      await db.query("INSERT INTO calendar_sync (user_id, window_from, window_to, time_zone, synced_at) VALUES ('usr_kenji', '2026-10-18T15:00:00Z', '2026-11-01T15:00:00Z', 'Asia/Tokyo', '2026-10-19T10:55:00Z')");
      await db.query("INSERT INTO calendar_busy (user_id, starts_at, ends_at, title) VALUES ('usr_kenji', '2026-10-19T11:00:00Z', '2026-10-19T12:30:00Z', NULL), ('usr_kenji', '2026-10-19T12:30:00Z', '2026-10-19T13:00:00Z', 'Dentist'), ('usr_kenji', '2026-10-19T15:00:00Z', '2026-10-19T16:00:00Z', NULL)");
      assert.equal((await body(await couple.todayResponse(req('ana'), t0))).json.partner.status, null, 'Free couples do not see the calendar');
      await db.query("INSERT INTO entitlements (user_id, source, product_id, period_type, expires_at, will_renew, had_trial) VALUES ('usr_ana', 'revenuecat', 'honto_premium_annual', 'trial', '2026-10-26T12:00:00Z', true, true)");
      await db.query("INSERT INTO couple_nudges (id, couple_id, from_user_id, to_user_id, source, created_at) VALUES ('n1', $1, 'usr_ana', 'usr_kenji', 'app', '2026-10-19T11:59:30Z'), ('n2', $1, 'usr_kenji', 'usr_ana', 'widget', '2026-10-19T10:06:00Z')", [coupleId]);
      await db.query("INSERT INTO trips (id, couple_id, traveler_user_id, created_by, departs_at, arrives_at, from_city, to_city, la_starts_at, la_ends_at, created_at, updated_at) VALUES ('trip1', $1, 'usr_ana', 'usr_ana', '2026-10-20T01:00:00Z', '2026-10-20T13:00:00Z', 'São Paulo', 'Tokyo', '2026-10-20T05:00:00Z', '2026-10-20T14:00:00Z', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')", [coupleId]);

      const busy = await body(await couple.todayResponse(req('ana'), t0));
      assertContract('Today', busy.json);
      assert.deepEqual(busy.json.partner.status, { state: 'busy', busyUntil: '2026-10-19T13:00:00Z', freeUntil: null, title: null, syncedAt: '2026-10-19T10:55:00Z' }, 'touching blocks merge');
      assert.deepEqual(busy.json.entitlement, fixture('getToday.200').entitlement);
      assert.deepEqual(busy.json.nudges, { lastSentAt: '2026-10-19T11:59:30Z', lastReceivedAt: '2026-10-19T10:06:00Z', nextAllowedAt: '2026-10-19T12:00:30Z' });
      assert.equal(busy.json.activeTrip.id, 'trip1');
      assert.deepEqual([busy.json.activeTrip.traveler, busy.json.activeTrip.phase, busy.json.activeTrip.liveActivity.eligible], ['me', 'scheduled', true]);
      assert.deepEqual(busy.json.reunion, fixture('getToday.200').reunion);
      assert.equal(busy.json.daysTogether, 961);
      const dentist = await body(await couple.todayResponse(req('ana'), at('2026-10-19T12:40:00Z')));
      assert.equal(dentist.json.partner.status.title, 'Dentist');
      const free = await body(await couple.todayResponse(req('ana'), at('2026-10-19T13:30:00Z')));
      assert.deepEqual(free.json.partner.status, { state: 'free', busyUntil: null, freeUntil: '2026-10-19T15:00:00Z', title: null, syncedAt: '2026-10-19T10:55:00Z' });
      assert.equal(free.json.nudges.nextAllowedAt, null);
      assert.equal((await body(await couple.todayResponse(req('ana'), at('2026-10-20T06:00:00Z')))).json.activeTrip.phase, 'inTransit');
      const stale = await body(await couple.todayResponse(req('ana'), at('2026-11-02T00:00:00Z')));
      assert.equal(stale.json.partner.status, null, 'expired trial no longer exposes partner calendar');
      await db.query("UPDATE entitlements SET expires_at='2026-12-01T00:00:00Z' WHERE user_id='usr_ana'");
      const stalePremium = await body(await couple.todayResponse(req('ana'), at('2026-11-02T00:00:00Z')));
      assert.equal(stalePremium.json.partner.status.state, 'unknown', 'uploaded window no longer covers now');
      // Kenji sees the couple as Premium through Ana.
      assert.equal((await body(await couple.todayResponse(req('kenji'), t0))).json.entitlement.grantedBy, 'partner');
      assert.equal((await body(await couple.meResponse(req('ana'), t0))).json.entitlement.trialEligible, false);
    });

    await t.test('GET /api/v1/today: ETag and If-None-Match', async () => {
      const first = await couple.todayResponse(req('ana'), NOW);
      const etag = first.headers.get('etag');
      assert.match(etag, /^W\/"[0-9a-f]{32}"$/);
      const again = await couple.todayResponse(req('ana'), at('2026-10-19T12:00:20Z'));
      assert.equal(again.headers.get('etag'), etag, 'same data within the hour: same ETag even though URLs are re-signed');
      const cached = await couple.todayResponse(req('ana', { 'if-none-match': etag }), NOW);
      assert.equal(cached.status, 304);
      assert.equal(await cached.text(), '');
      assert.equal(cached.headers.get('etag'), etag);
      await photo('ph_kenji_1019b', 'kenji', '2026-10-19', 'Asia/Tokyo', '2026-10-19T12:01:00Z');
      const changed = await couple.todayResponse(req('ana', { 'if-none-match': etag }), NOW);
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.get('etag'), etag);
      const route = await todayRoute.GET(req('ana'));
      assert.equal(route.status, 200);
      assertContract('Today', await route.json());
    });

    let unpaired;
    await t.test('DELETE /api/v1/couple: shared history disappears at once for both', async () => {
      pushes.length = 0;
      const res = await call(coupleRoute.DELETE, 'ana', { method: 'DELETE' });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assertContract('UnpairResult', res.json);
      unpaired = res.json;
      assert.equal(Date.parse(res.json.photosAvailableUntil) - Date.parse(res.json.unpairedAt), 30 * 86_400_000);

      expectError(await call(coupleRoute.GET, 'kenji'), 409, 'not_paired');
      expectError(await call(todayRoute.GET, 'kenji'), 409, 'not_paired');
      expectError(await call(todayRoute.GET, 'ana'), 409, 'not_paired');
      expectError(await call(coupleRoute.DELETE, 'kenji', { method: 'DELETE' }), 409, 'not_paired');
      const me = await call(meRoute.GET, 'kenji');
      assertContract('Me', me.json);
      assert.equal(me.json.couple, null);
      assert.deepEqual(me.json.pendingUnpair, { ...unpaired, reason: 'unpaired' });
      const anaMe = await call(meRoute.GET, 'ana');
      assertContract('Me', anaMe.json);
      assert.deepEqual(anaMe.json.pendingUnpair, { ...unpaired, reason: 'unpaired' }, 'both partners see the unpair and its reason');
      assert.deepEqual(pushes, [{ coupleId, fromUserId: 'usr_ana', toUserId: 'usr_kenji', event: { type: 'couple.unpaired', reason: 'unpaired' } }], 'only the other partner is notified');
      assert.equal((await db.query('SELECT unpair_reason FROM couples WHERE id = $1', [coupleId])).rows[0].unpair_reason, 'unpaired');
      const row = (await db.query('SELECT started_on, reunion_at, reunion_city, unpaired_at IS NOT NULL AS unpaired FROM couples WHERE id = $1', [coupleId])).rows[0];
      assert.deepEqual(row, { started_on: null, reunion_at: null, reunion_city: null, unpaired: true });
      const left = (await db.query('SELECT count(*)::int AS n FROM couple_members WHERE couple_id = $1 AND left_at IS NOT NULL', [coupleId])).rows[0].n;
      assert.equal(left, 2);
      for (const [table, where] of [['trips', 'couple_id = $1'], ['couple_nudges', 'couple_id = $1'], ['calendar_busy', "user_id IN ('usr_ana', 'usr_kenji') AND $1::text IS NOT NULL"]]) {
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, [coupleId])).rows[0].n, 0, table);
      }
      const kept = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE date_trunc('second', delete_after) = $2::timestamptz)::int AS dated FROM couple_photos WHERE couple_id = $1`, [coupleId, unpaired.photosAvailableUntil])).rows[0];
      assert.equal(kept.n, kept.dated, 'every photo is kept until unpair + 30 days');
      assert.ok(kept.n > 0);
      // Both can pair again right away (with someone else, or each other).
      const again = await invite('kenji');
      assert.equal(again.status, 201);
      await db.query("UPDATE couple_invites SET revoked_at = now() WHERE created_by = 'usr_kenji' AND used_at IS NULL");
    });

    await t.test('export: my own photos only, ZIP in exports/, 24h signed link', async () => {
      lifecycle.setObjectStore(null);
      expectError(await call(exportRoute.POST, 'ana', { method: 'POST' }), 503, 'missing_config');
      lifecycle.setObjectStore(store);
      const none = await call(exportRoute.GET, 'ana');
      assertContract('ExportStatus', none.json);
      assert.deepEqual(none.json, { status: 'none', url: null, expiresAt: null, photoCount: 4, photosAvailableUntil: unpaired.photosAvailableUntil });

      const queued = await call(exportRoute.POST, 'ana', { method: 'POST' });
      assert.equal(queued.status, 202);
      assertContract('ExportStatus', queued.json);
      assert.deepEqual([queued.json.status, queued.json.photoCount], ['pending', 4]);
      const ready = await call(exportRoute.GET, 'ana');
      assertContract('ExportStatus', ready.json);
      assert.equal(ready.json.status, 'ready');
      assert.match(ready.json.url, /^https:\/\/honto-test\.t3\.storageapi\.dev\/exports\/usr_ana\/exp_[a-z0-9]+\.zip\?X-Amz-Expires=86400/);
      const hours = (Date.parse(ready.json.expiresAt) - Date.now()) / 3_600_000;
      assert.ok(hours > 23.9 && hours <= 24, `24h link, got ${hours}`);
      const key = ready.json.url.split('.dev/')[1].split('?')[0];
      assert.equal(store.objects.get(key).contentType, 'application/zip');
      const files = unzip(store.objects.get(key).body);
      assert.deepEqual(files.map((f) => f.name).sort(), ['honto-photos/2026-10-19_ph_ana_1019.jpg', 'honto-photos/2026-10-19_ph_ana_1019b.jpg', 'honto-photos/2026-10-20_ph_ana_1020_first.jpg', 'honto-photos/2026-10-20_ph_ana_1020_late.jpg']);
      assert.equal(files.find((f) => f.name.endsWith('ph_ana_1019.jpg')).data, 'full ph_ana_1019');
      const row = (await db.query("SELECT extract(epoch FROM expires_at - ready_at)::int AS keep FROM photo_exports WHERE user_id = 'usr_ana'")).rows[0];
      assert.equal(row.keep, 7 * 86_400, 'ZIP kept 7 days');

      // Asking again right away returns the same ready export.
      const repeat = await call(exportRoute.POST, 'ana', { method: 'POST' });
      assert.deepEqual([repeat.status, repeat.json.status], [202, 'ready']);
      // Kenji's export holds only Kenji's photos (the partner's photos are not shared after unpairing).
      await call(exportRoute.POST, 'kenji', { method: 'POST' });
      const kenji = await call(exportRoute.GET, 'kenji');
      const kenjiFiles = unzip(store.objects.get(kenji.json.url.split('.dev/')[1].split('?')[0]).body);
      assert.ok(kenjiFiles.length === 3 && kenjiFiles.every((f) => f.name.includes('ph_kenji_')));
      // Never paired: nothing to export.
      expectError(await call(exportRoute.POST, 'solo', { method: 'POST' }), 410, 'export_unavailable');
      assert.equal((await call(exportRoute.GET, 'solo')).json.status, 'unavailable');
      // Paired with photos (zoe + yuki, none yet): nothing to export either.
      expectError(await call(exportRoute.POST, 'zoe', { method: 'POST' }), 410, 'export_unavailable');
    });

    await t.test('retention: nothing is deleted before 30 days; cron needs the secret', async () => {
      const cron = (header) => call(cronRoute.GET, null, { headers: header ? { authorization: header } : {} });
      expectError(await cron(), 401, 'unauthorized');
      expectError(await cron('Bearer wrong'), 401, 'unauthorized');
      const ok = await cron('Bearer test-cron-secret');
      assert.equal(ok.status, 200);
      assertContract('CronRetentionResult', ok.json);
      assert.deepEqual([ok.json.photosDeleted, ok.json.couplesPurged, ok.json.exportsDeleted], [0, 0, 0]);
      assert.ok(ok.json.invitesDeleted >= 3, 'expired and replaced codes are removed');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_invites WHERE code = 'EXP222'")).rows[0].n, 0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_invites WHERE code = $1', [anaCode])).rows[0].n, 1, 'used codes are kept');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM couples WHERE id = $1', [coupleId])).rows[0].n, 1);
      const saved = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;
      expectError(await cron('Bearer '), 401, 'unauthorized');
      process.env.CRON_SECRET = saved;
    });

    await t.test('retention: after 30 days everything of the unpaired couple goes (rows, then objects)', async () => {
      // Fixed timestamps: the unpair happened 31 days ago, the exports are past their 7 days.
      await db.query("UPDATE couples SET unpaired_at = unpaired_at - interval '31 days' WHERE id = $1", [coupleId]);
      await db.query("UPDATE couple_members SET left_at = left_at - interval '31 days' WHERE couple_id = $1", [coupleId]);
      await db.query("UPDATE couple_photos SET delete_after = delete_after - interval '31 days' WHERE couple_id = $1", [coupleId]);
      await db.query("UPDATE photo_exports SET ready_at = ready_at - interval '8 days', expires_at = expires_at - interval '8 days'");
      const exportKeys = (await db.query('SELECT object_key FROM photo_exports')).rows.map((r) => r.object_key);
      // An orphan ZIP (row already gone) older than 7 days, and a fresh one that must stay.
      store.objects.set('exports/usr_old/exp_orphan.zip', { body: new Uint8Array(1), lastModified: new Date(Date.now() - 8 * 86_400_000) });
      store.objects.set('exports/usr_new/exp_recent.zip', { body: new Uint8Array(1), lastModified: new Date() });
      const photoKeys = [...store.objects.keys()].filter((key) => key.startsWith(`couples/${coupleId}/`));
      assert.equal(photoKeys.length, 16);

      const pending = await lifecycle.runRetention(sql, null);
      assertContract('CronRetentionResult', pending);
      assert.deepEqual({ ...pending, tokensRevoked: 0, invitesDeleted: 0, calendarBlocksDeleted: 0 }, { ok: true, couplesRepaired: 0, photosDeleted: 8, couplesPurged: 1, exportsDeleted: 2, calendarBlocksDeleted: 0, tokensRevoked: 0, invitesDeleted: 0, objectsDeleted: 0, objectsPending: 18 });
      assert.equal((await db.query('SELECT count(*)::int AS n FROM couples WHERE id = $1', [coupleId])).rows[0].n, 0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_members WHERE couple_id = $1', [coupleId])).rows[0].n, 0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_photos WHERE couple_id = $1', [coupleId])).rows[0].n, 0);
      assert.equal((await db.query('SELECT used_by, couple_id FROM couple_invites WHERE code = $1', [anaCode])).rows[0].couple_id, null);
      assert.equal(store.objects.size, 16 + 2 + 2, 'no storage wired: objects untouched, keys queued');

      const drained = await lifecycle.runRetention(sql, store);
      assert.equal(drained.objectsDeleted, 19, '18 queued keys + the orphan ZIP');
      assert.equal(drained.objectsPending, 0);
      assert.equal(drained.exportsDeleted, 1, 'orphan ZIP found by listPrefix');
      assert.deepEqual([...store.objects.keys()], ['exports/usr_new/exp_recent.zip']);
      for (const key of [...photoKeys, ...exportKeys]) assert.ok(store.deleted.includes(key), key);

      const me = await call(meRoute.GET, 'ana');
      assert.deepEqual([me.json.couple, me.json.pendingUnpair], [null, null]);
      expectError(await call(exportRoute.POST, 'ana', { method: 'POST' }), 410, 'export_unavailable');
      const quiet = await lifecycle.runRetention(sql, store);
      assert.deepEqual([quiet.photosDeleted, quiet.couplesPurged, quiet.objectsDeleted, quiet.objectsPending], [0, 0, 0, 0]);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couples WHERE id = 'legacy1'")).rows[0].n, 1, 'legacy couples are never purged');
    });

    await t.test('retention: failed deletes stay queued', async () => {
      await db.query("INSERT INTO storage_deletions (object_key, reason) VALUES ('couples/x/photos/y/full.jpg', 'photo')");
      const failing = { ...fakeStore(), async deleteObjects() { throw new Error('S3 503'); } };
      const res = await lifecycle.runRetention(sql, failing);
      assert.deepEqual([res.objectsDeleted, res.objectsPending], [0, 1]);
      assert.deepEqual((await db.query('SELECT attempts, last_error FROM storage_deletions')).rows, [{ attempts: 1, last_error: 'S3 503' }]);
    });

    await t.test('DELETE /api/v1/me: account gone, partner unpaired and kept, my photos removed from storage', async () => {
      const zoeCouple = (await db.query("SELECT couple_id FROM couple_members WHERE user_id = 'usr_zoe' AND left_at IS NULL")).rows[0].couple_id;
      await photo('ph_zoe_1', 'zoe', '2026-10-19', 'UTC', '2026-10-19T10:00:00Z', { daily: true, coupleOf: zoeCouple });
      await photo('ph_yuki_1', 'yuki', '2026-10-19', 'UTC', '2026-10-19T10:00:00Z', { daily: true, coupleOf: zoeCouple });
      await db.query("INSERT INTO calendar_busy (user_id, starts_at, ends_at) VALUES ('usr_zoe', now() + interval '1 hour', now() + interval '2 hours'), ('usr_yuki', now() + interval '1 hour', now() + interval '2 hours')");
      await db.query("INSERT INTO photo_exports (id, user_id, status, object_key, photo_count, ready_at, expires_at) VALUES ('exp_zoe', 'usr_zoe', 'ready', 'exports/usr_zoe/exp_zoe.zip', 1, now(), now() + interval '7 days')");
      store.objects.set('exports/usr_zoe/exp_zoe.zip', { body: new Uint8Array(1), lastModified: new Date() });
      await db.query("INSERT INTO email_login_tokens (token_hash, email, code_hash, platform, expires_at) VALUES ('zoe-tok', 'zoe@example.com', 'c', 'ios', now() + interval '10 minutes')");
      const zoeKeys = ['full', 'thumb'].map((kind) => `couples/${zoeCouple}/photos/ph_zoe_1/${kind}.jpg`).concat('exports/usr_zoe/exp_zoe.zip');
      lifecycle.setObjectStore(store);
      pushes.length = 0;

      expectError(await call(meRoute.DELETE, null, { method: 'DELETE' }), 401, 'unauthorized');
      const res = await call(meRoute.DELETE, 'zoe', { method: 'DELETE' });
      assert.equal(res.status, 204);
      assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);
      const count = async (query, params = []) => (await db.query(query, params)).rows[0].n;
      assert.equal(await count("SELECT count(*)::int AS n FROM users WHERE id = 'usr_zoe'"), 0);
      for (const table of ['mobile_tokens', 'couple_members', 'photo_exports', 'calendar_busy']) assert.equal(await count(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = 'usr_zoe'`), 0, table);
      assert.equal(await count("SELECT count(*)::int AS n FROM couple_photos WHERE author_user_id = 'usr_zoe'"), 0);
      assert.equal(await count("SELECT count(*)::int AS n FROM email_login_tokens WHERE email = 'zoe@example.com'"), 0);
      for (const key of zoeKeys) assert.ok(!store.objects.has(key) && store.deleted.includes(key), key);
      assert.equal(await count('SELECT count(*)::int AS n FROM storage_deletions WHERE object_key = ANY($1)', [zoeKeys]), 0, 'deleted keys are not left queued');
      expectError(await call(meRoute.GET, 'zoe'), 401, 'unauthorized');

      // The partner keeps the account, is unpaired, and keeps their own photos for the 30-day grace.
      const yuki = await call(meRoute.GET, 'yuki');
      assert.equal(yuki.status, 200);
      assert.equal(yuki.json.couple, null);
      assert.ok(yuki.json.pendingUnpair?.photosAvailableUntil);
      assert.equal(yuki.json.pendingUnpair.reason, 'partner_deleted');
      assertContract('Me', yuki.json);
      assert.deepEqual(pushes, [{ coupleId: zoeCouple, fromUserId: 'usr_zoe', toUserId: 'usr_yuki', event: { type: 'couple.unpaired', reason: 'partner_deleted' } }]);
      assert.equal((await db.query('SELECT unpair_reason FROM couples WHERE id = $1', [zoeCouple])).rows[0].unpair_reason, 'partner_deleted');
      assert.equal(await count("SELECT count(*)::int AS n FROM couple_photos WHERE author_user_id = 'usr_yuki' AND delete_after IS NOT NULL"), 1);
      assert.ok(store.objects.has(`couples/${zoeCouple}/photos/ph_yuki_1/full.jpg`));
      assert.equal(await count("SELECT count(*)::int AS n FROM calendar_busy WHERE user_id = 'usr_yuki'"), 0, 'shared calendar mirror goes with the couple');
      assert.equal(await count('SELECT count(*)::int AS n FROM couples WHERE id = $1 AND unpaired_at IS NOT NULL', [zoeCouple]), 1);

      // Unpaired account without photos; a second call with a dead token is 401.
      assert.equal((await call(meRoute.DELETE, 'solo', { method: 'DELETE' })).status, 204);
      expectError(await call(meRoute.DELETE, 'solo', { method: 'DELETE' }), 401, 'unauthorized');
      assert.equal(await lifecycle.deleteAccount(sql, 'usr_nobody', store), false);
    });


    // Two accounts paired directly in the database (fresh names per subtest), each with a session token.
    const pairDirect = async (a, b) => {
      for (const p of [a, b]) {
        await db.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)", [`usr_${p}`, `${p}@example.com`, p]);
        tokens[p] = await auth.createMobileToken({ kind: 'user', userId: `usr_${p}`, platform: 'ios' });
      }
      const id = `cpl_${a}_${b}`;
      await db.query("INSERT INTO couples (id, legacy, paired_at) VALUES ($1, false, now())", [id]);
      await db.query("INSERT INTO couple_members (couple_id, user_id, role) VALUES ($1, $2, 'a'), ($1, $3, 'b')", [id, `usr_${a}`, `usr_${b}`]);
      return id;
    };
    const n = async (query, params = []) => (await db.query(query, params)).rows[0].n;

    await t.test('DELETE /api/v1/me: keys queued in the transaction, partner pushed, RevenueCat + Apple called after the commit', async () => {
      const cpl = await pairDirect('rio', 'sam');
      await photo('ph_rio_1', 'rio', '2026-10-19', 'UTC', '2026-10-19T10:00:00Z', { daily: true, coupleOf: cpl });
      await db.query("INSERT INTO photo_exports (id, user_id, status, object_key, photo_count, ready_at, expires_at) VALUES ('exp_rio', 'usr_rio', 'ready', 'exports/usr_rio/exp_rio.zip', 1, now(), now() + interval '7 days')");
      await db.query("INSERT INTO apple_tokens (user_id, client_id, refresh_token) VALUES ('usr_rio', 'com.hontogame.app', 'apple-refresh-rio')");
      await db.query("INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token) VALUES ('dev_rio', 'usr_rio', 'i1', 'ios', 'apns_alert', 'tok-rio')");
      await db.query("INSERT INTO players (id, user_id) VALUES ('pl_rio', 'usr_rio')");
      await db.query("UPDATE couples SET host_user_id = 'usr_rio' WHERE id = 'legacy1'");
      const keys = [`couples/${cpl}/photos/ph_rio_1/full.jpg`, `couples/${cpl}/photos/ph_rio_1/thumb.jpg`, 'exports/usr_rio/exp_rio.zip'];

      const { generateKeyPairSync } = await import('node:crypto');
      const appleKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
      const env = { REVENUECAT_SECRET_API_KEY: 'sk_test_value', REVENUECAT_PROJECT_ID: 'projtest1', APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: appleKey };
      const savedEnv = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
      Object.assign(process.env, env);
      const calls = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (input, init = {}) => {
        calls.push({ url: String(input), method: init.method, authorization: init.headers?.authorization, body: init.body ? String(init.body) : null });
        return new Response(null, { status: 200 });
      };
      // Storage down: the keys must stay queued for the cron (they were queued inside the transaction).
      lifecycle.setObjectStore({ ...fakeStore(), async deleteObjects() { throw new Error('R2 503'); } });
      pushes.length = 0;
      try {
        assert.equal((await call(meRoute.DELETE, 'rio', { method: 'DELETE' })).status, 204);
      } finally {
        globalThis.fetch = realFetch;
        for (const [k, v] of Object.entries(savedEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
        lifecycle.setObjectStore(store);
      }
      assert.deepEqual((await db.query('SELECT object_key, reason FROM storage_deletions WHERE object_key = ANY($1) ORDER BY object_key', [keys])).rows.map((r) => [r.object_key, r.reason]), [...keys].sort().map((k) => [k, 'account']));
      for (const table of ['push_devices', 'mobile_tokens', 'v1_refresh_tokens', 'user_sessions', 'apple_tokens', 'couple_members']) assert.equal(await n(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = 'usr_rio'`), 0, table);
      assert.equal(await n("SELECT count(*)::int AS n FROM players WHERE id = 'pl_rio' AND user_id IS NULL"), 1, 'legacy player kept, unlinked');
      assert.equal(await n("SELECT count(*)::int AS n FROM couples WHERE id = 'legacy1' AND host_user_id IS NULL"), 1);
      assert.deepEqual(pushes, [{ coupleId: cpl, fromUserId: 'usr_rio', toUserId: 'usr_sam', event: { type: 'couple.unpaired', reason: 'partner_deleted' } }]);
      const sam = await call(meRoute.GET, 'sam');
      assertContract('Me', sam.json);
      assert.deepEqual([sam.json.couple, sam.json.pendingUnpair?.reason], [null, 'partner_deleted']);
      const rc = calls.find((c) => c.url.startsWith('https://api.revenuecat.com/'));
      assert.deepEqual([rc.url, rc.method, rc.authorization], ['https://api.revenuecat.com/v2/projects/projtest1/customers/usr_rio', 'DELETE', 'Bearer sk_test_value']);
      const revoke = calls.find((c) => c.url === 'https://appleid.apple.com/auth/revoke');
      const form = new URLSearchParams(revoke.body);
      assert.deepEqual([revoke.method, form.get('client_id'), form.get('token'), form.get('token_type_hint')], ['POST', 'com.hontogame.app', 'apple-refresh-rio', 'refresh_token']);
      assert.match(form.get('client_secret'), /^eyJ/, 'ES256 client secret');
      assert.equal(calls.length, 2);
      // The cron deletes the queued keys once storage is back.
      const drained = await lifecycle.runRetention(sql, store);
      assert.equal(await n('SELECT count(*)::int AS n FROM storage_deletions WHERE object_key = ANY($1)', [keys]), 0);
      assert.ok(drained.objectsDeleted >= 3);
    });

    await t.test('DELETE /api/v1/me without REVENUECAT_SECRET_API_KEY or Apple settings: account deleted, warnings logged, no network', async () => {
      await pairDirect('una', 'vic');
      await db.query("INSERT INTO apple_tokens (user_id, client_id, refresh_token) VALUES ('usr_una', 'com.hontogame.app', 'apple-refresh-una')");
      const saved = { rc: process.env.REVENUECAT_SECRET_API_KEY, key: process.env.APPLE_PRIVATE_KEY };
      delete process.env.REVENUECAT_SECRET_API_KEY; delete process.env.APPLE_PRIVATE_KEY;
      const warnings = [];
      const realWarn = console.warn; const realFetch = globalThis.fetch;
      console.warn = (...args) => warnings.push(args.join(' '));
      globalThis.fetch = async (input) => { throw new Error(`unexpected network call to ${input}`); };
      try {
        assert.equal((await call(meRoute.DELETE, 'una', { method: 'DELETE' })).status, 204);
      } finally {
        console.warn = realWarn; globalThis.fetch = realFetch;
        if (saved.rc !== undefined) process.env.REVENUECAT_SECRET_API_KEY = saved.rc;
        if (saved.key !== undefined) process.env.APPLE_PRIVATE_KEY = saved.key;
      }
      assert.equal(await n("SELECT count(*)::int AS n FROM users WHERE id = 'usr_una'"), 0);
      assert.ok(warnings.some((w) => w.includes('REVENUECAT_SECRET_API_KEY')));
      assert.ok(warnings.some((w) => w.includes('APPLE_PRIVATE_KEY')));
      for (const line of warnings) assert.doesNotMatch(line, /apple-refresh/);
    });

    await t.test('deleteAccount is one transaction: a failing statement rolls everything back', async () => {
      const cpl = await pairDirect('tom', 'kim');
      await photo('ph_tom_1', 'tom', '2026-10-19', 'UTC', '2026-10-19T10:00:00Z', { daily: true, coupleOf: cpl });
      await db.query("INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token) VALUES ('dev_tom', 'usr_tom', 'i1', 'ios', 'apns_alert', 'tok-tom')");
      await db.exec(`CREATE FUNCTION honto_test_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = 'usr_tom' THEN RAISE EXCEPTION 'blocked by test'; END IF; RETURN OLD; END $$;
        CREATE TRIGGER honto_test_block_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION honto_test_block_delete();`);
      pushes.length = 0;
      try {
        await assert.rejects(lifecycle.deleteAccount(sql, 'usr_tom', store), /blocked by test/);
      } finally {
        await db.exec('DROP TRIGGER honto_test_block_delete ON users; DROP FUNCTION honto_test_block_delete();');
      }
      assert.equal(await n("SELECT count(*)::int AS n FROM users WHERE id = 'usr_tom'"), 1);
      assert.equal(await n('SELECT count(*)::int AS n FROM couples WHERE id = $1 AND unpaired_at IS NULL AND unpair_reason IS NULL', [cpl]), 1, 'couple still paired');
      assert.equal(await n('SELECT count(*)::int AS n FROM couple_members WHERE couple_id = $1 AND left_at IS NULL', [cpl]), 2);
      assert.equal(await n("SELECT count(*)::int AS n FROM couple_photos WHERE id = 'ph_tom_1' AND delete_after IS NULL"), 1);
      assert.equal(await n("SELECT count(*)::int AS n FROM storage_deletions WHERE object_key LIKE '%ph_tom_1%'"), 0, 'no key queued');
      assert.equal(await n("SELECT count(*)::int AS n FROM push_devices WHERE user_id = 'usr_tom'"), 1);
      assert.equal(await n("SELECT count(*)::int AS n FROM mobile_tokens WHERE user_id = 'usr_tom'"), 1);
      assert.ok(store.objects.has(`couples/${cpl}/photos/ph_tom_1/full.jpg`), 'objects untouched');
      assert.deepEqual(pushes, [], 'nothing sent for a rolled back deletion');
      assert.equal((await call(coupleRoute.GET, 'kim')).status, 200);
      // Once the failure is gone the same call succeeds.
      assert.equal(await lifecycle.deleteAccount(sql, 'usr_tom', store), true);
      assert.equal((await call(meRoute.GET, 'kim')).json.pendingUnpair.reason, 'partner_deleted');
    });

    await t.test('repair: a raw users delete leaves a half-ended couple; /me, pairing and the cron close it', async () => {
      const cpl = await pairDirect('ivy', 'ned');
      await db.query("DELETE FROM users WHERE id = 'usr_ned'");
      assert.equal(await n('SELECT count(*)::int AS n FROM couples WHERE id = $1 AND unpaired_at IS NULL', [cpl]), 1, 'half-ended: couple open, one member left');
      expectError(await call(coupleRoute.GET, 'ivy'), 409, 'not_paired');
      pushes.length = 0;
      // Pairing endpoints use the same rule as requireCouple: not stuck on 409 already_paired.
      const code = await invite('ivy');
      assert.equal(code.status, 201, JSON.stringify(code.json));
      await db.query("UPDATE couple_invites SET revoked_at = now() WHERE created_by = 'usr_ivy' AND used_at IS NULL");
      assert.deepEqual(pushes, [{ coupleId: cpl, fromUserId: '', toUserId: 'usr_ivy', event: { type: 'couple.unpaired', reason: 'partner_deleted' } }]);
      const ivy = await call(meRoute.GET, 'ivy');
      assertContract('Me', ivy.json);
      assert.deepEqual([ivy.json.couple, ivy.json.pendingUnpair?.reason], [null, 'partner_deleted']);
      assert.equal(await n('SELECT count(*)::int AS n FROM couple_members WHERE couple_id = $1 AND left_at IS NOT NULL', [cpl]), 1);

      // The daily cron repairs couples nobody touched.
      const other = await pairDirect('ola', 'pia');
      await db.query("DELETE FROM users WHERE id = 'usr_pia'");
      const repaired = await lifecycle.runRetention(sql, store);
      assertContract('CronRetentionResult', repaired);
      assert.equal(repaired.couplesRepaired, 1);
      assert.deepEqual(await (await db.query('SELECT unpair_reason, unpaired_at IS NOT NULL AS done FROM couples WHERE id = $1', [other])).rows[0], { unpair_reason: 'partner_deleted', done: true });
      assert.equal((await call(meRoute.GET, 'ola')).json.pendingUnpair.reason, 'partner_deleted');
      assert.equal((await lifecycle.runRetention(sql, store)).couplesRepaired, 0, 'idempotent');
    });

    await t.test('admin deleteUser: admin only, email must match, never self, same deletion as DELETE /me', async () => {
      await pairDirect('gus', 'hal');
      await db.query("INSERT INTO users (id, email, display_name, role) VALUES ('usr_boss', 'boss@example.com', 'Boss', 'admin')");
      tokens.boss = await auth.createMobileToken({ kind: 'user', userId: 'usr_boss', platform: 'ios' });
      const admin = (who, body) => call(adminRoute.POST, who, { method: 'POST', body: { action: 'deleteUser', ...body } });
      assert.equal((await admin('hal', { userId: 'usr_gus', confirmEmail: 'gus@example.com' })).status, 401, 'not an admin');
      assert.equal((await admin(null, { userId: 'usr_gus', confirmEmail: 'gus@example.com' })).status, 401);
      assert.equal((await admin('boss', { userId: 'usr_gus' })).status, 400);
      const mismatch = await admin('boss', { userId: 'usr_gus', confirmEmail: 'hal@example.com' });
      assert.deepEqual([mismatch.status, mismatch.json.error], [400, 'The confirmation email does not match this account.']);
      assert.equal(await n("SELECT count(*)::int AS n FROM users WHERE id = 'usr_gus'"), 1, 'nothing deleted on a mismatch');
      assert.equal((await admin('boss', { userId: 'usr_boss', confirmEmail: 'boss@example.com' })).status, 403, 'an admin cannot delete themselves');
      assert.equal((await admin('boss', { userId: 'usr_ghost', confirmEmail: 'ghost@example.com' })).status, 404);
      pushes.length = 0;
      const ok = await admin('boss', { userId: 'usr_gus', confirmEmail: '  GUS@example.com ' });
      assert.deepEqual([ok.status, ok.json], [200, { ok: true, deleted: true, userId: 'usr_gus' }]);
      assert.equal(await n("SELECT count(*)::int AS n FROM users WHERE id = 'usr_gus'"), 0);
      expectError(await call(meRoute.GET, 'gus'), 401, 'unauthorized');
      assert.deepEqual(pushes.map((p) => [p.toUserId, p.event.reason]), [['usr_hal', 'partner_deleted']]);
      assert.equal((await call(meRoute.GET, 'hal')).json.pendingUnpair.reason, 'partner_deleted');
      assert.equal((await admin('boss', { userId: 'usr_gus', confirmEmail: 'gus@example.com' })).status, 404);
    });

    await t.test('date helpers', () => {
      assert.equal(couple.localDay('Asia/Tokyo', at('2026-10-19T15:00:00Z')), '2026-10-20');
      assert.equal(couple.localDay('America/Sao_Paulo', at('2026-10-20T02:59:59Z')), '2026-10-19');
      assert.equal(couple.localDay(null, at('2026-10-19T23:59:59Z')), '2026-10-19');
      assert.equal(couple.utcOffsetMinutes('Asia/Tokyo', NOW), 540);
      assert.equal(couple.utcOffsetMinutes('America/Sao_Paulo', NOW), -180);
      assert.equal(couple.utcOffsetMinutes('Asia/Kolkata', NOW), 330);
      assert.equal(couple.utcOffsetMinutes('America/New_York', at('2026-07-01T12:00:00Z')), -240);
      assert.equal(couple.daysBetween('2024-03-02', '2026-10-19'), 961);
      assert.equal(couple.normalizeInviteCode(' k7q-2xm '), 'K7Q2XM');
      assert.equal(lifecycle.crc32(new TextEncoder().encode('honto')), zlibCrc32(Buffer.from('honto')) >>> 0);
    });
  } finally {
    (await import('../api/v1/lifecycle.ts')).setUnpairNotifier(null);
    hooks.deregister();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await db.close();
  }
});
