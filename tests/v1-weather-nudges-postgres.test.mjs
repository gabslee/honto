// Feedback r1 over isolated in-memory PGlite (never Neon): weather summaries (PUT/DELETE /api/v1/me/weather,
// GET /api/v1/today me.weather / partner.weather) and "Thinking of you" (POST /api/v1/nudges + push event).
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
const migration = read('../drizzle/0014_weather_nudges.sql');
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`;

process.env.DATABASE_URL = 'postgres://isolated-test';
let activeDb = null;
globalThis.__hontoTestSql = async (parts, ...values) => (await activeDb.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
const columns = async (db) => (await db.query(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name IN ('user_weather', 'couple_nudges') ORDER BY table_name, column_name`)).rows;

const hooks = () => module.registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
  if (specifier === 'next/server') return next('next/server.js', context);
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
  return next(specifier, context);
} });

test('weather validation and nudge push payload (pure)', async () => {
  const registered = hooks();
  try {
    const w = await import('../server/v1/weather.ts');
    const now = Date.parse('2026-10-19T15:00:00Z');
    const ok = { condition: 'rain', temperatureC: 14, isDay: true, observedAt: '2026-10-19T14:20:00.123Z' };
    assert.deepEqual(w.parseWeather(ok, now), { ...ok, observedAt: '2026-10-19T14:20:00Z' });
    assert.ok('error' in w.parseWeather({ ...ok, condition: 'hail' }, now));
    assert.ok('error' in w.parseWeather({ ...ok, temperatureC: 14.5 }, now), 'integers only');
    assert.ok('error' in w.parseWeather({ ...ok, temperatureC: 70 }, now));
    assert.ok('error' in w.parseWeather({ ...ok, isDay: 'yes' }, now));
    assert.ok('error' in w.parseWeather({ ...ok, observedAt: '2026-10-19T08:00:00Z' }, now), 'older than 6 h');
    assert.ok('error' in w.parseWeather({ ...ok, observedAt: '2026-10-19T16:00:00Z' }, now), 'future');
    assert.equal(w.parseWeather({ ...ok, observedAt: '2026-10-19T15:05:00Z' }, now).observedAt, '2026-10-19T15:00:00Z', 'small skew clamps to now');
    assert.ok('error' in w.parseWeather({ ...ok, latitude: 38.7 }, now) === false, 'extra keys are ignored, never stored');

    const push = await import('../app/push/index.ts');
    const data = push.pushData('cpl_1', { type: 'nudge.new', nudgeId: 'ndg_1', createdAt: '2026-10-19T14:59:59Z', fromName: 'Gabriel' }, new Date('2026-10-19T15:00:00Z'));
    assertContract('PushData', data);
    assert.deepEqual(data, { type: 'nudge.new', coupleId: 'cpl_1', sentAt: '2026-10-19T15:00:00Z', nudgeId: 'ndg_1', createdAt: '2026-10-19T14:59:59Z', fromName: 'Gabriel' });
    const alert = push.apnsAlertPayload(data);
    assert.deepEqual(alert.aps.alert, { title: 'Honto', body: 'Gabriel is thinking of you' });
    assert.equal(alert.aps['mutable-content'], 1);
    assert.equal(alert.aps.sound, undefined, 'silent');
  } finally {
    registered.deregister();
  }
});

test('drizzle/0014_weather_nudges.sql is idempotent and constrained', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(baseTables + foundation + lifecycleSql);
  await db.exec(migration);
  await db.exec(migration);
  try {
    await db.exec("INSERT INTO users (id, email, display_name) VALUES ('u1', 'u1@x.co', 'U1'), ('u2', 'u2@x.co', 'U2'); INSERT INTO couples (id, legacy) VALUES ('c1', false)");
    await assert.rejects(db.query("INSERT INTO user_weather (user_id, condition, temperature_c, is_day, observed_at) VALUES ('u1', 'hail', 1, true, now())"), 'known conditions only');
    await db.exec("INSERT INTO couple_nudges (id, couple_id, from_user_id, to_user_id, source, client_id) VALUES ('n1', 'c1', 'u1', 'u2', 'widget', 'abc')");
    await assert.rejects(db.query("INSERT INTO couple_nudges (id, couple_id, from_user_id, to_user_id, source, client_id) VALUES ('n2', 'c1', 'u1', 'u2', 'app', 'abc')"), 'clientId unique per sender');
    await db.exec("DELETE FROM couples WHERE id = 'c1'");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_nudges')).rows[0].n, 0, 'cascades with the couple');
  } finally {
    await db.close();
  }
});

test('weather and nudges over the real route handlers', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  activeDb = db;
  const registered = hooks();
  try {
    await db.exec(baseTables);
    const auth = await import('../app/server-auth.ts');
    const couple = await import('../server/v1/couple.ts');
    const weather = await import('../server/v1/weather.ts');
    const nudges = await import('../server/v1/nudges.ts');
    const weatherRoute = await import('../app/api/v1/me/weather/route.ts');
    const lifecycle = await import('../server/v1/lifecycle.ts');
    await lifecycle.ensureLifecycleSchema(auth.database());
    await weather.ensureWeatherSchema(auth.database());
    await nudges.ensureNudgesSchema(auth.database());
    const fromFile = new PGlite();
    await fromFile.exec(baseTables + foundation + lifecycleSql + migration);
    assert.deepEqual(await columns(db), await columns(fromFile), 'lazy schema matches drizzle/0014');
    await fromFile.close();

    const people = ['ana', 'kenji', 'solo'];
    await db.query(`INSERT INTO users (id, email, display_name) VALUES ${people.map((p) => `('usr_${p}', '${p}@example.com', '${p === 'ana' ? 'Ana Maria' : p}')`).join(', ')}`);
    await db.query("UPDATE users SET time_zone = 'America/Sao_Paulo' WHERE id = 'usr_ana'");
    await db.query("UPDATE users SET time_zone = 'Asia/Tokyo' WHERE id = 'usr_kenji'");
    await db.exec(`INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_ak', false, '2026-10-01T12:00:00Z');
      INSERT INTO couple_members (couple_id, user_id, role, joined_at) VALUES ('cpl_ak', 'usr_ana', 'a', '2026-10-01T12:00:00Z'), ('cpl_ak', 'usr_kenji', 'b', '2026-10-01T12:00:00Z');`);
    const tokens = {};
    for (const p of people) tokens[p] = await auth.createMobileToken({ kind: 'user', userId: `usr_${p}`, platform: 'ios' });
    const req = (who, path, init = {}) => new Request(`https://hontogame.com${path}`, { ...init, headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) } });
    const nowMs = Date.now();
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Weather: report, read back in /today (both sides), clear, stale.
    assert.equal((await weatherRoute.PUT(req(null, '/api/v1/me/weather', { method: 'PUT', body: '{}' }))).status, 401);
    const bad = await weatherRoute.PUT(req('ana', '/api/v1/me/weather', { method: 'PUT', body: JSON.stringify({ condition: 'hail' }) }));
    assert.equal(bad.status, 400);
    assertContract('Error', await bad.json());
    const report = { condition: 'rain', temperatureC: 14, isDay: true, observedAt: iso(nowMs - 10 * 60_000) };
    const put = await weatherRoute.PUT(req('kenji', '/api/v1/me/weather', { method: 'PUT', body: JSON.stringify({ ...report, latitude: 35.68, longitude: 139.76 }) }));
    assert.equal(put.status, 200);
    const stored = await put.json();
    assertContract('WeatherSummary', stored);
    assert.deepEqual(stored, report);
    assert.deepEqual(Object.keys((await db.query("SELECT * FROM user_weather")).rows[0]).sort(), ['condition', 'is_day', 'observed_at', 'temperature_c', 'updated_at', 'user_id'], 'no location columns');
    const todayAna = async () => {
      const response = await couple.todayResponse(req('ana', '/api/v1/today'), new Date());
      assert.equal(response.status, 200);
      const json = await response.json();
      assertContract('Today', json);
      return json;
    };
    let t = await todayAna();
    assert.deepEqual(t.partner.weather, report);
    assert.equal(t.me.weather, null);
    // Stale (> 12 h) summaries are hidden.
    await db.query("UPDATE user_weather SET observed_at = now() - interval '13 hours' WHERE user_id = 'usr_kenji'");
    t = await todayAna();
    assert.equal(t.partner.weather, null);
    await weatherRoute.PUT(req('kenji', '/api/v1/me/weather', { method: 'PUT', body: JSON.stringify(report) }));
    const del = await weatherRoute.DELETE(req('kenji', '/api/v1/me/weather', { method: 'DELETE' }));
    assert.equal(del.status, 204);
    t = await todayAna();
    assert.equal(t.partner.weather, null);

    // Nudges.
    const sent = [];
    const send = async (coupleId, fromUserId, event) => { sent.push({ coupleId, fromUserId, event }); return { devices: 1, sent: 1, failed: 0, pruned: 0, skipped: 0 }; };
    const nudge = (who, body, now) => nudges.sendNudgeResponse(req(who, '/api/v1/nudges', { method: 'POST', body: JSON.stringify(body) }), { now, send });
    assert.equal((await nudge('solo', { source: 'app' }, new Date())).status, 409, 'not paired');
    assert.equal((await nudge('ana', { source: 'sms' }, new Date())).status, 400);
    assert.equal((await nudge('ana', { source: 'widget', clientId: 'nope' }, new Date())).status, 400);
    const t0 = new Date(nowMs);
    const clientId = '0b7c6c1e-8a43-4f0e-9c1b-2d3e4f5a6b7c';
    const first = await nudge('ana', { source: 'widget', clientId }, t0);
    assert.equal(first.status, 201);
    const firstJson = await first.json();
    assertContract('NudgeResult', firstJson);
    assert.equal(Date.parse(firstJson.nextAllowedAt) - Date.parse(firstJson.createdAt), 60_000);
    assert.deepEqual(sent.map((s) => [s.coupleId, s.fromUserId, s.event.type, s.event.nudgeId, s.event.fromName]), [['cpl_ak', 'usr_ana', 'nudge.new', firstJson.id, 'Ana Maria']]);
    assert.equal(sent[0].event.createdAt, firstJson.createdAt, 'push carries the nudge createdAt');
    const retry = await nudge('ana', { source: 'widget', clientId: clientId.toUpperCase() }, new Date(nowMs + 5_000));
    assert.equal(retry.status, 201, 'same clientId: same result, not rate limited');
    assert.deepEqual(await retry.json(), firstJson);
    assert.equal(sent.length, 1, 'retries never push twice');
    const limited = await nudge('ana', { source: 'app' }, new Date(nowMs + 20_000));
    assert.equal(limited.status, 429);
    assertContract('Error', await limited.json());
    assert.ok(Number(limited.headers.get('retry-after')) >= 39 && Number(limited.headers.get('retry-after')) <= 40);
    assert.equal((await nudge('kenji', { source: 'app' }, new Date(nowMs + 20_000))).status, 201, 'the limit is per sender');
    t = await couple.todayResponse(req('kenji', '/api/v1/today'), new Date(nowMs + 30_000)).then((r) => r.json());
    assert.equal(t.nudges.lastReceivedAt, firstJson.createdAt, 'partner sees it in /today');
    // 30 per rolling day.
    await db.query("DELETE FROM couple_nudges WHERE from_user_id = 'usr_ana'");
    for (let i = 0; i < 30; i++) await db.query(`INSERT INTO couple_nudges (id, couple_id, from_user_id, to_user_id, source, created_at) VALUES ('old${i}', 'cpl_ak', 'usr_ana', 'usr_kenji', 'app', now() - interval '${23 - i * 0.5} hours')`);
    const daily = await nudge('ana', { source: 'app' }, new Date());
    assert.equal(daily.status, 429, '30 per day');
    assert.ok(Number(daily.headers.get('retry-after')) > 3000, 'until the oldest of the day expires');
  } finally {
    registered.deregister();
    activeDb = null;
    await db.close();
  }
});
