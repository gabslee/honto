import { verifyAppleNativeToken } from "../../../../mobile-auth";
import { providerLogin } from "../provider-login";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return providerLogin(request, (idToken, nonce) => verifyAppleNativeToken(idToken, { nonce }));
}
