import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/game-client.tsx', import.meta.url), 'utf8');

test('Premium portal control cannot submit the room form', () => {
  assert.match(source, /<button type="button" className="account-control curated-button account-premium-button"/);
});

test('Premium portal exposes loading and server errors instead of failing silently', () => {
  assert.match(source, /portalBusy \? "OPENING…" : "MANAGE PREMIUM"/);
  assert.match(source, /className="account-portal-error" role="alert"/);
  assert.match(source, /if \(!response\.ok \|\| !data\.url\) throw new Error/);
});
