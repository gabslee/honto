// app/push: APNs (fake node:http2), FCM (fake fetch) and notifyPartner over in-memory PGlite. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { jwtVerify, decodeProtectedHeader, importSPKI } from 'jose';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);

// ---- fakes ----------------------------------------------------------------------------------------
const apnsRequests = [];
const apnsSessions = [];
let apnsRespond = () => ({ status: 200, body: '' });
globalThis.__hontoHttp2 = {
  connect(origin) {
    const session = { origin, closed: false, on() { return session; }, close() { session.closed = true; } };
    session.request = (headers) => {
      const stream = new EventEmitter();
      stream.setEncoding = () => {};
      stream.setTimeout = () => {};
      stream.close = () => {};
      stream.end = (body) => setImmediate(() => {
        const sent = { origin, headers, body: JSON.parse(body) };
        apnsRequests.push(sent);
        let answer;
        try { answer = apnsRespond(sent); } catch (error) { stream.emit('error', error); return; }
        const { status, body: reply } = answer;
        stream.emit('response', { ':status': status });
        if (reply) stream.emit('data', reply);
        stream.emit('end');
      });
      return stream;
    };
    apnsSessions.push(session);
    return session;
  },
};
const fcmRequests = [];
let fcmTokenRequests = 0;
let fcmRespond = () => ({ status: 200, body: { name: 'projects/honto-test/messages/1' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://oauth2.googleapis.com/token') {
    fcmTokenRequests += 1;
    const form = new URLSearchParams(String(init.body));
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload } = await jwtVerify(form.get('assertion'), await importSPKI(rsa.publicKey, 'RS256'), { issuer: 'push@honto-test.iam.gserviceaccount.com', audience: 'https://oauth2.googleapis.com/token' });
    assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(payload.exp - payload.iat, 3600);
    return Response.json({ access_token: `ya29.fake-${fcmTokenRequests}`, expires_in: 3599, token_type: 'Bearer' });
  }
  if (url === 'https://fcm.googleapis.com/v1/projects/honto-test/messages:send') {
    const sent = { authorization: init.headers.authorization, body: JSON.parse(init.body) };
    fcmRequests.push(sent);
    const { status, body } = fcmRespond(sent);
    return Response.json(body, { status });
  }
  throw new Error(`unexpected network call to ${url}`);
};
test.after(() => { globalThis.fetch = realFetch; });

const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const apnsEnv = { APNS_KEY_P8: ec.privateKey.replace(/\n/g, '\\n'), APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: '4AW8H42XNA' };
const fcmEnv = { FCM_PROJECT_ID: 'honto-test', FCM_CLIENT_EMAIL: 'push@honto-test.iam.gserviceaccount.com', FCM_PRIVATE_KEY: rsa.privateKey.replace(/\n/g, '\\n') };
const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const clearPushEnv = () => setEnv({ APNS_KEY_P8: undefined, APNS_KEY_ID: undefined, APNS_TEAM_ID: '4AW8H42XNA', APNS_BUNDLE_ID: undefined, FCM_PROJECT_ID: undefined, FCM_CLIENT_EMAIL: undefined, FCM_PRIVATE_KEY: undefined });

const hooks = module.registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'node:http2') return { url: `data:text/javascript,${encodeURIComponent('export const connect = (...a) => globalThis.__hontoHttp2.connect(...a);')}`, shortCircuit: true };
  if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
  return next(specifier, context);
} });
test.after(() => hooks.deregister());

const { PGlite } = await import('@electric-sql/pglite');
const db = new PGlite();
globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
const oldUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = 'postgres://isolated-test';
test.after(async () => { if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl; await db.close(); });
clearPushEnv();

const apns = await import('../app/push/apns.ts');
const fcm = await import('../app/push/fcm.ts');
const push = await import('../app/push/index.ts');
const { ensurePhotosSchema } = await import('../api/v1/photos-schema.ts');
const { database } = await import('../app/server-auth.ts');

test('apnsConfig / fcmConfig: null while the keys are pending', () => {
  assert.equal(apns.apnsConfig({ APNS_TEAM_ID: '4AW8H42XNA' }), null);
  assert.equal(apns.apnsConfig({ ...apnsEnv, APNS_KEY_ID: '' }), null);
  const config = apns.apnsConfig(apnsEnv);
  assert.equal(config.bundleId, 'com.hontogame.app');
  assert.match(config.keyP8, /^-----BEGIN PRIVATE KEY-----\n/, '\\n escapes become newlines');
  assert.equal(apns.apnsTopic(config, 'alert'), 'com.hontogame.app');
  assert.equal(apns.apnsTopic(config, 'widgets'), 'com.hontogame.app.push-type.widgets');
  assert.equal(fcm.fcmConfig({ FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e' }), null);
  assert.equal(fcm.fcmConfig(fcmEnv).projectId, 'honto-test');
});

test('apnsJwt: ES256 provider token (kid, iss), cached ~50 minutes', async () => {
  const config = apns.apnsConfig(apnsEnv);
  const t0 = Date.parse('2026-10-19T12:00:00Z');
  const token = await apns.apnsJwt(config, t0);
  assert.deepEqual(decodeProtectedHeader(token), { alg: 'ES256', kid: 'ABC123DEFG' });
  const { payload } = await jwtVerify(token, await importSPKI(ec.publicKey, 'ES256'), { issuer: '4AW8H42XNA', currentDate: new Date(t0) });
  assert.equal(payload.iat, t0 / 1000);
  assert.equal(await apns.apnsJwt(config, t0 + 49 * 60_000), token);
  assert.notEqual(await apns.apnsJwt(config, t0 + 51 * 60_000), token);
});

test('sendApns: per-token sandbox/production host, alert and widget topics, prunes 410 and BadDeviceToken', async () => {
  apnsRequests.length = 0;
  apnsSessions.length = 0;
  apnsRespond = ({ headers, origin }) => {
    if (headers[':path'].endsWith('/gone')) return { status: 410, body: JSON.stringify({ reason: 'Unregistered', timestamp: 1 }) };
    if (headers[':path'].endsWith('/bad')) return { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
    if (headers[':path'].endsWith('/wrongenv')) return origin === 'https://api.sandbox.push.apple.com' ? { status: 200, body: '' } : { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
    if (headers[':path'].endsWith('/topic')) return { status: 400, body: JSON.stringify({ reason: 'DeviceTokenNotForTopic' }) };
    return { status: 200, body: '' };
  };
  const config = apns.apnsConfig(apnsEnv);
  const results = await apns.sendApns([
    { token: 'ok', env: 'sandbox', pushType: 'alert', payload: { aps: { alert: 'x' } } },
    { token: 'gone', env: 'production', pushType: 'alert', payload: {} },
    { token: 'bad', env: 'production', pushType: 'widgets', payload: push.WIDGET_PAYLOAD },
    { token: 'topic', env: 'production', pushType: 'alert', payload: {} },
    { token: 'wrongenv', env: 'production', pushType: 'widgets', payload: push.WIDGET_PAYLOAD },
  ], config);
  assert.deepEqual(results, [
    { status: 200, reason: null, prune: false },
    { status: 410, reason: 'Unregistered', prune: true },
    { status: 400, reason: 'BadDeviceToken', prune: true },
    { status: 400, reason: 'DeviceTokenNotForTopic', prune: false },
    { status: 200, reason: null, prune: false, env: 'sandbox' },
  ]);
  assert.deepEqual(apnsSessions.map((s) => [s.origin, s.closed]), [['https://api.sandbox.push.apple.com', true], ['https://api.push.apple.com', true]], 'one session per host, closed after the batch');
  const ok = apnsRequests.find((r) => r.headers[':path'] === '/3/device/ok');
  assert.equal(ok.origin, 'https://api.sandbox.push.apple.com');
  assert.equal(ok.headers[':method'], 'POST');
  assert.equal(ok.headers['apns-topic'], 'com.hontogame.app');
  assert.equal(ok.headers['apns-push-type'], 'alert');
  assert.match(ok.headers.authorization, /^bearer eyJ/);
  const widget = apnsRequests.find((r) => r.headers[':path'] === '/3/device/bad');
  assert.equal(widget.headers['apns-topic'], 'com.hontogame.app.push-type.widgets');
  assert.equal(widget.headers['apns-push-type'], 'widgets');
  assert.deepEqual(widget.body, { aps: { 'content-changed': true } });
});

test('sendFcm: OAuth token from the service account (cached), high-priority data messages, prunes UNREGISTERED', async () => {
  fcmRequests.length = 0;
  fcmRespond = ({ body }) => body.message.token === 'dead'
    ? { status: 404, body: { error: { code: 404, status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } }
    : body.message.token === 'invalid' ? { status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT' } } } : { status: 200, body: { name: 'm/1' } };
  const config = fcm.fcmConfig(fcmEnv);
  const results = await fcm.sendFcm([{ token: 'live', data: { type: 'photo.new', coupleId: 'cpl_01' } }, { token: 'dead', data: {} }, { token: 'invalid', data: {} }], config);
  assert.deepEqual(results, [{ status: 200, reason: null, prune: false }, { status: 404, reason: 'UNREGISTERED', prune: true }, { status: 400, reason: 'INVALID_ARGUMENT', prune: false }]);
  assert.deepEqual(fcmRequests[0].body, { message: { token: 'live', data: { type: 'photo.new', coupleId: 'cpl_01' }, android: { priority: 'HIGH' } } });
  assert.equal(fcmRequests[0].authorization, 'Bearer ya29.fake-1');
  await fcm.sendFcm([{ token: 'live', data: {} }], config);
  assert.equal(fcmTokenRequests, 1, 'access token reused');
  assert.equal(fcmRequests.at(-1).authorization, 'Bearer ya29.fake-1');
});

test('push payloads follow the contract (PushData, APNs honto key, FCM strings)', () => {
  const now = new Date('2026-10-19T10:05:02Z');
  const fixture = JSON.parse(readFileSync(new URL('../contracts/fixtures/schema.PushData.photo_new.json', import.meta.url), 'utf8'));
  const data = push.pushData('cpl_01', { type: 'photo.new', photoId: 'ph_kenji_1019', thumbUrl: fixture.thumbUrl, fromName: 'Kenji' }, now);
  assert.deepEqual(data, fixture);
  assertContract('PushData', data);
  const alert = push.apnsAlertPayload(data);
  assert.deepEqual(alert.aps, { alert: { title: 'Kenji', body: 'Sent you a photo' }, sound: 'default', 'mutable-content': 1, 'thread-id': 'cpl_01' });
  assert.deepEqual(alert.honto, data);
  const joined = push.pushData('cpl_01', { type: 'couple.joined', fromName: 'Ana' }, now);
  assertContract('PushData', joined);
  assert.equal(push.apnsAlertPayload(joined).aps['mutable-content'], undefined);
  const reunion = push.pushData('cpl_01', { type: 'reunion.changed' }, now);
  assert.deepEqual(reunion, { type: 'reunion.changed', coupleId: 'cpl_01', sentAt: '2026-10-19T10:05:02Z' });
  assert.equal(push.apnsAlertPayload(reunion), null, 'widget push only');
  assert.deepEqual(push.fcmData({ ...data, extra: null }), { ...fixture });
  assert.ok(Object.values(push.fcmData(data)).every((v) => typeof v === 'string'));
});

test('notifyPartner: fans out to the partner devices only, prunes dead tokens, no-op without keys, never logs tokens', async () => {
  const sql = database();
  await db.exec(`CREATE TABLE players (id text PRIMARY KEY);`);
  await ensurePhotosSchema(sql);
  await db.exec(`INSERT INTO users (id, email, display_name) VALUES ('usr_ana', 'ana@example.com', 'Ana'), ('usr_kenji', 'kenji@example.com', 'Kenji');
    INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_01', false, now());
    INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_01', 'usr_ana', 'a'), ('cpl_01', 'usr_kenji', 'b');
    INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token, env, created_at) VALUES
      ('d_alert', 'usr_kenji', 'i1', 'ios', 'apns_alert', 'tok-kenji-alert-sandbox', 'sandbox', now() - interval '5 min'),
      ('d_widget', 'usr_kenji', 'i1', 'ios', 'apns_widget', 'tok-kenji-widget', 'production', now() - interval '4 min'),
      ('d_fcm', 'usr_kenji', 'i2', 'android', 'fcm', 'tok-kenji-fcm', NULL, now() - interval '3 min'),
      ('d_old', 'usr_kenji', 'i3', 'ios', 'apns_alert', 'tok-kenji-revoked', 'production', now() - interval '2 min'),
      ('d_ana', 'usr_ana', 'i9', 'ios', 'apns_alert', 'tok-ana-own', 'production', now());
    UPDATE push_devices SET revoked_at = now() WHERE id = 'd_old';`);
  const logs = [];
  const original = { info: console.info, error: console.error, log: console.log, warn: console.warn };
  for (const level of Object.keys(original)) console[level] = (...args) => logs.push(args.map(String).join(' '));
  try {
    // Keys pending: logged no-op, nothing leaves the process.
    clearPushEnv();
    apnsRequests.length = 0; fcmRequests.length = 0;
    const idle = await push.notifyPartner('cpl_01', 'usr_ana', { type: 'photo.new', photoId: 'ph_1', thumbUrl: 'https://honto-photos-kwrqb3lgl-pn.t3.storageapi.dev/t.jpg?X-Amz-Signature=x', fromName: 'Ana' });
    assert.deepEqual(idle, { devices: 3, sent: 0, failed: 0, pruned: 0, skipped: 3 });
    assert.equal(apnsRequests.length + fcmRequests.length, 0);
    assert.ok(logs.some((l) => l.includes('APNs not configured')) && logs.some((l) => l.includes('FCM not configured')));

    // photo.new: APNs alert (sandbox) + APNs widget (production) + FCM data; the widget token is dead.
    setEnv({ ...apnsEnv, ...fcmEnv });
    apnsRespond = ({ headers }) => headers[':path'].endsWith('tok-kenji-widget') ? { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) } : { status: 200, body: '' };
    fcmRespond = () => ({ status: 200, body: { name: 'm/2' } });
    const now = new Date('2026-10-19T12:00:00Z');
    const sent = await push.notifyPartner('cpl_01', 'usr_ana', { type: 'photo.new', photoId: 'ph_1', thumbUrl: 'https://honto-photos-kwrqb3lgl-pn.t3.storageapi.dev/t.jpg?X-Amz-Signature=x', fromName: 'Ana' }, { now });
    assert.deepEqual(sent, { devices: 3, sent: 2, failed: 1, pruned: 1, skipped: 0 });
    assert.deepEqual(apnsRequests.map((r) => [r.origin, r.headers[':path'], r.headers['apns-push-type']]), [
      ['https://api.sandbox.push.apple.com', '/3/device/tok-kenji-alert-sandbox', 'alert'],
      ['https://api.push.apple.com', '/3/device/tok-kenji-widget', 'widgets'],
    ]);
    const alert = apnsRequests[0].body;
    assert.equal(alert.aps['mutable-content'], 1);
    assert.deepEqual(alert.honto, { type: 'photo.new', coupleId: 'cpl_01', sentAt: '2026-10-19T12:00:00Z', photoId: 'ph_1', thumbUrl: 'https://honto-photos-kwrqb3lgl-pn.t3.storageapi.dev/t.jpg?X-Amz-Signature=x', fromName: 'Ana' });
    assertContract('PushData', alert.honto);
    assert.deepEqual(fcmRequests.at(-1).body.message, { token: 'tok-kenji-fcm', data: alert.honto, android: { priority: 'HIGH' } });
    const revoked = (await db.query("SELECT id FROM push_devices WHERE revoked_at IS NOT NULL ORDER BY id")).rows.map((r) => r.id);
    assert.deepEqual(revoked, ['d_old', 'd_widget'], 'the 410 widget token was pruned');

    // reunion.changed: widget push only on iOS (none left) + FCM data; no visible alert.
    apnsRequests.length = 0; fcmRequests.length = 0;
    await db.query("UPDATE push_devices SET revoked_at = NULL WHERE id = 'd_widget'");
    apnsRespond = () => ({ status: 200, body: '' });
    const reunion = await push.notifyPartner('cpl_01', 'usr_ana', { type: 'reunion.changed' });
    assert.deepEqual(reunion, { devices: 3, sent: 2, failed: 0, pruned: 0, skipped: 1 });
    assert.deepEqual(apnsRequests.map((r) => [r.headers[':path'], r.body]), [['/3/device/tok-kenji-widget', { aps: { 'content-changed': true } }]]);
    assert.equal(fcmRequests[0].body.message.data.type, 'reunion.changed');

    // couple.joined goes the other way (to Ana), with an alert but no mutable-content; FCM UNREGISTERED is pruned.
    apnsRequests.length = 0; fcmRequests.length = 0;
    await db.query("INSERT INTO push_devices (id, user_id, installation_id, platform, kind, token) VALUES ('d_ana_fcm', 'usr_ana', 'i8', 'android', 'fcm', 'tok-ana-fcm-dead')");
    fcmRespond = () => ({ status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } });
    const joined = await push.notifyPartner('cpl_01', 'usr_kenji', { type: 'couple.joined', fromName: 'Kenji' });
    assert.deepEqual(joined, { devices: 2, sent: 1, failed: 1, pruned: 1, skipped: 0 });
    assert.deepEqual(apnsRequests.map((r) => [r.headers[':path'], r.body.aps.alert.body, r.body.aps['mutable-content']]), [['/3/device/tok-ana-own', 'You are now paired with Kenji', undefined]]);
    assert.ok((await db.query("SELECT revoked_at FROM push_devices WHERE id = 'd_ana_fcm'")).rows[0].revoked_at);

    // A transport failure is swallowed (counted as failed, logged without tokens).
    apnsRespond = () => { throw new Error('socket hang up'); };
    const broken = await push.notifyPartner('cpl_01', 'usr_ana', { type: 'reunion.changed' });
    assert.equal(broken.sent + broken.failed, 2);
    assert.equal((await push.notifyPartner('cpl_unknown', 'usr_ana', { type: 'reunion.changed' })).devices, 0);
  } finally {
    Object.assign(console, original);
    clearPushEnv();
  }
  assert.ok(logs.length > 0);
  for (const line of logs) assert.doesNotMatch(line, /tok-|ya29|BEGIN PRIVATE KEY/, `log leaks a secret: ${line}`);
});
