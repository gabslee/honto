/** Entitlement belongs to the authenticated host, never to a guest borrowing a room token. */
export function assertMultiplayerHost(player, userId, premium) {
  if (!player.is_host || !userId || player.user_id !== userId || !premium) throw new Error('Only the signed-in Premium host can enable or start multiplayer.');
}
export function assertRoomCapacity(multiplayer, count) {
  if (count >= (multiplayer ? 6 : 2)) throw new Error('This room is full.');
}
export function assertMultiplayerStart(count) {
  if (count < 3 || count > 6) throw new Error('Multiplayer needs 3 to 6 players.');
}
/** Re-read and revalidate on every optimistic conflict. commit must be a single atomic statement. */
export async function mutateWithRetry(read, reduce, commit) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await read();
    const next = await reduce(before);
    if (await commit(before, next)) return next;
  }
  throw new Error('The room changed while processing this action. Please try again.');
}
