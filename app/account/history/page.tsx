import { headers } from "next/headers";
import Link from "next/link";
import { getCurrentUser, hasPremiumAccess } from "../../server-auth";
import { historyForUser } from "../../match-history";
import { AccountShell, SignInRequired } from "../account-shell";

export const dynamic = "force-dynamic";

function TrophyIcon() {
  return <svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "-0.125em" }}><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8 20h8"/></svg>;
}

export default async function HistoryPage() {
  const incoming = await headers();
  const user = await getCurrentUser(new Request("http://honto.local/account/history", { headers: incoming }));
  if (!user) return <SignInRequired/>;
  if (!hasPremiumAccess(user)) return <AccountShell><section className="history-empty panel"><span className="eyebrow">PREMIUM · MATCH HISTORY</span><h1>Your tables, remembered.</h1><p>Match history is a Premium feature. Upgrade to unlock scores and results from your completed games.</p><Link className="primary-button account-cta" href="/pricing">EXPLORE PREMIUM →</Link></section></AccountShell>;
  const matches = await historyForUser(user.id) as any[];
  return <AccountShell><section className="history-head"><span className="eyebrow">PREMIUM · MATCH HISTORY</span><h1>Your past tables.</h1><p>Only final scores and table metadata are saved. Your answers and card content remain private.</p></section>{matches.length ? <section className="history-list">{matches.map((match) => <Link href={`/account/history/${match.id}`} className="history-card" key={match.id}><div><span>{match.mode === "multiplayer" ? "MULTIPLAYER" : "TWO PLAYERS"}</span><h2>{match.isWinner ? <><TrophyIcon/> You won</> : `#${match.placement} finish`}</h2><p>{match.playerCount} players · {match.cardCount} cards · {match.sips} sips</p></div><time>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(match.endedAt))}</time></Link>)}</section> : <section className="history-empty panel"><h2>No completed matches yet.</h2><p>Finish a game while signed in and it will appear here.</p><Link className="primary-button account-cta" href="/">CREATE A ROOM →</Link></section>}</AccountShell>;
}
