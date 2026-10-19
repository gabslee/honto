// /api/v1 photos, memories and devices over isolated in-memory PGlite (never Neon) and an in-memory S3 bucket
// behind a fetch stub (no network). Push keys are unset, so notifyPartner is the logged no-op.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const fixture = (name) => JSON.parse(readFileSync(new URL(`../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'));
const migration0008 = readFileSync(new URL('../drizzle/0008_v1_foundation.sql', import.meta.url), 'utf8');
const migration0009 = readFileSync(new URL('../drizzle/0009_photos_push.sql', import.meta.url), 'utf8');
// Pre-v1 production shapes (app/server-auth.ts, api/couple.ts) with one legacy Blob photo.
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO couple_photos VALUES ('legacy_photo', 'room:r1', 'r1', 'host', 'Ana', 'https://blob.example/x.jpg', 'x.jpg', NULL, 'hi', 'image/jpeg', 10, now());`;

const BUCKET_HOST = 'honto-photos-kwrqb3lgl-pn.t3.storageapi.dev';
const s3Env = { S3_ENDPOINT: 'https://t3.storageapi.dev', S3_REGION: 'auto', S3_BUCKET: 'honto-photos-kwrqb3lgl-pn', S3_ACCESS_KEY_ID: 'tid_TESTACCESSKEY', S3_SECRET_ACCESS_KEY: 'tsec_TestSecretKeyNotReal' };
const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

// ---- in-memory bucket ------------------------------------------------------------------------------
const bucket = new Map();
const serverCalls = [];
function s3(method, rawUrl, headers, body) {
  const url = new URL(rawUrl);
  assert.equal(url.host, BUCKET_HOST, 'virtual-host style on the configured endpoint');
  const key = decodeURIComponent(url.pathname.slice(1));
  const header = (name) => headers.get(name);
  if (url.searchParams.has('X-Amz-Signature')) {
    // Device side (presigned). Expiry and the signed Content-Type / Content-Length are enforced like S3.
    const date = url.searchParams.get('X-Amz-Date');
    const issued = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
    if (Date.now() > issued + Number(url.searchParams.get('X-Amz-Expires')) * 1000) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    if (method === 'PUT') {
      assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
      if (Number(header('content-length')) !== body.length) return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 });
      bucket.set(key, { size: body.length, type: header('content-type') });
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 405 });
  }
  assert.match(header('authorization') ?? '', /^AWS4-HMAC-SHA256 Credential=tid_TESTACCESSKEY\//, 'server calls are signed');
  serverCalls.push(`${method} ${url.pathname}${url.search}`);
  if (method === 'HEAD') {
    const found = bucket.get(key);
    return found ? new Response(null, { headers: { 'content-length': String(found.size), 'content-type': found.type } }) : new Response(null, { status: 404 });
  }
  if (method === 'POST' && url.searchParams.has('delete')) {
    for (const [, k] of String(body).matchAll(/<Key>(.*?)<\/Key>/g)) bucket.delete(k);
    return new Response('<DeleteResult></DeleteResult>');
  }
  return new Response(null, { status: 400 });
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (input instanceof Request) return s3(input.method, input.url, input.headers, input.method === 'POST' ? await input.text() : null);
  return s3(init.method ?? 'GET', String(input), new Headers(init.headers), init.body ?? null);
};
/** What the app does: PUT the bytes straight to the bucket with exactly the returned headers. */
const deviceUpload = (target, size = Number(target.headers['Content-Length'])) => globalThis.fetch(target.url, { method: target.method, headers: target.headers, body: new Uint8Array(size) });

test('photos, memories and devices', async (t) => {
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
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    await db.exec(baseTables);
    const auth = await import('../app/server-auth.ts');
    const { ensurePhotosSchema } = await import('../api/v1/photos-schema.ts');
    const { localDayIn, addDays } = await import('../app/api/v1/photos/photo-rows.ts');
    const photos = await import('../app/api/v1/photos/route.ts');
    const complete = await import('../app/api/v1/photos/[photoId]/complete/route.ts');
    const photo = await import('../app/api/v1/photos/[photoId]/route.ts');
    const memories = await import('../app/api/v1/memories/route.ts');
    const memoryDay = await import('../app/api/v1/memories/[day]/route.ts');
    const devices = await import('../app/api/v1/devices/route.ts');
    const device = await import('../app/api/v1/devices/[deviceId]/route.ts');
    const sql = auth.database();

    await ensurePhotosSchema(sql);
    await ensurePhotosSchema(sql);
    await db.exec(`INSERT INTO users (id, email, display_name, time_zone) VALUES ('usr_ana', 'ana@example.com', 'Ana', 'America/Sao_Paulo'), ('usr_kenji', 'kenji@example.com', 'Kenji', 'Asia/Tokyo'), ('usr_zoe', 'zoe@example.com', 'Zoe', NULL);
      INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_01', false, now());
      INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_01', 'usr_ana', 'a'), ('cpl_01', 'usr_kenji', 'b');
      INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token) VALUES ('dev_kenji_seed', 'usr_kenji', 'ins_seed', 'android', 'fcm', 'seed-fcm-token');`);
    const ana = await auth.createMobileToken({ kind: 'user', userId: 'usr_ana', platform: 'ios' });
    const kenji = await auth.createMobileToken({ kind: 'user', userId: 'usr_kenji', platform: 'android' });
    const zoe = await auth.createMobileToken({ kind: 'user', userId: 'usr_zoe', platform: 'ios' });
    const anaToday = localDayIn('America/Sao_Paulo');
    const kenjiToday = localDayIn('Asia/Tokyo');

    const call = async (handler, { method = 'GET', path = '/', token = ana, body, params = {} } = {}) => {
      const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
      const response = await handler(new Request(`https://hontogame.com${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve(params) });
      assert.equal(response.headers.get('cache-control'), 'no-store', `${method} ${path}`);
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers };
    };
    const expectError = (res, status, code) => {
      assert.equal(res.status, status, JSON.stringify(res.json));
      assertContract('Error', res.json);
      assert.equal(res.json.code, code);
    };
    const request = (overrides = {}) => ({ ...fixture('createPhoto.request'), clientId: crypto.randomUUID(), localDay: anaToday, ...overrides });
    const create = (body, token = ana) => call(photos.POST, { method: 'POST', path: '/api/v1/photos', token, body });
    const completeCall = (photoId, token = ana) => call(complete.POST, { method: 'POST', path: `/api/v1/photos/${photoId}/complete`, token, params: { photoId } });
    const uploadAndComplete = async (body, token = ana) => {
      const created = await create(body, token);
      assert.equal(created.status, 201, JSON.stringify(created.json));
      await deviceUpload(created.json.upload.full);
      await deviceUpload(created.json.upload.thumb);
      return completeCall(created.json.photo.id, token);
    };
    const month = (m, token = ana) => call(memories.GET, { path: `/api/v1/memories?month=${m}`, token });
    const day = (d, token = ana) => call(memoryDay.GET, { path: `/api/v1/memories/${d}`, token, params: { day: d } });

    await t.test('schema: the ensure path matches drizzle/0009_photos_push.sql and both are idempotent', async () => {
      const shape = async (target) => ({
        columns: (await target.query("SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name IN ('couple_photos', 'photo_exports', 'push_devices') ORDER BY table_name, column_name")).rows,
        indexes: (await target.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('couple_photos', 'photo_exports', 'push_devices') ORDER BY indexname")).rows,
      });
      const fresh = new PGlite();
      await fresh.exec(baseTables);
      for (const sqlFile of [migration0008, migration0009, migration0009]) await fresh.exec(sqlFile);
      await db.exec(migration0009);
      const expected = await shape(fresh);
      assert.equal(expected.columns.length, 12 + 15 + 8 + 13);
      assert.deepEqual(await shape(db), expected);
      assert.deepEqual((await db.query("SELECT storage, status, is_daily, url FROM couple_photos WHERE id = 'legacy_photo'")).rows[0], { storage: 'blob', status: 'ready', is_daily: false, url: 'https://blob.example/x.jpg' }, 'legacy Blob rows keep their url');
      await fresh.close();
    });

    await t.test('503 storage_not_configured while the bucket keys are empty', async () => {
      setEnv({ S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' });
      try {
        expectError(await create(request()), 503, 'storage_not_configured');
        expectError(await completeCall('ph_x'), 503, 'storage_not_configured');
        expectError(await call(photo.DELETE, { method: 'DELETE', params: { photoId: 'ph_x' } }), 503, 'storage_not_configured');
        expectError(await month('2026-10'), 503, 'storage_not_configured');
        expectError(await day(anaToday), 503, 'storage_not_configured');
        assert.deepEqual(fixture('createPhoto.503'), { error: 'Photo storage is not configured yet.', code: 'storage_not_configured' });
        // Auth still comes first, and devices do not need storage.
        expectError(await create(request(), null), 401, 'unauthorized');
        assert.equal((await call(devices.POST, { method: 'POST', body: { ...fixture('registerDevice.request'), token: 'no-storage-token' } })).status, 201);
      } finally {
        setEnv(s3Env);
      }
    });

    await t.test('POST /api/v1/photos: 503 matches the OpenAPI example whenever an S3 setting is missing', async () => {
      const operation = spec.paths['/api/v1/photos'].post;
      assert.equal(operation.responses['503'].$ref, '#/components/responses/StorageNotConfigured');
      const example = spec.components.responses.StorageNotConfigured.content['application/json'].example;
      assertContract('Error', example);
      assert.deepEqual(example, fixture('createPhoto.503'));
      const unset = Object.fromEntries(Object.keys(s3Env).map((k) => [k, undefined]));
      for (const missing of [unset, { S3_ACCESS_KEY_ID: undefined }, { S3_SECRET_ACCESS_KEY: undefined }, { S3_ENDPOINT: undefined }, { S3_BUCKET: undefined }, { S3_ENDPOINT: 'not a url' }]) {
        setEnv(missing);
        try {
          const res = await create(request());
          expectError(res, 503, 'storage_not_configured');
          assert.deepEqual(res.json, example, JSON.stringify(missing));
        } finally {
          setEnv(s3Env);
        }
      }
      assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_photos WHERE storage = $1', ['s3'])).rows[0].n, 0, 'nothing is reserved without storage');
    });

    let firstId;
    await t.test('POST /api/v1/photos: presigned PUTs (10 min) for full + thumb, idempotent by clientId', async () => {
      const body = request();
      const res = await create(body);
      assert.equal(res.status, 201, JSON.stringify(res.json));
      assertContract('PhotoCreateResponse', res.json);
      const { photo: created, upload } = res.json;
      firstId = created.id;
      assert.match(created.id, /^ph_[0-9a-f]{20}$/);
      assert.deepEqual({ ...created, id: 'x', createdAt: 'x' }, { ...fixture('createPhoto.201').photo, id: 'x', createdAt: 'x', localDay: anaToday });
      for (const [target, file, type, size] of [[upload.full, 'full.jpg', 'image/jpeg', '204800'], [upload.thumb, 'thumb.jpg', 'image/jpeg', '19456']]) {
        const url = new URL(target.url);
        assert.equal(url.host, BUCKET_HOST);
        assert.equal(url.pathname, `/couples/cpl_01/photos/${created.id}/${file}`);
        assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
        assert.equal(target.method, 'PUT');
        assert.deepEqual(target.headers, { 'Content-Type': type, 'Content-Length': size });
        assert.ok(Math.abs(Date.parse(target.expiresAt) - Date.now() - 600_000) < 5_000);
      }
      const retry = await create(body);
      assert.equal(retry.status, 201);
      assert.equal(retry.json.photo.id, created.id, 'same clientId, same photo');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_photos WHERE client_id = $1', [body.clientId])).rows[0].n, 1);
      const row = (await db.query('SELECT status, storage, url, pathname, author_user_id, role, time_zone, object_key FROM couple_photos WHERE id = $1', [created.id])).rows[0];
      assert.deepEqual(row, { status: 'pending', storage: 's3', url: null, pathname: null, author_user_id: 'usr_ana', role: 'a', time_zone: 'America/Sao_Paulo', object_key: `couples/cpl_01/photos/${created.id}/full.jpg` });

      const keyed = await create(request({ phraseKey: 'aitai', phrase: 'ignored', contentType: 'image/webp', thumbContentType: 'image/webp' }));
      assert.equal(keyed.status, 201);
      assert.deepEqual([keyed.json.photo.phraseKey, keyed.json.photo.phrase], ['aitai', '会いたい · I miss you']);
      assert.match(keyed.json.upload.full.url, /\/full\.webp\?/);
      const bare = await create(request({ phrase: undefined }));
      assert.deepEqual([bare.json.photo.phraseKey, bare.json.photo.phrase], [null, null]);
    });

    await t.test('POST /api/v1/photos: validation, limits and auth', async () => {
      expectError(await create(request({ clientId: 'nope' })), 400, 'bad_request');
      expectError(await create(request({ contentType: 'image/heic' })), 415, 'unsupported_media_type');
      expectError(await create(request({ thumbContentType: 'image/png' })), 415, 'unsupported_media_type');
      expectError(await create(request({ contentType: undefined })), 400, 'bad_request');
      expectError(await create(request({ bytes: 2 * 1024 * 1024 + 1 })), 413, 'too_large');
      expectError(await create(request({ thumbBytes: 256 * 1024 + 1 })), 413, 'too_large');
      expectError(await create(request({ bytes: 0 })), 400, 'bad_request');
      expectError(await create(request({ bytes: 1.5 })), 400, 'bad_request');
      expectError(await create(request({ width: 5000 })), 400, 'bad_request');
      expectError(await create(request({ timeZone: 'Mars/Base' })), 400, 'bad_request');
      expectError(await create(request({ localDay: '2026-02-30' })), 400, 'bad_request');
      expectError(await create(request({ localDay: addDays(anaToday, -2) })), 422, 'invalid_local_day');
      expectError(await create(request({ localDay: addDays(anaToday, 2) })), 422, 'invalid_local_day');
      expectError(await create(request({ phraseKey: 'not-a-phrase' })), 400, 'bad_request');
      expectError(await create(request({ phrase: 'x'.repeat(81) })), 400, 'bad_request');
      expectError(await create('not json'), 400, 'bad_request');
      expectError(await create(request(), null), 401, 'unauthorized');
      const unpaired = await create(request(), zoe);
      expectError(unpaired, 409, 'not_paired');
      assert.deepEqual(unpaired.json, fixture('createPhoto.409'));
    });

    await t.test('POST /api/v1/photos/{id}/complete: HEAD checks, daily photo, push, idempotent', async () => {
      const missing = await completeCall(firstId);
      expectError(missing, 422, 'upload_missing');
      assert.deepEqual(missing.json, fixture('completePhoto.422'));
      const created = (await create(request({ clientId: (await db.query('SELECT client_id FROM couple_photos WHERE id = $1', [firstId])).rows[0].client_id }))).json;
      assert.equal((await deviceUpload(created.upload.full)).status, 200);
      expectError(await completeCall(firstId), 422, 'upload_missing');
      assert.equal((await deviceUpload(created.upload.thumb, 10)).status, 403, 'a different Content-Length breaks the presigned PUT');
      await deviceUpload(created.upload.thumb);

      expectError(await completeCall(firstId, kenji), 404, 'not_found');
      expectError(await completeCall('ph_unknown'), 404, 'not_found');
      const pushLogs = () => logs.filter((l) => /^\[push\] photo\.new: \d+ sent/.test(l)).length;
      const before = pushLogs();
      const done = await completeCall(firstId);
      assert.equal(done.status, 200, JSON.stringify(done.json));
      assertContract('Photo', done.json);
      assert.deepEqual([done.json.status, done.json.isDaily, done.json.author, done.json.localDay], ['ready', true, 'me', anaToday]);
      for (const [url, file] of [[done.json.urls.full, 'full.jpg'], [done.json.urls.thumb, 'thumb.jpg']]) {
        assert.equal(new URL(url).host, BUCKET_HOST);
        assert.equal(new URL(url).pathname, `/couples/cpl_01/photos/${firstId}/${file}`);
        assert.equal(new URL(url).searchParams.get('X-Amz-Expires'), '86400');
      }
      assert.ok(pushLogs() > before, 'photo.new sent to the partner (FCM unconfigured: logged no-op)');
      assert.ok(logs.some((l) => l.includes('photo.new: FCM not configured, skipped 1')));

      const again = await completeCall(firstId);
      assert.equal(again.status, 200);
      assert.equal(again.json.isDaily, true);
      assert.equal(pushLogs(), before + 1, 'a repeated complete does not push again');

      const second = await uploadAndComplete(request({ phrase: 'Second one' }));
      assert.equal(second.status, 200);
      assert.equal(second.json.isDaily, false, 'later photos of the same day go to the gallery');
      // The partner sees it as "partner".
      const kenjiView = await day(anaToday, kenji);
      assert.ok(kenjiView.json.photos.some((p) => p.id === firstId && p.author === 'partner'));
    });

    await t.test('complete rejects oversize and mistyped objects', async () => {
      const created = (await create(request())).json;
      const prefix = `couples/cpl_01/photos/${created.photo.id}`;
      // As if the provider ignored the signed length: the HEAD check still catches it.
      bucket.set(`${prefix}/full.jpg`, { size: 2 * 1024 * 1024 + 5, type: 'image/jpeg' });
      bucket.set(`${prefix}/thumb.jpg`, { size: 19456, type: 'image/jpeg' });
      expectError(await completeCall(created.photo.id), 422, 'upload_size_mismatch');
      bucket.set(`${prefix}/full.jpg`, { size: 204799, type: 'image/jpeg' });
      expectError(await completeCall(created.photo.id), 422, 'upload_size_mismatch');
      bucket.set(`${prefix}/full.jpg`, { size: 204800, type: 'image/png' });
      expectError(await completeCall(created.photo.id), 422, 'unsupported_media_type');
      bucket.set(`${prefix}/full.jpg`, { size: 204800, type: 'image/jpeg; charset=binary' });
      const ok = await completeCall(created.photo.id);
      assert.equal(ok.status, 200);
      assert.equal(ok.json.isDaily, false);
      assert.equal((await db.query("SELECT status FROM couple_photos WHERE id = $1", [created.photo.id])).rows[0].status, 'ready');
    });

    await t.test('daily photo per author, on the author\'s own local day and time zone', async () => {
      const kenjiFirst = await uploadAndComplete(request({ localDay: kenjiToday, timeZone: 'Asia/Tokyo' }), kenji);
      assert.equal(kenjiFirst.status, 200);
      assert.equal(kenjiFirst.json.isDaily, true, 'Ana having a daily photo does not affect Kenji');
      assert.equal((await uploadAndComplete(request({ localDay: kenjiToday, timeZone: 'Asia/Tokyo' }), kenji)).json.isDaily, false);
      const yesterday = await uploadAndComplete(request({ localDay: addDays(anaToday, -1) }));
      assert.deepEqual([yesterday.json.localDay, yesterday.json.isDaily], [addDays(anaToday, -1), true], 'yesterday (still evening there) gets its own daily');

      // UTC+14 vs UTC-11: the same localDay is "tomorrow" in one zone and out of range in the other.
      const kiritimatiTomorrow = addDays(localDayIn('Pacific/Kiritimati'), 1);
      assert.equal((await create(request({ localDay: kiritimatiTomorrow, timeZone: 'Pacific/Kiritimati' }))).status, 201);
      expectError(await create(request({ localDay: kiritimatiTomorrow, timeZone: 'Pacific/Pago_Pago' })), 422, 'invalid_local_day');
      const dailies = (await db.query("SELECT author_user_id, to_char(local_day, 'YYYY-MM-DD') AS day FROM couple_photos WHERE is_daily ORDER BY author_user_id, local_day")).rows;
      assert.deepEqual(dailies, [{ author_user_id: 'usr_ana', day: addDays(anaToday, -1) }, { author_user_id: 'usr_ana', day: anaToday }, { author_user_id: 'usr_kenji', day: kenjiToday }].sort((a, b) => a.author_user_id.localeCompare(b.author_user_id) || a.day.localeCompare(b.day)));
    });

    // Seeded history around Ana's today (Free window = today and the 6 days before, in her zone).
    const recent = addDays(anaToday, -3);
    const old = addDays(anaToday, -10);
    const seed = async (id, author, localDay, { daily = false, createdAt = `${localDay}T12:00:00Z`, storage = 's3' } = {}) => {
      const key = `couples/cpl_01/photos/${id}`;
      await db.query(`INSERT INTO couple_photos (id, couple_id, role, author_name, url, pathname, phrase, content_type, size_bytes, storage, author_user_id, local_day, is_daily, status, object_key, thumb_key, thumb_content_type, thumb_size_bytes, width, height, created_at, ready_at)
        VALUES ($1, 'cpl_01', 'a', 'x', $2, $3, NULL, 'image/jpeg', 100, $4, $5, $6, $7, 'ready', $8, $9, 'image/jpeg', 10, 1080, 1440, $10, $10)`,
      [id, storage === 'blob' ? `https://blob.example/${id}.jpg` : null, storage === 'blob' ? `${id}.jpg` : null, storage, author, localDay, daily, storage === 's3' ? `${key}/full.jpg` : null, storage === 's3' ? `${key}/thumb.jpg` : null, createdAt]);
    };

    await t.test('GET /api/v1/memories: month grid, Free sees only the last 7 days', async () => {
      await seed('ph_ana_recent', 'usr_ana', recent, { daily: true, createdAt: `${recent}T11:42:00Z` });
      await seed('ph_kenji_recent', 'usr_kenji', recent, { daily: true, createdAt: `${recent}T10:05:00Z` });
      await seed('ph_ana_recent_b', 'usr_ana', recent, { createdAt: `${recent}T12:00:40Z` });
      await seed('ph_kenji_recent_b', 'usr_kenji', recent, { createdAt: `${recent}T12:30:00Z` });
      await seed('ph_ana_old', 'usr_ana', old, { daily: true });
      await seed('ph_kenji_old', 'usr_kenji', old, { daily: true });
      await seed('ph_kenji_legacy', 'usr_kenji', addDays(recent, -1), { daily: true, storage: 'blob' });
      await seed('ph_ana_edge_in', 'usr_ana', addDays(anaToday, -6), { daily: true });
      await seed('ph_ana_edge_out', 'usr_ana', addDays(anaToday, -7), { daily: true });

      const free = async (m) => {
        const res = await month(m);
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assertContract('MemoriesMonth', res.json);
        assert.equal(res.json.month, m);
        assert.equal(res.json.historyLimitDays, 7);
        return res.json.days;
      };
      const days = new Map();
      for (const m of new Set([old.slice(0, 7), recent.slice(0, 7), anaToday.slice(0, 7), kenjiToday.slice(0, 7)])) {
        const list = await free(m);
        assert.deepEqual(list.map((d) => d.day), [...list.map((d) => d.day)].sort(), 'ascending');
        for (const d of list) days.set(d.day, d);
      }
      assert.deepEqual(days.get(old), { day: old, locked: true, photoCount: 2, me: null, partner: null });
      assert.deepEqual([days.get(addDays(anaToday, -6)).locked, days.get(addDays(anaToday, -6)).me.photoId], [false, 'ph_ana_edge_in'], 'today and the 6 days before are open');
      assert.equal(days.get(addDays(anaToday, -7)).locked, true, 'the 7th day back is locked');
      const r = days.get(recent);
      assert.deepEqual([r.locked, r.photoCount, r.me.photoId, r.partner.photoId], [false, 4, 'ph_ana_recent', 'ph_kenji_recent'], 'daily thumbs of both');
      assert.equal(new URL(r.me.thumbUrl).host, BUCKET_HOST);
      assert.equal(new URL(r.me.thumbUrl).pathname, '/couples/cpl_01/photos/ph_ana_recent/thumb.jpg');
      assert.equal(new URL(r.partner.thumbUrl).searchParams.get('X-Amz-Expires'), '86400');
      assert.equal(days.get(addDays(recent, -1)).partner.thumbUrl, 'https://blob.example/ph_kenji_legacy.jpg', 'legacy Blob photos keep their url');
      assert.equal(days.get(addDays(recent, -1)).me, null);
      assert.equal(days.get(anaToday).me.photoId, firstId);
      const pending = (await db.query("SELECT count(*)::int AS n FROM couple_photos WHERE status = 'pending' AND local_day = $1", [anaToday])).rows[0].n;
      assert.ok(pending > 0);
      assert.equal(days.get(anaToday).photoCount, (await db.query("SELECT count(*)::int AS n FROM couple_photos WHERE status = 'ready' AND local_day = $1", [anaToday])).rows[0].n, 'pending photos are not counted');

      // Premium (either member pays): nothing locked, no limit.
      await db.query("UPDATE users SET plan = 'premium', subscription_status = 'active' WHERE id = 'usr_kenji'");
      const premium = await month(old.slice(0, 7));
      assertContract('MemoriesMonth', premium.json);
      assert.equal(premium.json.historyLimitDays, null);
      const oldDay = premium.json.days.find((d) => d.day === old);
      assert.deepEqual([oldDay.locked, oldDay.me.photoId, oldDay.partner.photoId], [false, 'ph_ana_old', 'ph_kenji_old']);
      await db.query("UPDATE users SET plan = 'free', subscription_status = 'inactive' WHERE id = 'usr_kenji'");

      for (const bad of ['2026-13', '2026-1', '', 'abc']) expectError(await month(bad), 400, 'bad_request');
      expectError(await call(memories.GET, { path: '/api/v1/memories' }), 400, 'bad_request');
      expectError(await month('2026-10', zoe), 409, 'not_paired');
      expectError(await month('2026-10', null), 401, 'unauthorized');
    });

    await t.test('GET /api/v1/memories/{day}: daily first (mine, then partner), then the gallery by time; 403 when locked', async () => {
      const res = await day(recent);
      assert.equal(res.status, 200);
      assertContract('MemoryDay', res.json);
      assert.equal(res.json.day, recent);
      assert.deepEqual(res.json.photos.map((p) => [p.id, p.author, p.isDaily]), [['ph_ana_recent', 'me', true], ['ph_kenji_recent', 'partner', true], ['ph_ana_recent_b', 'me', false], ['ph_kenji_recent_b', 'partner', false]]);
      assert.equal(new URL(res.json.photos[0].urls.full).pathname, '/couples/cpl_01/photos/ph_ana_recent/full.jpg');
      const kenjiView = await day(recent, kenji);
      assert.deepEqual(kenjiView.json.photos.map((p) => p.id), ['ph_kenji_recent', 'ph_ana_recent', 'ph_ana_recent_b', 'ph_kenji_recent_b']);

      assert.equal((await day(addDays(anaToday, -6))).status, 200);
      expectError(await day(addDays(anaToday, -7)), 403, 'premium_required');
      const locked = await day(old);
      expectError(locked, 403, 'premium_required');
      assert.deepEqual(locked.json, fixture('getMemoryDay.403'));
      await db.query("UPDATE users SET trial_ends_at = now() + interval '3 days' WHERE id = 'usr_ana'");
      assert.equal((await day(old)).json.photos.length, 2, 'Premium (trial) opens older days');
      await db.query("UPDATE users SET trial_ends_at = NULL WHERE id = 'usr_ana'");
      assert.deepEqual((await day(addDays(anaToday, 3))).json, { day: addDays(anaToday, 3), photos: [] });
      for (const bad of ['2026-02-30', '20261019', 'today']) expectError(await day(bad), 400, 'bad_request');
      expectError(await day(recent, zoe), 409, 'not_paired');
    });

    await t.test('DELETE /api/v1/photos/{id}: author only, removes the objects, promotes the next daily', async () => {
      const del = (photoId, token = ana) => call(photo.DELETE, { method: 'DELETE', path: `/api/v1/photos/${photoId}`, token, params: { photoId } });
      expectError(await del(firstId, kenji), 403, 'forbidden');
      expectError(await del('ph_unknown'), 404, 'not_found');
      assert.ok(bucket.has(`couples/cpl_01/photos/${firstId}/full.jpg`));
      const res = await del(firstId);
      assert.equal(res.status, 204);
      assert.equal(res.json, null);
      assert.ok(!bucket.has(`couples/cpl_01/photos/${firstId}/full.jpg`) && !bucket.has(`couples/cpl_01/photos/${firstId}/thumb.jpg`));
      const daily = (await db.query("SELECT id, phrase FROM couple_photos WHERE author_user_id = 'usr_ana' AND local_day = $1 AND is_daily", [anaToday])).rows;
      assert.deepEqual(daily.map((r) => r.phrase), ['Second one'], 'the next ready photo of the day became the daily photo');
      expectError(await del(firstId), 404, 'not_found');
    });

    await t.test('no photo bytes pass through the Function: the server only HEADs and deletes', () => {
      assert.ok(serverCalls.length > 0);
      assert.deepEqual([...new Set(serverCalls.map((c) => c.split(' ')[0]))].sort(), ['HEAD', 'POST']);
      assert.ok(serverCalls.filter((c) => c.startsWith('POST')).every((c) => c === 'POST /?delete'));
    });

    await t.test('POST / DELETE /api/v1/devices: upsert by token, one token per installation + kind', async () => {
      const register = (body, token = ana) => call(devices.POST, { method: 'POST', path: '/api/v1/devices', token, body });
      const alert = fixture('registerDevice.request');
      const first = await register(alert);
      assert.equal(first.status, 201, JSON.stringify(first.json));
      assertContract('Device', first.json);
      assert.deepEqual({ ...first.json, id: 'x', createdAt: 'x', lastSeenAt: 'x' }, { ...fixture('registerDevice.201'), id: 'x', createdAt: 'x', lastSeenAt: 'x' });
      assert.match(first.json.id, /^dev_[0-9a-f]{20}$/);
      const again = await register({ ...alert, appVersion: '1.0.1+4' });
      assert.equal(again.json.id, first.json.id, 'same token: same device');
      assert.equal((await db.query('SELECT app_version FROM push_devices WHERE id = $1', [first.json.id])).rows[0].app_version, '1.0.1+4');

      const rotated = await register({ ...alert, token: 'b'.repeat(64) });
      assert.notEqual(rotated.json.id, first.json.id);
      assert.ok((await db.query('SELECT revoked_at FROM push_devices WHERE id = $1', [first.json.id])).rows[0].revoked_at, 'the old token of that installation + kind is revoked');

      const widget = await register(fixture('registerDevice.request.apns_widget'));
      assert.deepEqual([widget.status, widget.json.kind, widget.json.env], [201, 'apns_widget', 'production']);
      const android = await register(fixture('registerDevice.request.fcm'), kenji);
      assertContract('Device', android.json);
      assert.deepEqual([android.json.kind, android.json.platform, android.json.env], ['fcm', 'android', null]);
      assert.equal((await register({ ...alert, token: 'zoe-token', installationId: 'ins_zoe' }, zoe)).status, 201, 'unpaired users register too');

      // A token that shows up under another account moves to it.
      const moved = await register({ ...alert, token: 'b'.repeat(64), installationId: 'ins_kenji_ipad' }, kenji);
      assert.equal(moved.json.id, rotated.json.id);
      assert.equal((await db.query('SELECT user_id FROM push_devices WHERE id = $1', [rotated.json.id])).rows[0].user_id, 'usr_kenji');

      for (const bad of [{ ...alert, env: undefined }, { ...alert, env: 'staging' }, { ...alert, kind: 'sms' }, { ...alert, platform: 'android' }, { ...fixture('registerDevice.request.fcm'), platform: 'ios' }, { ...alert, token: '' }, { ...alert, token: 'x'.repeat(4097) }, { ...alert, installationId: undefined }, { ...alert, appVersion: undefined }, { ...alert, locale: 'x'.repeat(17) }]) {
        expectError(await register(bad), 400, 'bad_request');
      }
      expectError(await register('nope'), 400, 'bad_request');
      expectError(await register(alert, null), 401, 'unauthorized');

      const remove = (deviceId, token = ana) => call(device.DELETE, { method: 'DELETE', path: `/api/v1/devices/${deviceId}`, token, params: { deviceId } });
      expectError(await remove(android.json.id), 404, 'not_found');
      assert.equal((await remove(widget.json.id)).status, 204);
      expectError(await remove(widget.json.id), 404, 'not_found');
      expectError(await remove(widget.json.id, null), 401, 'unauthorized');
      const active = (await db.query("SELECT kind, token FROM push_devices WHERE revoked_at IS NULL ORDER BY user_id, kind, token")).rows.map((r) => `${r.kind}:${r.token.slice(0, 8)}`);
      assert.deepEqual(active, ['apns_alert:bbbbbbbb', 'fcm:dGVzdC1m', 'fcm:seed-fcm', 'apns_alert:zoe-toke'], 'Ana moved her last token to Kenji and removed the widget one');
    });
  } finally {
    console.info = originalInfo;
    globalThis.fetch = realFetch;
    hooks.deregister();
    setEnv(saved);
    await db.close();
  }
});
