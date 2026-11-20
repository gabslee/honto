// Daily video 24 hour rule against a real PostgreSQL (advisory-lock replacement under true concurrency, the
// schema backfill over legacy rows, the sweep). Runs only when HONTO_TEST_DATABASE_URL points at a local
// scratch database (never a production URL); skipped otherwise. The database is dropped and rebuilt first.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

const url = process.env.HONTO_TEST_DATABASE_URL;
test('daily video 24h over a real PostgreSQL', { skip: !url && 'HONTO_TEST_DATABASE_URL not set' }, async () => {
  assert.match(url, /@(localhost|127\.0\.0\.1)[:/]/, 'only a local scratch database');
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  } });
  const { createSql } = await import('../server/pg-sql.ts');
  const schema = await import('../server/v1/launch-schema.ts');
  const media = await import('../server/v1/private-media.ts');
  hooks.deregister();
  const sql = createSql(url);
  try {
    await sql`DROP SCHEMA public CASCADE`; await sql`CREATE SCHEMA public`;
    await sql`CREATE TABLE players(id text PRIMARY KEY)`;
    await sql`CREATE TABLE users(id text PRIMARY KEY,email text UNIQUE NOT NULL,display_name text NOT NULL,role text NOT NULL DEFAULT 'user',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE couples(id text PRIMARY KEY,host_user_id text,partner_key text,reunion_date text,adult_confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`;
    await schema.ensureLaunchSchema(sql);
    await sql`INSERT INTO users(id,email,display_name,time_zone) VALUES ('a','a@test.com','Ana','America/Sao_Paulo'),('b','b@test.com','Kenji','Asia/Tokyo')`;
    await sql`INSERT INTO couples(id,legacy,paired_at) VALUES('c',false,now())`;
    await sql`INSERT INTO couple_members(couple_id,user_id,role) VALUES('c','a','a'),('c','b','b')`;
    const put = (id, author, status, dayOffset, agoHours, expires) => sql`INSERT INTO private_media(id,couple_id,author_user_id,recipient_user_id,client_id,kind,status,object_key,upload_key,content_type,size_bytes,width,height,duration_ms,local_day,created_at,ready_at,expires_at)
      VALUES(${id},'c',${author},${author === 'a' ? 'b' : 'a'},${id},'daily_video',${status},${'private-media/' + id},${'private-uploads/' + id},'video/mp4',4,720,1280,5000,current_date+${dayOffset}::int,now()-${agoHours}*interval '1 hour',now()-${agoHours}*interval '1 hour',${expires})`;

    // Legacy data written before the rule: several ready videos of one author on different days, no expiry.
    await put('legacy-3d', 'a', 'ready', -3, 72, null);
    await put('legacy-1h', 'a', 'ready', 0, 1, null);
    await put('legacy-b', 'b', 'ready', 0, 30, null);
    await schema.backfillDailyVideoExpiry(sql); await schema.backfillDailyVideoExpiry(sql);
    const rows = await sql`SELECT id, (expires_at - ready_at) = interval '24 hours' AS exact, expires_at > now() AS live FROM private_media ORDER BY id`;
    assert.deepEqual(rows.map(r => [r.id, r.exact, r.live]), [['legacy-1h', true, true], ['legacy-3d', true, false], ['legacy-b', true, false]]);
    const feed = await media.readPrivateFeed(sql, 'c', 'a', 'b');
    assert.equal(feed.meVideo.id, 'legacy-1h'); assert.equal(feed.partnerVideo, null);

    // Replacement across midnight, and two completions racing on separate pooled connections.
    const store = { deleted: [], deleteObjects: async function (keys) { this.deleted.push(...keys); }, listPrefix: async () => [], getObject: async () => null, putObject: async () => {}, presignGet: async () => '' };
    await put('x', 'a', 'processing', 1, 0, null); await put('y', 'a', 'processing', 2, 0, null);
    const rowOf = async id => (await sql`SELECT *, to_char(local_day,'YYYY-MM-DD') AS local_day FROM private_media WHERE id=${id}`)[0];
    const results = await Promise.allSettled([media.activateDailyVideo(sql, await rowOf('x')), media.activateDailyVideo(sql, await rowOf('y'))]);
    assert.ok(results.every(r => r.status === 'fulfilled'), JSON.stringify(results));
    const ready = await sql`SELECT id FROM private_media WHERE kind='daily_video' AND author_user_id='a' AND status='ready'`;
    assert.equal(ready.length, 1, 'exactly one live video for the author');
    assert.ok(!ready.some(r => ['legacy-1h', 'legacy-3d'].includes(r.id)), 'the legacy videos were replaced');
    const kept = (await sql`SELECT id FROM private_media WHERE author_user_id='b'`).map(r => r.id);
    assert.deepEqual(kept, ['legacy-b'], 'the partner video is untouched');

    // The sweep deletes expired rows and their objects.
    await media.expirePrivateMedia(sql, store);
    assert.deepEqual((await sql`SELECT id FROM private_media WHERE author_user_id='b'`), [], 'expired partner video removed');
    for (const key of ['private-media/legacy-b', 'private-uploads/legacy-b']) assert.ok(store.deleted.includes(key), key);
    assert.equal((await sql`SELECT 1 FROM storage_deletions WHERE reason='private_media'`).length, 0, 'outbox drained');
    // Running the schema again over live data changes nothing.
    const before = await sql`SELECT id, expires_at FROM private_media ORDER BY id`;
    await schema.ensureLaunchSchema(sql); await schema.backfillDailyVideoExpiry(sql);
    assert.deepEqual(await sql`SELECT id, expires_at FROM private_media ORDER BY id`, before);
  } finally { await sql.end(); }
});
