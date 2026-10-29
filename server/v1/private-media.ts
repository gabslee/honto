import { randomBytes } from 'node:crypto';
import type { PrivateMediaFeed, PrivateMediaItem, PrivateMediaUploadRequest } from '../../contracts/honto-api';
import { database } from '../../app/server-auth';
import { headObject, presignPut } from '../../app/storage';
import { apiError, noStore, normalizeTimeZone, requireCouple } from './context';
import { resolveEntitlement } from './couple';
import { getObjectStore, hitRateLimit, type ObjectStore } from './lifecycle';
import { ensureLaunchSchema, type LaunchSql } from './launch-schema';
import { localDayIn } from '../../app/api/v1/photos/photo-rows';
import { inspectDailyVideo } from './mp4';
import { postViewOnceMessage } from './chat';

type Row = {id:string;couple_id:string;author_user_id:string;recipient_user_id:string;client_id:string;kind:'daily_video'|'view_once';status:'pending'|'processing'|'ready'|'opening';object_key:string;upload_key:string;content_type:string;size_bytes:number;local_day:string;duration_ms:number|null;width:number;height:number;created_at:string;expires_at:string|null};
const headers = {...noStore,Pragma:'no-cache','X-Content-Type-Options':'nosniff'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const iso=(v:string|Date)=>new Date(v).toISOString();
export const VIDEO_MAX_BYTES=30*1024*1024, PRIVATE_PHOTO_MAX_BYTES=2*1024*1024;
export function validPrivateUpload(v:unknown): v is PrivateMediaUploadRequest {
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const b=v as PrivateMediaUploadRequest;
  if(typeof b.clientId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.clientId)||!normalizeTimeZone(b.timeZone))return false;
  if(!Number.isInteger(b.bytes)||b.bytes<1||![b.width,b.height].every(x=>Number.isInteger(x)&&x>0&&x<=4096))return false;
  if(b.kind==='view_once')return b.contentType==='image/jpeg'&&b.bytes<=PRIVATE_PHOTO_MAX_BYTES;
  return b.kind==='daily_video'&&b.contentType==='video/mp4'&&b.bytes<=VIDEO_MAX_BYTES&&typeof b.durationMs==='number'&&Number.isInteger(b.durationMs)&&b.durationMs>0&&b.durationMs<=15000&&Math.max(b.width,b.height)<=1280&&Math.min(b.width,b.height)<=720;
}
async function authPremium(request:Request) {
  const auth=await requireCouple(request);if(auth instanceof Response)return auth;
  const sql=database()!;await ensureLaunchSchema(sql);
  if(!(await resolveEntitlement(sql,auth.user.id,auth.partner.id)).premium)return apiError(402,'premium_required','This feature is included in Honto Premium for your couple.');
  return {...auth,sql};
}
function item(row:Row,viewer:string):PrivateMediaItem {
  return {id:row.id,kind:row.kind,author:row.author_user_id===viewer?'me':'partner',localDay:String(row.local_day).slice(0,10),createdAt:iso(row.created_at),expiresAt:row.expires_at?iso(row.expires_at):null,durationMs:row.duration_ms};
}
export async function readPrivateFeed(sql:LaunchSql,coupleId:string,userId:string,partnerId:string,myDay:string,partnerDay:string):Promise<PrivateMediaFeed> {
  await ensureLaunchSchema(sql);
  const rows=await sql`SELECT *, to_char(local_day,'YYYY-MM-DD') AS local_day FROM private_media WHERE couple_id=${coupleId} AND status='ready' AND ((kind='daily_video' AND ((author_user_id=${userId} AND local_day=${myDay}::date) OR (author_user_id=${partnerId} AND local_day=${partnerDay}::date))) OR (kind='view_once' AND recipient_user_id=${userId} AND expires_at>now())) ORDER BY created_at DESC LIMIT 60` as Row[];
  return {meVideo:rows.find(r=>r.kind==='daily_video'&&r.author_user_id===userId)?item(rows.find(r=>r.kind==='daily_video'&&r.author_user_id===userId)!,userId):null,partnerVideo:rows.find(r=>r.kind==='daily_video'&&r.author_user_id===partnerId)?item(rows.find(r=>r.kind==='daily_video'&&r.author_user_id===partnerId)!,userId):null,inbox:rows.filter(r=>r.kind==='view_once').map(r=>item(r,userId))};
}
export async function privateFeedResponse(request:Request) {
  const auth=await authPremium(request);if(auth instanceof Response)return auth;
  return json(await readPrivateFeed(auth.sql,auth.couple.id,auth.user.id,auth.partner.id,localDayIn(auth.user.timeZone||'UTC'),localDayIn(auth.partner.timeZone||'UTC')));
}
export async function createPrivateUploadResponse(request:Request) {
  const auth=await authPremium(request);if(auth instanceof Response)return auth;
  if(!getObjectStore())return apiError(503,'storage_not_configured','Media storage is unavailable.');
  const body=await request.json().catch(()=>null);if(!validPrivateUpload(body))return apiError(400,'bad_request','Use a JPEG photo up to 2 MB or a 720p MP4 up to 15 seconds.');
  const {sql,user,partner,couple}=auth;
  const prior=(await sql`SELECT * FROM private_media WHERE author_user_id=${user.id} AND client_id=${body.clientId}`)[0] as Row|undefined;
  if(prior&&(prior.couple_id!==couple.id||prior.kind!==body.kind))return apiError(409,'bad_request','Upload id already used.');
  let row=prior;
  if(!row) {
    const wait=await hitRateLimit(sql,'private_media',user.id,30,3600);if(wait)return apiError(429,'rate_limited','Try again later.',{'Retry-After':String(wait)});
    const id=`pm_${randomBytes(16).toString('hex')}`,ext=body.kind==='daily_video'?'mp4':'jpg';
    const key=`private-media/${couple.id}/${id}.${ext}`,upload=`private-uploads/${couple.id}/${id}.${ext}`;
    const day=localDayIn(user.timeZone||body.timeZone);
    await sql`INSERT INTO private_media (id,couple_id,author_user_id,recipient_user_id,client_id,kind,object_key,upload_key,content_type,size_bytes,width,height,duration_ms,local_day,expires_at) VALUES (${id},${couple.id},${user.id},${partner.id},${body.clientId},${body.kind},${key},${upload},${body.contentType},${body.bytes},${body.width},${body.height},${body.durationMs??null},${day}::date,now()+interval '30 minutes') ON CONFLICT (author_user_id,client_id) DO NOTHING`;
    row=(await sql`SELECT * FROM private_media WHERE author_user_id=${user.id} AND client_id=${body.clientId}`)[0] as Row;
  }
  if(row.status!=='pending')return apiError(409,'media_unavailable','This upload is already complete.');
  if(row.expires_at&&Date.parse(row.expires_at)<=Date.now())return apiError(410,'media_unavailable','This upload expired.');
  return json({id:row.id,upload:await presignPut(row.upload_key,{contentType:row.content_type,bytes:row.size_bytes})},201);
}
async function flushKeys(sql:LaunchSql,keys:string[],store:ObjectStore) {
  if(!keys.length)return;
  try{await store.deleteObjects(keys);for(const key of keys)await sql`DELETE FROM storage_deletions WHERE object_key=${key}`;}
  catch{ /* Durable outbox is retried by the private-media cron. Never log URLs or content. */ }
}
async function queueKeys(sql:LaunchSql,keys:string[]) {
  for(const key of keys)await sql`INSERT INTO storage_deletions (object_key,reason) VALUES (${key},'private_media') ON CONFLICT (object_key) DO NOTHING`;
}
/** Serialize a user's daily slot, not the whole couple, and retire old content atomically. */
export async function activateDailyVideo(sql:LaunchSql,row:Row) {
  const day=String(row.local_day).slice(0,10);
  await sql`INSERT INTO private_video_slots (couple_id,author_user_id,local_day) VALUES (${row.couple_id},${row.author_user_id},${day}::date) ON CONFLICT DO NOTHING`;
  const results=await sql.transaction([
    sql`SELECT 1 FROM private_video_slots WHERE couple_id=${row.couple_id} AND author_user_id=${row.author_user_id} AND local_day=${day}::date FOR UPDATE`,
    sql`WITH gone AS (DELETE FROM private_media WHERE couple_id=${row.couple_id} AND author_user_id=${row.author_user_id} AND local_day=${day}::date AND kind='daily_video' AND status='ready' AND id<>${row.id} RETURNING object_key,upload_key), queued AS (INSERT INTO storage_deletions (object_key,reason) SELECT key,'private_media' FROM gone CROSS JOIN LATERAL (VALUES(gone.object_key),(gone.upload_key)) AS k(key) ON CONFLICT DO NOTHING) SELECT key FROM gone CROSS JOIN LATERAL (VALUES(gone.object_key),(gone.upload_key)) AS k(key)`,
    sql`UPDATE private_media SET status='ready',ready_at=now(),expires_at=NULL WHERE id=${row.id} AND status='processing' RETURNING id`,
  ]);
  return results[1].map(r=>String(r.key));
}
export async function completePrivateResponse(request:Request,id:string) {
  const auth=await authPremium(request);if(auth instanceof Response)return auth;
  const {sql,user,couple}=auth,store=getObjectStore();if(!store)return apiError(503,'storage_not_configured','Media storage is unavailable.');
  const row=(await sql`SELECT *,to_char(local_day,'YYYY-MM-DD') AS local_day FROM private_media WHERE id=${id} AND couple_id=${couple.id} AND author_user_id=${user.id}`)[0] as Row|undefined;
  if(!row)return apiError(404,'not_found','Media not found.');
  if(row.status==='ready') {
    // Retry after a crash between "ready" and the chat message: the message is idempotent per media id.
    if(row.kind==='view_once')await postViewOnceMessage(sql,{id,coupleId:couple.id,authorUserId:user.id,fromName:user.displayName});
    return json(item(row,user.id));
  }
  if(row.status!=='pending'||(row.expires_at&&Date.parse(row.expires_at)<=Date.now()))return apiError(410,'media_unavailable','Upload expired.');
  const claim=await sql`UPDATE private_media SET status='processing' WHERE id=${id} AND status='pending' RETURNING id`;
  if(!claim.length)return apiError(409,'media_unavailable','This upload is being processed.');
  try {
    const head=await headObject(row.upload_key);
    if(!head||head.size!==row.size_bytes||(head.contentType||'').split(';')[0]!==row.content_type)return apiError(422,'upload_size_mismatch','Upload does not match.');
    const bytes=await store.getObject(row.upload_key);
    if(!bytes||bytes.length!==row.size_bytes)return apiError(422,'upload_size_mismatch','Upload does not match.');
    if(row.kind==='daily_video') {
      const actual=inspectDailyVideo(bytes);if(!actual)return apiError(422,'unsupported_media_type','Use an MP4 video no longer than 15 seconds in 720p.');
      await sql`UPDATE private_media SET duration_ms=${actual.durationMs},width=${actual.width},height=${actual.height} WHERE id=${id} AND status='processing'`;
    } else if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return apiError(422,'unsupported_media_type','Use a JPEG photo.');
    // Final keys are never exposed by a presigned PUT. A stale upload URL cannot
    // resurrect or mutate a photo after it has been viewed/deleted.
    await store.putObject(row.object_key,bytes,row.content_type);
    let retired:string[]=[];
    if(row.kind==='daily_video')retired=await activateDailyVideo(sql,row);
    else {
      const changed=await sql`UPDATE private_media SET status='ready',ready_at=now(),expires_at=now()+interval '24 hours' WHERE id=${id} AND status='processing' RETURNING id`;
      // The disappearing photo shows up in the couple chat; its push (chat_message) carries text only.
      if(changed.length)await postViewOnceMessage(sql,{id,coupleId:couple.id,authorUserId:user.id,fromName:user.displayName});
    }
    await queueKeys(sql,[row.upload_key]);await flushKeys(sql,[row.upload_key,...retired],store);
    const saved=(await sql`SELECT *,to_char(local_day,'YYYY-MM-DD') AS local_day FROM private_media WHERE id=${id} AND couple_id=${couple.id}`)[0] as Row|undefined;
    if(!saved)return apiError(410,'media_unavailable','Media no longer available.');
    return json(item(saved,user.id));
  } catch {return apiError(503,'storage_not_configured','Media storage is unavailable. Try again.');}
  finally {await sql`UPDATE private_media SET status='pending' WHERE id=${id} AND status='processing'`;}
}
export async function playbackPrivateResponse(request:Request,id:string) {
  const auth=await authPremium(request);if(auth instanceof Response)return auth;
  const store=getObjectStore();if(!store)return apiError(503,'storage_not_configured','Media storage is unavailable.');
  const row=(await auth.sql`SELECT object_key FROM private_media WHERE id=${id} AND couple_id=${auth.couple.id} AND kind='daily_video' AND status='ready'`)[0];
  if(!row)return apiError(404,'not_found','Video not found.');
  return json({url:await store.presignGet(String(row.object_key),60),expiresAt:new Date(Date.now()+60000).toISOString()});
}
/** Only the intended recipient can claim a photo; the conditional update settles races. */
export async function claimPrivatePhoto(sql:LaunchSql,coupleId:string,userId:string,id:string) {
  // The chat message keeps an "opened" tombstone after the media row is deleted.
  return (await sql`WITH claimed AS (UPDATE private_media SET status='opening',opening_at=now() WHERE id=${id} AND couple_id=${coupleId} AND recipient_user_id=${userId} AND kind='view_once' AND status='ready' AND expires_at>now() RETURNING *), opened AS (UPDATE couple_messages SET media_opened_at=now() WHERE private_media_id IN (SELECT id FROM claimed) AND kind='view_once') SELECT * FROM claimed`)[0] as Row|undefined;
}
export async function removePrivateRows(sql:LaunchSql,ids:string[]) {
  const keys=await sql`WITH gone AS (DELETE FROM private_media WHERE id=ANY(${ids}::text[]) RETURNING object_key,upload_key), queued AS (INSERT INTO storage_deletions (object_key,reason) SELECT key,'private_media' FROM gone CROSS JOIN LATERAL (VALUES(gone.object_key),(gone.upload_key)) AS k(key) ON CONFLICT DO NOTHING) SELECT key FROM gone CROSS JOIN LATERAL (VALUES(gone.object_key),(gone.upload_key)) AS k(key)`;
  return keys.map(r=>String(r.key));
}
export async function openPrivateResponse(request:Request,id:string) {
  const auth=await authPremium(request);if(auth instanceof Response)return auth;
  const {sql,user,couple}=auth,store=getObjectStore();if(!store)return apiError(503,'storage_not_configured','Media storage is unavailable.');
  const row=await claimPrivatePhoto(sql,couple.id,user.id,id);if(!row)return apiError(410,'media_unavailable','This photo has expired or has already been opened.');
  let bytes:Uint8Array|null=null;
  try{bytes=await store.getObject(row.object_key);}catch{ /* Closed rather than ever served twice. */ }
  const keys=await removePrivateRows(sql,[row.id]);await flushKeys(sql,keys,store);
  if(!bytes)return apiError(410,'media_unavailable','This photo is no longer available.');
  return json({contentType:'image/jpeg',base64:Buffer.from(bytes).toString('base64')});
}
/** Invoke every minute. Access already expires at exactly 24h even before this sweep runs. */
export async function expirePrivateMedia(sql:LaunchSql,store=getObjectStore()) {
  await ensureLaunchSchema(sql);
  const expired=await sql`SELECT p.id FROM private_media p JOIN couples c ON c.id=p.couple_id WHERE (p.expires_at IS NOT NULL AND p.expires_at<=now()) OR (p.status='opening' AND p.opening_at<now()-interval '5 minutes') OR c.unpaired_at IS NOT NULL`;
  const keys=await removePrivateRows(sql,expired.map(r=>String(r.id)));
  if(store) {
    const queued=await sql`SELECT object_key FROM storage_deletions WHERE reason='private_media' ORDER BY queued_at LIMIT 1000`;
    await flushKeys(sql,[...new Set([...keys,...queued.map(r=>String(r.object_key))])],store);
    // An already-used presigned PUT can only recreate a staging file. It never
    // receives a final key and the orphan sweep removes it after PUT expiry.
    const orphans=(await store.listPrefix('private-uploads/')).filter(o=>o.lastModified&&new Date(o.lastModified).getTime()<Date.now()-15*60000).map(o=>o.key);
    await queueKeys(sql,orphans);await flushKeys(sql,orphans,store);
    const finals=(await store.listPrefix('private-media/')).filter(o=>o.lastModified&&new Date(o.lastModified).getTime()<Date.now()-15*60000);
    for(const file of finals) {
      if(!(await sql`SELECT 1 FROM private_media WHERE object_key=${file.key} LIMIT 1`).length) {
        await queueKeys(sql,[file.key]);await flushKeys(sql,[file.key],store);
      }
    }
  }
  await sql`DELETE FROM private_video_slots WHERE local_day<current_date-2`;
  return {expired:expired.length};
}
