import assert from 'node:assert/strict';
import test from 'node:test';
import { nextHeaderVisibility } from '../app/header-visibility.js';

test('desktop header never retracts, even with a stale hidden state', () => {
  assert.equal(nextHeaderVisibility({ mobile: false, current: 200, previous: 100, maximum: 500, hidden: true }), false);
});

test('mobile header retracts down, returns up, and stays visible without overflow', () => {
  assert.equal(nextHeaderVisibility({ mobile: true, current: 40, previous: 20, maximum: 500, hidden: false }), true);
  assert.equal(nextHeaderVisibility({ mobile: true, current: 25, previous: 40, maximum: 500, hidden: true }), false);
  assert.equal(nextHeaderVisibility({ mobile: true, current: 0, previous: 20, maximum: 500, hidden: true }), false);
  assert.equal(nextHeaderVisibility({ mobile: true, current: 40, previous: 20, maximum: 0, hidden: true }), false);
});
