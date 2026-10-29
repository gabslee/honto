import { authorized } from '../../../../server/v1/cron-auth';
import { apiError, noStore } from '../../../../server/v1/context';
import { expirePrivateMedia } from '../../../../server/v1/private-media';
import { database } from '../../../server-auth';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request) {
 if(!await authorized(request))return apiError(401,'unauthorized','Cron authentication required.');
 const sql=database();if(!sql)return apiError(503,'missing_config','Database unavailable.');
 return Response.json(await expirePrivateMedia(sql),{headers:noStore});
}
