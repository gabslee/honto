export function roomPollDelay(status, visible = true) {
  if (!visible) return null;
  if (status === "playing") return 1400;
  if (status === "lobby") return 3000;
  return 8000;
}

export function connectionLabel({ online, refreshing, failed }) {
  if (!online) return "offline";
  if (refreshing || failed) return "reconnecting";
  return "online";
}
