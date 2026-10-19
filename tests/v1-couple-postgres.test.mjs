// W1b over isolated in-memory PGlite (never Neon): pairing, couple, /me, /today, unpair, export, retention.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

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

test('W1b couple lifecycle over the real route handlers', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
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
    const sql = auth.database();
    await lifecycle.ensureLifecycleSchema(sql);
    await lifecycle.ensureLifecycleSchema(sql);

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
      for (let i = 0; i < 10; i++) expectError(await join('lee', 'QQQQQQ'), 404, 'invalid_code');
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
      assert.deepEqual(ana.json.user, { ...fixture('getMe.200').user, id: 'usr_ana' });
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
      assert.equal(stale.json.partner.status.state, 'unknown', 'uploaded window no longer covers now');
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
      assert.deepEqual(me.json.pendingUnpair, unpaired);
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
      assert.deepEqual({ ...pending, tokensRevoked: 0, invitesDeleted: 0, calendarBlocksDeleted: 0 }, { ok: true, photosDeleted: 8, couplesPurged: 1, exportsDeleted: 2, calendarBlocksDeleted: 0, tokensRevoked: 0, invitesDeleted: 0, objectsDeleted: 0, objectsPending: 18 });
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
    hooks.deregister();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await db.close();
  }
});
