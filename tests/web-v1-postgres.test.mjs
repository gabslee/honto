// End-to-end API flows for daily card, date mode and couple history on an isolated in-memory PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

test('daily card, no-drinking mode and couple history over the real API SQL', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => {
    const query = parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
    return (await db.query(query, values)).rows;
  };
  const hooks = module.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
      if (specifier.endsWith('/server-auth')) return { url: 'data:text/javascript,export async function getCurrentUser(r){const id=r.headers.get("x-test-user");return id?{id,role:"user",plan:id.startsWith("premium")?"premium":"free"}:null}export function hasPremiumAccess(u){return u?.plan==="premium"}export function database(){return globalThis.__hontoTestSql}export async function ensureIdentitySchema(){}', shortCircuit: true };
      if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
        const ext = /(?:game-contract|multiplayer-service)$/.test(specifier) ? '.js' : '.ts';
        return next(new URL(specifier + ext, context.parentURL).href, context);
      }
      return next(specifier, context);
    },
  });
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://isolated-test';
  try {
    const { default: handler } = await import('../api/game.ts');
    await db.query("CREATE TABLE users (id text PRIMARY KEY, display_name text, role text DEFAULT 'user', plan text DEFAULT 'free', subscription_status text, subscription_expires_at timestamptz, trial_ends_at timestamptz)");
    await db.query("INSERT INTO users (id, display_name, plan) VALUES ('free-host', 'Free Host', 'free'), ('premium-host', 'Premium Host', 'premium')");
    async function api(body, user = null) {
      let status; let result;
      const req = { method: 'POST', body, query: body, headers: user ? { 'x-test-user': user } : {} };
      const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { result = value; return value; } };
      await handler(req, res); return { status, ...result };
    }
    // Free couple: host with an account, partner joins by link with no account.
    const host = await api({ action: 'create', name: 'Ana' }, 'free-host');
    assert.equal(host.status, 201);
    const partnerKey = 'pk-ben-browser-0000000000000001';
    const partner = await api({ action: 'join', code: host.code, name: 'Ben' });
    assert.ok(partner.token);
    const asHost = (action, extra = {}) => api({ action, code: host.code, token: host.token, timeZone: 'America/Sao_Paulo', ...extra }, 'free-host');
    const asPartner = (action, extra = {}) => api({ action, code: host.code, token: partner.token, partnerKey, timeZone: 'Asia/Tokyo', ...extra });

    // State fetch links the host's account to the room player.
    await api({ code: host.code, token: host.token }, 'free-host');
    let daily = (await asHost('daily')).daily;
    assert.equal(daily.limit, 1);
    assert.equal(daily.premium, false);
    const card = daily.cards.find((c) => c.day === daily.today);
    assert.ok(card.text.en && card.text.ja && card.text['pt-BR']);
    assert.ok(!['spicy', 'spicyLdr'].includes(card.deck));
    assert.equal((await asHost('dailyAnswer', { day: card.day, slot: 2, answer: 'x' })).status, 400, 'free limit is 1/day');
    assert.equal((await asHost('dailyConfirmAdult', { confirm18: true })).status, 400, 'free couples cannot unlock adult cards');

    daily = (await asHost('dailyAnswer', { day: card.day, slot: 1, answer: 'Host answer' })).daily;
    const mine = daily.cards.find((c) => c.day === card.day && c.slot === 1);
    assert.equal(mine.myAnswer, 'Host answer');
    assert.equal(mine.revealed, false);
    // Partner (different time zone) sees the same shared card for that day; answer stays hidden.
    let pd = (await asPartner('daily')).daily;
    let shared = pd.cards.find((c) => c.day === card.day && c.slot === 1);
    assert.ok(shared, 'partner can still answer the host-day card');
    assert.equal(shared.text.en, card.text.en);
    assert.equal(shared.partnerAnswered, true);
    assert.equal(shared.partnerAnswer, null);
    pd = (await asPartner('dailyAnswer', { day: card.day, slot: 1, answer: 'Partner answer' })).daily;
    shared = pd.cards.find((c) => c.day === card.day && c.slot === 1);
    assert.equal(shared.revealed, true);
    assert.equal(shared.partnerAnswer, 'Host answer');
    // Answers are final.
    await asHost('dailyAnswer', { day: card.day, slot: 1, answer: 'Changed' });
    const after = (await asPartner('daily')).daily.cards.find((c) => c.day === card.day && c.slot === 1);
    assert.equal(after.partnerAnswer, 'Host answer');

    // No-drinking date mode is selectable in the lobby and persisted.
    const configured = await asHost('configure', { drinkMode: 'date' });
    assert.equal(configured.room.drinkMode, 'date');
    assert.equal((await asPartner('configure', { drinkMode: 'sips' })).status, 400, 'only the host changes settings');
    assert.equal((await api({ code: host.code, token: partner.token })).room.drinkMode, 'date');

    // Couple history: reunion countdown and saved answers.
    assert.equal((await asHost('setReunion', { reunionDate: '2026-02-30' })).status, 400);
    const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    let history = (await asPartner('setReunion', { reunionDate: future })).history;
    assert.equal(history.reunionDate, future);
    assert.ok(history.daysUntilReunion >= 9 && history.daysUntilReunion <= 11);
    assert.equal(history.daily.length, 1);
    assert.deepEqual(history.daily[0].answers.map((a) => a.answer).sort(), ['Host answer', 'Partner answer']);
    // A completed game card is saved to the history and survives a deck reset.
    const room = (await db.query('SELECT id FROM rooms WHERE code = $1', [host.code])).rows[0];
    const players = (await db.query('SELECT id FROM players WHERE room_id = $1 ORDER BY joined_at', [room.id])).rows;
    await db.query("INSERT INTO deck_cards (id, room_id, card_number, type, actor_id, target_id, status, payload, result, completed_at) VALUES ('c1', $1, 1, 'wouldrather', $2, $3, 'complete', $4, $5, now())", [room.id, players[0].id, players[1].id, JSON.stringify({ options: ['Beach', 'Mountains'] }), JSON.stringify({ wouldRatherIndex: 1 })]);
    history = (await asHost('history')).history;
    assert.equal(history.moments[0].prompt, 'Beach / Mountains');
    assert.equal(history.moments[0].answer, 'Mountains');
    await db.query("DELETE FROM deck_cards WHERE room_id = $1", [room.id]);
    assert.equal((await asPartner('history')).history.moments.length, 1);

    // A new room by the same pair (host account + partner browser key) continues history and reunion date.
    const coupleId = history.coupleId;
    assert.ok(coupleId && !coupleId.startsWith('room:'), 'stable couple id once both identities are known');
    const host2 = await api({ action: 'create', name: 'Ana' }, 'free-host');
    const partner2 = await api({ action: 'join', code: host2.code, name: 'Ben' });
    await api({ code: host2.code, token: host2.token }, 'free-host');
    const h2 = (await api({ action: 'history', code: host2.code, token: partner2.token, partnerKey, timeZone: 'Asia/Tokyo' })).history;
    assert.equal(h2.coupleId, coupleId);
    assert.equal(h2.reunionDate, future);
    assert.equal(h2.daily.length, 1);
    assert.equal(h2.moments.length, 1);
    const d2 = (await api({ action: 'daily', code: host2.code, token: host2.token, timeZone: 'America/Sao_Paulo' }, 'free-host')).daily;
    assert.equal(d2.cards.find((c) => c.day === card.day && c.slot === 1)?.revealed, true, 'same daily card and answers in the new room');
    // A different partner browser with the same host is a different couple.
    const host3 = await api({ action: 'create', name: 'Ana' }, 'free-host');
    const other = await api({ action: 'join', code: host3.code, name: 'Cam' });
    await api({ code: host3.code, token: host3.token }, 'free-host');
    const h3 = (await api({ action: 'history', code: host3.code, token: other.token, partnerKey: 'pk-cam-browser-0000000000000002' })).history;
    assert.notEqual(h3.coupleId, coupleId);
    assert.equal(h3.daily.length, 0);
    assert.equal(h3.reunionDate, null);

    // Premium couple: 3 cards/day and adult cards only after the 18+ confirmation.
    const pHost = await api({ action: 'create', name: 'Cy' }, 'premium-host');
    await api({ action: 'join', code: pHost.code, name: 'Di' });
    await api({ code: pHost.code, token: pHost.token }, 'premium-host');
    const pd2 = (await api({ action: 'daily', code: pHost.code, token: pHost.token }, 'premium-host')).daily;
    assert.equal(pd2.limit, 3);
    assert.equal(pd2.adultConfirmed, false);
    assert.equal((await api({ action: 'dailyConfirmAdult', code: pHost.code, token: pHost.token }, 'premium-host')).status, 400);
    assert.equal((await api({ action: 'dailyConfirmAdult', code: pHost.code, token: pHost.token, confirm18: true }, 'premium-host')).daily.adultConfirmed, true);
  } finally {
    hooks.deregister();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  }
});
