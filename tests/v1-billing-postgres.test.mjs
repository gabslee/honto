// RevenueCat webhook -> entitlements over isolated in-memory PGlite (never Neon, no network).
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

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const SECRET = 'rc-test-shared-value';

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
const oldSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
process.env.DATABASE_URL = 'postgres://isolated-test';
test.after(async () => {
  hooks.deregister();
  delete globalThis.__hontoTestSql;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  if (oldSecret === undefined) delete process.env.REVENUECAT_WEBHOOK_SECRET; else process.env.REVENUECAT_WEBHOOK_SECRET = oldSecret;
  await db.close();
});

/**
 * RevenueCat sample payloads ("Webhook event types and fields" / "Sample webhook events"), with Honto's
 * products: honto_premium_monthly (US$4.99) and honto_premium_annual (US$29.99), 7-day trial.
 */
let sequence = 0;
function sample(type, fields = {}) {
  sequence += 1;
  const now = Date.now();
  const base = {
    id: `EVT-${String(sequence).padStart(4, '0')}-${type}`,
    type,
    app_id: 'app1a2b3c4d5',
    app_user_id: 'usr_ana',
    original_app_user_id: 'usr_ana',
    aliases: ['$RCAnonymousID:8b3a1f4d5c6e4b7a9c0d1e2f3a4b5c6d', 'usr_ana'],
    commission_percentage: 0.15,
    country_code: 'BR',
    currency: 'USD',
    entitlement_id: null,
    entitlement_ids: ['premium'],
    environment: 'PRODUCTION',
    event_timestamp_ms: now,
    expiration_at_ms: now + 30 * DAY,
    is_family_share: false,
    offer_code: null,
    original_transaction_id: '2000000712345678',
    period_type: 'NORMAL',
    presented_offering_id: 'default',
    price: 4.99,
    price_in_purchased_currency: 4.99,
    product_id: 'honto_premium_monthly',
    purchased_at_ms: now,
    store: 'APP_STORE',
    subscriber_attributes: { $email: { updated_at_ms: now, value: 'ana@example.com' } },
    takehome_percentage: 0.85,
    tax_percentage: 0.1,
    transaction_id: `20000007${String(sequence).padStart(8, '0')}`,
  };
  return { api_version: '1.0', event: { ...base, ...fields } };
}

test('POST /api/v1/billing/revenuecat and hasActiveEntitlement', async (t) => {
  await db.exec(baseTables);
  const auth = await import('../app/server-auth.ts');
  const { ensureFoundationSchema } = await import('../api/v1/foundation-schema.ts');
  const { isCouplePremium } = await import('../api/v1/context.ts');
  const { ensureEntitlementsSchema, hasActiveEntitlement, REVENUECAT_EVENT_TYPES } = await import('../app/entitlements.ts');
  const webhook = await import('../app/api/v1/billing/revenuecat/route.ts');
  const sql = auth.database();
  await ensureFoundationSchema(sql);
  await ensureEntitlementsSchema(sql);
  await db.query("INSERT INTO users (id, email, display_name) VALUES ('usr_ana', 'ana@example.com', 'Ana'), ('usr_kenji', 'kenji@example.com', 'Kenji'), ('usr_zoe', 'zoe@example.com', 'Zoe')");
  await db.query("INSERT INTO couples (id, legacy, paired_at) VALUES ('cpl_01', false, now())");
  await db.query("INSERT INTO couple_members (couple_id, user_id, role) VALUES ('cpl_01', 'usr_ana', 'a'), ('cpl_01', 'usr_kenji', 'b')");

  const post = async (body, authorization = SECRET) => {
    const headers = { 'content-type': 'application/json' };
    if (authorization !== null) headers.authorization = authorization;
    const response = await webhook.POST(new Request('https://x/api/v1/billing/revenuecat', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, json: await response.json() };
  };
  const ok = async (body) => {
    if (typeof body === 'object') assertContract('RevenueCatWebhook', body);
    const result = await post(body);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assertContract('WebhookAck', result.json);
    assert.deepEqual(result.json, fixture('revenueCatWebhook.200'));
  };
  const row = async (userId = 'usr_ana') => (await db.query("SELECT product_id, period_type, store, environment, expires_at, will_renew, had_trial FROM entitlements WHERE user_id = $1 AND source = 'revenuecat'", [userId])).rows[0] ?? null;
  const events = async () => (await db.query('SELECT count(*)::int AS n FROM revenuecat_events')).rows[0].n;
  const expectError = (result, status, code) => {
    assert.equal(result.status, status);
    assertContract('Error', result.json);
    assert.equal(result.json.code, code);
  };

  await t.test('auth: with REVENUECAT_WEBHOOK_SECRET unset every request is 401', async () => {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    expectError(await post(fixture('revenueCatWebhook.request'), ''), 401, 'unauthorized');
    expectError(await post(fixture('revenueCatWebhook.request'), SECRET), 401, 'unauthorized');
    expectError(await post(fixture('revenueCatWebhook.request'), null), 401, 'unauthorized');
    process.env.REVENUECAT_WEBHOOK_SECRET = '';
    expectError(await post(fixture('revenueCatWebhook.request'), ''), 401, 'unauthorized');
  });

  await t.test('auth: the Authorization header must equal the secret exactly', async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    for (const header of [null, '', 'nope', `Bearer ${SECRET}`, `${SECRET}x`, SECRET.slice(1), SECRET.toUpperCase()]) {
      expectError(await post(fixture('revenueCatWebhook.request'), header), 401, 'unauthorized');
    }
    assert.equal(await events(), 0, 'nothing recorded without auth');
  });

  await t.test('400 for bodies that are not RevenueCat events', async () => {
    for (const body of ['not json', {}, { api_version: '1.0' }, { event: { type: 'RENEWAL', app_user_id: 'usr_ana' } }, { event: { id: 'x', app_user_id: 'usr_ana' } }, { event: { id: 'x', type: 'RENEWAL' } }, { event: { id: 'x'.repeat(201), type: 'RENEWAL', app_user_id: 'usr_ana' } }]) {
      expectError(await post(body), 400, 'bad_request');
    }
  });

  await t.test('the contract fixture (INITIAL_PURCHASE, trial) for a known user', async () => {
    const body = fixture('revenueCatWebhook.request');
    body.event.expiration_at_ms = Date.now() + 7 * DAY;
    await ok(body);
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), true);
    assert.equal((await row()).product_id, 'honto_premium_annual');
    await db.query('DELETE FROM entitlements');
  });

  const purchase = sample('INITIAL_PURCHASE', { period_type: 'TRIAL', price: 0, price_in_purchased_currency: 0, expiration_at_ms: Date.now() + 7 * DAY, event_timestamp_ms: Date.now() - 10 * MIN });

  await t.test('INITIAL_PURCHASE (7-day trial) grants Premium to the couple', async () => {
    assert.equal(await isCouplePremium(sql, 'cpl_01'), false);
    await ok(purchase);
    const r = await row();
    assert.equal(r.product_id, 'honto_premium_monthly');
    assert.deepEqual([r.period_type, r.store, r.environment, r.will_renew, r.had_trial], ['trial', 'APP_STORE', 'PRODUCTION', true, true]);
    assert.equal(r.expires_at.getTime(), purchase.event.expiration_at_ms);
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), true);
    assert.equal(await hasActiveEntitlement(sql, 'usr_kenji'), false);
    assert.equal(await isCouplePremium(sql, 'cpl_01'), true, 'Premium is per couple');
    // Stripe columns are untouched.
    assert.deepEqual((await db.query("SELECT plan, subscription_status FROM users WHERE id = 'usr_ana'")).rows[0], { plan: 'free', subscription_status: 'inactive' });
  });

  await t.test('idempotent by event.id: a redelivery is acknowledged and not applied again', async () => {
    const recorded = await events();
    await db.query("UPDATE entitlements SET will_renew = false WHERE user_id = 'usr_ana'");
    await ok(purchase);
    await ok(purchase);
    assert.equal(await events(), recorded);
    assert.equal((await row()).will_renew, false, 'the duplicate did not touch the row');
    await db.query("UPDATE entitlements SET will_renew = true WHERE user_id = 'usr_ana'");
    const stored = (await db.query('SELECT type, app_user_id, payload FROM revenuecat_events WHERE id = $1', [purchase.event.id])).rows[0];
    assert.deepEqual([stored.type, stored.app_user_id, stored.payload.event.transaction_id], ['INITIAL_PURCHASE', 'usr_ana', purchase.event.transaction_id]);
  });

  await t.test('RENEWAL: trial converts, expiry moves forward', async () => {
    const renewal = sample('RENEWAL', { expiration_at_ms: Date.now() + 30 * DAY, event_timestamp_ms: Date.now() - 9 * MIN, renewal_number: 2 });
    await ok(renewal);
    const r = await row();
    assert.deepEqual([r.period_type, r.will_renew, r.had_trial], ['normal', true, true]);
    assert.ok(r.expires_at.getTime() > Date.now() + 29 * DAY);
  });

  await t.test('CANCELLATION: auto-renew off, access kept until expiration', async () => {
    await ok(sample('CANCELLATION', { cancel_reason: 'UNSUBSCRIBE', expiration_at_ms: Date.now() + 30 * DAY, event_timestamp_ms: Date.now() - 8 * MIN }));
    assert.equal((await row()).will_renew, false);
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), true);
  });

  await t.test('UNCANCELLATION: auto-renew back on', async () => {
    await ok(sample('UNCANCELLATION', { event_timestamp_ms: Date.now() - 7 * MIN }));
    assert.equal((await row()).will_renew, true);
  });

  await t.test('PRODUCT_CHANGE: still active, keeps the expiry when RevenueCat sends none', async () => {
    const before = (await row()).expires_at.getTime();
    await ok(sample('PRODUCT_CHANGE', { new_product_id: 'honto_premium_annual', expiration_at_ms: null, event_timestamp_ms: Date.now() - 6 * MIN }));
    const r = await row();
    assert.equal(r.expires_at.getTime(), before);
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), true);
  });

  await t.test('BILLING_ISSUE: access lasts until the grace period end RevenueCat reports', async () => {
    const graceEnd = Date.now() + 6 * DAY;
    await ok(sample('BILLING_ISSUE', { grace_period_expiration_at_ms: graceEnd, expiration_at_ms: graceEnd, event_timestamp_ms: Date.now() - 5 * MIN }));
    const r = await row();
    assert.equal(r.will_renew, true, 'unchanged: the store keeps retrying');
    assert.ok(Math.abs(r.expires_at.getTime() - graceEnd) < 1000);
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), true);
  });

  await t.test('EXPIRATION: Premium ends; an older event arriving late does not bring it back', async () => {
    const expiredAt = Date.now() - 4 * MIN;
    await ok(sample('EXPIRATION', { expiration_reason: 'BILLING_ERROR', expiration_at_ms: expiredAt, event_timestamp_ms: expiredAt }));
    const r = await row();
    assert.equal(r.will_renew, false);
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), false);
    assert.equal(await isCouplePremium(sql, 'cpl_01'), false);
    assert.equal(r.had_trial, true, 'the trial is remembered');
    // A RENEWAL from before the expiration delivered late (RevenueCat retries) is recorded and ignored.
    await ok(sample('RENEWAL', { expiration_at_ms: Date.now() + 30 * DAY, event_timestamp_ms: expiredAt - MIN }));
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), false);
    // A real resubscription later turns it back on.
    await ok(sample('RENEWAL', { product_id: 'honto_premium_annual', price: 29.99, price_in_purchased_currency: 29.99, expiration_at_ms: Date.now() + 365 * DAY, event_timestamp_ms: Date.now() - 3 * MIN }));
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), true);
    assert.equal((await row()).product_id, 'honto_premium_annual');
  });

  await t.test('TRANSFER: the purchase moves to the new Honto user', async () => {
    const transfer = sample('TRANSFER', { transferred_from: ['usr_ana', '$RCAnonymousID:0f1e2d3c4b5a69788796a5b4c3d2e1f0'], transferred_to: ['usr_kenji'], event_timestamp_ms: Date.now() - 2 * MIN });
    for (const key of ['app_user_id', 'original_app_user_id', 'aliases', 'product_id', 'entitlement_ids', 'period_type', 'expiration_at_ms', 'purchased_at_ms', 'price', 'price_in_purchased_currency', 'transaction_id', 'original_transaction_id', 'subscriber_attributes']) delete transfer.event[key];
    await ok(transfer);
    assert.equal(await row('usr_ana'), null);
    assert.equal(await hasActiveEntitlement(sql, 'usr_ana'), false);
    assert.equal(await hasActiveEntitlement(sql, 'usr_kenji'), true);
    assert.equal((await row('usr_kenji')).product_id, 'honto_premium_annual');
    assert.equal(await isCouplePremium(sql, 'cpl_01'), true, 'still Premium: Kenji pays now');
    assert.equal((await db.query('SELECT app_user_id FROM revenuecat_events WHERE id = $1', [transfer.event.id])).rows[0].app_user_id, 'usr_kenji');
    // Transfer to an unknown (anonymous) user: the old owner loses it.
    const lost = sample('TRANSFER', { transferred_from: ['usr_kenji'], transferred_to: ['$RCAnonymousID:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], event_timestamp_ms: Date.now() - MIN });
    delete lost.event.app_user_id;
    await ok(lost);
    assert.equal(await hasActiveEntitlement(sql, 'usr_kenji'), false);
  });

  await t.test('every handled type is covered, and unknown types are acknowledged and ignored', async () => {
    assert.deepEqual([...REVENUECAT_EVENT_TYPES].sort(), ['BILLING_ISSUE', 'CANCELLATION', 'EXPIRATION', 'INITIAL_PURCHASE', 'PRODUCT_CHANGE', 'RENEWAL', 'TRANSFER', 'UNCANCELLATION']);
    const handled = (await db.query('SELECT DISTINCT type FROM revenuecat_events ORDER BY type')).rows.map((r) => r.type);
    for (const type of REVENUECAT_EVENT_TYPES) assert.ok(handled.includes(type), type);
    const before = (await db.query('SELECT * FROM entitlements ORDER BY user_id')).rows;
    for (const type of ['TEST', 'SUBSCRIPTION_PAUSED', 'NON_RENEWING_PURCHASE', 'SUBSCRIBER_ALIAS']) await ok(sample(type, { app_user_id: 'usr_zoe' }));
    assert.deepEqual((await db.query('SELECT * FROM entitlements ORDER BY user_id')).rows, before);
  });

  await t.test('unknown users and other entitlements are acknowledged without granting anything', async () => {
    await ok(sample('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:1234', original_app_user_id: '$RCAnonymousID:1234', aliases: ['$RCAnonymousID:1234'] }));
    await ok(sample('INITIAL_PURCHASE', { app_user_id: 'usr_deleted', original_app_user_id: 'usr_deleted', aliases: [] }));
    await ok(sample('INITIAL_PURCHASE', { app_user_id: 'usr_zoe', entitlement_ids: ['something_else'] }));
    assert.equal(await hasActiveEntitlement(sql, 'usr_zoe'), false);
    // An anonymous app_user_id aliased to a Honto user (purchase before logIn) goes to that user.
    await ok(sample('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:5678', original_app_user_id: '$RCAnonymousID:5678', aliases: ['$RCAnonymousID:5678', 'usr_zoe'], environment: 'SANDBOX', store: 'PLAY_STORE' }));
    assert.equal(await hasActiveEntitlement(sql, 'usr_zoe'), true);
    assert.deepEqual([(await row('usr_zoe')).environment, (await row('usr_zoe')).store], ['SANDBOX', 'PLAY_STORE']);
    // A non-subscription purchase without expiry never expires.
    await ok(sample('INITIAL_PURCHASE', { app_user_id: 'usr_kenji', original_app_user_id: 'usr_kenji', aliases: [], expiration_at_ms: null, product_id: 'honto_lifetime' }));
    assert.equal((await row('usr_kenji')).expires_at, null);
    assert.equal(await hasActiveEntitlement(sql, 'usr_kenji'), true);
  });

  await t.test('schema: ensureEntitlementsSchema is idempotent', async () => {
    await ensureEntitlementsSchema(sql);
    const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'entitlements' ORDER BY column_name")).rows.map((r) => r.column_name);
    assert.deepEqual(columns, ['entitlement', 'environment', 'expires_at', 'had_trial', 'last_event_at', 'period_type', 'product_id', 'source', 'store', 'updated_at', 'user_id', 'will_renew']);
  });
});
