// W0 API contracts: spec structure, generated artifacts in sync, fixtures valid, mock server + TS client.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { loadSpec, operations, resolveRef } from '../contracts/scripts/spec.mjs';
import { validate, schemaRef } from '../contracts/scripts/validate-schema.mjs';
import { validateFixtures } from '../contracts/scripts/validate-fixtures.mjs';
import { buildAll } from '../contracts/scripts/generate.mjs';
import { createMockServer, handle } from '../contracts/mock/server.mjs';

const spec = loadSpec();
const ops = operations(spec);

test('spec: every operation has a unique operationId, tags, a 2xx and an error response', () => {
  const ids = ops.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const op of ops) {
    assert.ok(op.tags.length, `${op.id} tags`);
    assert.ok(op.successStatuses.length, `${op.id} 2xx`);
    if (op.security.length) assert.ok('401' in op.responses, `${op.id} must document 401`);
  }
});

test('spec: every $ref resolves', () => {
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') resolveRef(spec, node.$ref);
    Object.values(node).forEach(walk);
  };
  walk(spec);
});

test('spec: decisions from Gabriel are reflected', () => {
  const paths = Object.keys(spec.paths);
  for (const p of ['/api/v1/auth/email/start', '/api/v1/auth/apple', '/api/v1/auth/google', '/api/v1/couple/join', '/api/v1/today', '/api/v1/photos', '/api/v1/calendar/busy', '/api/v1/calendar/shares', '/api/v1/devices', '/api/v1/live-activity/tokens', '/api/v1/nudges', '/api/v1/billing/revenuecat', '/api/v1/me/export', '/api/cron/trips', '/api/cron/retention']) assert.ok(paths.includes(p), p);
  assert.ok(!paths.some((p) => p.startsWith('/api/mobile')), '/api/mobile stays frozen and out of the v1 contract');
  assert.deepEqual(spec.components.schemas.DeviceKind.enum, ['fcm', 'apns_alert', 'apns_widget']);
  assert.deepEqual(spec.components.schemas.PhotoContentType.enum, ['image/jpeg', 'image/webp']);
  assert.match(spec.paths['/api/v1/couple'].delete.description, /30 days/);
  assert.match(spec.paths['/api/v1/calendar/busy'].put.description, /All-day events never count as busy/);
  assert.ok(spec.components.schemas.Features.required.includes('nudge'));
});

test('generated TS/Dart/widget schema are up to date with openapi.yaml', () => {
  for (const [rel, content] of Object.entries(buildAll())) {
    assert.equal(readFileSync(new URL(`../contracts/${rel}`, import.meta.url), 'utf8'), content, `contracts/${rel} is stale: run npm run contracts:generate`);
  }
});

test('fixtures validate against the spec and cover every operation', () => {
  const { files, problems } = validateFixtures();
  assert.deepEqual(problems, []);
  assert.ok(files >= ops.length);
});

test('validator rejects wrong shapes (sanity)', () => {
  const photo = JSON.parse(readFileSync(new URL('../contracts/fixtures/completePhoto.200.json', import.meta.url), 'utf8'));
  assert.deepEqual(validate(spec, schemaRef('Photo'), photo), []);
  assert.ok(validate(spec, schemaRef('Photo'), { ...photo, status: 'uploaded' }).length);
  assert.ok(validate(spec, schemaRef('Photo'), { ...photo, localDay: '19/10/2026' }).length);
  assert.ok(validate(spec, schemaRef('Photo'), { ...photo, extra: 1 }).length);
  const { urls, ...noUrls } = photo; void urls;
  assert.ok(validate(spec, schemaRef('Photo'), noUrls).length);
});

test('widget snapshot JSON Schema is standalone (no OpenAPI refs)', () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/widget-snapshot.v1.json', import.meta.url), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(!JSON.stringify(schema).includes('"$ref":"#/components/'));
  assert.ok(schema.$defs.WidgetSnapshotPartner && schema.$defs.PartnerStatus);
  for (const name of ['schema.WidgetSnapshot', 'schema.WidgetSnapshot.unpaired']) {
    const sample = JSON.parse(readFileSync(new URL(`../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(validate(schema, schema, sample), [], name);
  }
  assert.ok(validate(schema, schema, { version: 1 }).length);
});

test('mock server: defaults, variants, auth and request validation', () => {
  const auth = { authorization: 'Bearer hm_u_test' };
  assert.equal(handle('GET', '/api/v1/today', {}, '').status, 401);
  const today = handle('GET', '/api/v1/today', auth, '');
  assert.equal(today.status, 200);
  assert.equal(today.fixture, 'getToday.200');
  assert.equal(handle('GET', '/api/v1/today', { ...auth, 'x-honto-fixture': '200.free_no_photos' }, '').body.entitlement.premium, false);
  assert.equal(handle('POST', '/api/v1/couple/join', { ...auth, 'x-honto-fixture': '410' }, '{"code":"K7Q2XM"}').body.code, 'code_expired');
  assert.equal(handle('POST', '/api/v1/couple/join', auth, '{"kode":"x"}').status, 400);
  assert.equal(handle('DELETE', '/api/v1/photos/ph_1', auth, '').status, 204);
  assert.equal(handle('GET', '/api/v1/memories', auth, '').status, 400);
  assert.equal(handle('GET', '/api/v1/memories?month=2026-10', auth, '').status, 200);
  assert.equal(handle('POST', '/api/v1/auth/email/start', {}, '{"email":"a@b.co","platform":"web"}').status, 202);
  assert.equal(handle('GET', '/api/v1/nope', auth, '').status, 404);
});

test('TS client talks to the mock server', async () => {
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const server = createMockServer();
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { createHontoClient, HontoApiError } = await import('../contracts/honto-client.ts');
    const api = createHontoClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'hm_u_test' });
    const today = await api('getToday');
    assert.equal(today.partner.displayName, 'Kenji');
    const day = await api('getMemoryDay', { pathParams: { day: '2026-10-19' } });
    assert.equal(day.photos.length, 3);
    assert.equal(await api('deleteTrip', { pathParams: { tripId: 'trp_01' } }), undefined);
    await assert.rejects(api('sendNudge', { body: { source: 'app' }, headers: { 'x-honto-fixture': '429' } }), (e) => e instanceof HontoApiError && e.status === 429 && e.code === 'rate_limited');
  } finally {
    server.close();
    hooks.deregister();
  }
});
