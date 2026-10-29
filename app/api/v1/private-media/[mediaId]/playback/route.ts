import { playbackPrivateResponse } from '../../../../../../server/v1/private-media';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request, {params}:{params:Promise<{mediaId:string}>}) {return playbackPrivateResponse(request,(await params).mediaId);}
