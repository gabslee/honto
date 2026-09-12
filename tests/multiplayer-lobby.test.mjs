import assert from "node:assert/strict";
import test from "node:test";
import { lobbyAccess, multiplayerDeckKeys } from "../app/multiplayer-lobby-rules.js";

test("Free hosts keep two seats and cannot enable multiplayer", () => {
  const access = lobbyAccess({ multiplayer: false, count: 2, isHost: true, premium: false });
  assert.equal(access.canStart, true);
  assert.equal(access.canToggle, false);
  assert.equal(access.maxPlayers, 2);
});
test("multiplayer starts only with a Premium host and three to six participants", () => {
  for (let count = 0; count <= 7; count++) {
    assert.equal(lobbyAccess({ multiplayer: true, count, isHost: true, premium: true }).canStart, count >= 3 && count <= 6);
    assert.equal(lobbyAccess({ multiplayer: true, count, isHost: true, premium: false }).canStart, false);
    assert.equal(lobbyAccess({ multiplayer: true, count, isHost: false, premium: true }).canStart, false);
  }
});
test("switching back to two seats cannot strand existing participants", () => {
  assert.equal(lobbyAccess({ multiplayer: true, count: 3, isHost: true, premium: true }).canToggle, false);
  assert.equal(lobbyAccess({ multiplayer: true, count: 2, isHost: true, premium: true }).canToggle, true);
});
test("pending mutations disable start and mode changes", () => {
  const access = lobbyAccess({ multiplayer: true, count: 3, isHost: true, premium: true, busy: true });
  assert.equal(access.canStart, false);
  assert.equal(access.canToggle, false);
});
test("the group deck omits questions and standalone rps, and adds voting and challenges", () => {
  assert.deepEqual(multiplayerDeckKeys, ["honto", "wouldrather", "preference", "estimate", "who", "challenge", "both"]);
});
