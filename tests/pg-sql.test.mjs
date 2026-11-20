// The shared PostgreSQL layer (server/pg-sql.ts). Pure checks always run; the live checks run against a
// local scratch database only when HONTO_TEST_DATABASE_URL is set (never a production URL).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

const hooks = module.registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
  return next(specifier, context);
} });
const { sslFor, createSql } = await import('../server/pg-sql.ts');
hooks.deregister();

test('TLS mode comes from sslmode, with remote hosts encrypted by default', () => {
  assert.equal(sslFor('postgres://u:p@localhost:5432/db'), false);
  assert.equal(sslFor('postgres://u:p@127.0.0.1:5432/db'), false);
  assert.equal(sslFor('postgres://u:p@postgres.railway.internal:5432/railway'), false);
  assert.deepEqual(sslFor('postgres://u:p@proxy.rlwy.net:1234/railway'), { rejectUnauthorized: false });
  assert.deepEqual(sslFor('postgres://u:p@proxy.rlwy.net:1234/railway?sslmode=require'), { rejectUnauthorized: false });
  assert.deepEqual(sslFor('postgres://u:p@proxy.rlwy.net:1234/railway?sslmode=verify-full'), { rejectUnauthorized: true });
  assert.equal(sslFor('postgres://u:p@proxy.rlwy.net:1234/railway?sslmode=disable'), false);
  assert.equal(sslFor('postgres://u:p@localhost/db?sslmode=disable&application_name=x'), false);
});

test('one shared client per connection string, queries stay lazy and carry bind parameters', async () => {
  const url = 'postgres://u:p@127.0.0.1:1/none';
  const sql = createSql(url);
  assert.equal(createSql(url), sql);
  const hostile = "x'; DROP TABLE users; --";
  const query = sql`SELECT ${hostile}::text AS a, ${2}::int AS b`;
  assert.equal(query.text, 'SELECT $1::text AS a, $2::int AS b');
  assert.deepEqual([...query.values], [hostile, 2]);
  assert.deepEqual(await sql.transaction([]), []);
  await sql.end();
});

const live = process.env.HONTO_TEST_DATABASE_URL;
test('live: rows, parameters, transaction atomicity and rollback', { skip: !live }, async () => {
  const sql = createSql(live);
  try {
    await sql`DROP TABLE IF EXISTS pg_sql_probe`;
    await sql`CREATE TABLE pg_sql_probe (id text PRIMARY KEY, n bigint NOT NULL, at timestamptz NOT NULL DEFAULT now(), tags text[], doc jsonb)`;
    await sql`INSERT INTO pg_sql_probe (id, n, tags, doc) VALUES (${"a"}, ${5}, ${["x", "y"]}, ${JSON.stringify({ k: 1 })}::jsonb)`;
    const rows = await sql`SELECT * FROM pg_sql_probe WHERE id = ${"a"}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].n, '5', 'bigint stays a string, as with the Neon driver');
    assert.ok(rows[0].at instanceof Date);
    assert.deepEqual(rows[0].tags, ['x', 'y']);
    assert.deepEqual(rows[0].doc, { k: 1 });
    let ran = false;
    const lazy = sql`SELECT 1`; ran = lazy.text.length > 0; assert.ok(ran);
    const results = await sql.transaction([
      sql`INSERT INTO pg_sql_probe (id, n) VALUES (${"b"}, ${1}) RETURNING id`,
      sql`UPDATE pg_sql_probe SET n = n + 1 WHERE id = ${"a"} RETURNING n`,
      sql`SELECT count(*)::int AS c FROM pg_sql_probe`,
    ]);
    assert.deepEqual(results.map((r) => r.length), [1, 1, 1]);
    assert.equal(results[2][0].c, 2);
    await assert.rejects(sql.transaction([
      sql`INSERT INTO pg_sql_probe (id, n) VALUES (${"c"}, ${1})`,
      sql`INSERT INTO pg_sql_probe (id, n) VALUES (${"a"}, ${1})`,
    ]), /duplicate key/);
    assert.equal((await sql`SELECT count(*)::int AS c FROM pg_sql_probe`)[0].c, 2, 'the failed batch left nothing behind');
    const results2 = await Promise.all(Array.from({ length: 12 }, (_, i) => sql`SELECT ${i}::int AS i`));
    assert.deepEqual(results2.map((r) => r[0].i), [...Array(12).keys()]);
  } finally {
    await sql`DROP TABLE IF EXISTS pg_sql_probe`;
    await sql.end();
  }
});
