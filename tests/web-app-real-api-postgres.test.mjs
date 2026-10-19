// hontogame.com/app on the real /api/v1 handlers (W1b /me + /today, W2a /memories), signed in with the web
// `honto_session` cookie, through the same contracts/honto-client.ts the page uses. Isolated in-memory PGlite
// (never Neon) and an in-memory S3 bucket behind a fetch stub (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const fixture = (name) => JSON.parse(readFileSync(new URL(`../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'));
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`;

const BUCKET_HOST = 'honto-photos-kwrqb3lgl-pn.t3.storageapi.dev';
const s3Env = { S3_ENDPOINT: 'https://t3.storageapi.dev', S3_REGION: 'auto', S3_BUCKET: 'honto-photos-kwrqb3lgl-pn', S3_ACCESS_KEY_ID: 'tid_TESTACCESSKEY', S3_SECRET_ACCESS_KEY: 'tsec_TestSecretKeyNotReal' };
const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

// In-memory bucket: presigned device PUTs and signed server HEADs are all /complete needs.
const bucket = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = input instanceof Request ? input.method : init.method ?? 'GET';
  assert.equal(url.host, BUCKET_HOST, `unexpected network call to ${url.host}`);
  const key = decodeURIComponent(url.pathname.slice(1));
  if (method === 'PUT') {
    const body = new Uint8Array(init.body ?? []);
    bucket.set(key, { size: body.length, type: new Headers(init.headers).get('content-type') });
    return new Response(null, { status: 200 });
  }
  if (method === 'HEAD') {
    const found = bucket.get(key);
    return found ? new Response(null, { headers: { 'content-length': String(found.size), 'content-type': found.type } }) : new Response(null, { status: 404 });
  }
  return new Response(null, { status: 404 });
};

test('/app loads real /api/v1 data with the web session cookie', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const saved = Object.fromEntries(['DATABASE_URL', ...Object.keys(s3Env), 'APNS_KEY_P8', 'APNS_KEY_ID', 'FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'].map((k) => [k, process.env[k]]));
  setEnv({ DATABASE_URL: 'postgres://isolated-test', ...s3Env, APNS_KEY_P8: undefined, APNS_KEY_ID: undefined, FCM_PROJECT_ID: undefined, FCM_CLIENT_EMAIL: undefined, FCM_PRIVATE_KEY: undefined });
  const originalInfo = console.info;
  console.info = () => {};
  try {
    await db.exec(baseTables);
    const auth = await import('../app/server-auth.ts');
    await auth.ensureIdentitySchema();
    const { ensurePhotosSchema } = await import('../api/v1/photos-schema.ts');
    const { localDayIn, addDays } = await import('../app/api/v1/photos/photo-rows.ts');
    const routes = {
      me: await import('../app/api/v1/me/route.ts'),
      today: await import('../app/api/v1/today/route.ts'),
      memories: await import('../app/api/v1/memories/route.ts'),
      memoryDay: await import('../app/api/v1/memories/[day]/route.ts'),
      photos: await import('../app/api/v1/photos/route.ts'),
      complete: await import('../app/api/v1/photos/[photoId]/complete/route.ts'),
    };
    const { createHontoClient } = await import('../contracts/honto-client.ts');
    const { loadMemoriesView, loadSettingsView } = await import('../app/app-ui/web-app-loader.js');
    const { dayCellState, monthOf, splitDayPhotos, photoPhrase } = await import('../app/app-ui/web-app-model.js');
    const sql = auth.database();
    await ensurePhotosSchema(sql);
    await db.exec(`INSERT INTO users (id, email, display_name, time_zone) VALUES ('usr_ana', 'ana@example.com', 'Ana', 'America/Sao_Paulo'), ('usr_kenji', 'kenji@example.com', 'Kenji', 'Asia/Tokyo');
      INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_01', false, now());
      INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_01', 'usr_ana', 'a'), ('cpl_01', 'usr_kenji', 'b');`);

    // Photos go in through the real upload flow (bearer tokens, as the apps do).
    const anaToday = localDayIn('America/Sao_Paulo');
    const kenjiToday = localDayIn('Asia/Tokyo');
    const tokens = { ana: await auth.createMobileToken({ kind: 'user', userId: 'usr_ana', platform: 'ios' }), kenji: await auth.createMobileToken({ kind: 'user', userId: 'usr_kenji', platform: 'android' }) };
    const upload = async (who, localDay, extra = {}) => {
      const body = { ...fixture('createPhoto.request'), clientId: crypto.randomUUID(), localDay, timeZone: who === 'ana' ? 'America/Sao_Paulo' : 'Asia/Tokyo', ...extra };
      const created = await routes.photos.POST(new Request('https://hontogame.com/api/v1/photos', { method: 'POST', headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      assert.equal(created.status, 201);
      const { photo, upload: targets } = await created.json();
      for (const target of [targets.full, targets.thumb]) await globalThis.fetch(target.url, { method: 'PUT', headers: target.headers, body: new Uint8Array(Number(target.headers['Content-Length'])) });
      const done = await routes.complete.POST(new Request(`https://hontogame.com/api/v1/photos/${photo.id}/complete`, { method: 'POST', headers: { authorization: `Bearer ${tokens[who]}` } }), { params: Promise.resolve({ photoId: photo.id }) });
      assert.equal(done.status, 200);
      return photo.id;
    };
    await upload('ana', anaToday, { phraseKey: undefined, phrase: 'Morning coffee for two' });
    await upload('kenji', kenjiToday, { phraseKey: 'aitai' });
    // An older day (outside the Free window): uploads only accept today ±1, so move one row back in time.
    const oldDay = addDays(anaToday, -20);
    const oldId = await upload('ana', anaToday);
    await db.query('UPDATE couple_photos SET local_day = $1, is_daily = true WHERE id = $2', [oldDay, oldId]);

    // The web side: a honto_session cookie and the typed client the page uses, routed to the handlers.
    const session = await auth.createUserSession('usr_ana');
    const served = [];
    const sourceFor = (cookie) => {
      const call = createHontoClient({
        baseUrl: 'https://hontogame.com',
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const request = new Request(url, { method: init.method, headers: { ...init.headers, cookie } });
          served.push(url.pathname + url.search);
          if (url.pathname === '/api/v1/me') return routes.me.GET(request);
          if (url.pathname === '/api/v1/today') return routes.today.GET(request);
          if (url.pathname === '/api/v1/memories') return routes.memories.GET(request);
          const day = url.pathname.match(/^\/api\/v1\/memories\/([^/]+)$/)?.[1];
          if (day) return routes.memoryDay.GET(request, { params: Promise.resolve({ day: decodeURIComponent(day) }) });
          return new Response(null, { status: 404 });
        },
      });
      return {
        getMe: () => call('getMe'),
        getToday: () => call('getToday'),
        getMemoriesMonth: (month) => call('getMemoriesMonth', { query: { month } }),
        getMemoryDay: (day) => call('getMemoryDay', { pathParams: { day } }),
      };
    };
    const source = sourceFor(`honto_session=${session}`);

    await t.test('Free: today opens with both photos and the phrase, the older day is locked without fetching it', async () => {
      const view = await loadMemoriesView(source, {});
      assert.equal(view.kind, 'ready', JSON.stringify(view));
      assertContract('Me', view.me);
      assertContract('Today', view.today);
      assertContract('MemoriesMonth', view.memories);
      assert.equal(view.todayDay, anaToday);
      assert.equal(view.memories.historyLimitDays, 7);
      assert.equal(view.today.partner.displayName, 'Kenji');
      assert.equal(view.selectedDay, anaToday);
      assert.equal(view.day.kind, 'photos');
      assertContract('MemoryDay', view.day.detail);
      const { me } = splitDayPhotos(view.day.detail.photos);
      assert.equal(me.authorUserId, 'usr_ana');
      assert.deepEqual(photoPhrase(me), { text: 'Morning coffee for two' });
      const summary = view.memories.days.find((entry) => entry.day === anaToday);
      assert.match(summary.me.thumbUrl, new RegExp(`^https://${BUCKET_HOST}/`), 'presigned bucket thumbnail');

      served.length = 0;
      const old = await loadMemoriesView(source, { month: monthOf(oldDay), day: oldDay });
      assert.deepEqual(old.day, { kind: 'locked', day: oldDay });
      assert.equal(old.memories.days.find((entry) => entry.day === oldDay)?.locked, true);
      assert.equal(dayCellState({ day: oldDay, summary: null, today: anaToday, historyLimitDays: 7 }), 'locked');
      assert.ok(!served.some((path) => path.startsWith(`/api/v1/memories/${oldDay}`)), 'a locked day is not fetched');
      const direct = await routes.memoryDay.GET(new Request(`https://hontogame.com/api/v1/memories/${oldDay}`, { headers: { cookie: `honto_session=${session}` } }), { params: Promise.resolve({ day: oldDay }) });
      assert.equal(direct.status, 403, 'and the API agrees (premium_required)');
    });

    await t.test('Premium: the older day opens with its photo', async () => {
      await db.query("UPDATE users SET plan = 'premium', subscription_status = 'active' WHERE id = 'usr_ana'");
      const view = await loadMemoriesView(source, { month: monthOf(oldDay), day: oldDay });
      assert.equal(view.kind, 'ready');
      assert.equal(view.memories.historyLimitDays, null);
      assert.equal(view.me.entitlement.premium, true);
      assert.equal(view.day.kind, 'photos');
      assert.equal(view.day.detail.photos[0].id, oldId);
    });

    await t.test('Settings and the signed-out state', async () => {
      const settings = await loadSettingsView(source);
      assert.equal(settings.kind, 'ready');
      assert.equal(settings.me.user.email, 'ana@example.com');
      assert.equal(settings.me.couple.partner.displayName, 'Kenji');
      assert.deepEqual(await loadMemoriesView(sourceFor('honto_session=not-a-session'), {}), { kind: 'signed-out' });
      assert.deepEqual(await loadSettingsView(sourceFor(''), {}), { kind: 'signed-out' });
    });
  } finally {
    console.info = originalInfo;
    setEnv(saved);
    hooks.deregister();
    globalThis.fetch = realFetch;
    await db.close();
  }
});
