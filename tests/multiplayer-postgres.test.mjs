// Real PostgreSQL integration, isolated in-memory. No production database is used.
// No production credentials or network are used. The actual API SQL runs unmodified.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

test('multiplayer API PostgreSQL lifecycle, authorization and concurrent joins', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => {
    const query = parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
    return (await db.query(query, values)).rows;
  };
  const hooks = module.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
      if (specifier.endsWith('/server-auth')) return { url: 'data:text/javascript,export async function getCurrentUser(r){const id=r.headers.get("x-test-user");return id?{id,plan:id.startsWith("premium")?"premium":"free"}:null}export function hasPremiumAccess(u){return u?.plan==="premium"}export function database(){return globalThis.__hontoTestSql}export async function ensureIdentitySchema(){}', shortCircuit: true };
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
    await db.query('CREATE TABLE users (id text PRIMARY KEY, display_name text)');
    await db.query("INSERT INTO users (id, display_name) VALUES ('premium-owner', 'Premium Host'), ('premium-intruder', 'Intruder'), ('premium-duo', 'Duo Host'), ('premium-late', 'Reconnected Host')");
    async function api(body, user = null, method = 'POST') {
      let status; let result;
      const req = { method, body, query: body, headers: user ? { 'x-test-user': user } : {} };
      const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { result = value; return value; } };
      await handler(req, res); return { status, ...result };
    }
    const host = await api({ action: 'create', name: 'Host' }, 'premium-owner');
    assert.equal(host.status, 201);
    const send = (action, extra = {}, user = 'premium-owner') => api({ action, code: host.code, token: host.token, ...extra }, user);
    assert.equal((await send('configure', { multiplayer: true }, 'free-user')).status, 400);
    assert.equal((await send('configure', { multiplayer: true }, 'premium-intruder')).status, 400);
    assert.equal((await send('configure', { multiplayer: true })).room.multiplayer, true);
    assert.equal((await send('start')).status, 400);
    const joins = await Promise.all(Array.from({ length: 8 }, (_, i) => api({ action: 'join', code: host.code, name: `Guest ${i}`, locale: i === 0 ? 'ja' : 'en' })));
    const guests = joins.filter(r => r.status === 201);
    assert.equal(guests.length, 5, JSON.stringify(joins));
    assert.equal((await send('configure', { multiplayer: false })).status, 400);
    const state = await api(host, 'premium-owner', 'GET');
    assert.equal(state.players.length, 6);
    assert.equal(state.room.canHostMultiplayer, true);
    assert.equal(state.room.locale, 'en');
    assert.equal(state.players.find(p => p.id === state.meId).connectedProvider, 'Google');
    assert.equal(state.players.find(p => p.id === state.meId).accountName, 'Premium Host');
    const japaneseGuest = await api(guests[0], null, 'GET');
    assert.equal(japaneseGuest.room.locale, 'ja');
    await api({ ...host, action: 'setLocale', locale: 'ja' }, 'premium-owner');
    await api({ ...guests[0], action: 'setLocale', locale: 'en' });
    assert.equal((await api(host, 'premium-owner', 'GET')).room.locale, 'ja');
    assert.equal((await api(guests[0], null, 'GET')).room.locale, 'en');
    assert.equal(JSON.stringify(state).includes(host.token), false);
    assert.equal(JSON.stringify(state).includes('premium-owner'), false);
    const started = await send('start');
    assert.equal(started.room.status, 'playing', JSON.stringify(started));
    assert.equal(started.group.card.type, 'hidden');
    assert.equal((await api({ action: 'join', code: host.code, name: 'Late guest' })).status, 400);
    const groupAction = { type: 'draw', cardId: started.group.card.id, round: started.group.round };
    assert.equal((await send('multiplayer', { groupAction })).status, 400, 'welcome blocks early actions');
    const sessions = [host, ...guests];
    for (const session of sessions) assert.equal((await api({ ...session, action: 'submitWager', wager: 'Tell a joke' })).status, 200);
    for (const session of sessions) assert.equal((await api({ ...session, action: 'ackWelcome' })).status, 200);
    assert.equal((await send('multiplayer', { groupAction })).status, 200);
    assert.equal((await send('multiplayer', { groupAction })).status, 400, 'cannot draw twice');
    // Play the actual randomly dealt card through the API and PostgreSQL.
    // This exercises JSON persistence, scoring, wheel ownership and collective advance.
    const memberSessions = new Map();
    for (const session of sessions) memberSessions.set((await api(session, null, 'GET')).meId, session);
    let live = await api(host, 'premium-owner', 'GET');
    const move = async (id, type, fields = {}) => {
      const response = await api({ ...memberSessions.get(id), action: 'multiplayer', groupAction: { type, cardId: live.group.card.id, round: live.group.round, ...fields } });
      assert.equal(response.status, 200, JSON.stringify(response));
      live = response;
    };
    const author = live.group.authorId;
    if (live.group.phase === 'prepare') {
      const type = live.group.card.type;
      await move(author, 'prepare', type === 'estimate' ? { answer: 42 } : type === 'preference' ? { answer: 1 } : { prompt: 'Choose the truth', options: type === 'wouldrather' ? ['A', 'B'] : ['A', 'B', 'C'], answer: 1 });
    }
    if (live.group.phase === 'opponent') await move(author, 'chooseOpponent', { playerId: live.players.find(p => p.id !== author).id });
    if (live.group.phase === 'duel') {
      const opponent = live.group.opponentId;
      if (live.group.card.challenge === 'rps') { await move(author, 'duel', { value: 'rock' }); await move(opponent, 'duel', { value: 'scissors' }); }
      else { await move(author, 'confirmLoser', { playerId: opponent }); await move(opponent, 'confirmLoser', { playerId: opponent }); }
    }
    if (live.group.phase === 'coin') await move(author, 'coin');
    if (live.group.phase === 'answer') {
      const guessing = ['honto', 'preference', 'estimate'].includes(live.group.card.type);
      const responders = live.players.filter(p => !guessing || p.id !== author);
      for (const player of responders) {
        const value = live.group.card.type === 'who' ? live.players.find(p => p.id !== player.id).id : live.group.card.challenge === 'surprise' ? true : 0;
        await move(player.id, 'answer', { value });
      }
    }
    assert.equal(live.group.phase, 'result');
    const expectedScores = { ...live.group.scores };
    for (const pending of [...live.group.wheels]) {
      await move(pending.playerIds[0], 'spin', { wheelId: pending.id });
      const spun = live.group.wheels.find(w => w.id === pending.id);
      for (const id of spun.playerIds) expectedScores[id] += spun.value;
    }
    assert.deepEqual(live.group.scores, expectedScores);
    assert.deepEqual((await api(host, null, 'GET')).group.scores, expectedScores, 'scores survive a fresh GET');
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 7000;
      for (const player of [...live.players]) await move(player.id, 'next');
    } finally { Date.now = realNow; }
    assert.equal(live.group.currentIndex, 1);
    assert.equal(live.group.phase, 'draw');
    assert.equal((await send('multiplayer', { groupAction: { type: 'leave' } })).status, 400);
    assert.equal((await api({ ...guests[0], action: 'removePlayer', playerId: started.meId })).status, 400);
    // A deterministic card fixture tests actual concurrent answer/spin persistence.
    const { createMultiplayerState } = await import('../api/multiplayer.ts');
    const fixture = createMultiplayerState({ players: started.players, cards: [{ id: 'voting-fixture', type: 'who', prompt: 'Who brings the best snacks?' }] });
    await db.query('UPDATE rooms SET group_state = $1::jsonb, revision = revision + 1 WHERE code = $2', [JSON.stringify(fixture), host.code]);
    const current = { cardId: 'voting-fixture', round: 0 };
    assert.equal((await send('multiplayer', { groupAction: { ...current, type: 'draw' } })).status, 200);
    const votes = await Promise.all(sessions.map((session, i) => api({ ...session, action: 'multiplayer', groupAction: { ...current, type: 'answer', value: i === 0 ? started.players[1].id : started.meId } })));
    assert.ok(votes.every(v => v.status === 200), JSON.stringify(votes));
    const voted = await api(host, 'premium-owner', 'GET');
    assert.equal(voted.group.phase, 'result');
    assert.equal(voted.group.answeredIds.length, 6);
    assert.equal(voted.group.wheels.length, 1);
    const spin = { ...current, type: 'spin', wheelId: voted.group.wheels[0].id };
    const spins = await Promise.all([send('multiplayer', { groupAction: spin }), send('multiplayer', { groupAction: spin })]);
    assert.deepEqual(spins.map(s => s.status).sort(), [200, 400]);
    const scored = await api(host, 'premium-owner', 'GET');
    assert.equal(scored.group.scores[started.meId], scored.group.wheels[0].value);
    assert.equal(scored.players.find(p => p.id === started.meId).sips, scored.group.wheels[0].value);
    assert.equal((await send('multiplayer', { groupAction: { ...current, cardId: 'stale', type: 'next' } })).status, 400);
    // The Premium host can leave; the ongoing game survives and transfers controls to a Free guest.
    assert.equal((await send('leave')).left, true);
    let continued = await api(guests[0], null, 'GET');
    assert.equal(continued.players.length, 5);
    assert.equal(continued.room.status, 'playing');
    assert.equal(continued.players.find(p => p.id === continued.meId).isHost, true);
    assert.equal(continued.room.canHostMultiplayer, false);
    assert.equal((await api(host, 'premium-owner', 'GET')).status, 400, 'removed token cannot reconnect');
    while (continued.players.length >= 3) {
      const target = continued.players.find(p => p.id !== continued.meId);
      continued = await api({ ...guests[0], action: 'removePlayer', playerId: target.id });
      assert.equal(continued.status, 200, JSON.stringify(continued));
    }
    assert.equal(continued.room.status, 'abandoned');
    assert.equal(continued.group.finished, true);
    assert.equal((await api({ ...guests[0], action: 'newTable' })).status, 400, 'a Free replacement host cannot restart Premium mode');
    const duo = await api({ action: 'create', name: 'Duo host' }, 'premium-duo');
    const duoGuest = await api({ action: 'join', code: duo.code, name: 'Partner' });
    assert.equal(duoGuest.status, 201);
    assert.equal((await api({ action: 'join', code: duo.code, name: 'Third' })).status, 400);
    assert.equal((await api({ ...duo, action: 'configure', cardTypes: 'honto,honto,honto' }, 'premium-duo')).status, 200);
    const duoStart = await api({ ...duo, action: 'start' }, 'premium-duo');
    assert.equal(duoStart.status, 200, JSON.stringify(duoStart));
    assert.equal(duoStart.room.multiplayer, false);
    assert.equal(duoStart.room.status, 'playing');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM deck_cards')).rows[0].n, 12);
    await db.query("UPDATE deck_cards SET type = 'honto', payload = '{}'::jsonb WHERE room_id = (SELECT id FROM rooms WHERE code = $1) AND card_number = 1", [duo.code]);
    const duoGuestState = await api(duoGuest, null, 'GET');
    assert.equal((await api({ ...duo, action: 'submitWager', wager: 'Host challenge' }, 'premium-duo')).status, 200);
    assert.equal((await api({ ...duoGuest, action: 'submitWager', wager: 'Guest challenge' })).status, 200);
    assert.equal((await api({ ...duo, action: 'ackWelcome' }, 'premium-duo')).status, 200);
    assert.equal((await api({ ...duoGuest, action: 'ackWelcome' })).status, 200);
    assert.equal((await api({ ...duo, action: 'drawCard' }, 'premium-duo')).status, 200);
    assert.equal((await api({ ...duo, action: 'ackReveal' }, 'premium-duo')).status, 200);
    assert.equal((await api({ ...duo, action: 'submitHonto', prompt: 'Regression', statements: ['Truth', 'Lie A', 'Lie B'], truthIndex: 0 }, 'premium-duo')).status, 200);
    const guessed = await api({ ...duoGuest, action: 'guessHonto', guessedIndex: 0 });
    assert.equal(guessed.status, 200, JSON.stringify(guessed));
    assert.equal(guessed.lastCard.result.correct, true);
    assert.equal(guessed.lastCard.result.drinkerId, duoStart.meId);
    assert.equal((await api({ ...duo, action: 'startWheel' }, 'premium-duo')).status, 200);
    const duoAfter = await api(duoGuest, null, 'GET');
    assert.equal(duoAfter.activeCard.type, 'hidden');
    assert.equal(duoAfter.room.currentRound, 2);
    assert.equal(duoGuestState.room.multiplayer, false);

    const anonymousHost = await api({ action: 'create', name: 'Reconnect me' });
    const rebound = await api(anonymousHost, 'premium-late', 'GET');
    assert.equal(rebound.players.find(p => p.id === rebound.meId).connected, true);
    assert.equal(rebound.players.find(p => p.id === rebound.meId).accountName, 'Reconnected Host');
    assert.equal((await api({ ...anonymousHost, action: 'configure', multiplayer: true }, 'premium-late')).room.multiplayer, true, 'login binds the existing host token to the Premium account');
  } finally {
    hooks.deregister();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    delete globalThis.__hontoTestSql;
    await db.close();
  }
});
