import assert from 'node:assert/strict';
import test from 'node:test';
import * as module from 'node:module';
import { PGlite } from '@electric-sql/pglite';

test('completed matches archive once and expose only summaries to participating accounts', async () => {
  const db = new PGlite();
  globalThis.__hontoHistorySql = async (parts, ...values) => {
    const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
    return (await db.query(query, values)).rows;
  };
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoHistorySql', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    return next(specifier, context);
  } });
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://isolated-history';
  try {
    await db.exec("CREATE TABLE rooms (id text PRIMARY KEY, code text, multiplayer boolean, round_count integer, started_at timestamptz, status text, group_state jsonb); CREATE TABLE players (id text PRIMARY KEY, room_id text, user_id text, name text, sips integer, joined_at timestamptz); INSERT INTO rooms VALUES ('room-1','MOON-123',false,8,now(),'finished',null); INSERT INTO players VALUES ('p1','room-1','user-1','Ana',2,now()),('p2','room-1',null,'Guest',5,now());");
    const history = await import('../app/match-history.ts');
    await history.ensureHistorySchema();
    await db.query("INSERT INTO users (id,email,display_name) VALUES ('user-1','ana@example.com','Ana')");
    await history.archiveFinishedMatch('room-1');
    await history.archiveFinishedMatch('room-1');
    const list = await history.historyForUser('user-1');
    assert.equal(list.length, 1);
    assert.equal(list[0].mode, 'duo');
    assert.equal(list[0].isWinner, true);
    const detail = await history.historyMatchForUser(list[0].id, 'user-1');
    assert.equal(detail.players.length, 2);
    assert.equal(JSON.stringify(detail).includes('prompt'), false);
    assert.equal(await history.historyMatchForUser(list[0].id, 'someone-else'), null);
  } finally {
    hooks.deregister();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    delete globalThis.__hontoHistorySql;
    await db.close();
  }
});
