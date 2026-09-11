export const SESSION_STORAGE_KEY = "honto-room-sessions";

function readSessionMap(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(SESSION_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadRoomSession(storage, code, ttlMs, now = Date.now()) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  const saved = readSessionMap(storage)[normalizedCode];
  if (!saved || typeof saved.token !== "string" || typeof saved.savedAt !== "number" || now - saved.savedAt >= ttlMs) {
    if (saved) removeRoomSession(storage, normalizedCode);
    return null;
  }
  return { code: normalizedCode, token: saved.token };
}

export function saveRoomSession(storage, session, now = Date.now()) {
  const code = String(session.code ?? "").trim().toUpperCase();
  if (!code || !session.token) return;
  const sessions = readSessionMap(storage);
  sessions[code] = { token: session.token, savedAt: now };
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

export function removeRoomSession(storage, code) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  const sessions = readSessionMap(storage);
  if (!(normalizedCode in sessions)) return;
  delete sessions[normalizedCode];
  if (Object.keys(sessions).length) storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  else storage.removeItem(SESSION_STORAGE_KEY);
}
