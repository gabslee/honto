import { completePrivateResponse } from '../../../../../../api/v1/private-media';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:Request, {params}:{params:Promise<{mediaId:string}>}) {return completePrivateResponse(request,(await params).mediaId);}
