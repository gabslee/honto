import { joinCoupleResponse } from "../../../../../api/v1/couple";

export const dynamic = "force-dynamic";

/** POST /api/v1/couple/join `{ code }`: pair with the account that created the code. */
export async function POST(request: Request) {
  return joinCoupleResponse(request);
}
