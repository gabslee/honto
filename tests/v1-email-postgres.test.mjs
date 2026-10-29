// W1b email magic link over isolated in-memory PGlite (never Neon); Resend is a stubbed fetch (no network).
// Also checks the universal link / App Link files the magic link and /j/ pairing links rely on.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { loadSpec } from '../contracts/scripts/spec.mjs';
import { schemaRef, validate } from '../contracts/scripts/validate-schema.mjs';

const spec = loadSpec();
const assertContract = (schema, value) => assert.deepEqual(validate(spec, schemaRef(schema), value), [], `${schema}: ${JSON.stringify(value)}`);
const EMOJI = /(?![0-9#*©®™])\p{Emoji}|\u{FE0F}|\u{200D}/u;
const baseTables = `CREATE TABLE players (id text PRIMARY KEY);
  CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`;

test('email magic link: start, verify by link or code, single use, expiry, limits', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const keys = ['DATABASE_URL', 'VERCEL_ENV', 'RESEND_API_KEY', 'EMAIL_FROM', 'HONTO_ADMIN_EMAIL', 'HONTO_REVIEW_EMAILS', 'HONTO_REVIEW_CODE'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.DATABASE_URL = 'postgres://isolated-test';
  const realFetch = globalThis.fetch;
  const realInfo = console.info;
  const logged = [];
  console.info = (...args) => { logged.push(args.join(' ')); };
  globalThis.fetch = async (url) => { throw new Error(`unexpected network call to ${url}`); };
  try {
    await db.exec(baseTables);
    const auth = await import('../app/server-auth.ts');
    const { requireUser } = await import('../server/v1/context.ts');
    const email = await import('../server/v1/email-login.ts');
    const start = await import('../app/api/v1/auth/email/start/route.ts');
    const verify = await import('../app/api/v1/auth/email/verify/route.ts');
    const refresh = await import('../app/api/v1/auth/refresh/route.ts');
    await auth.ensureIdentitySchema();
    await (await import('../server/v1/lifecycle.ts')).ensureLifecycleSchema(auth.database());
    await db.query("INSERT INTO users (id, email, display_name, created_at) VALUES ('usr_ana', 'ana@example.com', 'Ana', '2026-10-01T13:20:00Z')");

    let ip = 1;
    const post = async (handler, body, headers = {}) => {
      const response = await handler(new Request('https://preview-honto.vercel.app/api/v1/auth/email/x', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${ip}, 10.0.0.1`, ...headers }, body: JSON.stringify(body) }));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, json: await response.json(), headers: response.headers };
    };
    const expectError = (res, status, code) => {
      assert.equal(res.status, status, JSON.stringify(res.json));
      assertContract('Error', res.json);
      assert.equal(res.json.code, code);
    };
    const lastLog = () => {
      const line = logged.at(-1) ?? '';
      return { token: decodeURIComponent(line.match(/token=([^\s]+)/)?.[1] ?? ''), code: line.match(/code (\d{6})/)?.[1], line };
    };
    // Fills the current and the next fixed window of a limiter, so the next call is limited even if the
    // clock crosses a window boundary mid-test (looping up to the limit would flake at :00 / :15 / ...).
    const fillWindows = (scope, subject, hits, seconds) => db.query(`INSERT INTO v1_rate_limits (scope, subject, window_start, hits)
      SELECT $1, $2, to_timestamp(floor(extract(epoch FROM now()) / $3::int) * $3::int) + k * make_interval(secs => $3::int), $4::int FROM generate_series(0, 1) k
      ON CONFLICT (scope, subject, window_start) DO UPDATE SET hits = EXCLUDED.hits`, [scope, subject, seconds, hits]);
    const { saltedHash } = await import('../server/v1/lifecycle.ts');
    const ipSubject = () => saltedHash('ip', `203.0.113.${ip}`);
    const tokenRows = async () => (await db.query('SELECT count(*)::int AS n FROM email_login_tokens')).rows[0].n;

    await t.test('start: validation', async () => {
      for (const body of [{}, { email: 'nope', platform: 'ios' }, { email: `${'a'.repeat(250)}@x.io`, platform: 'ios' }, { email: 'ana@example.com', platform: 'windows' }, { email: 'ana@example.com' }]) {
        expectError(await post(start.POST, body), 400, 'bad_request');
      }
    });

    await t.test('start in Production without RESEND_API_KEY: 503 email_unavailable, nothing logged or stored', async () => {
      process.env.VERCEL_ENV = 'production';
      const before = logged.length;
      const res = await post(start.POST, { email: 'ana@example.com', platform: 'ios' });
      expectError(res, 503, 'email_unavailable');
      assert.deepEqual(res.json, { error: res.json.error, code: 'email_unavailable' });
      assert.equal(logged.length, before);
      assert.equal(await tokenRows(), 0);
      process.env.VERCEL_ENV = 'preview';
    });

    let anaLink;
    await t.test('start in Preview without RESEND_API_KEY: console sender logs the link and the code', async () => {
      const res = await post(start.POST, { email: '  Ana@Example.com ', platform: 'ios', locale: 'en' });
      assert.equal(res.status, 202);
      assertContract('EmailStartResponse', res.json);
      assert.deepEqual(res.json, { sent: true, expiresInSeconds: 900, resendAfterSeconds: 60 });
      anaLink = lastLog();
      assert.match(anaLink.line, /ana@example\.com: https:\/\/preview-honto\.vercel\.app\/auth\/email\?token=ml_/, 'Preview links point at the preview itself');
      assert.match(anaLink.code, /^\d{6}$/);
      const row = (await db.query('SELECT email, platform, token_hash, code_hash, extract(epoch FROM expires_at - created_at)::int AS ttl FROM email_login_tokens')).rows[0];
      assert.deepEqual([row.email, row.platform, row.ttl], ['ana@example.com', 'ios', 900]);
      assert.ok(!row.token_hash.includes(anaLink.token) && row.code_hash !== anaLink.code, 'stored hashed');
      assert.match(row.token_hash, /^[0-9a-f]{64}$/);
    });

    await t.test('start: one email per address per minute, 5 per hour, 20 per IP per hour', async () => {
      const again = await post(start.POST, { email: 'ana@example.com', platform: 'ios' });
      expectError(again, 429, 'rate_limited');
      assert.ok(again.json.retryAfterSeconds > 0 && again.json.retryAfterSeconds <= 60);
      assert.equal(again.headers.get('retry-after'), String(again.json.retryAfterSeconds));
      await db.query("INSERT INTO email_login_tokens (token_hash, email, code_hash, platform, expires_at, used_at, created_at) SELECT 'h' || g, 'busy@example.com', 'c', 'ios', now(), now(), now() - interval '50 minutes' + g * interval '1 minute' FROM generate_series(1, 5) g");
      const hourly = await post(start.POST, { email: 'busy@example.com', platform: 'ios' });
      expectError(hourly, 429, 'rate_limited');
      assert.ok(hourly.json.retryAfterSeconds > 500, 'waits until the oldest of the hour drops out');
      ip = 77;
      for (let i = 0; i < 3; i++) assert.equal((await post(start.POST, { email: `ip${i}@example.com`, platform: 'web' })).status, 202);
      await fillWindows('email_start_ip', await ipSubject(), 20, 3600);
      expectError(await post(start.POST, { email: 'ip-last@example.com', platform: 'web' }), 429, 'rate_limited');
      const raw = (await db.query("SELECT subject FROM v1_rate_limits WHERE scope = 'email_start_ip'")).rows.map((r) => r.subject);
      assert.ok(raw.every((subject) => /^[0-9a-f]{64}$/.test(subject)), 'IPs are stored hashed');
      ip = 2;
    });

    await t.test('verify by link: existing account, hm_u_ token, single use', async () => {
      const res = await post(verify.POST, { token: anaLink.token, platform: 'ios' });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assertContract('AuthSession', res.json);
      assert.match(res.json.refreshToken, /^hm_r_/);
      assert.deepEqual({ ...res.json, token: 'x', refreshToken: 'r' }, { token: 'x', refreshToken: 'r', refreshExpiresInDays: 365, tokenType: 'Bearer', expiresInDays: 365, created: false, user: { id: 'usr_ana', email: 'ana@example.com', displayName: 'Ana', timeZone: null, createdAt: '2026-10-01T13:20:00Z' } });
      assert.match(res.json.token, /^hm_u_/);
      const me = await requireUser(new Request('https://x/api/v1/me', { headers: { authorization: `Bearer ${res.json.token}` } }));
      assert.equal(me.user.id, 'usr_ana');
      expectError(await post(verify.POST, { token: anaLink.token, platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(verify.POST, { email: 'ana@example.com', code: anaLink.code, platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(verify.POST, { token: 'ml_made_up', platform: 'ios' }), 401, 'invalid_token');
    });

    await t.test('verify by email + code: new account (201) with the verified email', async () => {
      await db.query('DELETE FROM email_login_tokens');
      assert.equal((await post(start.POST, { email: 'kenji@example.com', platform: 'android' })).status, 202);
      const { code } = lastLog();
      expectError(await post(verify.POST, { email: 'kenji@example.com', platform: 'android' }), 400, 'bad_request');
      expectError(await post(verify.POST, { email: 'kenji@example.com', code: '12345', platform: 'android' }), 400, 'bad_request');
      const res = await post(verify.POST, { email: 'Kenji@example.com', code: `${code.slice(0, 3)} ${code.slice(3)}`, platform: 'android', name: 'Kenji' });
      assert.equal(res.status, 201, JSON.stringify(res.json));
      assertContract('AuthSession', res.json);
      assert.deepEqual([res.json.created, res.json.user.email, res.json.user.displayName], [true, 'kenji@example.com', 'Kenji']);
      const tokenRow = (await db.query("SELECT kind, platform FROM mobile_tokens WHERE user_id = $1", [res.json.user.id])).rows[0];
      assert.deepEqual(tokenRow, { kind: 'user', platform: 'android' });
      // Second sign-in with the same email finds the same account.
      await db.query('DELETE FROM email_login_tokens');
      await post(start.POST, { email: 'kenji@example.com', platform: 'ios' });
      const again = await post(verify.POST, { token: lastLog().token, platform: 'ios' });
      assert.deepEqual([again.status, again.json.created, again.json.user.id], [200, false, res.json.user.id]);
    });

    await t.test('verify: 5 wrong codes lock the code and the link; expired tokens fail', async () => {
      await db.query('DELETE FROM email_login_tokens');
      await post(start.POST, { email: 'zoe@example.com', platform: 'ios' });
      const { code, token } = lastLog();
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expectError(await post(verify.POST, { email: 'zoe@example.com', code: wrong, platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(verify.POST, { email: 'zoe@example.com', code, platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(verify.POST, { token, platform: 'ios' }), 401, 'invalid_token');

      await db.query('DELETE FROM email_login_tokens');
      await post(start.POST, { email: 'zoe@example.com', platform: 'ios' });
      const fresh = lastLog();
      await db.query("UPDATE email_login_tokens SET expires_at = now() - interval '1 second'");
      expectError(await post(verify.POST, { token: fresh.token, platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(verify.POST, { email: 'zoe@example.com', code: fresh.code, platform: 'ios' }), 401, 'invalid_token');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE email = 'zoe@example.com'")).rows[0].n, 0, 'no account without a valid token');
    });

    await t.test('verify: platform web sets the honto_session cookie and returns token null', async () => {
      await db.query('DELETE FROM email_login_tokens');
      await post(start.POST, { email: 'ana@example.com', platform: 'web' });
      const res = await post(verify.POST, { token: lastLog().token, platform: 'web' });
      assert.equal(res.status, 200);
      assertContract('AuthSession', res.json);
      assert.deepEqual([res.json.token, res.json.expiresInDays], [null, 30]);
      const cookie = res.headers.get('set-cookie');
      assert.match(cookie, /^honto_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
      const session = await requireUser(new Request('https://x/api/v1/me', { headers: { cookie: cookie.split(';')[0] } }));
      assert.equal(session.user.id, 'usr_ana');
    });

    await t.test('verify: 30 calls per IP per 15 minutes', async () => {
      ip = 99;
      for (let i = 0; i < 3; i++) expectError(await post(verify.POST, { token: `ml_guess_${i}`, platform: 'ios' }), 401, 'invalid_token');
      await fillWindows('email_verify_ip', await ipSubject(), 30, 900);
      expectError(await post(verify.POST, { token: 'ml_guess_last', platform: 'ios' }), 429, 'rate_limited');
      ip = 3;
    });

    await t.test('App Review demo login: allowlisted address + fixed code, no email, limited tries', async () => {
      ip = 120;
      await db.query('DELETE FROM email_login_tokens');
      const reviewer = 'review-a@hontogame.com';
      // Off unless both variables are set (and the code is 6 digits).
      assert.equal(email.reviewLogin(reviewer, { HONTO_REVIEW_EMAILS: reviewer }), null);
      assert.equal(email.reviewLogin(reviewer, { HONTO_REVIEW_CODE: '424242' }), null);
      assert.equal(email.reviewLogin(reviewer, { HONTO_REVIEW_EMAILS: reviewer, HONTO_REVIEW_CODE: '4242' }), null);
      assert.equal(email.reviewLogin('ana@example.com', { HONTO_REVIEW_EMAILS: reviewer, HONTO_REVIEW_CODE: '424242' }), null);
      assert.deepEqual(email.reviewLogin(reviewer, { HONTO_REVIEW_EMAILS: ` Review-A@hontogame.com , review-b@hontogame.com`, HONTO_REVIEW_CODE: '424242' }), { code: '424242' });
      expectError(await post(verify.POST, { email: reviewer, code: '424242', platform: 'ios' }), 401, 'invalid_token');

      process.env.HONTO_REVIEW_EMAILS = 'review-a@hontogame.com,review-b@hontogame.com';
      process.env.HONTO_REVIEW_CODE = '424242';
      try {
        const before = logged.length;
        const started = await post(start.POST, { email: 'Review-A@hontogame.com', platform: 'ios' });
        assert.equal(started.status, 202);
        assert.deepEqual(started.json, { sent: true, expiresInSeconds: 900, resendAfterSeconds: 60 });
        assert.equal(logged.length, before, 'no email is sent for a review address');
        assert.equal(await tokenRows(), 0, 'no token is stored for a review address');
        expectError(await post(verify.POST, { email: reviewer, code: '111111', platform: 'ios' }), 401, 'invalid_token');
        const ok = await post(verify.POST, { email: 'Review-A@hontogame.com', code: '424 242', platform: 'ios', name: 'Alex' });
        assert.equal(ok.status, 201, JSON.stringify(ok.json));
        assertContract('AuthSession', ok.json);
        assert.deepEqual([ok.json.created, ok.json.user.email, ok.json.user.displayName], [true, reviewer, 'Alex']);
        assert.match(ok.json.token, /^hm_u_/);
        assert.match(ok.json.refreshToken, /^hm_r_/);
        const again = await post(verify.POST, { email: reviewer, code: '424242', platform: 'ios' });
        assert.deepEqual([again.status, again.json.user.id], [200, ok.json.user.id], 'the code is reusable for the review account');
        // The fixed code never works for anyone else.
        expectError(await post(verify.POST, { email: 'ana@example.com', code: '424242', platform: 'ios' }), 401, 'invalid_token');
        // 10 tries per address per hour.
        await fillWindows('review_code', await saltedHash('email', reviewer), 10, 3600);
        expectError(await post(verify.POST, { email: reviewer, code: '424242', platform: 'ios' }), 429, 'rate_limited');
        // Normal addresses still get a real email.
        assert.equal((await post(start.POST, { email: 'mia@example.com', platform: 'ios' })).status, 202);
        assert.match(lastLog().line, /mia@example\.com/);
      } finally {
        delete process.env.HONTO_REVIEW_EMAILS;
        delete process.env.HONTO_REVIEW_CODE;
        ip = 5;
      }
    });

    let firstSession;
    await t.test('refresh: verify issues a single-use hm_r_ token to the apps, never to the web', async () => {
      await db.exec('DELETE FROM email_login_tokens; DELETE FROM v1_refresh_tokens');
      await post(start.POST, { email: 'ana@example.com', platform: 'ios' });
      const session = await post(verify.POST, { token: lastLog().token, platform: 'ios' });
      assert.match(session.json.refreshToken, /^hm_r_[\w-]{43}$/);
      assert.equal(session.json.refreshExpiresInDays, 365);
      const stored = (await db.query('SELECT token_hash, user_id, platform, extract(day FROM expires_at - created_at)::int AS days FROM v1_refresh_tokens')).rows;
      assert.deepEqual(stored.map((r) => [r.user_id, r.platform, r.days]), [['usr_ana', 'ios', 365]]);
      assert.ok(!stored[0].token_hash.includes(session.json.refreshToken.slice(5)), 'stored hashed');
      await db.query('DELETE FROM email_login_tokens');
      await post(start.POST, { email: 'ana@example.com', platform: 'web' });
      const web = await post(verify.POST, { token: lastLog().token, platform: 'web' });
      assert.deepEqual([web.json.refreshToken, web.json.refreshExpiresInDays], [null, null]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM v1_refresh_tokens')).rows[0].n, 1);
      firstSession = session.json;
    });

    await t.test('refresh: rotation, old access token revoked, reuse ends the chain', async () => {
      const bearer = (token) => new Request('https://x/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
      const rotated = await post(refresh.POST, { refreshToken: firstSession.refreshToken, platform: 'ios' }, { authorization: `Bearer ${firstSession.token}` });
      assert.equal(rotated.status, 200, JSON.stringify(rotated.json));
      assertContract('AuthSession', rotated.json);
      assert.deepEqual([rotated.json.created, rotated.json.user.id, rotated.json.tokenType, rotated.json.expiresInDays, rotated.json.refreshExpiresInDays], [false, 'usr_ana', 'Bearer', 365, 365]);
      assert.notEqual(rotated.json.token, firstSession.token);
      assert.notEqual(rotated.json.refreshToken, firstSession.refreshToken);
      assert.equal((await requireUser(bearer(rotated.json.token))).user.id, 'usr_ana');
      assert.equal((await requireUser(bearer(firstSession.token))).status, 401, 'the old access token is revoked');

      // A retry with the same token right away (two requests raced) fails without ending the chain.
      expectError(await post(refresh.POST, { refreshToken: firstSession.refreshToken, platform: 'ios' }), 401, 'invalid_token');
      const second = await post(refresh.POST, { refreshToken: rotated.json.refreshToken, platform: 'ios' });
      assert.equal(second.status, 200);
      // Reuse later (token copied): every token of the chain is revoked, including the newest one.
      await db.query("UPDATE v1_refresh_tokens SET used_at = used_at - interval '1 minute' WHERE used_at IS NOT NULL");
      expectError(await post(refresh.POST, { refreshToken: firstSession.refreshToken, platform: 'ios' }), 401, 'invalid_token');
      expectError(await post(refresh.POST, { refreshToken: second.json.refreshToken, platform: 'ios' }), 401, 'invalid_token');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM v1_refresh_tokens WHERE revoked_at IS NULL')).rows[0].n, 0);
      assert.equal((await requireUser(bearer(second.json.token))).user.id, 'usr_ana', 'access tokens already issued keep working until they expire or log out');
    });

    await t.test('refresh: validation, expiry, other chains untouched, per-IP limit, retention', async () => {
      for (const body of [{}, { refreshToken: 'hm_u_wrong_kind', platform: 'ios' }, { refreshToken: 'hm_r_x', platform: 'web' }, { refreshToken: `hm_r_${'x'.repeat(200)}`, platform: 'ios' }]) {
        expectError(await post(refresh.POST, body), 400, 'bad_request');
      }
      expectError(await post(refresh.POST, { refreshToken: 'hm_r_unknown', platform: 'android' }), 401, 'invalid_token');
      const { issueRefreshToken } = await import('../server/v1/refresh-tokens.ts');
      const sql = auth.database();
      const other = await issueRefreshToken(sql, 'usr_ana', 'android');
      const expired = await issueRefreshToken(sql, 'usr_ana', 'android');
      await db.query("UPDATE v1_refresh_tokens SET expires_at = now() - interval '1 second' WHERE family_id = (SELECT family_id FROM v1_refresh_tokens ORDER BY created_at DESC LIMIT 1)");
      expectError(await post(refresh.POST, { refreshToken: expired, platform: 'android' }), 401, 'invalid_token');
      const ok = await post(refresh.POST, { refreshToken: other, platform: 'android' });
      assert.equal(ok.status, 200, 'an expired chain does not affect another sign-in');
      const { runRetention } = await import('../server/v1/lifecycle.ts');
      const before = (await db.query('SELECT count(*)::int AS n FROM v1_refresh_tokens')).rows[0].n;
      await runRetention(sql, null);
      const after = (await db.query('SELECT count(*)::int AS n FROM v1_refresh_tokens')).rows[0].n;
      assert.equal(before - after, 1, 'expired refresh tokens are purged');
      ip = 150;
      for (let i = 0; i < 3; i++) expectError(await post(refresh.POST, { refreshToken: `hm_r_guess${i}`, platform: 'ios' }), 401, 'invalid_token');
      await fillWindows('refresh_ip', await ipSubject(), 30, 900);
      expectError(await post(refresh.POST, { refreshToken: 'hm_r_guess_last', platform: 'ios' }), 429, 'rate_limited');
      ip = 4;
    });

    await t.test('Resend: plain fetch to api.resend.com (stubbed), short English email, no emoji', async () => {
      process.env.RESEND_API_KEY = 're_test_key';
      process.env.EMAIL_FROM = 'Honto <hello@hontogame.com>';
      process.env.VERCEL_ENV = 'production';
      const calls = [];
      globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }); };
      const before = logged.length;
      await db.query('DELETE FROM email_login_tokens');
      const res = await post(start.POST, { email: 'ana@example.com', platform: 'ios' });
      assert.equal(res.status, 202);
      assert.equal(logged.length, before, 'Production never logs tokens');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.resend.com/emails');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_key');
      const sent = JSON.parse(calls[0].init.body);
      assert.deepEqual([sent.from, sent.to], ['Honto <hello@hontogame.com>', ['ana@example.com']]);
      const link = sent.text.match(/https:\/\/hontogame\.com\/auth\/email\?token=(ml_[\w-]+)/);
      assert.ok(link, 'Production links always use hontogame.com (universal links)');
      const code = sent.text.match(/code in the app: (\d{6})/)[1];
      assert.ok(sent.subject.includes(code) && sent.html.includes(code) && sent.html.includes(link[0]));
      for (const part of [sent.subject, sent.text, sent.html]) assert.doesNotMatch(part, EMOJI);
      assert.match(sent.html, /Inter/);
      assert.doesNotMatch(sent.html, /Fraunces/i);
      assert.ok(sent.text.split('\n').length <= 10, 'short');
      const ok = await post(verify.POST, { token: decodeURIComponent(link[1]), platform: 'ios' });
      assert.equal(ok.status, 200);

      // Resend failure: 503 email_unavailable and the token is burned.
      globalThis.fetch = async () => new Response('{"message":"domain not verified"}', { status: 403 });
      await db.query('DELETE FROM email_login_tokens');
      expectError(await post(start.POST, { email: 'ana@example.com', platform: 'ios' }), 503, 'email_unavailable');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM email_login_tokens WHERE used_at IS NULL')).rows[0].n, 0);
    });

    await t.test('EmailSender selection', () => {
      assert.equal(email.emailSenderFromEnv({ VERCEL_ENV: 'production' }), null);
      assert.equal(email.emailSenderFromEnv({ VERCEL_ENV: 'production', RESEND_API_KEY: 'k' }).name, 'resend');
      assert.equal(email.emailSenderFromEnv({ VERCEL_ENV: 'preview' }).name, 'console');
      assert.equal(email.emailSenderFromEnv({}).name, 'console');
      assert.equal(email.normalizeEmail(' A@B.co '), 'a@b.co');
      assert.equal(email.normalizeEmail('a b@c.d'), null);
      const codes = new Set(Array.from({ length: 200 }, () => email.newSignInCode()));
      assert.ok([...codes].every((code) => /^\d{6}$/.test(code)) && codes.size > 190);
    });
  } finally {
    hooks.deregister();
    globalThis.fetch = realFetch;
    console.info = realInfo;
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await db.close();
  }
});

test('universal links (AASA) and Android App Links', async () => {
  const aasa = await import('../app/.well-known/apple-app-site-association/route.ts');
  const response = aasa.GET();
  // Apple fetches https://hontogame.com/.well-known/apple-app-site-association: no extension, JSON, no redirect.
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(aasa.dynamic, 'force-static');
  assert.ok(existsSync(new URL('../app/.well-known/apple-app-site-association/route.ts', import.meta.url)), 'route segment has no extension');
  const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /trailingSlash|redirects\(/, 'nothing redirects the well-known path');
  const body = await response.json();
  assert.deepEqual(body.applinks.details[0].appIDs, ['4AW8H42XNA.com.hontogame.app']);
  assert.deepEqual(body.applinks.details[0].components.map((c) => c['/']), ['/auth/email*', '/j/*']);

  const saved = process.env.ANDROID_CERT_SHA256;
  try {
    const links = await import('../app/.well-known/assetlinks.json/route.ts');
    delete process.env.ANDROID_CERT_SHA256;
    assert.deepEqual(await links.GET().json(), []);
    process.env.ANDROID_CERT_SHA256 = 'aa:bb:cc, DD:EE:FF';
    assert.deepEqual(await links.GET().json(), [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.hontogame.app', sha256_cert_fingerprints: ['AA:BB:CC', 'DD:EE:FF'] } }]);
  } finally {
    if (saved === undefined) delete process.env.ANDROID_CERT_SHA256; else process.env.ANDROID_CERT_SHA256 = saved;
  }
});
