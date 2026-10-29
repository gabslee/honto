import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { pgliteSql } from './helpers/pglite-sql.mjs';

const s3Env = { S3_ENDPOINT: 'https://t3.storageapi.dev', S3_REGION: 'auto', S3_BUCKET: 'honto-test-bucket', S3_ACCESS_KEY_ID: 'tid_TESTACCESSKEY', S3_SECRET_ACCESS_KEY: 'tsec_TestSecretKeyNotReal' };
const uuid = n => `6b1f3c9e-2d4a-4b7e-9c11-${String(n).padStart(12, '0')}`;

test('couple chat over isolated PostgreSQL', async t => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const sql = globalThis.__hontoTestSql = pgliteSql(db);
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier === 'next/server') return next('next/server.js', context);
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  }});
  const savedEnv = Object.fromEntries(['DATABASE_URL', ...Object.keys(s3Env)].map(k => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  Object.assign(process.env, { DATABASE_URL: 'postgres://isolated-test', ...s3Env });
  try {
    await db.exec(`CREATE TABLE players(id text PRIMARY KEY);
      CREATE TABLE users(id text PRIMARY KEY,email text UNIQUE NOT NULL,display_name text NOT NULL,role text NOT NULL DEFAULT 'user',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE couples(id text PRIMARY KEY,host_user_id text,partner_key text,reunion_date text,adult_confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());`);
    const auth = await import('../app/server-auth.ts');
    const schema = await import('../server/v1/launch-schema.ts');
    const chat = await import('../server/v1/chat.ts');
    const media = await import('../server/v1/private-media.ts');
    const push = await import('../app/push/index.ts');
    const lifecycle = await import('../server/v1/lifecycle.ts');
    await schema.ensureLaunchSchema(sql);
    // The migrations are idempotent over the runtime schema.
    await db.exec(readFileSync(new URL('../drizzle/0018_launch_private_media.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../drizzle/0019_couple_chat.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO users(id,email,display_name,time_zone) VALUES ('a','a@test.com','Ana','America/Sao_Paulo'),('b','b@test.com','Kenji','Asia/Tokyo'),('y','y@test.com','Yui','UTC'),('z','z@test.com','Zoe','UTC'),('s','s@test.com','Solo','UTC');
      INSERT INTO couples(id,legacy,paired_at) VALUES('c',false,now()),('c2',false,now());
      INSERT INTO couple_members(couple_id,user_id,role) VALUES('c','a','a'),('c','b','b'),('c2','y','a'),('c2','z','b');`);
    const tokens = {};
    for (const id of ['a','b','y','z','s']) tokens[id] = await auth.createMobileToken({kind:'user',userId:id,platform:'ios'});
    const req = (id, body, path = '/api/v1/chat/messages', method = body ? 'POST' : 'GET') => new Request(`https://hontogame.com${path}`, {method, headers:{authorization:`Bearer ${tokens[id]}`, 'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    const pushes = [];
    chat.setChatNotifier(async (coupleId, from, event) => { pushes.push({coupleId, from, event}); });
    const send = async (id, body) => { const r = await chat.sendChatResponse(req(id, body)); return {status: r.status, body: await r.json()}; };
    const list = async (id, query = '') => { const r = await chat.listChatResponse(req(id, null, `/api/v1/chat/messages${query}`)); return {status: r.status, body: await r.json()}; };
    const photo = async (id, couple, author, localDay = "current_date") => db.exec(`INSERT INTO couple_photos(id,couple_id,role,author_name,content_type,size_bytes,storage,author_user_id,local_day,status,is_daily,object_key,thumb_key) VALUES ('${id}','${couple}','a','x','image/jpeg',10,'s3','${author}',${localDay},'ready',true,'couples/${couple}/photos/${id}/full.jpg','couples/${couple}/photos/${id}/thumb.jpg')`);
    const video = async (id, couple, author, recipient) => db.query(`INSERT INTO private_media(id,couple_id,author_user_id,recipient_user_id,client_id,kind,status,object_key,upload_key,content_type,size_bytes,width,height,duration_ms,local_day) VALUES($1,$2,$3,$4,$1,'daily_video','ready',$5,$6,'video/mp4',10,720,1280,5000,current_date)`, [id, couple, author, recipient, `private-media/${id}.mp4`, `private-uploads/${id}.mp4`]);

    await t.test('unpaired users get 409; text is sent, trimmed, idempotent and validated', async () => {
      assert.equal((await chat.listChatResponse(req('s'))).status, 409);
      const first = await send('a', {clientId: uuid(1), body: '  Good morning  '});
      assert.equal(first.status, 201);
      assert.equal(first.body.body, 'Good morning');
      assert.equal(first.body.kind, 'text');
      assert.equal(first.body.author, 'me');
      const again = await send('a', {clientId: uuid(1).toUpperCase(), body: 'different text'});
      assert.equal(again.body.id, first.body.id, 'retry with the same clientId returns the first message');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_messages")).rows[0].n, 1);
      assert.equal(pushes.length, 1, 'a retry never pushes again');
      for (const bad of [{clientId: 'nope', body: 'x'}, {clientId: uuid(2), body: '   '}, {clientId: uuid(2), body: 'x'.repeat(2001)}, {clientId: uuid(2), body: 'x', photoId: 'p', privateMediaId: 'v'}]) {
        assert.equal((await send('a', bad)).status, 400);
      }
      assert.equal((await send('a', {clientId: uuid(2), body: 'x'.repeat(2000)})).status, 201, '2000 characters is the limit');
    });

    await t.test('push is text only: partner name as title, truncated body, chat_message data without media', () => {
      const {event, coupleId, from} = pushes[0];
      assert.deepEqual([coupleId, from, event.type, event.preview, event.fromName], ['c', 'a', 'chat_message', 'Good morning', 'Ana']);
      const data = push.pushData('c', event, new Date('2026-10-19T12:00:00Z'));
      assert.deepEqual(data, {type: 'chat_message', coupleId: 'c', sentAt: '2026-10-19T12:00:00Z', messageId: event.messageId, fromName: 'Ana'});
      const payload = push.apnsAlertPayload(data, event.preview);
      assert.deepEqual(payload.aps.alert, {title: 'Ana', body: 'Good morning'});
      assert.equal(payload.aps['mutable-content'], undefined);
      assert.doesNotMatch(JSON.stringify(payload), /thumb|imageUrl|https:|attachment/);
      const long = pushes[1].event.preview;
      assert.equal([...long].length, 120);
      assert.ok(long.endsWith('...'));
      assert.equal(chat.chatPreview('photo_comment', 'Nice'), 'Commented on your photo: Nice');
      assert.equal(chat.chatPreview('video_comment', 'Ha'), 'Commented on your video: Ha');
      assert.equal(chat.chatPreview('view_once', null), 'Sent you a disappearing photo');
    });

    await t.test('history is newest first and pages with the before cursor; other couples never see it', async () => {
      for (let i = 3; i <= 7; i++) assert.equal((await send(i % 2 ? 'b' : 'a', {clientId: uuid(i), body: `m${i}`})).status, 201);
      const page1 = await list('b', '?limit=3');
      assert.deepEqual(page1.body.messages.map(m => m.body), ['m7', 'm6', 'm5']);
      assert.deepEqual(page1.body.messages.map(m => m.author), ['me', 'partner', 'me']);
      const page2 = await list('b', `?limit=3&before=${page1.body.nextBefore}`);
      assert.deepEqual(page2.body.messages.map(m => m.body), ['m4', 'm3', 'x'.repeat(2000)]);
      const page3 = await list('b', `?limit=3&before=${page2.body.nextBefore}`);
      assert.deepEqual(page3.body.messages.map(m => m.body), ['Good morning']);
      assert.equal(page3.body.nextBefore, null);
      assert.equal((await list('b', '?limit=0')).status, 400);
      assert.equal((await list('b', '?limit=101')).status, 400);
      assert.equal((await list('z', `?before=${page1.body.nextBefore}`)).status, 400, 'cursor of another couple');
      assert.deepEqual((await list('z')).body, {messages: [], nextBefore: null});
    });

    await t.test("comments only on the partner's photo or daily video of this couple", async () => {
      await photo('ph_b', 'c', 'b'); await photo('ph_a', 'c', 'a'); await photo('ph_z', 'c2', 'z');
      await video('pm_vb', 'c', 'b', 'a'); await video('pm_va', 'c', 'a', 'b');
      const ok = await send('a', {clientId: uuid(10), body: 'Love this', photoId: 'ph_b'});
      assert.equal(ok.status, 201);
      assert.equal(ok.body.kind, 'photo_comment');
      assert.equal(ok.body.photo.photoId, 'ph_b');
      assert.equal(ok.body.photo.available, true);
      assert.match(ok.body.photo.thumbUrl, /thumb\.jpg\?X-Amz-/, 'signed like Memories thumbnails');
      assert.equal(pushes.at(-1).event.preview, 'Commented on your photo: Love this');
      assert.equal((await send('a', {clientId: uuid(11), body: 'mine', photoId: 'ph_a'})).status, 422, 'own photo is rejected');
      assert.equal((await send('a', {clientId: uuid(12), body: 'other', photoId: 'ph_z'})).status, 422, 'another couple');
      assert.equal((await send('a', {clientId: uuid(13), body: 'gone', photoId: 'ph_missing'})).status, 422);
      const vid = await send('a', {clientId: uuid(14), body: 'Ha', privateMediaId: 'pm_vb'});
      assert.equal(vid.status, 201);
      assert.deepEqual(vid.body.video, {mediaId: 'pm_vb', available: true, posterUrl: null});
      assert.equal((await send('a', {clientId: uuid(15), body: 'mine', privateMediaId: 'pm_va'})).status, 422, 'own video is rejected');
      // The photo is deleted and the video replaced: the comments stay, without media.
      await db.exec("DELETE FROM couple_photos WHERE id='ph_b'; DELETE FROM private_media WHERE id='pm_vb'");
      const [v, p] = (await list('b', '?limit=2')).body.messages;
      assert.deepEqual(v.video, {mediaId: null, available: false, posterUrl: null});
      assert.deepEqual(p.photo, {photoId: null, available: false, thumbUrl: null, expiresAt: null});
      assert.equal(p.body, 'Love this');
    });

    await t.test('Free couples get no thumbnail for photos outside the 7-day window', async () => {
      await photo('ph_old', 'c', 'b', "current_date - 30");
      const old = await send('a', {clientId: uuid(16), body: 'Throwback', photoId: 'ph_old'});
      assert.equal(old.body.photo.available, true);
      assert.equal(old.body.photo.thumbUrl, null);
    });

    const jpeg = new Uint8Array([255, 216, 1, 2, 255, 217]);
    const store = {getObject: async () => jpeg, putObject: async () => {}, deleteObjects: async () => {}, listPrefix: async () => [], presignGet: async () => { throw Error('No URL for private photo'); }};
    lifecycle.setObjectStore(store);
    globalThis.fetch = async (input, init) => {
      if ((init?.method ?? input?.method) === 'HEAD') return new Response(null, {status: 200, headers: {'content-length': String(jpeg.length), 'content-type': 'image/jpeg'}});
      throw new Error('unexpected network call');
    };
    const upload = (id, clientId) => media.createPrivateUploadResponse(req(id, {clientId, kind: 'view_once', contentType: 'image/jpeg', bytes: jpeg.length, width: 10, height: 10, timeZone: 'UTC'}, '/api/v1/private-media'));

    await t.test('disappearing photos stay Premium; text and comments stay Free', async () => {
      assert.equal((await upload('a', uuid(20))).status, 402);
      assert.equal((await media.openPrivateResponse(req('b'), 'x')).status, 402);
    });

    let onceId;
    await t.test('a completed view-once photo becomes one chat message with a text-only push', async () => {
      await db.exec("UPDATE users SET role='admin' WHERE id='a'");
      const created = await upload('a', uuid(21));
      assert.equal(created.status, 201);
      onceId = (await created.json()).id;
      const before = pushes.length;
      assert.equal((await media.completePrivateResponse(req('a', {}), onceId)).status, 200);
      assert.equal((await media.completePrivateResponse(req('a', {}), onceId)).status, 200, 'repeat is harmless');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_messages WHERE private_media_id=$1", [onceId])).rows[0].n, 1);
      assert.equal(pushes.length, before + 1);
      assert.equal(pushes.at(-1).event.type, 'chat_message');
      assert.equal(pushes.at(-1).event.preview, 'Sent you a disappearing photo');
      const mine = (await list('a', '?limit=1')).body.messages[0];
      assert.equal(mine.kind, 'view_once');
      assert.equal(mine.body, null);
      assert.equal(mine.viewOnce.status, 'unopened');
      assert.equal(mine.viewOnce.isRecipient, false);
      const theirs = (await list('b', '?limit=1')).body.messages[0];
      assert.deepEqual({...theirs.viewOnce, expiresAt: undefined}, {mediaId: onceId, status: 'unopened', expiresAt: undefined, isRecipient: true});
      assert.ok(Date.parse(theirs.viewOnce.expiresAt) > Date.now() + 23 * 3600e3);
      assert.doesNotMatch(JSON.stringify(theirs), /https:|private-media\//, 'never a reusable URL or object key');
    });

    await t.test('opening leaves an opened tombstone; expiry leaves an expired one', async () => {
      const opened = await media.openPrivateResponse(req('b', {}), onceId);
      assert.equal(opened.status, 200);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM private_media WHERE id=$1", [onceId])).rows[0].n, 0, 'media row and bytes are gone');
      const tomb = (await list('b', '?limit=1')).body.messages[0];
      assert.deepEqual({...tomb.viewOnce, expiresAt: undefined}, {mediaId: null, status: 'opened', expiresAt: undefined, isRecipient: true});
      assert.equal((await list('a', '?limit=1')).body.messages[0].viewOnce.status, 'opened', 'the sender sees it was opened');

      const created = await upload('a', uuid(22));
      const lateId = (await created.json()).id;
      await media.completePrivateResponse(req('a', {}), lateId);
      await db.query("UPDATE private_media SET expires_at=now()-interval '1 second' WHERE id=$1", [lateId]);
      assert.equal((await list('b', '?limit=1')).body.messages[0].viewOnce.status, 'expired', 'expired at exactly 24h, before the sweep');
      await media.expirePrivateMedia(sql, store);
      const expired = (await list('b', '?limit=1')).body.messages[0];
      assert.equal(expired.viewOnce.status, 'expired');
      assert.equal(expired.viewOnce.mediaId, null);
      assert.equal((await media.openPrivateResponse(req('b', {}), lateId)).status, 410);
    });

    await t.test('unread count and latest preview; the read marker never moves backwards', async () => {
      const summary = async id => (await (await chat.chatSummaryResponse(req(id, null, '/api/v1/chat/summary'))).json());
      const read = async (id, messageId) => chat.markChatReadResponse(req(id, {messageId}, '/api/v1/chat/read'));
      const all = (await list('b', '?limit=100')).body.messages;
      const fromA = all.filter(m => m.authorUserId === 'a').length;
      let s = await summary('b');
      assert.equal(s.unreadCount, fromA);
      assert.equal(s.latest.id, all[0].id);
      assert.equal(s.lastReadMessageId, null);
      assert.equal((await read('b', all[3].id)).status, 200);
      s = await summary('b');
      assert.equal(s.unreadCount, all.slice(0, 3).filter(m => m.authorUserId === 'a').length);
      await read('b', all[0].id);
      const latest = await (await read('b', all[5].id)).json();
      assert.equal(latest.lastReadMessageId, all[0].id, 'an older id does not move the marker back');
      assert.equal(latest.unreadCount, 0);
      assert.equal((await read('b', 'msg_unknown')).status, 404);
      assert.equal((await read('z', all[0].id)).status, 404, 'another couple');
    });

    await t.test('unpair removes the chat; deleting an account removes its messages', async () => {
      await send('y', {clientId: uuid(30), body: 'hi'}); await send('z', {clientId: uuid(31), body: 'hey'});
      await lifecycle.deleteAccount(sql, 'z', store);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_messages WHERE couple_id='c2'")).rows[0].n, 0);
      lifecycle.setUnpairNotifier(async () => {});
      await lifecycle.unpairCouple(sql, 'c', {actorId: 'a'});
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_messages WHERE couple_id='c'")).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM couple_chat_reads WHERE couple_id='c'")).rows[0].n, 0);
      assert.equal((await chat.listChatResponse(req('a'))).status, 409);
    });
  } finally {
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    hooks.deregister(); await db.close();
  }
});
