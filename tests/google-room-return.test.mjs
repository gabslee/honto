import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as startGoogle } from '../app/api/auth/google/start/route.ts';
import { googleReturnWithAuth } from '../app/google-return.js';

test('Google login keeps a same-origin room return and rejects an external return', async () => {
  const previous = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  try {
    const response = await startGoogle(new Request('https://honto.test/api/auth/google/start?return_to=%2F%3Froom%3DMOON-123'));
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
    assert.ok(response.headers.getSetCookie().some(cookie => cookie.includes('honto_google_return=%2F%3Froom%3DMOON-123')));
    const unsafe = await startGoogle(new Request('https://honto.test/api/auth/google/start?return_to=https%3A%2F%2Fevil.test%2Fsteal'));
    assert.ok(unsafe.headers.getSetCookie().some(cookie => cookie.includes('honto_google_return=%2F;')));
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previous;
  }
});

test('the Google callback return keeps the room query and rejects protocol-relative paths', () => {
  assert.equal(googleReturnWithAuth('/?room=MOON-123', 'invalid_state'), '/?room=MOON-123&auth=invalid_state');
  assert.equal(googleReturnWithAuth('//evil.test/steal', 'success'), '/?auth=success');
});
