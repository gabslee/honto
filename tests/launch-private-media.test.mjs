import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { readFileSync } from 'node:fs';
import { pgliteSql } from './helpers/pglite-sql.mjs';
import { inspectDailyVideo } from '../server/v1/mp4.ts';

function mp4(duration = 15000, width = 1280, height = 720) {
  const box = (tag, bytes) => { const b = Buffer.alloc(8 + bytes.length); b.writeUInt32BE(b.length); b.write(tag, 4); bytes.copy(b, 8); return b; };
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(duration, 16);
  const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(width * 65536, 76); tkhd.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))]))]);
}
test('MP4 limits use actual metadata, support portrait, reject truncated and oversized files', () => {
  assert.deepEqual(inspectDailyVideo(mp4()), { durationMs: 15000, width: 1280, height: 720 });
  assert.deepEqual(inspectDailyVideo(mp4(1000, 720, 1280)), { durationMs: 1000, width: 720, height: 1280 });
  for (const bytes of [mp4(15001), mp4(0), mp4(1000, 1920, 1080), mp4().subarray(0, 40), Buffer.from('not an mp4')]) assert.equal(inspectDailyVideo(bytes), null);
});

test('launch city and private-media routes over isolated PostgreSQL', async t => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const sql = globalThis.__hontoTestSql = pgliteSql(db);
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>globalThis.__hontoTestSql', shortCircuit: true };
    if (specifier === 'next/server') return next('next/server.js', context);
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && !context.parentURL?.includes('/node_modules/')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    return next(specifier, context);
  }});
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://isolated-test';
  try {
    await db.exec(`CREATE TABLE players(id text PRIMARY KEY);
      CREATE TABLE users(id text PRIMARY KEY,email text UNIQUE NOT NULL,display_name text NOT NULL,role text NOT NULL DEFAULT 'user',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE couples(id text PRIMARY KEY,host_user_id text,partner_key text,reunion_date text,adult_confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());`);
    const auth = await import('../app/server-auth.ts');
    const schema = await import('../server/v1/launch-schema.ts');
    const city = await import('../server/v1/city.ts');
    const media = await import('../server/v1/private-media.ts');
    const push = await import('../app/push/index.ts');
    const lifecycle = await import('../server/v1/lifecycle.ts');
    await schema.ensureLaunchSchema(sql);
    await db.exec(readFileSync(new URL('../drizzle/0018_launch_private_media.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO users(id,email,display_name,time_zone) VALUES ('a','a@test.com','Ana','America/Sao_Paulo'),('b','b@test.com','Kenji','Asia/Tokyo'),('z','z@test.com','Zoe','UTC');
      INSERT INTO couples(id,legacy,paired_at) VALUES('c',false,now());
      INSERT INTO couple_members(couple_id,user_id,role) VALUES('c','a','a'),('c','b','b');`);
    const tokens = {};
    for (const id of ['a','b','z']) tokens[id] = await auth.createMobileToken({kind:'user',userId:id,platform:'ios'});
    const req = (id, body, method = body ? 'POST' : 'GET') => new Request('https://hontogame.com/api/v1/test', {method, headers:{authorization:`Bearer ${tokens[id]}`, 'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    await t.test('free users can select cities, malformed coordinates are rejected', async () => {
      const sp={name:'São Paulo',country:'Brazil',latitude:-23.5505,longitude:-46.6333,timeZone:'America/Sao_Paulo'};
      assert.equal((await city.updateCityResponse(req('a',sp,'PUT'))).status,200);
      assert.equal((await city.updateCityResponse(req('b',{...sp,latitude:91},'PUT'))).status,400);
      assert.equal(city.cityDistanceKm(sp,sp),0);
      assert.equal(city.cityDistanceKm(sp,{...sp,latitude:35.6762,longitude:139.6503}),18537);
      assert.equal((await city.citiesFor(sql,['a','b'])).size,1);
    });
    await t.test('all private endpoints enforce couple Premium on the server', async () => {
      assert.equal((await media.privateFeedResponse(req('a'))).status,402);
      assert.equal((await media.openPrivateResponse(req('a'),'private')).status,402);
      assert.equal((await media.playbackPrivateResponse(req('b'),'video')).status,402);
      assert.equal((await media.privateFeedResponse(req('z'))).status,409);
      await db.exec("UPDATE users SET role='admin' WHERE id='a'");
      assert.equal((await media.privateFeedResponse(req('b'))).status,200,'partner premium applies to the couple');
    });
    const insert = async (id, kind='view_once', author='a', status='ready', expired=false) => {
      await db.query(`INSERT INTO private_media(id,couple_id,author_user_id,recipient_user_id,client_id,kind,status,object_key,upload_key,content_type,size_bytes,width,height,local_day,expires_at) VALUES($1,'c',$2,$3,$1,$4,$5,$6,$7,'image/jpeg',4,1,1,current_date,now()+$8::interval)`,[id,author,author==='a'?'b':'a',kind,status,`private-media/${id}`,`private-uploads/${id}`,expired?'-1 second':'24 hours']);
      return (await db.query("SELECT *,to_char(local_day,'YYYY-MM-DD') AS local_day FROM private_media WHERE id=$1",[id])).rows[0];
    };
    await t.test('view-once recipient claim is atomic; sender, stranger and expired claims fail', async () => {
      await insert('once');
      assert.equal(await media.claimPrivatePhoto(sql,'c','a','once'),undefined);
      assert.equal(await media.claimPrivatePhoto(sql,'c','z','once'),undefined);
      const claims=await Promise.all([media.claimPrivatePhoto(sql,'c','b','once'),media.claimPrivatePhoto(sql,'c','b','once')]);
      assert.equal(claims.filter(Boolean).length,1);
      await insert('expired','view_once','a','ready',true);
      assert.equal(await media.claimPrivatePhoto(sql,'c','b','expired'),undefined);
    });
    await t.test('viewing deletes DB and storage, never returns a reusable URL', async () => {
      await insert('open');
      const deleted=[];
      const store={getObject:async()=>new Uint8Array([255,216,255,217]),deleteObjects:async keys=>deleted.push(...keys),presignGet:async()=>{throw Error('No URL for private photo');},putObject:async()=>{},listPrefix:async()=>[]};
      lifecycle.setObjectStore(store);
      const response=await media.openPrivateResponse(req('b'),'open');
      assert.equal(response.status,200);
      assert.match(response.headers.get('cache-control'),/no-store/);
      const value=await response.json();assert.deepEqual(Object.keys(value).sort(),['base64','contentType']);
      assert.equal((await db.query("SELECT * FROM private_media WHERE id='open'")).rows.length,0);
      assert.ok(deleted.includes('private-media/open'));
      assert.equal((await media.openPrivateResponse(req('b'),'open')).status,410);
    });
    await t.test('replace video atomically only for its author and local day; queue old storage', async () => {
      await insert('old','daily_video'); await insert('partner','daily_video','b');
      const row=await insert('new','daily_video','a','processing');
      const keys=await media.activateDailyVideo(sql,row);
      assert.ok(keys.includes('private-media/old'));
      assert.deepEqual((await db.query("SELECT id FROM private_media WHERE kind='daily_video' ORDER BY id")).rows.map(r=>r.id),['new','partner']);
      assert.equal((await db.query("SELECT * FROM storage_deletions WHERE object_key='private-media/old'")).rows.length,1);
    });
    await t.test('expiry deletes unopened rows and retries failed object deletion durably', async () => {
      const removed=[];let fail=true;
      const store={deleteObjects:async keys=>{if(fail)throw Error('offline');removed.push(...keys);},listPrefix:async()=>[],getObject:async()=>null,putObject:async()=>{},presignGet:async()=>''};
      await media.expirePrivateMedia(sql,store);
      assert.equal((await db.query("SELECT * FROM private_media WHERE id='expired'")).rows.length,0);
      assert.equal((await db.query("SELECT * FROM storage_deletions WHERE object_key='private-media/expired'")).rows.length,1);
      fail=false;await media.expirePrivateMedia(sql,store);
      assert.ok(removed.includes('private-media/expired'));
      assert.equal((await db.query("SELECT * FROM storage_deletions WHERE reason='private_media'")).rows.length,0);
    });
    await t.test('private push carries sender text and metadata, never image preview', () => {
      const payload=push.apnsAlertPayload({type:'private_photo.new',coupleId:'c',fromName:'Ana',mediaId:'m',sentAt:new Date().toISOString()});
      assert.equal(payload.aps.alert.body,'Nova foto do Ana');
      assert.equal(payload.aps['mutable-content'],undefined);
      assert.doesNotMatch(JSON.stringify(payload),/thumbnail|imageUrl|https:|attachment/);
    });
  } finally {
    if(saved===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=saved;
    hooks.deregister();await db.close();
  }
});
