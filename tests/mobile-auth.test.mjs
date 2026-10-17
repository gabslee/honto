import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';

const hooks = module.registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
  return next(specifier, context);
} });
const { verifyGoogleIdToken, verifyAppleNativeToken, googleAudiences, appleAudiences } = await import('../app/mobile-auth.ts');
hooks.deregister();

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });
const sign = (claims, { iss, aud, exp = '10m' }) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).setSubject('sub-123').sign(privateKey);

test('audiences come from env, with the iOS client id and bundle id', () => {
  assert.deepEqual(googleAudiences({ GOOGLE_CLIENT_ID: 'web.apps', GOOGLE_IOS_CLIENT_ID: 'ios.apps' }), ['web.apps', 'ios.apps']);
  assert.deepEqual(appleAudiences({}), ['com.hontogame.app']);
  assert.deepEqual(appleAudiences({ APPLE_IOS_BUNDLE_ID: 'com.other.app' }), ['com.other.app']);
});

test('Google native ID token: iOS audience accepted, others rejected, nonce checked', async () => {
  const token = await sign({ email: 'Ana@Example.com', email_verified: true, name: 'Ana', nonce: createHash('sha256').update('raw-nonce').digest('hex') }, { iss: 'https://accounts.google.com', aud: 'ios.apps' });
  const id = await verifyGoogleIdToken(token, { audiences: ['web.apps', 'ios.apps'], keys, nonce: 'raw-nonce' });
  assert.deepEqual(id, { provider: 'google', sub: 'sub-123', email: 'ana@example.com', emailVerified: true, name: 'Ana' });
  await assert.rejects(verifyGoogleIdToken(token, { audiences: ['web.apps'], keys }));
  await assert.rejects(verifyGoogleIdToken(token, { audiences: ['ios.apps'], keys, nonce: 'other' }));
  await assert.rejects(verifyGoogleIdToken(token, { audiences: [], keys }), /missing_config/);
  const evil = await sign({}, { iss: 'https://evil.example', aud: 'ios.apps' });
  await assert.rejects(verifyGoogleIdToken(evil, { audiences: ['ios.apps'], keys }));
  const expired = await sign({}, { iss: 'accounts.google.com', aud: 'ios.apps', exp: Math.floor(Date.now() / 1000) - 60 });
  await assert.rejects(verifyGoogleIdToken(expired, { audiences: ['ios.apps'], keys }));
});

test('Apple native ID token: bundle id audience', async () => {
  const token = await sign({ email: 'x@privaterelay.appleid.com', email_verified: 'true' }, { iss: 'https://appleid.apple.com', aud: 'com.hontogame.app' });
  const id = await verifyAppleNativeToken(token, { keys });
  assert.equal(id.email, 'x@privaterelay.appleid.com'); assert.equal(id.emailVerified, true); assert.equal(id.provider, 'apple');
  const web = await sign({}, { iss: 'https://appleid.apple.com', aud: 'com.hontogame.web' });
  await assert.rejects(verifyAppleNativeToken(web, { keys }));
});
