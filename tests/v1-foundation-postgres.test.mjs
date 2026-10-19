// /api/v1 foundation over isolated in-memory PGlite (never Neon): auth context, couples, premium, time zone.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const migration = readFileSync(new URL('../drizzle/0008_v1_foundation.sql', import.meta.url), 'utf8');
// Pre-v1 production shapes the foundation builds on (app/server-auth.ts, api/couple.ts).
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO couples (id, host_user_id, partner_key) VALUES ('legacy1', 'u-legacy', 'pk-1');`;

async function columns(db) {
  const { rows } = await db.query(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name IN ('couple_members', 'couple_invites') OR (table_name = 'users' AND column_name LIKE 'time_zone%') OR (table_name = 'couples' AND column_name IN ('legacy', 'paired_at', 'unpaired_at', 'started_on', 'reunion_at', 'reunion_city', 'reunion_time_zone'))
    ORDER BY table_name, column_name`);
  const { rows: indexes } = await db.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('couple_members', 'couple_invites') ORDER BY indexname");
  return { rows, indexes };
}

test('drizzle/0008_v1_foundation.sql is idempotent and leaves legacy couples alone', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(baseTables);
  await db.exec(migration);
  await db.exec(migration);
  const legacy = (await db.query("SELECT legacy, paired_at FROM couples WHERE id = 'legacy1'")).rows[0];
  assert.deepEqual(legacy, { legacy: true, paired_at: null });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_members')).rows[0].n, 0, 'legacy couples are not migrated');
  await db.close();
});

test('requireUser, requireCouple, isCouplePremium and PUT /api/v1/me/timezone', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://isolated-test';
  try {
    await db.exec(baseTables);
    const auth = await import('../app/server-auth.ts');
    const { ensureFoundationSchema } = await import('../api/v1/foundation-schema.ts');
    const { requireUser, requireCouple, isCouplePremium, toApiUser, normalizeTimeZone } = await import('../api/v1/context.ts');
    const timezone = await import('../app/api/v1/me/timezone/route.ts');
    const sql = auth.database();

    await ensureFoundationSchema(sql);
    await ensureFoundationSchema(sql);
    await db.query("INSERT INTO users (id, email, display_name, created_at) VALUES ('usr_ana', 'ana@example.com', 'Ana', '2026-10-01T13:20:00Z'), ('usr_kenji', 'kenji@example.com', 'Kenji', '2026-10-02T09:00:00Z'), ('usr_zoe', 'zoe@example.com', 'Zoe', now())");
    await db.query("INSERT INTO couples (id, legacy, paired_at, started_on) VALUES ('cpl_01', false, '2026-10-02T22:10:00Z', '2024-03-02')");
    await db.query("INSERT INTO couple_members (couple_id, user_id, role, joined_at) VALUES ('cpl_01', 'usr_ana', 'a', '2026-10-02T22:00:00Z'), ('cpl_01', 'usr_kenji', 'b', '2026-10-02T22:10:00Z')");

    const anaToken = await auth.createMobileToken({ kind: 'user', userId: 'usr_ana', platform: 'ios' });
    const kenjiToken = await auth.createMobileToken({ kind: 'user', userId: 'usr_kenji', platform: 'android' });
    const zoeToken = await auth.createMobileToken({ kind: 'user', userId: 'usr_zoe', platform: 'ios' });
    const deviceToken = await auth.createMobileToken({ kind: 'device', partnerKey: 'pk-1' });
    const anaCookie = await auth.createUserSession('usr_ana');
    const bearer = (token) => new Request('https://x/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
    const cookie = (token) => new Request('https://x/api/v1/me', { headers: { cookie: `theme=dark; honto_session=${token}` } });
    const expect401 = async (result) => {
      assert.ok(result instanceof Response, 'expected a Response');
      assert.equal(result.status, 401);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      const body = await result.json();
      assertContract('Error', body);
      assert.equal(body.code, 'unauthorized');
    };

    await t.test('schema: the ensure path matches the migration file and both are idempotent', async () => {
      const fresh = new PGlite();
      await fresh.exec(baseTables);
      await fresh.exec(migration);
      await db.exec(migration);
      const expected = await columns(fresh);
      assert.equal(expected.rows.length, 22);
      assert.equal(expected.indexes.length, 5);
      assert.deepEqual(await columns(db), expected);
      assert.equal((await db.query("SELECT legacy FROM couples WHERE id = 'legacy1'")).rows[0].legacy, true);
      // One active couple per user; a left member can pair again.
      await db.query("INSERT INTO couples (id, legacy) VALUES ('cpl_x', false)");
      await assert.rejects(db.query("INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_x', 'usr_ana', 'a')"));
      await assert.rejects(db.query("INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_x', 'usr_zoe', 'z')"));
      await db.query("DELETE FROM couples WHERE id = 'cpl_x'");
      await fresh.close();
    });

    await t.test('requireUser: bearer and cookie', async () => {
      const viaBearer = await requireUser(bearer(anaToken));
      assert.equal(viaBearer.user.id, 'usr_ana');
      assert.equal(viaBearer.user.createdAt, '2026-10-01T13:20:00Z');
      assertContract('User', toApiUser(viaBearer.user));
      const viaCookie = await requireUser(cookie(anaCookie));
      assert.deepEqual(viaCookie, viaBearer);
    });

    await t.test('requireUser: 401 for missing, unknown, device, revoked and expired credentials', async () => {
      await expect401(await requireUser(new Request('https://x/api/v1/me')));
      await expect401(await requireUser(bearer('hm_u_not-a-real-token')));
      await expect401(await requireUser(bearer('garbage')));
      await expect401(await requireUser(cookie('not-a-session')));
      await expect401(await requireUser(bearer(deviceToken)));
      // A bad bearer is not rescued by a valid cookie.
      await expect401(await requireUser(new Request('https://x', { headers: { authorization: 'Bearer hm_u_nope', cookie: `honto_session=${anaCookie}` } })));

      const revoked = await auth.createMobileToken({ kind: 'user', userId: 'usr_ana', platform: 'revoke-me' });
      assert.equal((await requireUser(bearer(revoked))).user.id, 'usr_ana');
      assert.equal(await auth.revokeMobileToken(bearer(revoked)), true);
      await expect401(await requireUser(bearer(revoked)));

      const expired = await auth.createMobileToken({ kind: 'user', userId: 'usr_ana', platform: 'expire-me' });
      await db.query("UPDATE mobile_tokens SET expires_at = now() - interval '1 minute' WHERE platform = 'expire-me'");
      await expect401(await requireUser(bearer(expired)));

      const oldSession = await auth.createUserSession('usr_ana');
      await db.query("UPDATE user_sessions SET expires_at = now() - interval '1 minute' WHERE created_at = (SELECT max(created_at) FROM user_sessions)");
      await expect401(await requireUser(cookie(oldSession)));
    });

    await t.test('requireCouple: returns the partner, 409 not_paired otherwise', async () => {
      const ana = await requireCouple(bearer(anaToken));
      assert.equal(ana.user.id, 'usr_ana');
      assert.deepEqual(ana.couple, { id: 'cpl_01', role: 'a', pairedAt: '2026-10-02T22:10:00Z', startedOn: '2024-03-02', reunionAt: null, reunionCity: null, reunionTimeZone: null });
      assert.deepEqual(ana.partner, { id: 'usr_kenji', email: 'kenji@example.com', displayName: 'Kenji', role: 'b', timeZone: null, timeZoneUpdatedAt: null, joinedAt: '2026-10-02T22:10:00Z' });
      const kenji = await requireCouple(bearer(kenjiToken));
      assert.equal(kenji.partner.id, 'usr_ana');
      assert.equal(kenji.couple.role, 'b');

      const notPaired = async (result) => {
        assert.ok(result instanceof Response);
        assert.equal(result.status, 409);
        const body = await result.json();
        assertContract('Error', body);
        assert.equal(body.code, 'not_paired');
      };
      await notPaired(await requireCouple(bearer(zoeToken)));
      await expect401(await requireCouple(bearer('hm_u_nope')));
      // Unpaired couple (both members left) no longer resolves.
      await db.query("UPDATE couples SET unpaired_at = now() WHERE id = 'cpl_01'");
      await notPaired(await requireCouple(bearer(anaToken)));
      await db.query("UPDATE couples SET unpaired_at = NULL WHERE id = 'cpl_01'");
      await db.query("UPDATE couple_members SET left_at = now() WHERE user_id = 'usr_kenji'");
      await notPaired(await requireCouple(bearer(anaToken)));
      await db.query("UPDATE couple_members SET left_at = NULL WHERE user_id = 'usr_kenji'");
      assert.equal((await requireCouple(bearer(anaToken))).partner.id, 'usr_kenji');
    });

    await t.test('isCouplePremium: Stripe legacy access, then entitlements once the table exists', async () => {
      assert.equal(await isCouplePremium(sql, 'cpl_01'), false, 'free couple, no entitlements table yet');
      await db.query("UPDATE users SET plan = 'premium', subscription_status = 'active', subscription_expires_at = now() + interval '30 days' WHERE id = 'usr_kenji'");
      assert.equal(await isCouplePremium(sql, 'cpl_01'), true, 'either member pays');
      await db.query("UPDATE users SET subscription_expires_at = now() - interval '1 day' WHERE id = 'usr_kenji'");
      assert.equal(await isCouplePremium(sql, 'cpl_01'), false, 'expired Stripe subscription');
      await db.query("UPDATE users SET plan = 'free', subscription_status = 'inactive', subscription_expires_at = NULL, trial_ends_at = now() + interval '3 days' WHERE id = 'usr_ana'");
      assert.equal(await isCouplePremium(sql, 'cpl_01'), true, 'running Stripe trial');
      await db.query("UPDATE users SET trial_ends_at = NULL WHERE id = 'usr_ana'");

      // Shape from drizzle/proposed (0010, owned by W3).
      await db.query("CREATE TABLE entitlements (user_id text NOT NULL, source text NOT NULL, entitlement text NOT NULL DEFAULT 'premium', expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, source, entitlement))");
      assert.equal(await isCouplePremium(sql, 'cpl_01'), false);
      await db.query("INSERT INTO entitlements (user_id, source, expires_at) VALUES ('usr_ana', 'revenuecat', now() + interval '1 year')");
      assert.equal(await isCouplePremium(sql, 'cpl_01'), true, 'RevenueCat entitlement');
      await db.query("UPDATE entitlements SET expires_at = now() - interval '1 hour'");
      assert.equal(await isCouplePremium(sql, 'cpl_01'), false, 'expired entitlement');
      await db.exec("UPDATE entitlements SET expires_at = now() + interval '1 year'; UPDATE couple_members SET left_at = now() WHERE user_id = 'usr_ana'");
      assert.equal(await isCouplePremium(sql, 'cpl_01'), false, 'a member who left does not count');
      await db.exec("UPDATE couple_members SET left_at = NULL WHERE user_id = 'usr_ana'; DELETE FROM entitlements");
      assert.equal(await isCouplePremium(sql, 'nope'), false);
    });

    await t.test('PUT /api/v1/me/timezone', async () => {
      const put = async (body, headers = { authorization: `Bearer ${anaToken}` }) => {
        const response = await timezone.PUT(new Request('https://x/api/v1/me/timezone', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return { status: response.status, json: await response.json() };
      };
      const request = JSON.parse(readFileSync(new URL('../contracts/fixtures/updateTimeZone.request.json', import.meta.url), 'utf8'));
      const ok = await put(request);
      assert.equal(ok.status, 200);
      assertContract('TimeZoneResult', ok.json);
      assert.equal(ok.json.timeZone, 'America/Sao_Paulo');
      assert.match(ok.json.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.equal((await requireUser(bearer(anaToken))).user.timeZone, 'America/Sao_Paulo');

      // Cookie works too, casing is canonicalized, and the partner sees it.
      const viaCookie = await put({ timeZone: ' asia/tokyo ' }, { cookie: `honto_session=${anaCookie}` });
      assert.deepEqual([viaCookie.status, viaCookie.json.timeZone], [200, 'Asia/Tokyo']);
      const kenji = await requireCouple(bearer(kenjiToken));
      assert.equal(kenji.partner.timeZone, 'Asia/Tokyo');
      assert.equal(kenji.partner.timeZoneUpdatedAt, viaCookie.json.updatedAt);
      assert.equal((await put({ timeZone: 'UTC' })).json.timeZone, 'UTC');

      for (const bad of [{ timeZone: 'Mars/Olympus_Mons' }, { timeZone: '+05:00' }, { timeZone: '' }, { timeZone: 42 }, { timeZone: 'A'.repeat(65) }, {}, 'not json', null]) {
        const res = await put(bad);
        assert.equal(res.status, 400, JSON.stringify(bad));
        assertContract('Error', res.json);
        assert.equal(res.json.code, 'bad_request');
      }
      assert.equal((await requireUser(bearer(anaToken))).user.timeZone, 'UTC', 'rejected values are not stored');

      const anon = await put(request, {});
      assert.equal(anon.status, 401);
      assert.equal(anon.json.code, 'unauthorized');
      const revoked = await put(request, { authorization: 'Bearer hm_u_revoked' });
      assert.equal(revoked.status, 401);
    });

    await t.test('normalizeTimeZone', () => {
      assert.equal(normalizeTimeZone('Europe/Lisbon'), 'Europe/Lisbon');
      assert.equal(normalizeTimeZone('america/new_york'), 'America/New_York');
      assert.equal(normalizeTimeZone('Etc/GMT+3'), 'Etc/GMT+3');
      assert.equal(normalizeTimeZone('Not/AZone'), null);
      assert.equal(normalizeTimeZone('../etc/passwd'), null);
      assert.equal(normalizeTimeZone(undefined), null);
    });
  } finally {
    hooks.deregister();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    await db.close();
  }
});
