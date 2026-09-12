export const multiplayerDeckKeys = ["honto", "wouldrather", "preference", "estimate", "who", "challenge", "both"];

export function lobbyAccess({ multiplayer, count, isHost, premium, busy = false }) {
  const minPlayers = multiplayer ? 3 : 2;
  const maxPlayers = multiplayer ? 6 : 2;
  return {
    minPlayers, maxPlayers,
    canStart: !busy && isHost && (!multiplayer || premium) && count >= minPlayers && count <= maxPlayers,
    canToggle: !busy && isHost && premium && (!multiplayer || count <= 2),
  };
}
