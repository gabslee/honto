import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mobileAction } from '../app/api/mobile/mobile-routes.js';

test('mobile routes map to game actions', () => {
  assert.equal(mobileAction('GET', ['daily']), 'daily');
  assert.equal(mobileAction('post', ['daily', 'answer']), 'dailyAnswer');
  assert.equal(mobileAction('GET', ['history']), 'history');
  assert.equal(mobileAction('PUT', ['reunion']), 'setReunion');
  assert.equal(mobileAction('DELETE', ['history']), null);
  assert.equal(mobileAction('GET', ['start']), null, 'game actions are not exposed');
});

test('mobile API is documented', () => {
  const doc = readFileSync(new URL('../docs/mobile-api.md', import.meta.url), 'utf8');
  for (const p of ['/api/auth/google/start', '/api/auth/apple/start', '/api/auth/me', '/api/mobile/daily', '/api/mobile/daily/answer', '/api/mobile/history', '/api/mobile/reunion', '/api/mobile/moments/photo']) assert.ok(doc.includes(p), p);
});
