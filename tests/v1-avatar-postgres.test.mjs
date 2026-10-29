// /api/v1/me/avatar (upload, complete, delete), PATCH /api/v1/me and avatar exposure on /me, /couple and /today,
// over isolated in-memory PGlite (never Neon) and an in-memory S3 bucket behind a fetch stub (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';
import { pgliteSql } from './helpers/pglite-sql.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const fixture = (name) => JSON.parse(readFileSync(new URL(`../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'));
const migration0015 = readFileSync(new URL('../drizzle/0015_avatars.sql', import.meta.url), 'utf8');
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`;

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
      bucket.set(key, { size: body.length, type: header('content-type'), data: new Uint8Array(body) });
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
  if (method === 'GET' && url.searchParams.get('list-type') === '2') {
    const keys = [...bucket.keys()].filter((k) => k.startsWith(url.searchParams.get('prefix'))).sort();
    return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k}</Key><LastModified>${bucket.get(k).lastModified ?? new Date().toISOString()}</LastModified><Size>${bucket.get(k).size}</Size></Contents>`).join('')}</ListBucketResult>`);
  }
  if (method === 'GET') {
    const found = bucket.get(key);
    return found ? new Response(found.data ?? new Uint8Array(found.size), { headers: { 'content-type': found.type } }) : new Response(null, { status: 404 });
  }
  if (method === 'PUT') {
    const data = new Uint8Array(body);
    bucket.set(key, { size: data.length, type: header('content-type'), data });
    return new Response(null, { status: 200 });
  }
  if (method === 'POST' && url.searchParams.has('delete')) {
    for (const [, k] of String(body).matchAll(/<Key>(.*?)<\/Key>/g)) bucket.delete(k);
    return new Response('<DeleteResult></DeleteResult>');
  }
  return new Response(null, { status: 400 });
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (input instanceof Request) return s3(input.method, input.url, input.headers, input.method === 'POST' ? await input.text() : input.method === 'PUT' ? await input.arrayBuffer() : null);
  return s3(init.method ?? 'GET', String(input), new Headers(init.headers), init.body ?? null);
};
/** What the app does: PUT the bytes straight to the bucket with exactly the returned headers. */
const deviceUpload = (target, size = Number(target.headers['Content-Length'])) => globalThis.fetch(target.url, { method: target.method, headers: target.headers, body: new Uint8Array(size) });

test('profile photo and profile edit', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = pgliteSql(db);
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
    const { ensurePhotosSchema } = await import('../server/v1/photos-schema.ts');
    const { ensureAvatarSchema, normalizeDisplayName } = await import('../server/v1/profile.ts');
    const lifecycle = await import('../server/v1/lifecycle.ts');
    const me = await import('../app/api/v1/me/route.ts');
    const avatar = await import('../app/api/v1/me/avatar/route.ts');
    const upload = await import('../app/api/v1/me/avatar/upload/route.ts');
    const complete = await import('../app/api/v1/me/avatar/complete/route.ts');
    const couple = await import('../app/api/v1/couple/route.ts');
    const today = await import('../app/api/v1/today/route.ts');
    const sql = auth.database();

    await ensurePhotosSchema(sql);
    await lifecycle.ensureLifecycleSchema(sql);
    // The migration and the lazy ensure agree and are both idempotent.
    await db.exec(migration0015);
    await ensureAvatarSchema(sql);
    await db.exec(migration0015);
    await db.exec(`INSERT INTO users (id, email, display_name, time_zone) VALUES ('usr_ana', 'ana@example.com', 'Ana', 'America/Sao_Paulo'), ('usr_kenji', 'kenji@example.com', 'Kenji', 'Asia/Tokyo'), ('usr_zoe', 'zoe@example.com', 'Zoe', NULL);
      INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_01', false, now());
      INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_01', 'usr_ana', 'a'), ('cpl_01', 'usr_kenji', 'b');`);
    const ana = await auth.createMobileToken({ kind: 'user', userId: 'usr_ana', platform: 'ios' });
    const kenji = await auth.createMobileToken({ kind: 'user', userId: 'usr_kenji', platform: 'android' });
    const zoe = await auth.createMobileToken({ kind: 'user', userId: 'usr_zoe', platform: 'ios' });

    const call = async (handler, { method = 'GET', path = '/', token = ana, body } = {}) => {
      const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
      const response = await handler(new Request(`https://hontogame.com${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve({}) });
      assert.equal(response.headers.get('cache-control'), 'no-store', `${method} ${path}`);
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers };
    };
    const expectError = (res, status, code) => {
      assert.equal(res.status, status, JSON.stringify(res.json));
      assertContract('Error', res.json);
      assert.equal(res.json.code, code);
    };
    const reserve = (body = {}, token = ana) => call(upload.POST, { method: 'POST', path: '/api/v1/me/avatar/upload', token, body: { ...fixture('createAvatarUpload.request'), ...body } });
    const finish = (avatarId, token = ana) => call(complete.POST, { method: 'POST', path: '/api/v1/me/avatar/complete', token, body: { avatarId } });
    const setAvatar = async (token = ana, body = {}) => {
      const created = await reserve(body, token);
      assert.equal(created.status, 201, JSON.stringify(created.json));
      await deviceUpload(created.json.upload.full);
      await deviceUpload(created.json.upload.thumb);
      const done = await finish(created.json.avatarId, token);
      assert.equal(done.status, 200, JSON.stringify(done.json));
      return done.json;
    };
    const getMe = (token = ana) => call(me.GET, { path: '/api/v1/me', token });

    await t.test('no avatar yet: avatar is null on /me, /couple and /today', async () => {
      const res = await getMe();
      assert.equal(res.status, 200);
      assertContract('Me', res.json);
      assert.equal(res.json.user.avatar, null);
      assert.equal(res.json.couple.partner.avatar, null);
      const unpaired = await getMe(zoe);
      assert.equal(unpaired.status, 200);
      assertContract('Me', unpaired.json);
      assert.equal(unpaired.json.user.avatar, null);
      const day = await call(today.GET, { path: '/api/v1/today' });
      assert.equal(day.status, 200);
      assertContract('Today', day.json);
      assert.equal(day.json.me.avatar, null);
      assert.equal(day.json.partner.avatar, null);
    });

    await t.test('POST /api/v1/me/avatar/upload validates and presigns both PUTs', async () => {
      expectError(await call(upload.POST, { method: 'POST', path: '/api/v1/me/avatar/upload', token: null, body: fixture('createAvatarUpload.request') }), 401, 'unauthorized');
      expectError(await call(upload.POST, { method: 'POST', path: '/api/v1/me/avatar/upload', body: 'nope' }), 400, 'bad_request');
      expectError(await reserve({ contentType: 'image/png' }), 415, 'unsupported_media_type');
      expectError(await reserve({ thumbContentType: 'image/gif' }), 415, 'unsupported_media_type');
      expectError(await reserve({ bytes: 1024 * 1024 + 1 }), 413, 'too_large');
      expectError(await reserve({ thumbBytes: 128 * 1024 + 1 }), 413, 'too_large');
      expectError(await reserve({ bytes: 0 }), 400, 'bad_request');
      expectError(await reserve({ width: 2049 }), 400, 'bad_request');
      expectError(await reserve({ height: 0 }), 400, 'bad_request');
      const res = await reserve({ thumbContentType: 'image/webp' });
      assert.equal(res.status, 201);
      assertContract('AvatarUploadResponse', res.json);
      assert.match(res.json.avatarId, /^av_/);
      assert.match(new URL(res.json.upload.full.url).pathname, new RegExp(`^/avatars/usr_ana/${res.json.avatarId}/full\\.jpg$`));
      assert.match(new URL(res.json.upload.thumb.url).pathname, new RegExp(`^/avatars/usr_ana/${res.json.avatarId}/thumb\\.webp$`));
      assert.equal(res.json.upload.full.headers['Content-Length'], String(fixture('createAvatarUpload.request').bytes));
      // Works without a partner.
      assert.equal((await reserve({}, zoe)).status, 201);
    });

    await t.test('POST /api/v1/me/avatar/complete checks the uploads, then exposes the avatar to me and my partner', async () => {
      expectError(await finish('av_missing'), 404, 'not_found');
      expectError(await call(complete.POST, { method: 'POST', path: '/api/v1/me/avatar/complete', body: {} }), 400, 'bad_request');
      const created = await reserve();
      expectError(await finish(created.json.avatarId, kenji), 404, 'not_found');
      expectError(await finish(created.json.avatarId), 422, 'upload_missing');
      await deviceUpload(created.json.upload.full);
      await deviceUpload(created.json.upload.thumb);
      // Wrong size behind the declared one.
      bucket.set(new URL(created.json.upload.thumb.url).pathname.slice(1), { size: 5, type: 'image/jpeg' });
      expectError(await finish(created.json.avatarId), 422, 'upload_size_mismatch');
      await deviceUpload(created.json.upload.thumb);
      bucket.set(new URL(created.json.upload.full.url).pathname.slice(1), { size: fixture('createAvatarUpload.request').bytes, type: 'image/png' });
      expectError(await finish(created.json.avatarId), 422, 'unsupported_media_type');
      await deviceUpload(created.json.upload.full);
      const done = await finish(created.json.avatarId);
      assert.equal(done.status, 200, JSON.stringify(done.json));
      assertContract('Avatar', done.json);
      assert.equal(done.json.id, created.json.avatarId);
      assert.match(done.json.urls.thumb, /X-Amz-Expires=86400/);
      assert.match(new URL(done.json.urls.full).pathname, /^\/avatars\/usr_ana\/av_[^/]+\/full\.jpg$/);
      // Idempotent.
      const again = await finish(created.json.avatarId);
      assert.equal(again.status, 200);
      assert.equal(again.json.id, done.json.id);

      const mine = await getMe();
      assertContract('Me', mine.json);
      assert.equal(mine.json.user.avatar.id, done.json.id);
      assert.equal(mine.json.couple.partner.avatar, null);
      const theirs = await getMe(kenji);
      assert.equal(theirs.json.couple.partner.avatar.id, done.json.id);
      const coupleView = await call(couple.GET, { path: '/api/v1/couple', token: kenji });
      assertContract('Couple', coupleView.json);
      assert.equal(coupleView.json.partner.avatar.id, done.json.id);
      const day = await call(today.GET, { path: '/api/v1/today', token: kenji });
      assertContract('Today', day.json);
      assert.equal(day.json.partner.avatar.id, done.json.id);
      assert.equal(day.json.me.avatar, null);
      const own = await call(today.GET, { path: '/api/v1/today' });
      assert.equal(own.json.me.avatar.id, done.json.id);
    });

    await t.test('a new avatar replaces the previous one and deletes its objects', async () => {
      const before = (await getMe()).json.user.avatar;
      const oldKeys = [new URL(before.urls.full).pathname.slice(1), new URL(before.urls.thumb).pathname.slice(1)];
      assert.ok(oldKeys.every((k) => bucket.has(k)));
      const next = await setAvatar();
      assert.notEqual(next.id, before.id);
      assert.ok(oldKeys.every((k) => !bucket.has(k)), 'previous objects deleted');
      const ready = await sql`SELECT count(*)::int AS n FROM user_avatars WHERE user_id = 'usr_ana' AND status = 'ready'`;
      assert.equal(ready[0].n, 1);
      assert.equal((await getMe()).json.user.avatar.id, next.id);
      assert.equal((await sql`SELECT count(*)::int AS n FROM storage_deletions`)[0].n, 0);
    });

    await t.test('DELETE /api/v1/me/avatar removes rows and objects', async () => {
      expectError(await call(avatar.DELETE, { method: 'DELETE', path: '/api/v1/me/avatar', token: null }), 401, 'unauthorized');
      const current = (await getMe()).json.user.avatar;
      const res = await call(avatar.DELETE, { method: 'DELETE', path: '/api/v1/me/avatar' });
      assert.equal(res.status, 204);
      assert.ok(!bucket.has(new URL(current.urls.full).pathname.slice(1)));
      assert.ok(!bucket.has(new URL(current.urls.thumb).pathname.slice(1)));
      assert.equal((await getMe()).json.user.avatar, null);
      assert.equal((await getMe(kenji)).json.couple.partner.avatar, null);
      assert.equal((await call(avatar.DELETE, { method: 'DELETE', path: '/api/v1/me/avatar' })).status, 204, 'idempotent');
    });

    await t.test('upload reservations are rate limited per user', async () => {
      // Earlier subtests used some of the 20 per hour; keep going until the limit.
      let res;
      for (let i = 0; i < 25; i += 1) { res = await reserve({}, zoe); if (res.status !== 201) break; }
      assert.equal(res.status, 429);
      assertContract('Error', res.json);
      assert.equal(res.json.code, 'rate_limited');
      assert.ok(Number(res.headers.get('retry-after')) > 0);
    });

    await t.test('retention purges pending avatars older than a day', async () => {
      const stale = await reserve({}, kenji);
      await deviceUpload(stale.json.upload.full);
      await sql`UPDATE user_avatars SET created_at = now() - interval '2 days' WHERE id = ${stale.json.avatarId}`;
      await lifecycle.runRetention(sql);
      assert.equal((await sql`SELECT count(*)::int AS n FROM user_avatars WHERE id = ${stale.json.avatarId}`)[0].n, 0);
      assert.ok(!bucket.has(new URL(stale.json.upload.full.url).pathname.slice(1)));
    });

    await t.test('PATCH /api/v1/me edits the display name; the partner sees it', async () => {
      assert.equal(normalizeDisplayName('  Ana   Lima '), 'Ana Lima');
      assert.equal(normalizeDisplayName('a\u0000b'), null);
      assert.equal(normalizeDisplayName('a\u202eb'), null);
      assert.equal(normalizeDisplayName('x'.repeat(80)), 'x'.repeat(80));
      assert.equal(normalizeDisplayName('x'.repeat(81)), null);
      const patch = (body, token = ana) => call(me.PATCH, { method: 'PATCH', path: '/api/v1/me', token, body });
      expectError(await patch(fixture('updateProfile.request'), null), 401, 'unauthorized');
      expectError(await patch({}), 400, 'bad_request');
      expectError(await patch({ displayName: '   ' }), 400, 'bad_request');
      expectError(await patch({ displayName: 42 }), 400, 'bad_request');
      expectError(await patch({ displayName: 'y'.repeat(81) }), 400, 'bad_request');
      expectError(await patch({ displayName: 'bad\nname\u0007' }), 400, 'bad_request');
      const avatarNow = await setAvatar();
      const res = await patch({ displayName: '  Ana   Lima ' });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assertContract('User', res.json);
      assert.equal(res.json.displayName, 'Ana Lima');
      assert.equal(res.json.avatar.id, avatarNow.id);
      assert.equal((await getMe()).json.user.displayName, 'Ana Lima');
      assert.equal((await getMe(kenji)).json.couple.partner.displayName, 'Ana Lima');
      assert.equal((await call(today.GET, { path: '/api/v1/today', token: kenji })).json.partner.displayName, 'Ana Lima');
    });

    await t.test('PATCH /api/v1/couple (start date, reunion) is seen by both partners', async () => {
      const res = await call(couple.PATCH, { method: 'PATCH', path: '/api/v1/couple', token: kenji, body: { startedOn: '2024-03-02', reunion: { at: '2027-01-10T09:30:00Z', city: 'Lisbon', timeZone: 'Europe/Lisbon' } } });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assertContract('Couple', res.json);
      assert.equal(res.json.partner.avatar.id, (await getMe()).json.user.avatar.id);
      const seen = (await getMe()).json.couple;
      assert.equal(seen.startedOn, '2024-03-02');
      assert.deepEqual({ at: seen.reunion.at, city: seen.reunion.city, timeZone: seen.reunion.timeZone }, { at: '2027-01-10T09:30:00Z', city: 'Lisbon', timeZone: 'Europe/Lisbon' });
      const day = (await call(today.GET, { path: '/api/v1/today' })).json;
      assert.equal(day.startedOn, '2024-03-02');
      assert.equal(day.reunion.city, 'Lisbon');
    });

    await t.test('DELETE /api/v1/me deletes the avatar objects too', async () => {
      const current = (await getMe()).json.user.avatar;
      const keys = [new URL(current.urls.full).pathname.slice(1), new URL(current.urls.thumb).pathname.slice(1)];
      assert.ok(keys.every((k) => bucket.has(k)));
      const res = await call(me.DELETE, { method: 'DELETE', path: '/api/v1/me' });
      assert.equal(res.status, 204);
      assert.ok(keys.every((k) => !bucket.has(k)), 'avatar objects deleted with the account');
      assert.equal((await sql`SELECT count(*)::int AS n FROM user_avatars WHERE user_id = 'usr_ana'`)[0].n, 0);
      assert.equal((await sql`SELECT count(*)::int AS n FROM storage_deletions`)[0].n, 0);
    });
  } finally {
    console.info = originalInfo;
    globalThis.fetch = realFetch;
    hooks.deregister();
    setEnv(saved);
    await db.close();
  }
});
