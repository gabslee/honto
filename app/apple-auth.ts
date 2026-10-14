import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export type AppleIdTokenClaims = JWTPayload & {
  sub: string;
  email?: string;
  email_verified?: boolean | "true" | "false";
  nonce: string;
};

export async function generateAppleClientSecret(options: {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  now?: number;
}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const key = await importPKCS8(options.privateKey.replace(/\\n/g, "\n"), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: options.keyId })
    .setIssuer(options.teamId)
    .setSubject(options.clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key);
}

export function validateAppleIdTokenClaims(
  claims: JWTPayload,
  options: { clientId: string; nonce: string; now?: number },
): asserts claims is AppleIdTokenClaims {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== APPLE_ISSUER) throw new Error("Apple id_token has an invalid issuer");
  if (!audiences.includes(options.clientId)) throw new Error("Apple id_token has an invalid audience");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("Apple id_token has expired");
  if (claims.nonce !== options.nonce) throw new Error("Apple id_token has an invalid nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("Apple id_token has no subject");
}

export async function verifyAppleIdToken(idToken: string, clientId: string, nonce: string) {
  const { payload } = await jwtVerify(idToken, appleJwks, {
    algorithms: ["RS256"],
    issuer: APPLE_ISSUER,
    audience: clientId,
  });
  validateAppleIdTokenClaims(payload, { clientId, nonce });
  return payload;
}
