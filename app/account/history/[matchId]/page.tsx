import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, hasPremiumAccess } from "../../../server-auth";
import { historyMatchForUser } from "../../../match-history";
import { AccountShell, SignInRequired } from "../../account-shell";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const incoming = await headers();
  const user = await getCurrentUser(new Request("http://honto.local/account/history", { headers: incoming }));
  if (!user) return <SignInRequired/>;
  if (!hasPremiumAccess(user)) redirect("/account");
  const { matchId } = await params;
  const match = await historyMatchForUser(matchId, user.id) as any;
  if (!match) notFound();
  return <AccountShell><section className="history-head"><Link href="/account/history">← MATCH HISTORY</Link><span className="eyebrow">{match.mode === "multiplayer" ? "MULTIPLAYER" : "TWO PLAYERS"} · ROOM {match.roomCode}</span><h1>The final table.</h1><p>{match.playerCount} players · {match.cardCount} cards · {new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short" }).format(new Date(match.endedAt))}</p></section><section className="history-score panel">{match.players.map((player: any) => <div className={player.isMe ? "me" : ""} key={`${player.name}-${player.placement}`}><b>{player.isWinner ? "🏆" : `#${player.placement}`}</b><strong>{player.name}{player.isMe ? " · YOU" : ""}</strong><span>🍺 {player.sips} {player.sips === 1 ? "sip" : "sips"}</span></div>)}</section><p className="history-privacy">Private answers, prompts and secret choices were not stored.</p></AccountShell>;
}
