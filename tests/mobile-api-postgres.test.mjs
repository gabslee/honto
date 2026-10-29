// End-to-end mobile API over isolated PGlite: bearer tokens, partner device token, photo moments.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

test('mobile auth tokens, account-free partner device token and photo moments', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((t, p, i) => t + (i ? `$${i}` : '') + p, ''), values)).rows;
  globalThis.__blobPuts = [];
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier === '@vercel/blob') return { url: 'data:text/javascript,export async function put(p,b,o){globalThis.__blobPuts.push({p,o,size:b.length});return{url:"https://blob.test/"+p,pathname:p}}', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
      const ext = /(?:game-contract|multiplayer-service)$/.test(specifier) ? '.js' : '.ts';
      return next(new URL(specifier + ext, context.parentURL).href, context);
    }
    return next(specifier, context);
  } });
  const env = { DATABASE_URL: process.env.DATABASE_URL, BLOB: process.env.BLOB_READ_WRITE_TOKEN };
  process.env.DATABASE_URL = 'postgres://isolated-test';
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  try {
    const { default: game } = await import('../server/game.ts');
    const auth = await import('../app/server-auth.ts');
    const { findOrCreateProviderUser } = await import('../app/mobile-auth.ts');
    const mobile = await import('../app/api/mobile/[...path]/route.ts');
    const partnerRoute = await import('../app/api/mobile/auth/partner/route.ts');
    const logout = await import('../app/api/mobile/auth/logout/route.ts');
    // Make sure base tables exist (rooms/players) before the identity schema alters players.
    await game({ method: 'POST', body: { action: 'create', name: 'Seed' }, query: {}, headers: new Headers() }, { setHeader() {}, status() { return this; }, json(v) { return v; } });
    await auth.ensureIdentitySchema();

    // Same user as the web login: an existing web user (by email) is matched, then the provider sub is linked.
    await db.query("INSERT INTO users (id, email, display_name) VALUES ('web-ana', 'ana@example.com', 'Ana')");
    const g = await findOrCreateProviderUser({ provider: 'google', sub: 'g-1', email: 'ana@example.com', emailVerified: true, name: 'Ana' });
    assert.deepEqual(g, { userId: 'web-ana', created: false });
    const a = await findOrCreateProviderUser({ provider: 'apple', sub: 'a-1', email: 'ana@example.com', emailVerified: true, name: null });
    assert.equal(a.userId, 'web-ana');
    // Apple sends no email after the first sign-in: matched by sub.
    assert.equal((await findOrCreateProviderUser({ provider: 'apple', sub: 'a-1', email: null, emailVerified: false, name: null })).userId, 'web-ana');
    await assert.rejects(findOrCreateProviderUser({ provider: 'apple', sub: 'a-2', email: null, emailVerified: false, name: null }), /email_not_verified/);
    const fresh = await findOrCreateProviderUser({ provider: 'google', sub: 'g-2', email: 'new@example.com', emailVerified: true, name: 'New' });
    assert.equal(fresh.created, true);

    // Bearer token: random, stored hashed, accepted like the cookie.
    const hostToken = await auth.createMobileToken({ kind: 'user', userId: 'web-ana', platform: 'ios' });
    assert.match(hostToken, /^hm_u_[A-Za-z0-9_-]{40,}$/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM mobile_tokens WHERE token_hash = $1', [hostToken])).rows[0].n, 0, 'never stored in clear');
    const bearer = (t) => ({ authorization: `Bearer ${t}` });
    assert.equal((await auth.getCurrentUser(new Request('https://x', { headers: bearer(hostToken) }))).id, 'web-ana');

    // Host creates a room (as the app would, with the bearer token).
    let created;
    await game({ method: 'POST', body: { action: 'create', name: 'Ana' }, query: {}, headers: new Headers(bearer(hostToken)) }, { setHeader() {}, status() { return this; }, json(v) { created = v; return v; } });
    const call = async (method, path, { token, body, form } = {}) => {
      const init = { method, headers: token ? bearer(token) : {} };
      if (body) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
      if (form) init.body = form;
      const r = await mobile[method](new Request(`https://x/api/mobile/${path}`, init), { params: Promise.resolve({ path: path.split('?')[0].split('/') }) });
      return { status: r.status, json: await r.json() };
    };
    // Partner without account joins by invite code and gets a device token.
    const join = await partnerRoute.POST(new Request('https://x/api/mobile/auth/partner', { method: 'POST', body: JSON.stringify({ code: created.code, name: 'Ben' }) }));
    const partner = await join.json();
    assert.equal(join.status, 201); assert.match(partner.token, /^hm_d_/); assert.ok(partner.partnerKey);
    // Rejoining the same room with the same device reuses the seat.
    const again = await (await partnerRoute.POST(new Request('https://x', { method: 'POST', headers: bearer(partner.token), body: JSON.stringify({ code: created.code, name: 'Ben' }) }))).json();
    assert.equal(again.room.token, partner.room.token); assert.equal(again.reusedToken, true);

    // Both sides call without code/token: resolved from the bearer token.
    const hostDaily = await call('GET', 'daily?timeZone=UTC', { token: hostToken });
    assert.equal(hostDaily.status, 200); assert.ok(hostDaily.json.daily.coupleId);
    assert.ok(!hostDaily.json.daily.coupleId.startsWith('room:'), 'stable couple: host account + partner device key');
    const partnerHistory = await call('GET', 'history', { token: partner.token });
    assert.equal(partnerHistory.json.history.coupleId, hostDaily.json.daily.coupleId);

    // Photo upload: validated, stored in Blob, linked to the couple.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const form = () => { const f = new FormData(); f.set('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'p.jpg'); f.set('phraseKey', 'aitai'); return f; };
    const up = await call('POST', 'moments/photo', { token: partner.token, form: form() });
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal(up.json.photo.phrase, '会いたい'); assert.equal(up.json.photo.romaji, 'aitai'); assert.equal(up.json.photo.mine, true);
    assert.match(globalThis.__blobPuts[0].p, /^moments\/[A-Za-z0-9_-]+\/[0-9a-f-]+\.jpg$/); assert.equal(globalThis.__blobPuts[0].o.contentType, 'image/jpeg');
    const fake = new FormData(); fake.set('photo', new Blob([new TextEncoder().encode('<svg/>')], { type: 'image/jpeg' })); fake.set('phrase', 'hi');
    assert.equal((await call('POST', 'moments/photo', { token: partner.token, form: fake })).status, 415);
    const big = new FormData(); big.set('photo', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])); big.set('phrase', 'hi');
    assert.equal((await call('POST', 'moments/photo', { token: partner.token, form: big })).status, 413);
    const noPhrase = new FormData(); noPhrase.set('photo', new Blob([jpeg]));
    assert.equal((await call('POST', 'moments/photo', { token: partner.token, form: noPhrase })).status, 400);
    // Photo moments cannot be faked through the JSON game endpoint.
    let direct;
    await game({ method: 'POST', body: { action: 'photoUpload', code: created.code, token: created.token, url: 'https://evil' }, query: {}, headers: new Headers() }, { setHeader() {}, status(s) { direct = s; return this; }, json(v) { return v; } });
    assert.ok(direct >= 400);

    // Widget: the host sees the partner's latest photo; the partner sees none from the host yet.
    const latest = await call('GET', 'moments/latest', { token: hostToken });
    assert.equal(latest.json.photo.author, 'Ben'); assert.equal(latest.json.photo.mine, false);
    assert.equal((await call('GET', 'moments/latest', { token: partner.token })).json.photo, null);
    // History includes the photo.
    const history = await call('GET', 'history', { token: hostToken });
    assert.equal(history.json.history.photos.length, 1); assert.equal(history.json.history.photos[0].url.startsWith('https://blob.test/'), true);

    // Revocable.
    await logout.POST(new Request('https://x', { method: 'POST', headers: bearer(hostToken) }));
    assert.equal(await auth.getCurrentUser(new Request('https://x', { headers: bearer(hostToken) })), null);
    assert.equal((await call('GET', 'history', { token: hostToken })).status, 401);
    // No credentials at all.
    assert.equal((await call('GET', 'daily')).status, 401);
  } finally {
    hooks.deregister();
    process.env.DATABASE_URL = env.DATABASE_URL; if (env.BLOB === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = env.BLOB;
  }
});
