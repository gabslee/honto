// Admin complimentary Premium over isolated in-memory PGlite (never Neon).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

test('POST /api/admin grantPremium: admin-only entitlement row, counted for the couple, revocable', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://isolated-test';
  try {
    await db.exec(`CREATE TABLE players (id text PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`);
    const auth = await import('../app/server-auth.ts');
    const admin = await import('../app/api/admin/route.ts');
    const { resolveEntitlement } = await import('../api/v1/couple.ts');
    await auth.ensureIdentitySchema();
    await db.query("INSERT INTO users (id, email, display_name) VALUES ('usr_maya', 'maya@example.com', 'Maya'), ('usr_leo', 'leo@example.com', 'Leo')");
    const session = await auth.createAdminSession('owner@example.com', 'Owner');
    const post = async (body, cookie) => {
      const response = await admin.POST(new Request('https://hontogame.com/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
      return { status: response.status, json: await response.json() };
    };
    const cookie = `${auth.adminCookieName()}=${session.token}`;

    assert.equal((await post({ action: 'grantPremium', userId: 'usr_maya', expiresAt: null })).status, 401, 'admin only');
    assert.equal((await post({ action: 'grantPremium', userId: 'usr_maya', expiresAt: 'soon' }, cookie)).status, 400);
    assert.equal((await post({ action: 'grantPremium', userId: 'usr_nobody', expiresAt: null }, cookie)).status, 404);
    const ok = await post({ action: 'grantPremium', userId: 'usr_maya', expiresAt: '2027-01-31T00:00:00Z' }, cookie);
    assert.deepEqual(ok, { status: 200, json: { ok: true, userId: 'usr_maya', expiresAt: '2027-01-31T00:00:00Z' } });
    const sql = auth.database();
    const forLeo = await resolveEntitlement(sql, 'usr_leo', 'usr_maya');
    assert.deepEqual([forLeo.premium, forLeo.source, forLeo.grantedBy, forLeo.expiresAt], [true, 'admin', 'partner', '2027-01-31T00:00:00Z'], 'the partner is Premium too');
    assert.equal((await resolveEntitlement(sql, 'usr_maya', 'usr_leo')).grantedBy, 'me');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE id = 'usr_maya' AND plan = 'free'")).rows[0].n, 1, 'no Stripe plan change');
    await post({ action: 'grantPremium', userId: 'usr_maya', expiresAt: null }, cookie);
    assert.equal((await resolveEntitlement(sql, 'usr_maya', 'usr_leo')).expiresAt, null, 'upsert');
    assert.deepEqual(await post({ action: 'grantPremium', userId: 'usr_maya', revoke: true }, cookie), { status: 200, json: { ok: true, revoked: true } });
    assert.equal((await resolveEntitlement(sql, 'usr_leo', 'usr_maya')).premium, false);
  } finally {
    hooks.deregister();
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
    await db.close();
  }
});
