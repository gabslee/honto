// /api/v1/auth/{google,apple,logout} over isolated in-memory PGlite (never Neon). ID tokens are signed with a
// local RS256 key and verified by the real jose code against a local JWKS (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const GOOGLE = 'https://accounts.google.com';
const APPLE = 'https://appleid.apple.com';

test('v1 Google / Apple sign-in relinks existing accounts; logout revokes the current token', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const keys = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_IOS_CLIENT_ID', 'GOOGLE_ANDROID_CLIENT_ID', 'APPLE_IOS_BUNDLE_ID', 'HONTO_ADMIN_EMAIL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { DATABASE_URL: 'postgres://isolated-test', GOOGLE_CLIENT_ID: 'web.apps', GOOGLE_IOS_CLIENT_ID: 'ios.apps', GOOGLE_ANDROID_CLIENT_ID: 'android.apps' });
  try {
    await db.exec(`CREATE TABLE players (id text PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`);
    const auth = await import('../app/server-auth.ts');
    const { requireUser } = await import('../api/v1/context.ts');
    const providers = await import('../api/v1/provider-login.ts');
    const google = await import('../app/api/v1/auth/google/route.ts');
    const apple = await import('../app/api/v1/auth/apple/route.ts');
    const logout = await import('../app/api/v1/auth/logout/route.ts');
    const refresh = await import('../app/api/v1/auth/refresh/route.ts');
    await auth.ensureIdentitySchema();
    // Accounts made before the app: a Premium web subscriber whose email row has mixed case (older flow), and a
    // web Google user whose subject is already linked.
    await db.query("INSERT INTO users (id, email, display_name, plan, subscription_status, subscription_expires_at, created_at) VALUES ('usr_ana', 'Ana@Example.com', 'Ana', 'premium', 'active', '2027-01-01T00:00:00Z', '2026-01-02T03:04:05Z'), ('usr_kenji', 'kenji@example.com', 'Kenji', 'free', 'inactive', NULL, '2026-02-01T00:00:00Z'), ('usr_web', 'web@example.com', 'Web', 'free', 'inactive', NULL, '2026-03-01T00:00:00Z')");
    await db.query("INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ('acc1', 'usr_web', 'google', 'g-web-sub')");

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
    providers.setProviderKeys({ google: jwks, apple: jwks });
    const sign = (claims, { iss = GOOGLE, aud = 'ios.apps', sub = 'g-sub', exp = '10m', key = privateKey } = {}) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(key);
    const post = async (handler, body, headers = {}) => {
      const response = await handler(new Request('https://hontogame.com/api/v1/auth/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, json: await response.json(), headers: response.headers };
    };
    const expectError = (res, status, code) => {
      assert.equal(res.status, status, JSON.stringify(res.json));
      assertContract('Error', res.json);
      assert.equal(res.json.code, code);
    };
    const userCount = async () => (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const links = async (userId) => (await db.query('SELECT provider, provider_account_id AS sub FROM auth_accounts WHERE user_id = $1 ORDER BY provider, provider_account_id', [userId])).rows;
    const bearer = (token) => new Request('https://x/api/v1/me', { headers: { authorization: `Bearer ${token}` } });

    let anaSession;
    await t.test('Google: an existing Premium account is relinked by verified email (case-insensitive), not duplicated', async () => {
      const before = await userCount();
      const token = await sign({ email: 'ana@example.com', email_verified: true, name: 'Ana G' }, { sub: 'g-ana' });
      const res = await post(google.POST, { idToken: token, platform: 'ios' });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assertContract('AuthSession', res.json);
      assert.deepEqual([res.json.created, res.json.user.id, res.json.user.email, res.json.user.displayName, res.json.tokenType, res.json.expiresInDays], [false, 'usr_ana', 'Ana@Example.com', 'Ana', 'Bearer', 365]);
      assert.match(res.json.token, /^hm_u_/);
      assert.match(res.json.refreshToken, /^hm_r_/);
      assert.equal(await userCount(), before, 'no duplicate account');
      assert.deepEqual(await links('usr_ana'), [{ provider: 'google', sub: 'g-ana' }]);
      const plan = (await db.query("SELECT plan, subscription_status FROM users WHERE id = 'usr_ana'")).rows[0];
      assert.deepEqual(plan, { plan: 'premium', subscription_status: 'active' }, 'Premium is kept');
      assert.equal((await requireUser(bearer(res.json.token))).user.id, 'usr_ana', 'same opaque session as the email login');
      anaSession = res.json;
      // Later the Google account's email changes: the linked subject still finds the same user.
      const moved = await post(google.POST, { idToken: await sign({ email: 'ana.new@example.com', email_verified: true }, { sub: 'g-ana', aud: 'android.apps' }), platform: 'android' });
      assert.deepEqual([moved.status, moved.json.user.id], [200, 'usr_ana']);
      assert.equal(await userCount(), before);
    });

    await t.test('Google: a subject linked by the web callback signs in to that account', async () => {
      const res = await post(google.POST, { idToken: await sign({ email: 'someone-else@example.com', email_verified: true }, { sub: 'g-web-sub', aud: 'web.apps' }), platform: 'ios' });
      assert.deepEqual([res.status, res.json.user.id, res.json.created], [200, 'usr_web', false]);
    });

    await t.test('Google: new account only when nothing matches (201)', async () => {
      const nonce = 'raw-nonce';
      const token = await sign({ email: 'New.Person@Example.com', email_verified: 'true', name: 'New Person', nonce: createHash('sha256').update(nonce).digest('hex') }, { sub: 'g-new' });
      const res = await post(google.POST, { idToken: token, nonce, platform: 'android' });
      assert.equal(res.status, 201, JSON.stringify(res.json));
      assertContract('AuthSession', res.json);
      assert.deepEqual([res.json.created, res.json.user.email, res.json.user.displayName], [true, 'new.person@example.com', 'New Person']);
      assert.deepEqual(await links(res.json.user.id), [{ provider: 'google', sub: 'g-new' }]);
      const again = await post(google.POST, { idToken: await sign({ email: 'new.person@example.com', email_verified: true }, { sub: 'g-new' }), platform: 'ios' });
      assert.deepEqual([again.status, again.json.created, again.json.user.id], [200, false, res.json.user.id]);
    });

    await t.test('Google: email_verified is required (nothing created or linked)', async () => {
      const before = await userCount();
      for (const claims of [{ email: 'kenji@example.com', email_verified: false }, { email: 'kenji@example.com' }, { email: 'stranger@example.com', email_verified: 'false' }]) {
        expectError(await post(google.POST, { idToken: await sign(claims, { sub: 'g-unverified' }), platform: 'ios' }), 400, 'email_required');
      }
      assert.equal(await userCount(), before);
      assert.deepEqual(await links('usr_kenji'), []);
    });

    await t.test('Google: JWKS signature, issuer, audience (iOS / Android / web client ids), expiry and nonce are checked', async () => {
      for (const aud of ['ios.apps', 'android.apps', 'web.apps']) {
        assert.equal((await post(google.POST, { idToken: await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana', aud }), platform: 'ios' })).status, 200, aud);
      }
      const bad = [
        await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana', aud: 'someone-elses.apps' }),
        await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana', iss: 'https://evil.example' }),
        await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana', exp: Math.floor(Date.now() / 1000) - 60 }),
        await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana', key: other.privateKey }),
        await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana', iss: APPLE, aud: 'com.hontogame.app' }),
        'not.a.jwt',
      ];
      for (const idToken of bad) expectError(await post(google.POST, { idToken, platform: 'ios' }), 401, 'invalid_token');
      const withNonce = await sign({ email: 'ana@example.com', email_verified: true, nonce: 'expected' }, { sub: 'g-ana' });
      expectError(await post(google.POST, { idToken: withNonce, nonce: 'other', platform: 'ios' }), 401, 'invalid_token');
      for (const body of [{}, { idToken: '', platform: 'ios' }, { idToken: withNonce }, { idToken: withNonce, platform: 'web' }]) expectError(await post(google.POST, body), 400, 'bad_request');
      const ids = { web: process.env.GOOGLE_CLIENT_ID, ios: process.env.GOOGLE_IOS_CLIENT_ID, android: process.env.GOOGLE_ANDROID_CLIENT_ID };
      delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_IOS_CLIENT_ID; delete process.env.GOOGLE_ANDROID_CLIENT_ID;
      expectError(await post(google.POST, { idToken: withNonce, platform: 'ios' }), 503, 'missing_config');
      Object.assign(process.env, { GOOGLE_CLIENT_ID: ids.web, GOOGLE_IOS_CLIENT_ID: ids.ios, GOOGLE_ANDROID_CLIENT_ID: ids.android });
    });

    await t.test('Apple: audience is the bundle id; relink by verified email, then by subject without email', async () => {
      const appleToken = (claims, sub = 'a-kenji', aud = 'com.hontogame.app') => sign(claims, { iss: APPLE, aud, sub });
      const before = await userCount();
      const first = await post(apple.POST, { idToken: await appleToken({ email: 'KENJI@example.com', email_verified: 'true' }), name: 'Kenji Apple', platform: 'ios' });
      assert.equal(first.status, 200, JSON.stringify(first.json));
      assertContract('AuthSession', first.json);
      assert.deepEqual([first.json.created, first.json.user.id, first.json.user.displayName], [false, 'usr_kenji', 'Kenji'], 'existing account kept as is');
      assert.deepEqual(await links('usr_kenji'), [{ provider: 'apple', sub: 'a-kenji' }]);
      // Apple sends the email only on the first sign-in.
      const later = await post(apple.POST, { idToken: await appleToken({}), platform: 'ios' });
      assert.deepEqual([later.status, later.json.user.id], [200, 'usr_kenji']);
      assert.equal(await userCount(), before);

      const relay = await post(apple.POST, { idToken: await appleToken({ email: 'x1@privaterelay.appleid.com', email_verified: true, is_private_email: true }, 'a-new'), name: 'Yuki', platform: 'ios' });
      assert.deepEqual([relay.status, relay.json.created, relay.json.user.email, relay.json.user.displayName], [201, true, 'x1@privaterelay.appleid.com', 'Yuki']);

      expectError(await post(apple.POST, { idToken: await appleToken({}, 'a-unknown'), platform: 'ios' }), 400, 'email_required');
      expectError(await post(apple.POST, { idToken: await appleToken({ email: 'ana@example.com', email_verified: 'false' }, 'a-unverified'), platform: 'ios' }), 400, 'email_required');
      assert.deepEqual(await links('usr_ana'), [{ provider: 'google', sub: 'g-ana' }], 'an unverified email never links');
      expectError(await post(apple.POST, { idToken: await appleToken({ email: 'kenji@example.com', email_verified: true }, 'a-kenji', 'com.hontogame.web'), platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(apple.POST, { idToken: await sign({ email: 'kenji@example.com', email_verified: true }, { iss: GOOGLE, aud: 'com.hontogame.app', sub: 'a-kenji' }), platform: 'ios' }), 401, 'invalid_token');
    });

    await t.test('sign-in response: isNewUser and usedPrivateRelayEmail', async () => {
      const existing = await post(google.POST, { idToken: await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana' }), platform: 'ios' });
      assert.deepEqual([existing.json.isNewUser, existing.json.usedPrivateRelayEmail], [false, false]);
      const hidden = await post(apple.POST, { idToken: await sign({ email: 'Q9z@PrivateRelay.AppleID.com', email_verified: 'true' }, { iss: APPLE, aud: 'com.hontogame.app', sub: 'a-hidden' }), name: 'Mia', platform: 'ios' });
      assert.equal(hidden.status, 201);
      assertContract('AuthSession', hidden.json);
      assert.deepEqual([hidden.json.isNewUser, hidden.json.created, hidden.json.usedPrivateRelayEmail, hidden.json.user.email], [true, true, true, 'q9z@privaterelay.appleid.com']);
      // Later Apple sign-ins carry no email: still flagged from the account email.
      const later = await post(apple.POST, { idToken: await sign({}, { iss: APPLE, aud: 'com.hontogame.app', sub: 'a-hidden' }), platform: 'ios' });
      assert.deepEqual([later.status, later.json.isNewUser, later.json.usedPrivateRelayEmail], [200, false, true]);
    });

    await t.test('identities are never moved to another user (shared findOrCreateProviderUser / linkProviderIdentity)', async () => {
      const { findOrCreateProviderUser, linkProviderIdentity } = await import('../app/mobile-auth.ts');
      // Subject linked to Ana, token now carries Kenji's verified email: still Ana, link unchanged.
      const same = await findOrCreateProviderUser({ provider: 'google', sub: 'g-ana', email: 'kenji@example.com', emailVerified: true, name: null });
      assert.deepEqual(same, { userId: 'usr_ana', created: false });
      assert.equal(await linkProviderIdentity('google', 'g-ana', 'usr_kenji'), 'usr_ana', 'DO NOTHING: the owner is reported, not replaced');
      assert.equal(await linkProviderIdentity('google', 'g-ana', 'usr_ana'), 'usr_ana');
      assert.deepEqual((await db.query("SELECT user_id FROM auth_accounts WHERE provider = 'google' AND provider_account_id = 'g-ana'")).rows, [{ user_id: 'usr_ana' }]);
      // Email match is lower(email) and only with email_verified.
      assert.deepEqual(await findOrCreateProviderUser({ provider: 'google', sub: 'g-ana-2', email: 'ANA@example.COM', emailVerified: true, name: null }), { userId: 'usr_ana', created: false });
      await assert.rejects(findOrCreateProviderUser({ provider: 'google', sub: 'g-ana-3', email: 'ana@example.com', emailVerified: false, name: null }), /email_not_verified/);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM auth_accounts WHERE provider_account_id = 'g-ana-3'")).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE lower(email) = 'ana@example.com'")).rows[0].n, 1, 'never duplicated');
    });

    await t.test('POST /api/v1/auth/link/{provider}: adds an identity to the signed-in account, 409 if taken', async () => {
      const route = await import('../app/api/v1/auth/link/[provider]/route.ts');
      const yuki = (await db.query("SELECT id FROM users WHERE email = 'x1@privaterelay.appleid.com'")).rows[0].id;
      const yukiToken = await auth.createMobileToken({ kind: 'user', userId: yuki, platform: 'ios' });
      const kenjiToken = await auth.createMobileToken({ kind: 'user', userId: 'usr_kenji', platform: 'ios' });
      const link = async (provider, body, token) => {
        const response = await route.POST(new Request(`https://hontogame.com/api/v1/auth/link/${provider}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider }) });
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return { status: response.status, json: await response.json() };
      };
      const yukiGoogle = await sign({ email: 'yuki.real@gmail.com', email_verified: true }, { sub: 'g-yuki' });
      expectError(await link('google', { idToken: yukiGoogle }), 401, 'unauthorized');
      expectError(await link('github', { idToken: yukiGoogle }, yukiToken), 404, 'not_found');
      expectError(await link('google', {}, yukiToken), 400, 'bad_request');
      expectError(await link('google', { idToken: 'not.a.jwt' }, yukiToken), 401, 'invalid_token');
      expectError(await link('apple', { idToken: yukiGoogle }, yukiToken), 401, 'invalid_token');

      const added = await link('google', { idToken: yukiGoogle }, yukiToken);
      assert.equal(added.status, 201, JSON.stringify(added.json));
      assertContract('ProviderLinkResult', added.json);
      assert.deepEqual(added.json, { provider: 'google', alreadyLinked: false, email: 'yuki.real@gmail.com', usedPrivateRelayEmail: false });
      const again = await link('google', { idToken: yukiGoogle }, yukiToken);
      assert.deepEqual([again.status, again.json.alreadyLinked], [200, true]);
      // The Apple "Hide My Email" user can now sign in with Google and lands on the same account.
      const viaGoogle = await post(google.POST, { idToken: yukiGoogle, platform: 'android' });
      assert.deepEqual([viaGoogle.status, viaGoogle.json.user.id, viaGoogle.json.usedPrivateRelayEmail], [200, yuki, true]);

      // Someone else's identity: 409, and nothing moves.
      const anaGoogle = await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana' });
      const taken = await link('google', { idToken: anaGoogle }, kenjiToken);
      expectError(taken, 409, 'identity_in_use');
      assert.deepEqual((await db.query("SELECT user_id FROM auth_accounts WHERE provider_account_id = 'g-ana'")).rows, [{ user_id: 'usr_ana' }]);
      expectError(await link('apple', { idToken: await sign({}, { iss: APPLE, aud: 'com.hontogame.app', sub: 'a-hidden' }) }, kenjiToken), 409, 'identity_in_use');
      const relayLink = await link('apple', { idToken: await sign({ email: 'k2@privaterelay.appleid.com', email_verified: true }, { iss: APPLE, aud: 'com.hontogame.app', sub: 'a-kenji-2' }) }, kenjiToken);
      assert.deepEqual([relayLink.status, relayLink.json.usedPrivateRelayEmail], [201, true]);

      const saved = process.env.GOOGLE_CLIENT_ID;
      const ios = process.env.GOOGLE_IOS_CLIENT_ID;
      const android = process.env.GOOGLE_ANDROID_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_IOS_CLIENT_ID; delete process.env.GOOGLE_ANDROID_CLIENT_ID;
      expectError(await link('google', { idToken: yukiGoogle }, yukiToken), 503, 'missing_config');
      Object.assign(process.env, { GOOGLE_CLIENT_ID: saved, GOOGLE_IOS_CLIENT_ID: ios, GOOGLE_ANDROID_CLIENT_ID: android });
    });

    await t.test('web callbacks: subject first, lower(email) next, never move an identity', async () => {
      const googleCallback = await import('../app/api/auth/google/callback/route.ts');
      const appleCallback = await import('../app/api/auth/apple/callback/route.ts');
      const env = { GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET, APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID, APPLE_TEAM_ID: process.env.APPLE_TEAM_ID, APPLE_KEY_ID: process.env.APPLE_KEY_ID, APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY };
      const { exportPKCS8, generateKeyPair: es } = await import('jose');
      const appleSigning = await es('ES256', { extractable: true });
      Object.assign(process.env, { GOOGLE_CLIENT_SECRET: 'secret', APPLE_CLIENT_ID: 'com.hontogame.web', APPLE_TEAM_ID: 'TEAM', APPLE_KEY_ID: 'KEY', APPLE_PRIVATE_KEY: await exportPKCS8(appleSigning.privateKey) });
      const realFetch = globalThis.fetch;
      let googleProfile; let appleIdToken;
      const publicJwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'at' });
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(googleProfile);
        if (url === 'https://appleid.apple.com/auth/token') return Response.json({ id_token: appleIdToken });
        if (url === 'https://appleid.apple.com/auth/keys') return Response.json({ keys: [publicJwk] });
        throw new Error(`unexpected fetch ${url}`);
      };
      const sessionUser = async (response) => {
        const cookie = response.headers.getSetCookie().find((c) => c.startsWith('honto_session=') && !c.startsWith('honto_session=;'));
        assert.ok(cookie, `signed in (${response.headers.get('location')})`);
        return (await requireUser(new Request('https://x', { headers: { cookie: cookie.split(';')[0] } }))).user.id;
      };
      const viaGoogle = async (profile) => {
        googleProfile = profile;
        return googleCallback.GET(new Request('https://hontogame.com/api/auth/callback/google?code=c&state=s1', { headers: { cookie: 'honto_google_state=s1; honto_google_return=%2Fapp' } }));
      };
      const viaApple = async (claims, sub) => {
        appleIdToken = await sign({ ...claims, nonce: 'n1' }, { iss: APPLE, aud: 'com.hontogame.web', sub });
        return appleCallback.POST(new Request('https://hontogame.com/api/auth/apple/callback', { method: 'POST', headers: { cookie: 'honto_apple_state=s2; honto_apple_nonce=n1; honto_apple_return=%2Fapp', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: 'c', state: 's2' }) }));
      };
      try {
        const before = await userCount();
        // Linked subject whose Google email is now Kenji's: signs in Ana, the link is not moved to Kenji.
        assert.equal(await sessionUser(await viaGoogle({ sub: 'g-ana', email: 'kenji@example.com', email_verified: true, name: 'Ana' })), 'usr_ana');
        assert.deepEqual((await db.query("SELECT user_id FROM auth_accounts WHERE provider_account_id = 'g-ana'")).rows, [{ user_id: 'usr_ana' }]);
        // New subject, mixed-case stored email ('Ana@Example.com'): relinked to Ana, no duplicate user.
        assert.equal(await sessionUser(await viaGoogle({ sub: 'g-ana-web', email: 'ana@example.com', email_verified: true, name: 'Ana' })), 'usr_ana');
        assert.equal(await userCount(), before);
        const unverified = await viaGoogle({ sub: 'g-nope', email: 'nope@example.com', email_verified: false });
        assert.match(unverified.headers.get('location'), /error/);

        // Apple web: linked subject without email in the token (returning user) signs in Kenji.
        assert.equal(await sessionUser(await viaApple({}, 'a-kenji')), 'usr_kenji');
        // Linked subject with Ana's verified email: still Kenji, nothing moved.
        assert.equal(await sessionUser(await viaApple({ email: 'ana@example.com', email_verified: 'true' }, 'a-kenji')), 'usr_kenji');
        assert.deepEqual((await db.query("SELECT user_id FROM auth_accounts WHERE provider = 'apple' AND provider_account_id = 'a-kenji'")).rows, [{ user_id: 'usr_kenji' }]);
        // Unknown subject without a verified email is refused.
        assert.match((await viaApple({ email: 'web@example.com', email_verified: 'false' }, 'a-unknown-web')).headers.get('location'), /error/);
        assert.equal(await userCount(), before);
      } finally {
        globalThis.fetch = realFetch;
        for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    });

    await t.test('logout: revokes the current bearer token and its refresh chain only', async () => {
      const second = await post(google.POST, { idToken: await sign({ email: 'ana@example.com', email_verified: true }, { sub: 'g-ana' }), platform: 'android' });
      const res = await post(logout.POST, {}, { authorization: `Bearer ${anaSession.token}` });
      assert.equal(res.status, 200);
      assertContract('LogoutResponse', res.json);
      assert.deepEqual(res.json, { revoked: true });
      assert.equal((await requireUser(bearer(anaSession.token))).status, 401, 'token revoked');
      expectError(await post(refresh.POST, { refreshToken: anaSession.refreshToken, platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(logout.POST, {}, { authorization: `Bearer ${anaSession.token}` }), 401, 'unauthorized');
      // The other device keeps its session and can still refresh.
      assert.equal((await requireUser(bearer(second.json.token))).user.id, 'usr_ana');
      assert.equal((await post(refresh.POST, { refreshToken: second.json.refreshToken, platform: 'android' })).status, 200);
      expectError(await post(logout.POST, {}), 401, 'unauthorized');
    });

    await t.test('logout: web cookie session is deleted and the cookie cleared', async () => {
      const session = await auth.createUserSession('usr_ana');
      const cookie = { cookie: `theme=dark; honto_session=${session}` };
      assert.equal((await requireUser(new Request('https://x', { headers: cookie }))).user.id, 'usr_ana');
      const res = await post(logout.POST, {}, cookie);
      assert.deepEqual([res.status, res.json.revoked], [200, true]);
      assert.match(res.headers.get('set-cookie'), /^honto_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
      assert.equal((await requireUser(new Request('https://x', { headers: cookie }))).status, 401);
    });
  } finally {
    hooks.deregister();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await db.close();
  }
});
