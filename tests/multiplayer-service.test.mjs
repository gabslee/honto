import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMultiplayerHost, assertRoomCapacity, assertMultiplayerStart, mutateWithRetry } from '../api/multiplayer-service.js';

test('only the authenticated Premium host may enable or start multiplayer', () => {
  const host = { is_host: true, user_id: 'owner' };
  assert.doesNotThrow(() => assertMultiplayerHost(host, 'owner', true));
  for (const args of [[host, 'owner', false], [host, 'guest', true], [{ ...host, is_host: false }, 'owner', true], [{ is_host: true }, null, true]]) {
    assert.throws(() => assertMultiplayerHost(...args), /Premium host/);
  }
});
test('duo capacity remains two; multiplayer holds six and starts with three through six', () => {
  assert.doesNotThrow(() => assertRoomCapacity(false, 1));
  assert.throws(() => assertRoomCapacity(false, 2), /full/);
  assert.doesNotThrow(() => assertRoomCapacity(true, 5));
  assert.throws(() => assertRoomCapacity(true, 6), /full/);
  for (let n = 3; n <= 6; n++) assert.doesNotThrow(() => assertMultiplayerStart(n));
  for (const n of [0, 1, 2, 7]) assert.throws(() => assertMultiplayerStart(n), /3 to 6/);
});
test('concurrent updates retry against fresh snapshots and preserve both responses', async () => {
  let state = { revision: 0, answers: [] };
  const read = async () => structuredClone(state);
  const commit = async (before, next) => {
    if (before.revision !== state.revision) return false;
    state = { ...next, revision: before.revision + 1 }; return true;
  };
  await Promise.all(['a', 'b'].map(id => mutateWithRetry(read, s => ({ ...s, answers: [...s.answers, id] }), commit)));
  assert.deepEqual(state.answers.sort(), ['a', 'b']);
  assert.equal(state.revision, 2);
});
test('CAS retry revalidates identity and phase, never commits a stale action', async () => {
  let reads = 0; let commits = 0;
  await assert.rejects(mutateWithRetry(async () => ({ active: ++reads === 1 }), s => {
    if (!s.active) throw new Error('Card changed'); return s;
  }, async () => { commits++; return false; }), /Card changed/);
  assert.equal(commits, 1);
});
test('contention is bounded and reports a retryable conflict', async () => {
  let attempts = 0;
  await assert.rejects(mutateWithRetry(async () => ({}), x => x, async () => { attempts++; return false; }), /changed/);
  assert.equal(attempts, 8);
});
