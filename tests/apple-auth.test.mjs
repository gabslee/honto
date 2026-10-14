import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { decodeProtectedHeader, exportJWK, jwtVerify } from "jose";
import { generateAppleClientSecret, validateAppleIdTokenClaims } from "../app/apple-auth.ts";
import { GET as startApple } from "../app/api/auth/apple/start/route.ts";

test("Apple client secret is a valid ES256 JWT with the required claims", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
  const now = 1_800_000_000;
  const secret = await generateAppleClientSecret({ clientId: "com.example.honto", teamId: "TEAM123", keyId: "KEY123", privateKey: privatePem, now });
  assert.deepEqual(decodeProtectedHeader(secret), { alg: "ES256", kid: "KEY123" });
  const key = await exportJWK(publicKey);
  const { payload } = await jwtVerify(secret, key, { issuer: "TEAM123", audience: "https://appleid.apple.com", subject: "com.example.honto", currentDate: new Date(now * 1000) });
  assert.equal(payload.iat, now);
  assert.equal(payload.exp, now + 300);
});

test("Apple id_token claims require Apple issuer, client audience, future expiry, and nonce", () => {
  const claims = { iss: "https://appleid.apple.com", aud: "com.example.honto", exp: 1_800_000_300, sub: "apple-user", nonce: "nonce-123" };
  assert.doesNotThrow(() => validateAppleIdTokenClaims(claims, { clientId: "com.example.honto", nonce: "nonce-123", now: 1_800_000_000 }));
  assert.throws(() => validateAppleIdTokenClaims({ ...claims, iss: "https://attacker.test" }, { clientId: "com.example.honto", nonce: "nonce-123", now: 1_800_000_000 }), /issuer/);
  assert.throws(() => validateAppleIdTokenClaims({ ...claims, aud: "wrong-client" }, { clientId: "com.example.honto", nonce: "nonce-123", now: 1_800_000_000 }), /audience/);
  assert.throws(() => validateAppleIdTokenClaims({ ...claims, exp: 1_799_999_999 }, { clientId: "com.example.honto", nonce: "nonce-123", now: 1_800_000_000 }), /expired/);
  assert.throws(() => validateAppleIdTokenClaims({ ...claims, nonce: "wrong" }, { clientId: "com.example.honto", nonce: "nonce-123", now: 1_800_000_000 }), /nonce/);
});

test("Apple authorization uses form_post and cross-site state cookies", async () => {
  const previous = process.env.APPLE_CLIENT_ID;
  process.env.APPLE_CLIENT_ID = "com.example.honto";
  try {
    const response = await startApple(new Request("https://honto.test/api/auth/apple/start?return_to=%2F%3Froom%3DMOON-123"));
    const location = new URL(response.headers.get("location"));
    assert.equal(location.origin, "https://appleid.apple.com");
    assert.equal(location.searchParams.get("response_mode"), "form_post");
    assert.equal(location.searchParams.get("scope"), "name email");
    assert.equal(location.searchParams.get("redirect_uri"), "https://honto.test/api/auth/apple/callback");
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 3);
    assert.ok(cookies.every((cookie) => cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=None")));
  } finally {
    if (previous === undefined) delete process.env.APPLE_CLIENT_ID;
    else process.env.APPLE_CLIENT_ID = previous;
  }
});
