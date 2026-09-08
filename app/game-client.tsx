"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { questionLibrary } from "./i18n";

type ThemeKey = "general" | "life" | "relationships" | "spicy";
type Player = { id: string; name: string; isHost: number; sips: number; joinedAt: string };
type Card = {
  id: string; cardNumber: number; type: "hidden" | "honto" | "question" | "preference" | "estimate" | "rps" | "both"; completedAt?: string | null;
  status: "hidden" | "ready" | "guess" | "choose" | "complete";
  actorId: string; actorName: string; targetId: string; targetName: string;
  payload: { prompt?: string; statements?: string[]; question?: string; sips?: number; options?: Array<number | string>; wrongGuesses?: number[]; hasChosen?: boolean; tieCount?: number };
  secret?: { truthIndex?: number; preferenceIndex?: number; correctNumber?: number };
  revealedBy?: string[];
  result: { correct?: boolean; guessedIndex?: number; choice?: "answer" | "skip"; skipped?: boolean; skipById?: string; drinkerId?: string | null; spinById?: string | null; wheelStartedAt?: string; sips?: number; correctNumber?: number; wrongGuesses?: number[]; firstTry?: boolean; actorChoice?: RpsChoice; targetChoice?: RpsChoice; bothDrink?: boolean };
};
type GameState = {
  room: { code: string; status: "lobby" | "playing" | "finished"; roundCount: number; currentRound: number; themeCategory: string; customTheme: string | null; startedAt: string | null };
  players: Player[]; activeCard: Card | null; lastCard: Card | null; meId: string;
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const THEME_KEYS: ThemeKey[] = ["general", "life", "relationships", "spicy"];
const THEME_LABELS: Record<ThemeKey, string> = { general: "General", life: "Life & stories", relationships: "Relationships", spicy: "Spicy · 18+" };
const LEGACY_THEME_MAP: Record<string, ThemeKey> = { mixed: "general", family: "general", innocent: "general", life: "life", flirty: "relationships", spicy: "spicy", wild: "general" };
const CARD_META = {
  honto: { icon: "🤥", label: "TWO LIES, ONE TRUTH", color: "yellow" },
  question: { icon: "❓", label: "QUESTION OR SIPS", color: "mint" },
  preference: { icon: "🧠", label: "READ MY MIND", color: "blue" },
  estimate: { icon: "🎯", label: "NUMBER ESTIMATE", color: "pink" },
  rps: { icon: "✊", label: "JOKEN-PÔ", color: "blue" },
  both: { icon: "🍻", label: "BOTH DRINK", color: "yellow" },
} as const;
type RpsChoice = "rock" | "paper" | "scissors";

function storedThemes(value?: string | null): ThemeKey[] {
  if (!value || value === "safe") return [];
  return [...new Set(value.split(",").map((key) => LEGACY_THEME_MAP[key.trim()]).filter((key): key is ThemeKey => Boolean(key)))];
}
function activeThemes(value?: string | null) {
  const selected = storedThemes(value);
  return selected.length ? selected : ["general", "life"] as ThemeKey[];
}
function shuffleLocal<T>(items: readonly T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}
async function gameApi(body: Record<string, unknown>) {
  const response = await fetch("/api/game", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "cache-control": "no-cache" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export default function GameClient() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [session, setSession] = useState<{ code: string; token: string } | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dismissedReveal, setDismissedReveal] = useState<string | null>(null);

  useEffect(() => {
    const room = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
    // A bare URL is always a fresh landing page. Never resurrect a previous room from storage without an explicit invite code.
    if (!room) { localStorage.removeItem("honto-session"); setSession(null); setJoinCode(""); setMode("create"); return; }
    const saved = localStorage.getItem("honto-session");
    if (saved) try {
      const parsed = JSON.parse(saved) as { code?: string; token?: string; savedAt?: number };
      if (parsed.code && parsed.token && parsed.savedAt && Date.now() - parsed.savedAt < SESSION_TTL_MS && (!room || room === parsed.code)) setSession({ code: parsed.code, token: parsed.token });
      else localStorage.removeItem("honto-session");
    } catch { localStorage.removeItem("honto-session"); }
    if (room) { setJoinCode(room); setMode("join"); }
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!session) return;
    try {
      const response = await fetch(`/api/game?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}&_=${Date.now()}`, { cache: "no-store", headers: { "cache-control": "no-cache" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "This room is no longer available.");
      setGame(data);
      if (!quiet) setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Connection error.";
      if (/room not found|no longer available|session is not valid|invalid session/i.test(message)) { localStorage.removeItem("honto-session"); setSession(null); setGame(null); setDismissedReveal(null); }
      if (!quiet) setError(message);
    }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => void refresh(true), 1800);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  async function enter(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await gameApi({ action: mode, name, code: joinCode });
      const next = { code: data.code, token: data.token };
      localStorage.setItem("honto-session", JSON.stringify({ ...next, savedAt: Date.now() }));
      history.replaceState({}, "", `?room=${encodeURIComponent(data.code)}`); setSession(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn't enter the room."); }
    finally { setBusy(false); }
  }

  async function act(action: string, extras: Record<string, unknown> = {}) {
    if (!session) return null;
    setBusy(true); setError("");
    try { const data = await gameApi({ action, ...session, ...extras }); setGame(data); return data; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong."); return null; }
    finally { setBusy(false); }
  }

  function leave() {
    localStorage.removeItem("honto-session"); history.replaceState({}, "", location.pathname);
    setSession(null); setGame(null); setDismissedReveal(null);
  }

  if (!session) return <Landing name={name} setName={setName} joinCode={joinCode} setJoinCode={setJoinCode} mode={mode} setMode={setMode} enter={enter} busy={busy} error={error} />;
  if (!game) return <main className="loading"><div className="stamp">HONTO?!</div><p>Shuffling the deck…</p>{error && <p className="form-error">{error}</p>}</main>;

  const host = game.players.find((player) => player.id === game.meId)?.isHost;
  const reveal = game.lastCard && game.lastCard.id !== dismissedReveal ? game.lastCard : null;
  const copyInvite = async () => { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${game.room.code}`); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };

  return <main className="app-shell">
    <header className="topbar"><button className="brand" onClick={leave}><span>HONTO?</span><b>!</b></button><div className="room-pill"><span className="live-dot"/>ROOM <strong>{game.room.code}</strong></div><div className="session-tools"><button className="tiny-button" onClick={leave}>EXIT</button></div></header>
    {error && <div className="toast error-toast">{error}<button onClick={() => setError("")}>×</button></div>}
    {game.room.status === "lobby" && <Lobby game={game} host={Boolean(host)} busy={busy} copied={copied} copyInvite={copyInvite} act={act} />}
    {game.room.status === "playing" && <GameTable game={game} busy={busy} act={act} />}
    {game.room.status === "finished" && <Finished players={game.players} leave={leave} />}
    {reveal && <Reveal card={reveal} players={game.players} meId={game.meId} close={() => setDismissedReveal(reveal.id)} spinWheel={() => act("startWheel")} />}
  </main>;
}

function Landing(props: { name: string; setName: (value: string) => void; joinCode: string; setJoinCode: (value: string) => void; mode: "create" | "join"; setMode: (value: "create" | "join") => void; enter: (event: FormEvent) => void; busy: boolean; error: string }) {
  return <main className="landing"><nav><div className="logo"><span>HONTO?</span><b>!</b></div><span className="microcopy">A SHARED DECK FOR TWO</span></nav><section className="hero"><div className="hero-copy"><span className="eyebrow">ONLINE PARTY GAME · 2 PLAYERS</span><h1>Draw a card.<br/><em>Read each other.</em></h1><p>Bluff, ask, read their mind, estimate, or battle. Every card decides who takes the next sip.</p><div className="rule-cards"><span><b>1</b>BLUFF</span><span><b>2</b>ASK</span><span><b>3</b>READ</span><span><b>4</b>ESTIMATE</span><span><b>5</b>RPS</span><span><b>6</b>BOTH</span></div></div><form className="entry-card" onSubmit={props.enter}><div className="card-tabs"><button type="button" className={props.mode === "create" ? "active" : ""} onClick={() => props.setMode("create")}>Create room</button><button type="button" className={props.mode === "join" ? "active" : ""} onClick={() => props.setMode("join")}>Join room</button></div><label>WHAT SHOULD WE CALL YOU?<input value={props.name} onChange={(event) => props.setName(event.target.value)} maxLength={24} placeholder="Your name or nickname" required /></label>{props.mode === "join" && <label>ROOM CODE<input value={props.joinCode} onChange={(event) => props.setJoinCode(event.target.value.toUpperCase())} maxLength={16} placeholder="MOON-42" required /></label>}{props.error && <p className="form-error">{props.error}</p>}<button className="primary-button" disabled={props.busy}>{props.busy ? "ONE SECOND…" : props.mode === "create" ? "CREATE THE DECK →" : "JOIN THE GAME →"}</button><small>No account needed. Alcoholic or non-alcoholic drinks both count.</small></form></section><footer>HONTO MEANS “IS IT TRUE?” IN JAPANESE.</footer></main>;
}

function Lobby({ game, host, busy, copied, copyInvite, act }: { game: GameState; host: boolean; busy: boolean; copied: boolean; copyInvite: () => void; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const [selected, setSelected] = useState<ThemeKey[]>(() => storedThemes(game.room.themeCategory));
  const selectedRef = useRef(selected);
  const themeSaveQueue = useRef(Promise.resolve());
  const configure = (extra: Record<string, unknown>) => act("configure", { roundCount: game.room.roundCount, themeCategory: game.room.themeCategory, customTheme: game.room.customTheme, ...extra });
  const toggleTheme = (key: ThemeKey) => {
    const current = selectedRef.current;
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    selectedRef.current = next;
    setSelected(next);
    themeSaveQueue.current = themeSaveQueue.current.then(() => configure({ themeCategory: next.join(",") })).then(() => undefined);
  };
  return <section className="lobby"><div className="lobby-head"><span className="eyebrow">SHUFFLING THE CARDS</span><h1>Your deck is <em>almost</em> ready.</h1><p>Invite one person. This table has exactly two seats.</p></div><div className="lobby-grid"><div className="panel"><div className="panel-title"><h2>At the table <small className="room-name-tip" title={`Room ${game.room.code}`}>ROOM {game.room.code}</small></h2><span>{game.players.length}/2</span></div><div className="people-list">{game.players.map((player, index) => <div className="person" key={player.id}><span className={`avatar avatar-${index}`}>{player.name[0]}</span><div><strong>{player.name}</strong><small>{player.isHost ? "host" : "ready to play"}</small></div><i>●</i></div>)}</div><button className="invite-button" onClick={copyInvite}>{copied ? "LINK COPIED! ✓" : "COPY INVITE LINK"}</button></div><div className="panel"><div className="panel-title"><h2>The deck</h2><span className="sticker">6 CARD TYPES</span></div><div className="setting"><label>Number of cards</label><div className="segmented">{[8, 12, 16, 24].map((count) => <button key={count} disabled={!host} className={game.room.roundCount === count ? "active" : ""} onClick={() => configure({ roundCount: count })}>{count}</button>)}</div></div><div className="setting"><label>Theme categories</label><p className="setting-hint">These guide the question and preference cards.</p><div className="subject-checks">{THEME_KEYS.map((key) => <label className={`subject-check ${key === "spicy" ? "spicy-check" : ""} ${selected.includes(key) ? "selected" : ""}`} key={key}><input type="checkbox" checked={selected.includes(key)} disabled={!host} onChange={() => toggleTheme(key)} /><span>{THEME_LABELS[key]}</span></label>)}</div></div><div className="setting"><label>Optional custom subject</label><input className="custom-setting" defaultValue={game.room.customTheme ?? ""} disabled={!host} placeholder="e.g. our travel stories" onBlur={(event) => configure({ customTheme: event.target.value })}/></div>{host ? <button className="primary-button start-button" disabled={busy || game.players.length !== 2} onClick={() => act("start")}>{game.players.length === 2 ? "SHUFFLE & START →" : "WAITING FOR PLAYER TWO…"}</button> : <div className="host-note">The host is choosing the deck.</div>}</div></div></section>;
}

function GameTable({ game, busy, act }: { game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const card = game.activeCard;
  const shownIntro = useRef(new Set<string>());
  const [introCardId, setIntroCardId] = useState<string | null>(null);
  const revealComplete = !card || card.status !== "ready" || (card.revealedBy ?? []).includes(card.actorId);
  useEffect(() => {
    if (card?.status === "ready" && !shownIntro.current.has(card.id)) {
      shownIntro.current.add(card.id);
      setIntroCardId(card.id);
    }
    if (card?.status === "ready" && (card.revealedBy ?? []).includes(card.actorId)) setIntroCardId(null);
  }, [card?.id, card?.status, card?.revealedBy?.length]);
  let content;
  if (!card) content = <Waiting title="Finding the next card…" text="The shared deck is syncing."/>;
  else if (card.status === "hidden") content = <DrawCard key={card.id} card={card} meId={game.meId} busy={busy} draw={() => act("drawCard")}/>;
  else if (!revealComplete) content = <Waiting title="Waiting for the card reveal." text={`${card.actorName} will reveal it for both players.`}/>;
  else if (card.type === "honto") content = <HontoCard key={card.id} card={card} meId={game.meId} game={game} busy={busy} act={act}/>;
  else if (card.type === "question") content = <QuestionCard key={card.id} card={card} meId={game.meId} game={game} busy={busy} act={act}/>;
  else if (card.type === "preference") content = <PreferenceCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else if (card.type === "estimate") content = <EstimateCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else if (card.type === "rps") content = <RpsCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else content = <BothDrinkCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  const canSkip = Boolean(card && revealComplete && ["ready", "guess", "choose"].includes(card.status));
  return <section className="game-stage"><div className="round-strip"><span>CARD</span><b>{game.room.currentRound}/{game.room.roundCount}</b><div className="progress"><i style={{ width: `${(game.room.currentRound / game.room.roundCount) * 100}%` }}/></div><span>{game.room.roundCount - game.room.currentRound} LEFT IN THE DECK</span></div><div className="round-controls">{canSkip && <SkipButton busy={busy} skip={() => act("skipCard")}/>}</div><ScoreRail players={game.players} meId={game.meId}/>{content}{introCardId === card?.id && card && <CardReveal card={card} meId={game.meId} acknowledge={() => act("ackReveal")}/>}</section>;
}

function SkipButton({ busy, skip }: { busy: boolean; skip: () => Promise<unknown> }) {
  return <button type="button" className="skip-button" title="Skip this mini game · spin for 2, 4 or 6 sips" aria-label="Skip this mini game. Spin for 2, 4 or 6 sips." disabled={busy} onClick={() => void skip()}><span>↷</span><strong>SKIP</strong><small><SipMug/> 2× SIP WHEEL</small></button>;
}

function DrawCard({ card, meId, busy, draw }: { card: Card; meId: string; busy: boolean; draw: () => Promise<unknown> }) {
  const mine = card.actorId === meId;
  const [flipping, setFlipping] = useState(false);
  const reveal = () => { if (busy || flipping) return; setFlipping(true); window.setTimeout(() => { void draw(); }, 720); };
  const cardFace = <><span className="playing-card-corner top">本当<small>?!</small></span><span className="playing-card-mark">!</span><span className="playing-card-center"><i>本当</i><strong>HONTO?!</strong><small>{mine ? "DRAW" : "WAIT"}</small></span><span className="playing-card-corner bottom">本当<small>?!</small></span></>;
  return <div className="play-card deck-draw"><span className="turn-badge">CARD {card.cardNumber}</span><h2>{mine ? "Your turn to draw." : `${card.actorName} is drawing the next card…`}</h2><p className="hint">{mine ? "Tap the card to reveal what comes next." : "The card will reveal on both screens."}</p><div className="draw-card-zone">{mine ? <button className={`honto-playing-card ${flipping ? "is-flipping" : ""}`} aria-label="Draw the next Honto card" disabled={busy || flipping} onClick={reveal}>{cardFace}</button> : <div className="honto-playing-card waiting-card" aria-hidden="true">{cardFace}</div>}</div></div>;
}

function CardReveal({ card, meId, acknowledge }: { card: Card; meId: string; acknowledge: () => Promise<unknown> }) {
  const meta = CARD_META[card.type as Exclude<Card["type"], "hidden">];
  const revealedBy = card.revealedBy ?? [];
  const actorHasRevealed = revealedBy.includes(card.actorId);
  const isActor = card.actorId === meId;
  const [turning, setTurning] = useState(false);
  const reveal = async () => {
    if (!isActor || actorHasRevealed || turning) return;
    setTurning(true);
    await new Promise((resolve) => window.setTimeout(resolve, 380));
    const result = await acknowledge();
    if (result === null) setTurning(false);
  };
  const waitingForActor = !actorHasRevealed && !isActor;
  return <div className="card-reveal-backdrop"><button type="button" className={`game-reveal-card reveal-${meta.color} ${turning ? "is-turning" : ""} ${waitingForActor ? "is-waiting" : ""}`} onClick={() => void reveal()} disabled={!isActor || actorHasRevealed || turning} aria-label={waitingForActor ? `Waiting for ${card.actorName} to reveal` : actorHasRevealed ? "Starting the next game" : `Reveal ${meta.label}`}><span className="game-reveal-kicker">THE NEXT CHALLENGE</span><span className="game-reveal-icon"><MiniGameIcon type={card.type as Exclude<Card["type"], "hidden">}/></span><strong className="game-reveal-kanji">本当?!</strong><h2>{meta.label}</h2>{waitingForActor ? <p className="game-reveal-status"><b>{card.actorName} is revealing the card.</b><br/>You&apos;ll join the mini game as soon as it opens.</p> : actorHasRevealed ? <p className="game-reveal-status"><b>Card revealed!</b><br/>Opening the mini game now.</p> : <p>Tap the card to reveal it for both players.</p>}<span className="game-reveal-cta">{waitingForActor ? `WAITING FOR ${card.actorName.toUpperCase()}…` : actorHasRevealed ? "OPENING NEXT GAME…" : "TAP TO REVEAL →"}</span></button></div>;
}

function MiniGameIcon({ type }: { type: Exclude<Card["type"], "hidden"> }) {
  const fill = type === "honto" || type === "both" ? "#ffd644" : type === "question" ? "#a8e6cf" : type === "preference" || type === "rps" ? "#a9d5ff" : "#ff8eab";
  const face = <><circle cx="37" cy="45" r="3.5" fill="currentColor"/><circle cx="59" cy="45" r="3.5" fill="currentColor"/><path d="M38 61c6 5 14 5 20 0" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></>;
  let art = <><circle cx="48" cy="48" r="40" fill={fill} stroke="currentColor" strokeWidth="4"/>{face}</>;
  if (type === "honto") art = <><rect x="23" y="28" width="34" height="47" rx="6" fill="#ff8eab" stroke="currentColor" strokeWidth="4" transform="rotate(-10 23 28)"/><rect x="39" y="20" width="34" height="47" rx="6" fill={fill} stroke="currentColor" strokeWidth="4" transform="rotate(8 39 20)"/><path d="M49 37h14M49 47h9" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M76 64l5 8 8-4-5-8z" fill="#f04444" stroke="currentColor" strokeWidth="3"/></>;
  if (type === "question") art = <><path d="M18 25c0-7 6-12 13-12h34c7 0 13 5 13 12v25c0 7-6 12-13 12H42L28 77V62h-2c-5-2-8-6-8-12z" fill={fill} stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="M42 32c2-5 12-5 14 1 2 7-7 8-7 14M49 56h.1" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/></>;
  if (type === "preference") art = <><circle cx="29" cy="47" r="17" fill="#ff8eab" stroke="currentColor" strokeWidth="4"/><circle cx="67" cy="31" r="17" fill={fill} stroke="currentColor" strokeWidth="4"/><circle cx="67" cy="67" r="17" fill="#a8e6cf" stroke="currentColor" strokeWidth="4"/><path d="M43 42l9-6M43 53l9 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>{face}</>;
  if (type === "estimate") art = <><circle cx="48" cy="48" r="34" fill={fill} stroke="currentColor" strokeWidth="4"/><circle cx="48" cy="48" r="20" fill="none" stroke="currentColor" strokeWidth="5"/><circle cx="48" cy="48" r="7" fill="#f04444" stroke="currentColor" strokeWidth="3"/><path d="M48 10v13M48 73v13M10 48h13M73 48h13" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M61 23l12 2-7 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></>;
  if (type === "rps") art = <><circle cx="48" cy="48" r="39" fill={fill} stroke="currentColor" strokeWidth="4"/><path d="M24 60V43c0-3 4-4 6-1l2 6V27c0-4 6-4 6 0v16-20c0-4 6-4 6 0v20-16c0-4 6-4 6 0v18-12c0-4 6-4 6 0v18c0 10-6 16-16 16H35c-6 0-11-4-11-7z" fill="#ff8eab" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/></>;
  if (type === "both") art = <><path d="M18 34h35v28c0 7-5 12-12 12H30c-7 0-12-5-12-12z" fill={fill} stroke="currentColor" strokeWidth="4"/><path d="M53 43h7c8 0 11 11 4 15h-9" fill="none" stroke="currentColor" strokeWidth="4"/><path d="M25 27h21M26 19h18" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M47 43h31v20c0 6-4 10-10 10H57" fill="#ff8eab" stroke="currentColor" strokeWidth="4"/><path d="M78 48h4c7 0 9 9 3 13h-7" fill="none" stroke="currentColor" strokeWidth="4"/></>;
  return <svg viewBox="0 0 96 96" className="mini-game-svg" aria-hidden="true" focusable="false">{art}</svg>;
}

function HontoCard({ card, meId, game, busy, act }: { card: Card; meId: string; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  if (card.status === "ready") return card.actorId === meId ? <HontoComposer card={card} game={game} busy={busy} act={act}/> : <Waiting title={`${card.actorName} is preparing a bluff…`} text="Two lies and one carefully hidden truth are on the way."/>;
  if (card.status === "guess") return card.targetId === meId ? <div className="play-card guesser"><CardBadge type="honto"/><h2>Which one is <em>{card.actorName}</em>&apos;s truth?</h2><div className="story-cards">{card.payload.statements?.map((story, index) => <button disabled={busy} onClick={() => act("guessHonto", { guessedIndex: index })} key={index}><span>0{index + 1}</span><p>{story}</p><b>THIS IS TRUE</b></button>)}</div><small><SipMug/> Your guess decides who faces the 1–3 sip wheel.</small></div> : <Waiting title="Your stories are on the table." text={`${card.targetName} is trying to find the truth.`}/>;
  return null;
}

function HontoComposer({ card, game, busy, act }: { card: Card; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const prompt = "personal truth";
  const [truth, setTruth] = useState(""); const [lies, setLies] = useState<string[]>([]); const [selected, setSelected] = useState<number[]>([]); const [generating, setGenerating] = useState(false);
  const generate = async () => { setGenerating(true); try { const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "lies", truth }) }); const data = await response.json(); if (!response.ok || !Array.isArray(data.lies)) throw new Error("No ideas available."); setLies(data.lies); setSelected([]); } finally { setGenerating(false); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); const chosen = selected.map((index) => lies[index]).filter(Boolean); if (chosen.length !== 2) return; const entries = [{ text: truth.trim(), truth: true }, ...chosen.map((text) => ({ text: text.trim(), truth: false }))].sort(() => Math.random() - .5); await act("submitHonto", { prompt, statements: entries.map((entry) => entry.text), truthIndex: entries.findIndex((entry) => entry.truth) }); };
  return <form className="play-card writer" onSubmit={submit}><CardBadge type="honto"/><h2>Tell one truth.<br/><em>Let the AI write five lies.</em></h2><p className="hint">Type one truth and the AI will help with 5 lie options.</p><label className="truth-editor"><span>YOUR TRUTH</span><textarea value={truth} onChange={(event) => setTruth(event.target.value)} maxLength={180} placeholder="Type one true story about yourself…"/></label><button type="button" className="ai-button" onClick={generate} disabled={generating || !truth.trim()}>{generating ? "WRITING LIES…" : "GENERATE 5 LIES ✦"}</button>{lies.length > 0 && <><p className="hint">Choose two of the five options. You can edit them before sending.</p><div className="lie-options">{lies.map((lie, index) => <label key={index} className={selected.includes(index) ? "selected" : ""}><input type="checkbox" checked={selected.includes(index)} onChange={() => setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : current.length < 2 ? [...current, index] : current)}/><textarea value={lie} maxLength={180} onChange={(event) => setLies((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}/><b>{selected.includes(index) ? "SELECTED" : "SELECT"}</b></label>)}</div><button className="primary-button" disabled={busy || selected.length !== 2}>SEND THREE STORIES →</button></>}</form>;
}

function QuestionCard({ card, meId, game, busy, act }: { card: Card; meId: string; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const localQuestions = activeThemes(game.room.themeCategory).flatMap((key) => questionLibrary[key]);
  const [question, setQuestion] = useState(""); const [sips, setSips] = useState(1); const [ideas, setIdeas] = useState<string[]>(() => shuffleLocal(localQuestions).slice(0, 3)); const questionPointer = useRef({ x: 0, y: 0, moved: false });
  const [showQuestionModal, setShowQuestionModal] = useState(false); const [questionHint, setQuestionHint] = useState(""); const [selectedThemes, setSelectedThemes] = useState<ThemeKey[]>(() => [activeThemes(game.room.themeCategory)[0] ?? "general"]); const [generating, setGenerating] = useState(false);
  const refreshIdeas = () => setIdeas(shuffleLocal(localQuestions).slice(0, 3));
  const generateWithAi = async () => { setGenerating(true); try { const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "question", count: 3, category: selectedThemes.length ? [selectedThemes[0]] : ["general"], customTheme: game.room.customTheme, questionHint }) }); const data = await response.json(); if (!response.ok || !Array.isArray(data.questions)) throw new Error("No questions available."); setIdeas(data.questions.slice(0, 3)); setShowQuestionModal(false); } catch (cause) { setIdeas(shuffleLocal(localQuestions).slice(0, 3)); setShowQuestionModal(false); } finally { setGenerating(false); } };
  if (card.status === "ready") return card.actorId === meId ? <><div className="play-card question-card"><CardBadge type="question"/><h2>Ask <em>{card.targetName}</em> anything.</h2><p className="hint">Choose a curated prompt, ask the AI for ideas, or write your own. If they answer out loud, you drink. If they skip, they drink.</p><textarea className="mini-game-input" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={220} placeholder="Write your question…"/><div className="question-tools"><button type="button" className="ai-button" onClick={() => setShowQuestionModal(true)}>GET 3 AI QUESTIONS ✦</button><button type="button" className="curated-button" onClick={refreshIdeas}>USE CURATED QUESTIONS ↻</button></div>{ideas.length > 0 && <div className="question-option-list"><span>CHOOSE ONE · {activeThemes(game.room.themeCategory).join(" · ").toUpperCase()}</span>{ideas.map((idea) => <button type="button" className="question-option" key={idea} onPointerDown={(event) => { questionPointer.current = { x: event.clientX, y: event.clientY, moved: false }; }} onPointerMove={(event) => { if (Math.hypot(event.clientX - questionPointer.current.x, event.clientY - questionPointer.current.y) > 10) questionPointer.current.moved = true; }} onPointerCancel={() => { questionPointer.current.moved = true; }} onClick={(event) => { if (questionPointer.current.moved && event.detail !== 0) { event.preventDefault(); return; } setQuestion(idea); }}>{idea}</button>)}</div>}<SipPicker value={sips} onChange={setSips}/><button className="primary-button" disabled={busy || question.trim().length < 3} onClick={() => act("submitQuestion", { question, sips })}>SEND QUESTION →</button></div>{showQuestionModal && <div className="question-ai-backdrop" role="presentation"><div className="question-ai-modal" role="dialog" aria-modal="true" aria-labelledby="question-ai-title"><button type="button" className="question-modal-close" aria-label="Close question helper" onClick={() => setShowQuestionModal(false)}>×</button><span className="eyebrow">QUESTION HELPER</span><h2 id="question-ai-title">What kind of question do you want to ask?</h2><textarea className="question-hint-input" value={questionHint} onChange={(event) => setQuestionHint(event.target.value)} maxLength={180} placeholder="e.g. something playful about a first date"/><fieldset className="question-theme-fieldset"><legend>Choose one theme</legend><div className="question-theme-checks">{THEME_KEYS.map((key) => <label key={key} className={selectedThemes.includes(key) ? "selected" : ""}><input type="radio" name="question-theme" checked={selectedThemes.includes(key)} onChange={() => setSelectedThemes([key])}/><span>{THEME_LABELS[key]}</span></label>)}</div></fieldset><button type="button" className="primary-button" disabled={generating} onClick={generateWithAi}>{generating ? "THINKING…" : "GENERATE 3 QUESTIONS →"}</button><p className="question-modal-note">Choose one category to guide the AI. Leave the text empty for broad prompts.</p></div></div>}</> : <Waiting title={`${card.actorName} is choosing a question…`} text="Answer honestly or take the sips."/>;
  if (card.status === "choose") return card.targetId === meId ? <div className="play-card question-card"><CardBadge type="question"/><h2>{card.actorName} wants to know…</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint"><SipMug/> Answer out loud and {card.actorName} takes {card.payload.sips} {card.payload.sips === 1 ? "sip" : "sips"}. Skip and you take them.</p><div className="mini-game-actions"><button className="primary-button" disabled={busy} onClick={() => act("answerQuestion", { choice: "answer" })}>I&apos;LL ANSWER</button><button className="primary-button dare-button" disabled={busy} onClick={() => act("answerQuestion", { choice: "skip" })}><SipMug/> TAKE {card.payload.sips} SIPS</button></div></div> : <Waiting title={`${card.targetName} is deciding…`} text={card.payload.question ?? "The question is on the table."}/>;
  return null;
}

function PreferenceCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const options = (card.payload.options ?? []).filter((option): option is string => typeof option === "string");
  const choiceButtons = (action: "choosePreference" | "guessPreference") => <div className="preference-options">{options.map((option, index) => <button key={option} aria-label={`Option ${index + 1}: ${option}`} disabled={busy} onClick={() => act(action, { preferenceIndex: index })}><span className="preference-number">0{index + 1}</span><p className="preference-label">{option}</p><small>CHOOSE THIS</small></button>)}</div>;
  if (card.status === "ready") return card.actorId === meId ? <div className="play-card preference-card"><CardBadge type="preference"/><h2>What would <em>you</em> choose?</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint">Choose secretly. {card.targetName} will try to read your mind.</p>{choiceButtons("choosePreference")}</div> : <Waiting title={`${card.actorName} is choosing secretly…`} text={card.payload.question ?? "Three options are on the table."}/>;
  if (card.status === "guess") return card.targetId === meId ? <div className="play-card preference-card"><CardBadge type="preference"/><h2>Read <em>{card.actorName}</em>&apos;s mind.</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint"><SipMug/> Guess correctly and {card.actorName} faces the sip wheel. Miss and you face it.</p>{choiceButtons("guessPreference")}</div> : <Waiting title={`${card.targetName} is trying to read your mind…`} text={card.payload.question ?? "Your choice is locked."}/>;
  return null;
}

function EstimateCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const [answer, setAnswer] = useState("");
  if (card.status === "ready") return card.actorId === meId ? <div className="play-card estimate-card"><CardBadge type="estimate"/><h2>Give the real number.</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint">Your answer stays secret. We will mix it with four believable options.</p><input className="number-answer" type="number" min="0" max="1000000" step="1" inputMode="numeric" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Your exact answer"/><button className="primary-button" disabled={busy || answer === ""} onClick={() => act("submitEstimate", { correctNumber: Number(answer) })}>LOCK MY ANSWER →</button></div> : <Waiting title={`${card.actorName} is locking in the real number…`} text={card.payload.question ?? "A numeric question is coming."}/>;
  const wrong = card.payload.wrongGuesses ?? [];
  const options = (card.payload.options ?? []).filter((option): option is number => typeof option === "number");
  if (card.status === "guess") return card.targetId === meId ? <div className="play-card estimate-card"><CardBadge type="estimate"/><h2>How well do you know <em>{card.actorName}</em>?</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint"><SipMug/> A wrong guess costs one sip. Keep guessing until you find it.</p><div className="estimate-options">{options.map((option) => <button key={option} className={wrong.includes(option) ? "eliminated" : ""} disabled={busy || wrong.includes(option)} onClick={() => act("guessEstimate", { estimate: option })}><strong>{option.toLocaleString()}</strong>{wrong.includes(option) && <small><SipMug/> WRONG · 1 SIP</small>}</button>)}</div><p className="attempt-count">{wrong.length ? <><SipMug/> {wrong.length} wrong {wrong.length === 1 ? "guess" : "guesses"} · {wrong.length} {wrong.length === 1 ? "sip" : "sips"}</> : "First try: if you nail it, they drink."}</p></div> : <Waiting title={`${card.targetName} is estimating…`} text={`${wrong.length} wrong ${wrong.length === 1 ? "guess" : "guesses"} so far.`}/>;
  return null;
}

const RPS_OPTIONS: Array<{ value: RpsChoice; icon: string; label: string }> = [
  { value: "rock", icon: "✊", label: "ROCK" },
  { value: "paper", icon: "✋", label: "PAPER" },
  { value: "scissors", icon: "✌️", label: "SCISSORS" },
];

function RpsCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const opponent = card.actorId === meId ? card.targetName : card.actorName;
  const [showTie, setShowTie] = useState(false); const seenTie = useRef(0);
  useEffect(() => { const tieCount = Number(card.payload.tieCount ?? 0); if (tieCount > seenTie.current) { seenTie.current = tieCount; setShowTie(true); const timer = window.setTimeout(() => setShowTie(false), 2800); return () => window.clearTimeout(timer); } return undefined; }, [card.payload.tieCount]);
  if (card.payload.hasChosen) return <Waiting title="Your move is locked." text={`Waiting for ${opponent} to choose. They cannot see your move.`}/>;
  return <><div className="play-card rps-card"><CardBadge type="rps"/><h2>{card.payload.tieCount ? "Tie! Joken-pô again." : `Joken-pô vs ${opponent}.`}</h2><p className="hint"><SipMug/> Pick secretly. The loser spins the 1–3 SIP wheel.</p><div className="rps-options">{RPS_OPTIONS.map((option) => <button key={option.value} disabled={busy || showTie} onClick={() => act("chooseRps", { rpsChoice: option.value })}><span>{option.icon}</span><strong>{option.label}</strong></button>)}</div></div>{showTie && <div className="rps-tie-backdrop"><div className="rps-tie-card" role="status" aria-live="polite"><span className="eyebrow">JOKEN-PÔ</span><div className="rps-tie-hands"><span>✊</span><b>VS</b><span>✊</span></div><h2>Tie!</h2><p>You both chose the same move. Get ready to try again.</p><div className="reveal-dots"><i/><i/><i/></div></div></div>}</>;
}

function BothDrinkCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const mine = card.actorId === meId;
  return <div className="play-card both-card"><CardBadge type="both"/><h2>No guessing.<br/><em>Both of you drink.</em></h2><p className="hint"><SipMug/> Spin once. The result applies to both players.</p>{mine ? <button className="primary-button spin-button" disabled={busy} onClick={() => act("spinBoth")}><SipMug/> SPIN FOR BOTH →</button> : <div className="both-waiting"><span className="both-waiting-orbit"/><strong>{card.actorName} is rolling the sip wheel…</strong><small>You will both drink the result.</small></div>}</div>;
}

function CardBadge({ type }: { type: Exclude<Card["type"], "hidden"> }) { const meta = CARD_META[type]; return <span className={`card-type-badge ${meta.color}`}><b>{meta.icon}</b>{meta.label}</span>; }
function SipMug() { return <span className="sip-mug" aria-hidden="true">🍺</span>; }
function SipPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <div className="sip-picker-wrap"><span><SipMug/> HOW MANY SIPS?</span><div className="sip-picker">{[1, 2, 3].map((sips) => <button type="button" key={sips} className={value === sips ? "active" : ""} onClick={() => onChange(sips)}><SipMug/><strong>{sips}</strong><small>{sips === 1 ? "SIP" : "SIPS"}</small></button>)}</div></div>; }
function Waiting({ title, text }: { title: string; text: string }) { return <div className="play-card waiting"><div className="bobble">🃏</div><span className="turn-badge">HANG TIGHT</span><h2>{title}</h2><p>{text}</p><div className="typing"><i/><i/><i/></div></div>; }
function ScoreRail({ players, meId }: { players: Player[]; meId: string }) { return <aside className="score-rail">{players.map((player, index) => <div key={player.id}><span className={`avatar avatar-${index}`}>{player.name[0]}</span><strong>{player.name}{player.id === meId ? " · you" : ""}</strong><small><SipMug/> {player.sips} {player.sips === 1 ? "sip" : "sips"}</small></div>)}</aside>; }

function Reveal({ card, players, meId, close, spinWheel }: { card: Card; players: Player[]; meId: string; close: () => void; spinWheel: () => Promise<unknown> }) {
  const hasWheel = Boolean(card.result.skipped) || card.type === "honto" || card.type === "preference" || card.type === "rps" || card.type === "both";
  const doubleSips = Boolean(card.result.skipped);
  const [requestingSpin, setRequestingSpin] = useState(false);
  const initialCompleteElapsed = Math.max(0, Date.now() - (card.completedAt ? new Date(card.completedAt).getTime() : Date.now()));
  const initialSpinElapsed = card.result.wheelStartedAt ? Math.max(0, Date.now() - new Date(card.result.wheelStartedAt).getTime()) : 0;
  const introDuration = card.type === "rps" ? 3800 : 1200;
  const wheelDuration = 4700;
  const [revealPhase, setRevealPhase] = useState<"intro" | "ready" | "spinning" | "result">(!hasWheel ? "result" : card.result.wheelStartedAt ? (initialSpinElapsed < wheelDuration ? "spinning" : "result") : initialCompleteElapsed < introDuration ? "intro" : "ready");
  useEffect(() => {
    if (!hasWheel) { setRevealPhase("result"); return; }
    const completeElapsed = Math.max(0, Date.now() - (card.completedAt ? new Date(card.completedAt).getTime() : Date.now()));
    if (!card.result.wheelStartedAt) {
      setRevealPhase(completeElapsed < introDuration ? "intro" : "ready");
      const readyTimer = window.setTimeout(() => setRevealPhase("ready"), Math.max(0, introDuration - completeElapsed));
      return () => window.clearTimeout(readyTimer);
    }
    const spinElapsed = Math.max(0, Date.now() - new Date(card.result.wheelStartedAt).getTime());
    setRevealPhase(spinElapsed < wheelDuration ? "spinning" : "result");
    const resultTimer = window.setTimeout(() => setRevealPhase("result"), Math.max(0, wheelDuration - spinElapsed));
    return () => window.clearTimeout(resultTimer);
  }, [card.id, card.completedAt, card.result.wheelStartedAt, hasWheel]);
  const drinker = players.find((player) => player.id === card.result.drinkerId)?.name;
  let icon = "✓"; let eyebrow = "CARD COMPLETE"; let title = drinker ? `${drinker} drinks.` : "You found the number."; let detail = "The next card is waiting.";
  if (card.type === "honto") { icon = card.result.correct ? "✓" : "×"; eyebrow = card.result.correct ? "TRUTH FOUND" : "BLUFF SUCCESS"; title = card.result.correct ? `${card.targetName} found the truth. ${drinker} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.` : `${card.targetName} fell for the bluff and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `The truth was: “${card.payload.statements?.[card.secret?.truthIndex ?? 0]}”`; }
  if (card.type === "question") { icon = card.result.choice === "answer" ? "💬" : "🥃"; eyebrow = card.result.choice === "answer" ? "ANSWERED OUT LOUD" : "QUESTION SKIPPED"; title = `${drinker} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = card.result.choice === "answer" ? `${card.targetName} chose to answer, so the asker drinks.` : `${card.targetName} chose not to answer.`; }
  if (card.type === "preference") { const chosen = card.payload.options?.[card.secret?.preferenceIndex ?? 0]; icon = card.result.correct ? "🧠" : "×"; eyebrow = card.result.correct ? "MIND READ" : "NOT EVEN CLOSE"; title = card.result.correct ? `${card.targetName} guessed it. ${card.actorName} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.` : `${card.targetName} missed and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `${card.actorName} chose “${chosen}”.`; }
  if (card.type === "estimate") { icon = "🎯"; eyebrow = card.result.firstTry ? "FIRST TRY" : "NUMBER FOUND"; title = card.result.firstTry ? `${card.targetName} nailed it. ${card.actorName} drinks.` : `${card.targetName} found it after ${card.result.wrongGuesses?.length} misses.`; detail = `The correct answer was ${card.result.correctNumber}.`; }
  if (card.type === "rps") { const labels = { rock: "Rock ✊", paper: "Paper ✋", scissors: "Scissors ✌️" }; icon = "⚔️"; eyebrow = "JOKEN-PÔ COMPLETE"; title = `${drinker} loses and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `${card.actorName}: ${labels[card.result.actorChoice ?? "rock"]} · ${card.targetName}: ${labels[card.result.targetChoice ?? "rock"]}`; }
  if (card.type === "both") { icon = "🍻"; eyebrow = "BOTH DRINK"; title = `Both take ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `${players.map((player) => player.name).join(" & ")}, cheers!`; }
  if (doubleSips) { const skipper = players.find((player) => player.id === (card.result.skipById ?? card.result.drinkerId))?.name ?? "The player"; icon = "↷"; eyebrow = "MINI GAME SKIPPED"; title = `${skipper} skips and takes ${card.result.sips} sips.`; detail = "Skipping doubles the wheel result: 2, 4, or 6 sips."; }
  const viewerDrinks = card.result.drinkerId === meId;
  const spinnerId = card.result.spinById ?? (card.type === "both" ? card.actorId : card.result.drinkerId);
  const spinnerName = players.find((player) => player.id === spinnerId)?.name ?? "The player";
  const rpsEmojis = { rock: "✊", paper: "✋", scissors: "✌️" };
  const rpsLoserName = drinker ? spinnerName : "The loser";
  const introTitle = doubleSips ? "Skip & sip!" : card.type === "rps" ? "Joken-pô!" : card.type === "both" ? "Everyone, cheers!" : card.type === "honto" ? "Truth or bluff?" : "Mind read complete!";
  if (revealPhase === "intro") return <div className="modal-backdrop reveal-intro-backdrop"><div className={`reveal-card reveal-intro ${card.type === "rps" ? "rps-reveal-intro" : ""}`} role="status" aria-live="polite"><div className="result-mark">{icon}</div><span className="eyebrow">{eyebrow}</span>{card.type === "rps" ? <><h2>Joken-pô!</h2><div className="rps-reveal-battle"><div><span>{rpsEmojis[card.result.actorChoice ?? "rock"]}</span><small>{card.actorName}</small></div><b>VS</b><div><span>{rpsEmojis[card.result.targetChoice ?? "rock"]}</span><small>{card.targetName}</small></div></div><p className="rps-winner-callout"><strong>{rpsLoserName}</strong> loses this round.</p></> : <><h2>{introTitle}</h2><p className="reveal-intro-copy">The table is getting ready to find out who takes the next sip.</p><div className="reveal-dots"><i/><i/><i/></div></>}</div></div>;
  if (revealPhase === "ready") return <div className="modal-backdrop"><div className="reveal-card wheel-ready" role="dialog" aria-live="polite"><div className="result-mark">{icon}</div><span className="eyebrow"><SipMug/> SIP WHEEL</span><h2>Ready to spin?</h2><p className="reveal-intro-copy">{doubleSips ? "Skipping doubles the wheel: 2, 4, or 6 sips." : card.type === "both" ? "One spin sets the SIPs for both players." : `${spinnerName} takes the wheel.`}</p><div className="sip-wheel-stage wheel-ready-stage"><i className="sip-wheel-pointer"/><div className="sip-wheel sip-wheel-static"><span className="sip-wheel-number one">{doubleSips ? 2 : 1}</span><span className="sip-wheel-number two">{doubleSips ? 4 : 2}</span><span className="sip-wheel-number three">{doubleSips ? 6 : 3}</span></div></div>{meId === spinnerId ? <button type="button" className="wheel-start-button" aria-label="Spin the sip wheel" disabled={requestingSpin} onClick={async () => { setRequestingSpin(true); try { await spinWheel(); } finally { setRequestingSpin(false); } }}>{requestingSpin ? "STARTING THE WHEEL…" : <><SipMug/> SPIN</>}</button> : <p className="wheel-waiting"><strong>{spinnerName}</strong> is ready to spin the wheel…</p>}</div></div>;
  if (revealPhase === "spinning") return <div className="modal-backdrop"><div className="reveal-card wheel-card" role="status" aria-live="polite"><span className="eyebrow"><SipMug/> SIP WHEEL</span><h2>How many sips?</h2><div className="sip-wheel-stage"><i className="sip-wheel-pointer"/><div className="sip-wheel"><span className="sip-wheel-number one">{doubleSips ? 2 : 1}</span><span className="sip-wheel-number two">{doubleSips ? 4 : 2}</span><span className="sip-wheel-number three">{doubleSips ? 6 : 3}</span></div></div><p><SipMug/> {spinnerName} is spinning the wheel…</p></div></div>;
  return <div className="modal-backdrop"><div className={`reveal-card ${viewerDrinks || card.type === "both" ? "wrong" : "correct"}`}><div className="result-mark">{icon}</div><span className="eyebrow">{eyebrow}</span>{hasWheel && <div className="wheel-result"><span>THE WHEEL SAYS</span><strong>{card.result.sips}</strong><small><SipMug/> {card.result.sips === 1 ? "SIP" : "SIPS"}</small></div>}<h2>{(card.result.drinkerId || card.type === "both") && <SipMug/>} {title}</h2><blockquote>{detail}</blockquote><button className="primary-button" onClick={close}>NEXT CARD →</button></div></div>;
}

function Finished({ players, leave }: { players: Player[]; leave: () => void }) {
  const sorted = useMemo(() => [...players].sort((a, b) => a.sips - b.sips), [players]);
  return <section className="finished"><span className="eyebrow">THE DECK IS EMPTY</span><h1>The lightest drinker was…</h1><div className="winner">🏆<strong>{sorted[0]?.name}</strong><span><SipMug/> {sorted[0]?.sips} {sorted[0]?.sips === 1 ? "sip" : "sips"}</span></div><div className="final-list">{sorted.map((player, index) => <div key={player.id}><b>#{index + 1}</b><span>{player.name}</span><small><SipMug/> {player.sips} {player.sips === 1 ? "sip" : "sips"}</small></div>)}</div><button className="primary-button" onClick={leave}>NEW TABLE →</button></section>;
}
