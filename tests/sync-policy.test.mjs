import assert from "node:assert/strict";
import test from "node:test";
import { connectionLabel, roomPollDelay } from "../app/sync-policy.js";

test("room polling pauses in background and adapts to the current phase", () => {
  assert.equal(roomPollDelay("playing", true), 1400);
  assert.equal(roomPollDelay("lobby", true), 3000);
  assert.equal(roomPollDelay("finished", true), 8000);
  assert.equal(roomPollDelay("playing", false), null);
});

test("connection status distinguishes offline and reconnecting clients", () => {
  assert.equal(connectionLabel({ online: false, refreshing: false, failed: false }), "offline");
  assert.equal(connectionLabel({ online: true, refreshing: false, failed: true }), "reconnecting");
  assert.equal(connectionLabel({ online: true, refreshing: true, failed: false }), "reconnecting");
  assert.equal(connectionLabel({ online: true, refreshing: false, failed: false }), "online");
});
