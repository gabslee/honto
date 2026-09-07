"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { themeCategories } from "./i18n";

type ThemeKey = "mixed" | "family" | "innocent" | "life" | "flirty" | "spicy";
type Player = { id: string; name: string; isHost: number; sips: number; joinedAt: string };
type Card = {
  id: string; cardNumber: number; type: "hidden" | "honto" | "question" | "preference" | "estimate" | "rps" | "both";
  status: "hidden" | "ready" | "guess" | "choose" | "complete";
  actorId: string; actorName: string; targetId: string; targetName: string;
  payload: { prompt?: string; statements?: string[]; question?: string; sips?: number; options?: Array<number | string>; wrongGuesses?: number[]; hasChosen?: boolean; tieCount?: number };
  secret?: { truthIndex?: number; preferenceIndex?: number; correctNumber?: number };
  result: { correct?: boolean; guessedIndex?: number; choice?: "answer" | "skip"; drinkerId?: string | null; sips?: number; correctNumber?: number; wrongGuesses?: number[]; firstTry?: boolean; actorChoice?: RpsChoice; targetChoice?: RpsChoice; bothDrink?: boolean };
};
type GameState = {
  room: { code: string; status: "lobby" | "playing" | "finished"; roundCount: number; currentRound: number; themeCategory: string; customTheme: string | null; startedAt: string | null };
  players: Player[]; activeCard: Card | null; lastCard: Card | null; meId: string;
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const THEME_KEYS: ThemeKey[] = ["mixed", "family", "innocent", "life", "flirty", "spicy"];
const THEME_LABELS: Record<ThemeKey, string> = { mixed: "General", family: "Family", innocent: "Innocent & silly", life: "Life stories", flirty: "Flirty", spicy: "Spicy · 18+" };
const CARD_META = {
  honto: { icon: "🤥", label: "TWO LIES, ONE TRUTH", color: "yellow" },
  question: { icon: "❓", label: "QUESTION OR SIPS", color: "mint" },
  preference: { icon: "🧠", label: "READ MY MIND", color: "blue" },
  estimate: { icon: "🎯", label: "NUMBER ESTIMATE", color: "pink" },
  rps: { icon: "✊", label: "ROCK PAPER SCISSORS", color: "blue" },
  both: { icon: "🍻", label: "BOTH DRINK", color: "yellow" },
} as const;
type RpsChoice = "rock" | "paper" | "scissors";

function storedThemes(value?: string | null): ThemeKey[] {
  if (!value || value === "safe") return [];
  return value.split(",").filter((key): key is ThemeKey => THEME_KEYS.includes(key as ThemeKey));
}
function activeThemes(value?: string | null) {
  const selected = storedThemes(value);
  return selected.length ? selected : ["mixed", "family", "innocent", "life"] as ThemeKey[];
}
async function gameApi(body: Record<string, unknown>) {
  const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
      const response = await fetch(`/api/game?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "This room is no longer available.");
      setGame(data);
      if (!quiet) setError("");
    } catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : "Connection error."); }
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
    {reveal && <Reveal card={reveal} players={game.players} meId={game.meId} close={() => setDismissedReveal(reveal.id)} />}
  </main>;
}

function Landing(props: { name: string; setName: (value: string) => void; joinCode: string; setJoinCode: (value: string) => void; mode: "create" | "join"; setMode: (value: "create" | "join") => void; enter: (event: FormEvent) => void; busy: boolean; error: string }) {
  return <main className="landing"><nav><div className="logo"><span>HONTO?</span><b>!</b></div><span className="microcopy">A SHARED DECK FOR TWO</span></nav><section className="hero"><div className="hero-copy"><span className="eyebrow">ONLINE PARTY GAME · 2 PLAYERS</span><h1>Draw a card.<br/><em>Read each other.</em></h1><p>Bluff, ask, read their mind, estimate, or battle. Every card decides who takes the next sip.</p><div className="rule-cards"><span><b>1</b>BLUFF</span><span><b>2</b>ASK</span><span><b>3</b>READ</span><span><b>4</b>ESTIMATE</span><span><b>5</b>RPS</span><span><b>6</b>BOTH</span></div></div><form className="entry-card" onSubmit={props.enter}><div className="card-tabs"><button type="button" className={props.mode === "create" ? "active" : ""} onClick={() => props.setMode("create")}>Create room</button><button type="button" className={props.mode === "join" ? "active" : ""} onClick={() => props.setMode("join")}>Join room</button></div><label>WHAT SHOULD WE CALL YOU?<input value={props.name} onChange={(event) => props.setName(event.target.value)} maxLength={24} placeholder="Your name or nickname" required /></label>{props.mode === "join" && <label>ROOM CODE<input value={props.joinCode} onChange={(event) => props.setJoinCode(event.target.value.toUpperCase())} maxLength={16} placeholder="MOON-42" required /></label>}{props.error && <p className="form-error">{props.error}</p>}<button className="primary-button" disabled={props.busy}>{props.busy ? "ONE SECOND…" : props.mode === "create" ? "CREATE THE DECK →" : "JOIN THE GAME →"}</button><small>No account needed. Alcoholic or non-alcoholic drinks both count.</small></form></section><footer>HONTO MEANS “IS IT TRUE?” IN JAPANESE.</footer></main>;
}

function Lobby({ game, host, busy, copied, copyInvite, act }: { game: GameState; host: boolean; busy: boolean; copied: boolean; copyInvite: () => void; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const selected = storedThemes(game.room.themeCategory);
  const configure = (extra: Record<string, unknown>) => act("configure", { roundCount: game.room.roundCount, themeCategory: game.room.themeCategory, customTheme: game.room.customTheme, ...extra });
  const toggleTheme = (key: ThemeKey) => { const next = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]; void configure({ themeCategory: next.join(",") }); };
  return <section className="lobby"><div className="lobby-head"><span className="eyebrow">SHUFFLING THE CARDS</span><h1>Your deck is <em>almost</em> ready.</h1><p>Invite one person. This table has exactly two seats.</p></div><div className="lobby-grid"><div className="panel"><div className="panel-title"><h2>At the table</h2><span>{game.players.length}/2</span></div><div className="people-list">{game.players.map((player, index) => <div className="person" key={player.id}><span className={`avatar avatar-${index}`}>{player.name[0]}</span><div><strong>{player.name}</strong><small>{player.isHost ? "host" : "ready to play"}</small></div><i>●</i></div>)}</div><button className="invite-button" onClick={copyInvite}>{copied ? "LINK COPIED! ✓" : "COPY INVITE LINK"}</button></div><div className="panel"><div className="panel-title"><h2>The deck</h2><span className="sticker">6 CARD TYPES</span></div><div className="setting"><label>Number of cards</label><div className="segmented">{[8, 12, 16, 24].map((count) => <button key={count} disabled={!host} className={game.room.roundCount === count ? "active" : ""} onClick={() => configure({ roundCount: count })}>{count}</button>)}</div></div><div className="setting"><label>Theme categories</label><p className="setting-hint">These guide AI ideas for stories and questions.</p><div className="subject-checks">{THEME_KEYS.map((key) => <label className={`subject-check ${key === "spicy" ? "spicy-check" : ""} ${selected.includes(key) ? "selected" : ""}`} key={key}><input type="checkbox" checked={selected.includes(key)} disabled={!host} onChange={() => toggleTheme(key)} /><span>{THEME_LABELS[key]}</span></label>)}</div></div><div className="setting"><label>Optional custom subject</label><input className="custom-setting" defaultValue={game.room.customTheme ?? ""} disabled={!host} placeholder="e.g. our travel stories" onBlur={(event) => configure({ customTheme: event.target.value })}/></div>{host ? <button className="primary-button start-button" disabled={busy || game.players.length !== 2} onClick={() => act("start")}>{game.players.length === 2 ? "SHUFFLE & START →" : "WAITING FOR PLAYER TWO…"}</button> : <div className="host-note">The host is choosing the deck.</div>}</div></div></section>;
}

function GameTable({ game, busy, act }: { game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const card = game.activeCard;
  let content;
  if (!card) content = <Waiting title="Finding the next card…" text="The shared deck is syncing."/>;
  else if (card.status === "hidden") content = <DrawCard key={card.id} card={card} meId={game.meId} busy={busy} draw={() => act("drawCard")}/>;
  else if (card.type === "honto") content = <HontoCard key={card.id} card={card} meId={game.meId} game={game} busy={busy} act={act}/>;
  else if (card.type === "question") content = <QuestionCard key={card.id} card={card} meId={game.meId} game={game} busy={busy} act={act}/>;
  else if (card.type === "preference") content = <PreferenceCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else if (card.type === "estimate") content = <EstimateCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else if (card.type === "rps") content = <RpsCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else content = <BothDrinkCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  return <section className="game-stage"><div className="round-strip"><span>CARD</span><b>{game.room.currentRound}/{game.room.roundCount}</b><div className="progress"><i style={{ width: `${(game.room.currentRound / game.room.roundCount) * 100}%` }}/></div><span>{game.room.roundCount - game.room.currentRound} LEFT IN THE DECK</span></div><ScoreRail players={game.players} meId={game.meId}/>{content}</section>;
}

function DrawCard({ card, meId, busy, draw }: { card: Card; meId: string; busy: boolean; draw: () => Promise<unknown> }) {
  const mine = card.actorId === meId;
  const cardFace = <><span className="playing-card-corner top">本当<small>?!</small></span><span className="playing-card-mark">!</span><span className="playing-card-center"><i>本当</i><strong>HONTO?!</strong><small>{mine ? "DRAW" : "WAIT"}</small></span><span className="playing-card-corner bottom">本当<small>?!</small></span></>;
  return <div className="play-card deck-draw"><span className="turn-badge">CARD {card.cardNumber}</span><h2>{mine ? "Your turn to draw." : `${card.actorName} is drawing the next card…`}</h2><p className="hint">{mine ? "Tap the card to reveal what comes next." : "The card will turn over on both screens."}</p><div className="draw-card-zone">{mine ? <button className="honto-playing-card" aria-label="Draw the next Honto card" disabled={busy} onClick={draw}>{cardFace}</button> : <div className="honto-playing-card waiting-card" aria-hidden="true">{cardFace}</div>}</div></div>;
}

function HontoCard({ card, meId, game, busy, act }: { card: Card; meId: string; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  if (card.status === "ready") return card.actorId === meId ? <HontoComposer card={card} game={game} busy={busy} act={act}/> : <Waiting title={`${card.actorName} is preparing a bluff…`} text="Two lies and one carefully hidden truth are on the way."/>;
  if (card.status === "guess") return card.targetId === meId ? <div className="play-card guesser"><CardBadge type="honto"/><h2>Which one is <em>{card.actorName}</em>&apos;s truth?</h2><p className="prompt-caption">THEME: {card.payload.prompt?.toUpperCase()}</p><div className="story-cards">{card.payload.statements?.map((story, index) => <button disabled={busy} onClick={() => act("guessHonto", { guessedIndex: index })} key={index}><span>0{index + 1}</span><p>{story}</p><b>THIS IS TRUE</b></button>)}</div><small><SipMug/> Your guess decides who faces the 1–3 sip wheel.</small></div> : <Waiting title="Your stories are on the table." text={`${card.targetName} is trying to find the truth.`}/>;
  return null;
}

function HontoComposer({ card, game, busy, act }: { card: Card; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const localPrompts = activeThemes(game.room.themeCategory).flatMap((key) => themeCategories[key]);
  const [prompt, setPrompt] = useState<string>(localPrompts[Math.floor(Math.random() * localPrompts.length)] ?? "a story your friend does not know");
  const [truth, setTruth] = useState(""); const [lies, setLies] = useState<string[]>([]); const [selected, setSelected] = useState<number[]>([]); const [generating, setGenerating] = useState(false);
  const generate = async () => { setGenerating(true); try { const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "lies", truth, prompt, category: activeThemes(game.room.themeCategory) }) }); const data = await response.json(); if (!response.ok || !Array.isArray(data.lies)) throw new Error("No ideas available."); setLies(data.lies); setSelected([]); } finally { setGenerating(false); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); const chosen = selected.map((index) => lies[index]).filter(Boolean); if (chosen.length !== 2) return; const entries = [{ text: truth.trim(), truth: true }, ...chosen.map((text) => ({ text: text.trim(), truth: false }))].sort(() => Math.random() - .5); await act("submitHonto", { prompt, statements: entries.map((entry) => entry.text), truthIndex: entries.findIndex((entry) => entry.truth) }); };
  return <form className="play-card writer" onSubmit={submit}><CardBadge type="honto"/><h2>Start with one truth about…</h2><div className="prompt-row"><textarea className="prompt-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={140}/><button type="button" onClick={() => setPrompt(localPrompts[Math.floor(Math.random() * localPrompts.length)])}>ANOTHER IDEA</button></div><label className="truth-editor"><span>YOUR TRUTH</span><textarea value={truth} onChange={(event) => setTruth(event.target.value)} maxLength={180} placeholder="Type one true story about yourself…"/></label><button type="button" className="ai-button" onClick={generate} disabled={generating || !truth.trim()}>{generating ? "WRITING LIES…" : "GENERATE 5 LIES ✦"}</button>{lies.length > 0 && <><p className="hint">Choose two. You can edit them before sending.</p><div className="lie-options">{lies.map((lie, index) => <label key={index} className={selected.includes(index) ? "selected" : ""}><input type="checkbox" checked={selected.includes(index)} onChange={() => setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : current.length < 2 ? [...current, index] : current)}/><textarea value={lie} maxLength={180} onChange={(event) => setLies((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}/><b>{selected.includes(index) ? "SELECTED" : "SELECT"}</b></label>)}</div><button className="primary-button" disabled={busy || selected.length !== 2}>SEND THREE STORIES →</button></>}</form>;
}

function QuestionCard({ card, meId, game, busy, act }: { card: Card; meId: string; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const [question, setQuestion] = useState(""); const [sips, setSips] = useState(1); const [ideas, setIdeas] = useState<string[]>([]); const [generating, setGenerating] = useState(false);
  const generate = async () => { setGenerating(true); try { const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "question", count: 3, category: activeThemes(game.room.themeCategory), customTheme: game.room.customTheme }) }); const data = await response.json(); if (!response.ok || !Array.isArray(data.questions)) throw new Error("No questions available."); setIdeas(data.questions.slice(0, 3)); } finally { setGenerating(false); } };
  if (card.status === "ready") return card.actorId === meId ? <div className="play-card question-card"><CardBadge type="question"/><h2>Ask <em>{card.targetName}</em> anything.</h2><p className="hint">If they answer out loud, you drink. If they skip, they drink.</p><textarea className="mini-game-input" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={220} placeholder="Write your question…"/><button className="ai-button" onClick={generate} disabled={generating}>{generating ? "THINKING…" : "GET 3 AI QUESTIONS ✦"}</button>{ideas.length > 0 && <div className="question-option-list"><span>CHOOSE ONE</span>{ideas.map((idea) => <button key={idea} onClick={() => setQuestion(idea)}>{idea}</button>)}</div>}<SipPicker value={sips} onChange={setSips}/><button className="primary-button" disabled={busy || question.trim().length < 3} onClick={() => act("submitQuestion", { question, sips })}>SEND QUESTION →</button></div> : <Waiting title={`${card.actorName} is choosing a question…`} text="Answer honestly or take the sips."/>;
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
  if (card.payload.hasChosen) return <Waiting title="Your move is locked." text={`Waiting for ${opponent} to choose. They cannot see your move.`}/>;
  return <div className="play-card rps-card"><CardBadge type="rps"/><h2>{card.payload.tieCount ? "Tie! Choose again." : `Battle ${opponent}.`}</h2><p className="hint"><SipMug/> Pick secretly. The loser spins the 1–3 SIP wheel.</p><div className="rps-options">{RPS_OPTIONS.map((option) => <button key={option.value} disabled={busy} onClick={() => act("chooseRps", { rpsChoice: option.value })}><span>{option.icon}</span><strong>{option.label}</strong></button>)}</div></div>;
}

function BothDrinkCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const mine = card.actorId === meId;
  return mine ? <div className="play-card both-card"><CardBadge type="both"/><h2>No guessing.<br/><em>You both drink.</em></h2><p className="hint"><SipMug/> Spin once. The result applies to both players.</p><button className="primary-button spin-button" disabled={busy} onClick={() => act("spinBoth")}><SipMug/> SPIN FOR BOTH →</button></div> : <Waiting title={`${card.actorName} will spin for both of you…`} text="The same 1–3 SIP result applies to both players."/>;
}

function CardBadge({ type }: { type: Exclude<Card["type"], "hidden"> }) { const meta = CARD_META[type]; return <span className={`card-type-badge ${meta.color}`}><b>{meta.icon}</b>{meta.label}</span>; }
function SipMug() { return <span className="sip-mug" aria-hidden="true">🍺</span>; }
function SipPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <div className="sip-picker-wrap"><span><SipMug/> HOW MANY SIPS?</span><div className="sip-picker">{[1, 2, 3].map((sips) => <button type="button" key={sips} className={value === sips ? "active" : ""} onClick={() => onChange(sips)}><SipMug/><strong>{sips}</strong><small>{sips === 1 ? "SIP" : "SIPS"}</small></button>)}</div></div>; }
function Waiting({ title, text }: { title: string; text: string }) { return <div className="play-card waiting"><div className="bobble">🃏</div><span className="turn-badge">HANG TIGHT</span><h2>{title}</h2><p>{text}</p><div className="typing"><i/><i/><i/></div></div>; }
function ScoreRail({ players, meId }: { players: Player[]; meId: string }) { return <aside className="score-rail">{players.map((player, index) => <div key={player.id}><span className={`avatar avatar-${index}`}>{player.name[0]}</span><strong>{player.name}{player.id === meId ? " · you" : ""}</strong><small><SipMug/> {player.sips} {player.sips === 1 ? "sip" : "sips"}</small></div>)}</aside>; }

function Reveal({ card, players, meId, close }: { card: Card; players: Player[]; meId: string; close: () => void }) {
  const hasWheel = card.type === "honto" || card.type === "preference" || card.type === "rps" || card.type === "both";
  const [spinning, setSpinning] = useState(hasWheel);
  useEffect(() => { if (!hasWheel) return; const timer = window.setTimeout(() => setSpinning(false), 1900); return () => window.clearTimeout(timer); }, [card.id, hasWheel]);
  const drinker = players.find((player) => player.id === card.result.drinkerId)?.name;
  let icon = "✓"; let eyebrow = "CARD COMPLETE"; let title = drinker ? `${drinker} drinks.` : "You found the number."; let detail = "The next card is waiting.";
  if (card.type === "honto") { icon = card.result.correct ? "✓" : "×"; eyebrow = card.result.correct ? "TRUTH FOUND" : "BLUFF SUCCESS"; title = card.result.correct ? `${card.targetName} found the truth. ${drinker} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.` : `${card.targetName} fell for the bluff and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `The truth was: “${card.payload.statements?.[card.secret?.truthIndex ?? 0]}”`; }
  if (card.type === "question") { icon = card.result.choice === "answer" ? "💬" : "🥃"; eyebrow = card.result.choice === "answer" ? "ANSWERED OUT LOUD" : "QUESTION SKIPPED"; title = `${drinker} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = card.result.choice === "answer" ? `${card.targetName} chose to answer, so the asker drinks.` : `${card.targetName} chose not to answer.`; }
  if (card.type === "preference") { const chosen = card.payload.options?.[card.secret?.preferenceIndex ?? 0]; icon = card.result.correct ? "🧠" : "×"; eyebrow = card.result.correct ? "MIND READ" : "NOT EVEN CLOSE"; title = card.result.correct ? `${card.targetName} guessed it. ${card.actorName} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.` : `${card.targetName} missed and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `${card.actorName} chose “${chosen}”.`; }
  if (card.type === "estimate") { icon = "🎯"; eyebrow = card.result.firstTry ? "FIRST TRY" : "NUMBER FOUND"; title = card.result.firstTry ? `${card.targetName} nailed it. ${card.actorName} drinks.` : `${card.targetName} found it after ${card.result.wrongGuesses?.length} misses.`; detail = `The correct answer was ${card.result.correctNumber}.`; }
  if (card.type === "rps") { const labels = { rock: "Rock ✊", paper: "Paper ✋", scissors: "Scissors ✌️" }; icon = "⚔️"; eyebrow = "BATTLE COMPLETE"; title = `${drinker} loses and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `${card.actorName}: ${labels[card.result.actorChoice ?? "rock"]} · ${card.targetName}: ${labels[card.result.targetChoice ?? "rock"]}`; }
  if (card.type === "both") { icon = "🍻"; eyebrow = "BOTH DRINK"; title = `Both take ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `${players.map((player) => player.name).join(" & ")}, cheers!`; }
  const viewerDrinks = card.result.drinkerId === meId;
  if (spinning) return <div className="modal-backdrop"><div className="reveal-card wheel-card" role="status" aria-live="polite"><span className="eyebrow"><SipMug/> SIP WHEEL</span><h2>How many sips?</h2><div className="sip-wheel-stage"><i className="sip-wheel-pointer"/><div className="sip-wheel"><span className="sip-wheel-number one">1</span><span className="sip-wheel-number two">2</span><span className="sip-wheel-number three">3</span></div></div><p><SipMug/> Spinning for {card.type === "both" ? "both players" : drinker}…</p></div></div>;
  return <div className="modal-backdrop"><div className={`reveal-card ${viewerDrinks || card.type === "both" ? "wrong" : "correct"}`}><div className="result-mark">{icon}</div><span className="eyebrow">{eyebrow}</span>{hasWheel && <div className="wheel-result"><span>THE WHEEL SAYS</span><strong>{card.result.sips}</strong><small><SipMug/> {card.result.sips === 1 ? "SIP" : "SIPS"}</small></div>}<h2>{(card.result.drinkerId || card.type === "both") && <SipMug/>} {title}</h2><blockquote>{detail}</blockquote><button className="primary-button" onClick={close}>NEXT CARD →</button></div></div>;
}

function Finished({ players, leave }: { players: Player[]; leave: () => void }) {
  const sorted = useMemo(() => [...players].sort((a, b) => a.sips - b.sips), [players]);
  return <section className="finished"><span className="eyebrow">THE DECK IS EMPTY</span><h1>The lightest drinker was…</h1><div className="winner">🏆<strong>{sorted[0]?.name}</strong><span><SipMug/> {sorted[0]?.sips} {sorted[0]?.sips === 1 ? "sip" : "sips"}</span></div><div className="final-list">{sorted.map((player, index) => <div key={player.id}><b>#{index + 1}</b><span>{player.name}</span><small><SipMug/> {player.sips} {player.sips === 1 ? "sip" : "sips"}</small></div>)}</div><button className="primary-button" onClick={leave}>NEW TABLE →</button></section>;
}
