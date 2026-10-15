// Stable couple identity across rooms (pure helpers).
// Couple = logged-in host account + the partner's browser key (no partner account needed).
export const PARTNER_KEY_STORAGE = "honto-partner-key";
export const PARTNER_KEY_COOKIE = "honto_partner";

export function validPartnerKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{20,64}$/.test(value);
}

export function roomCoupleId(roomId) { return `room:${roomId}`; }

/** Which couple a room belongs to: stable when we know the host account and the partner's browser key. */
export function coupleKeyFor(players) {
  const host = players.find((player) => player.is_host);
  const partner = players.find((player) => !player.is_host);
  if (host?.user_id && partner && validPartnerKey(partner.partner_key)) return { hostUserId: host.user_id, partnerKey: partner.partner_key };
  return null;
}

export function roleFor(player) { return player?.is_host ? "host" : "partner"; }
