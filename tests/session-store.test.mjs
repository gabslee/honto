import assert from "node:assert/strict";
import test from "node:test";
import { loadRoomSession, removeRoomSession, saveRoomSession, SESSION_STORAGE_KEY } from "../app/session-store.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("keeps independent persistent sessions for different rooms", () => {
  const storage = memoryStorage();
  saveRoomSession(storage, { code: "moon-101", token: "host-token" }, 1_000);
  saveRoomSession(storage, { code: "wave-202", token: "guest-token" }, 2_000);

  assert.deepEqual(loadRoomSession(storage, "MOON-101", 10_000, 3_000), { code: "MOON-101", token: "host-token" });
  assert.deepEqual(loadRoomSession(storage, "wave-202", 10_000, 3_000), { code: "WAVE-202", token: "guest-token" });
});

test("expires stale sessions and removes only the requested room", () => {
  const storage = memoryStorage();
  saveRoomSession(storage, { code: "MOON-101", token: "old" }, 1_000);
  saveRoomSession(storage, { code: "WAVE-202", token: "current" }, 9_000);

  assert.equal(loadRoomSession(storage, "MOON-101", 5_000, 10_000), null);
  assert.deepEqual(loadRoomSession(storage, "WAVE-202", 5_000, 10_000), { code: "WAVE-202", token: "current" });
  removeRoomSession(storage, "WAVE-202");
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null);
});
