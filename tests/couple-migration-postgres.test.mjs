// Legacy room-scoped daily/history data is migrated to couple-scoped data without loss.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

test('legacy room data migrates to a room-scoped couple and merges into the stable couple', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  globalThis.__hontoTestSql = async (parts, ...values) => (await db.query(parts.reduce((t, p, i) => t + (i ? `$${i}` : '') + p, ''), values)).rows;
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  try {
    // Pre-migration schema and data (as created by the earlier version of this branch).
    await db.exec(`CREATE TABLE rooms (id text PRIMARY KEY, code text, reunion_date text, daily_adult_confirmed_at timestamptz);
      CREATE TABLE players (id text PRIMARY KEY, room_id text REFERENCES rooms(id), name text, is_host boolean, user_id text, joined_at timestamptz DEFAULT now());
      CREATE TABLE daily_cards (room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, day text NOT NULL, slot integer NOT NULL, deck text NOT NULL, card_index integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, day, slot));
      CREATE TABLE daily_answers (room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, day text NOT NULL, slot integer NOT NULL, player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE, answer text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, day, slot, player_id));
      CREATE TABLE couple_moments (card_id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, type text NOT NULL, prompt text NOT NULL, answer text, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO rooms VALUES ('r1', 'A-B-1', '2026-12-24', NULL);
      INSERT INTO players (id, room_id, name, is_host, user_id) VALUES ('p1', 'r1', 'Ana', true, 'u1'), ('p2', 'r1', 'Ben', false, NULL);
      INSERT INTO daily_cards VALUES ('r1', '2026-10-14', 1, 'deepTalk', 3, now());
      INSERT INTO daily_answers VALUES ('r1', '2026-10-14', 1, 'p1', 'a1', now()), ('r1', '2026-10-14', 1, 'p2', 'b1', now());
      INSERT INTO couple_moments VALUES ('c1', 'r1', 'wouldrather', 'A / B', 'B', now());`);
    const { ensureCoupleSchema, resolveCouple, rememberPartnerKey } = await import('../api/couple.ts');
    await ensureCoupleSchema(globalThis.__hontoTestSql);
    const migrated = (await db.query("SELECT couple_id FROM rooms WHERE id = 'r1'")).rows[0].couple_id;
    assert.equal(migrated, 'room:r1');
    assert.deepEqual((await db.query("SELECT role, author_name, couple_id FROM daily_answers ORDER BY role")).rows, [{ role: 'host', author_name: 'Ana', couple_id: 'room:r1' }, { role: 'partner', author_name: 'Ben', couple_id: 'room:r1' }]);
    assert.equal((await db.query("SELECT reunion_date FROM couples WHERE id = 'room:r1'")).rows[0].reunion_date, '2026-12-24');
    // Once the partner's browser key is known, data merges into a stable couple.
    const sql = globalThis.__hontoTestSql;
    await rememberPartnerKey(sql, { id: 'r1' }, { id: 'p2', is_host: false }, 'pk-ben-browser-0000000000000001');
    const couple = await resolveCouple(sql, { id: 'r1' });
    assert.notEqual(couple.id, 'room:r1');
    assert.equal(couple.reunionDate, '2026-12-24');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM daily_answers WHERE couple_id = $1', [couple.id])).rows[0].n, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM couple_moments WHERE couple_id = $1', [couple.id])).rows[0].n, 1);
    // Idempotent.
    await ensureCoupleSchema(sql);
    assert.equal((await resolveCouple(sql, { id: 'r1' })).id, couple.id);
  } finally { hooks.deregister(); }
});
