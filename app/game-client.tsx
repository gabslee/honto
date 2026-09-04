"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMessages, themeCategories } from "./i18n";

type Player = { id: string; name: string; isHost: number; sips: number; joinedAt: string };
type ActiveRound = {
  id: string; roundNumber: number; authorId: string; authorName: string; prompt: string;
  statementOne: string; statementTwo: string; statementThree: string; createdAt?: string;
  guessedIndex: number | null; guesserId: string | null; result: string | null; truthIndex: number | null;
};
type GameState = {
  room: { code: string; status: "lobby" | "playing" | "finished"; roundCount: number; currentRound: number; groupSipEvery: number | null; timerMinutes: number | null; writeTimerMinutes: number | null; guessTimerMinutes: number | null; themeCategory: string; exclusiveThemes: boolean; customTheme: string | null; gameMode: "honto" | "truth_sips"; miniGameEnabled: boolean; miniGameEvery: number; startedAt: string | null; roundStartedAt: string | null; sessionPaused: boolean; pausedAt: string | null; pausedSeconds: number };
  players: Player[]; activeRound: ActiveRound | null; miniGame: { id: string; triggerRound: number; type: "question"; status: "ask" | "answer"; question: string | null; sips: number; choice: "truth" | "dare" | null; answer: string | null; assignedPlayerId: string; assignedPlayerName: string; askerName: string | null; targetPlayerName: string | null } | null; lastReveal: { roundNumber: number; authorId: string; guesserId: string; truthIndex: number; guessedIndex: number | null; result: "correct" | "wrong" | "timeout"; statementOne: string; statementTwo: string; statementThree: string; timeoutStage?: "writing" | "guessing" | null; drinkerId: string } | null; meId: string;
};

const t = getMessages();
const PROMPTS: string[] = [...t.prompts];
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const THEME_KEYS = ["mixed", "family", "innocent", "life", "flirty", "spicy"] as const;
type ThemeKey = (typeof THEME_KEYS)[number];
type QuestionCategory = "session" | "custom" | ThemeKey;

function storedThemeKeys(value: string | null | undefined): ThemeKey[] {
  if (!value || value === "safe") return [];
  return value.split(",").filter((key): key is ThemeKey => THEME_KEYS.includes(key as ThemeKey));
}

function activeThemeKeys(value: string | null | undefined): ThemeKey[] {
  const selected = storedThemeKeys(value);
  return selected.length ? selected : ["mixed", "family", "innocent", "life"];
}

function timestamp(value: string | null | undefined) {
  return value ? new Date(value.includes("Z") ? value : `${value}Z`).getTime() : 0;
}

async function gameApi(body: Record<string, unknown>) {
  const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? t.errors.generic);
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
  const [promptIndex, setPromptIndex] = useState(0);
  const [prompt, setPrompt] = useState(PROMPTS[0]);
  const [promptPool, setPromptPool] = useState<string[]>([]);
  const [suggestingPrompt, setSuggestingPrompt] = useState(false);
  const [truthText, setTruthText] = useState("");
  const [lieOptions, setLieOptions] = useState<string[]>([]);
  const [selectedLies, setSelectedLies] = useState<number[]>([]);
  const [generatingLies, setGeneratingLies] = useState(false);
  const [suggestingMiniQuestion, setSuggestingMiniQuestion] = useState(false);
  const [reveal, setReveal] = useState<{ correct: boolean; truthIndex: number; drinkerId: string; roundNumber: number; authorId: string; guesserId: string; statements: string[] } | null>(null);
  const [seenRevealRound, setSeenRevealRound] = useState<number | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderZeroTick, setReminderZeroTick] = useState<number | null>(null);
  const [timeoutNotice, setTimeoutNotice] = useState<{ playerId: string; roundNumber: number; stage: "writing" | "guessing" } | null>(null);
  const [dismissedReminder, setDismissedReminder] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const hydratedRef = useRef(false);
  const promptBatchRef = useRef("");
  const timeoutSentRef = useRef("");

  useEffect(() => {
    const room = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
    const saved = localStorage.getItem("honto-session");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { code?: string; token?: string; savedAt?: number };
        const fresh = Boolean(parsed.savedAt && Date.now() - parsed.savedAt < SESSION_TTL_MS);
        if (room && fresh && parsed.code === room && parsed.token) setSession({ code: parsed.code, token: parsed.token });
        else localStorage.removeItem("honto-session");
      } catch { localStorage.removeItem("honto-session"); }
    }
    if (room) { setJoinCode(room); setMode("join"); }
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!session) return;
    try {
      const response = await fetch(`/api/game?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? "ROOM_NOT_FOUND" : response.status === 401 ? "SESSION_INVALID" : (data.error ?? t.errors.refresh));
      if (!hydratedRef.current) {
        if (data.room?.startedAt && data.room?.timerMinutes) {
          const started = timestamp(data.room.startedAt);
          const pausedNow = data.room.sessionPaused && data.room.pausedAt ? Math.floor((Date.now() - timestamp(data.room.pausedAt)) / 1000) : 0;
          const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000) - (data.room.pausedSeconds ?? 0) - pausedNow);
          setDismissedReminder(Math.floor((elapsed / 60) / data.room.timerMinutes));
        }
        hydratedRef.current = true;
      }
      setGame(data);
      if (!quiet) setError("");
    } catch (cause) {
      if (cause instanceof Error && (cause.message === "ROOM_NOT_FOUND" || cause.message === "SESSION_INVALID")) {
        localStorage.removeItem("honto-session"); hydratedRef.current = false; setSession(null); setGame(null); setError(t.errors.sessionExpired); return;
      }
      if (!quiet) setError(cause instanceof Error ? cause.message : t.errors.connection);
    }
  }, [session]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => refresh(true), 2200);
    return () => window.clearInterval(timer);
  }, [session, refresh]);
  useEffect(() => {
    if (!game?.room.startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [game?.room.startedAt]);

  const me = game?.players.find((player) => player.id === game.meId);
  const author = game ? game.players[(game.room.currentRound - 1) % game.players.length] : null;
  const parseTime = (value: string | null) => value ? new Date(value.includes("Z") ? value : `${value}Z`).getTime() : 0;
  const elapsedSeconds = game?.room.startedAt ? Math.max(0, Math.floor((now - parseTime(game.room.startedAt)) / 1000) - (game.room.pausedSeconds ?? 0) - (game.room.sessionPaused && game.room.pausedAt ? Math.floor((now - parseTime(game.room.pausedAt)) / 1000) : 0)) : 0;
  const reminderTotalSeconds = game?.room.timerMinutes ? game.room.timerMinutes * 60 : null;
  const reminderTick = reminderTotalSeconds && elapsedSeconds >= reminderTotalSeconds ? Math.floor(elapsedSeconds / reminderTotalSeconds) : 0;
  const reminderRemainingSeconds = reminderTotalSeconds ? reminderTotalSeconds - (elapsedSeconds % reminderTotalSeconds) : null;
  const nextTimerSip = reminderZeroTick === reminderTick && reminderOpen ? 0 : reminderRemainingSeconds;
  const turnStartedAt = game?.activeRound?.createdAt ?? game?.room.roundStartedAt;
  const turnLimit = game?.room.gameMode === "truth_sips" ? null : game?.activeRound ? game.room.guessTimerMinutes : game?.room.writeTimerMinutes;
  const turnElapsed = turnStartedAt ? Math.max(0, Math.floor((now - parseTime(turnStartedAt)) / 1000)) : 0;
  const turnRemaining = turnLimit ? Math.max(0, turnLimit * 60 - turnElapsed) : null;

  useEffect(() => {
    if (!game || game.room.status !== "playing" || game.room.gameMode === "truth_sips" || author?.id !== game.meId) return;
    const batchKey = `${game.room.currentRound}|${game.room.themeCategory}|${game.room.customTheme ?? ""}`;
    if (promptBatchRef.current === batchKey || promptPool.length > 0 || suggestingPrompt) return;
    promptBatchRef.current = batchKey;
    const localThemes = activeThemeKeys(game.room.themeCategory).flatMap((key) => themeCategories[key]);
    const initialPrompt = localThemes[0] ?? PROMPTS[0];
    setPrompt(initialPrompt);
    void suggestPrompt(initialPrompt);
  }, [game?.room.status, game?.room.currentRound, game?.room.themeCategory, game?.room.customTheme, author?.id, game?.meId, promptPool.length, suggestingPrompt]);

  useEffect(() => {
    if (!game || game.room.status !== "playing" || game.room.gameMode === "truth_sips" || game.miniGame || turnRemaining !== 0) return;
    const stage = game.activeRound ? "guessing" : "writing";
    const canExpire = stage === "writing" ? author?.id === game.meId : game.activeRound?.authorId !== game.meId;
    if (!canExpire) return;
    const key = `${game.room.currentRound}:${stage}`;
    if (timeoutSentRef.current === key) return;
    timeoutSentRef.current = key;
    void act("timeout");
  }, [game?.room.status, game?.room.currentRound, game?.activeRound?.id, game?.activeRound?.authorId, game?.meId, author?.id, turnRemaining]);

  useEffect(() => {
    if (!game || (game.room.status !== "playing" && game.room.status !== "finished")) return;
    if (game.lastReveal && game.lastReveal.roundNumber !== seenRevealRound && (game.lastReveal.roundNumber < game.room.currentRound || game.room.status === "finished")) {
      const result = game.lastReveal;
      if (result.result === "timeout") setTimeoutNotice({ playerId: result.drinkerId, roundNumber: result.roundNumber, stage: result.timeoutStage ?? "guessing" });
      else setReveal({ correct: result.result === "correct", truthIndex: result.truthIndex, drinkerId: result.drinkerId, roundNumber: result.roundNumber, authorId: result.authorId, guesserId: result.guesserId, statements: [result.statementOne, result.statementTwo, result.statementThree] });
      setSeenRevealRound(result.roundNumber);
    }
  }, [game, seenRevealRound]);

  useEffect(() => {
    if (reminderTick > 0 && reminderTick !== dismissedReminder && !game?.room.sessionPaused) {
      setReminderOpen(true);
      setReminderZeroTick(reminderTick);
      setDismissedReminder(reminderTick);
      try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 660; gain.gain.value = 0.04; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.12); } catch { /* audio needs browser permission */ }
    }
  }, [reminderTick, dismissedReminder, game?.room.sessionPaused]);

  async function enter(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await gameApi({ action: mode, name, code: joinCode });
      const next = { code: data.code, token: data.token };
      localStorage.setItem("honto-session", JSON.stringify({ ...next, savedAt: Date.now() })); hydratedRef.current = false; setSession(next);
      history.replaceState(null, "", `?room=${data.code}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.errors.enter); }
    finally { setBusy(false); }
  }

  async function act(action: string, extras: Record<string, unknown> = {}) {
    if (!session) return;
    setBusy(true); setError("");
    try {
      const data = await gameApi({ action, ...session, ...extras });
      if (data.room) setGame(data);
      return data;
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.errors.generic); }
    finally { setBusy(false); }
  }

  function leave() {
    localStorage.removeItem("honto-session"); hydratedRef.current = false; setSession(null); setGame(null); setReveal(null); setReminderOpen(false); setLieOptions([]); setSelectedLies([]); setTruthText("");
    history.replaceState(null, "", location.pathname);
  }

  async function copyInvite() {
    const url = `${location.origin}${location.pathname}?room=${session?.code}`;
    await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600);
  }

  function rotateLocalPrompt() {
    const list = game ? activeThemeKeys(game.room.themeCategory).flatMap((key) => themeCategories[key]) : PROMPTS;
    const next = (promptIndex + 1) % list.length; setPromptIndex(next); setPrompt(list[next]);
  }

  function newPrompt() {
    if (promptPool.length) {
      const [next, ...remaining] = promptPool;
      setPromptPool(remaining);
      setPrompt(next);
      return;
    }
    void suggestPrompt();
  }

  async function suggestPrompt(basePrompt = prompt) {
    setSuggestingPrompt(true);
    try {
      const categories = activeThemeKeys(game?.room.themeCategory);
      const excluded = [basePrompt, ...promptPool];
      const responses = await Promise.all(categories.map(async (category) => {
        const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "theme", count: 20, category: [category], customTheme: game?.room.customTheme, fresh: true, exclude: excluded }) });
        const data = await response.json() as { prompt?: string; prompts?: string[] };
        return response.ok ? (data.prompts?.length ? data.prompts : data.prompt ? [data.prompt] : []) : [];
      }));
      const seen = new Set(excluded.map((item) => item.toLowerCase()));
      const prompts = responses.flat().filter((item) => { const key = item.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
      for (let index = prompts.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [prompts[index], prompts[swapIndex]] = [prompts[swapIndex], prompts[index]];
      }
      if (prompts.length) { setPrompt(prompts[0]); setPromptPool(prompts.slice(1)); }
      else rotateLocalPrompt();
    } catch { rotateLocalPrompt(); }
    finally { setSuggestingPrompt(false); }
  }

  async function generateLies() {
    if (!truthText.trim()) { setError("Write your truth first."); return; }
    setGeneratingLies(true); setError("");
    try {
      const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "lies", truth: truthText, prompt, category: activeThemeKeys(game?.room.themeCategory) }) });
      const data = await response.json() as { lies?: string[] };
      if (!response.ok || !data.lies?.length) throw new Error("We couldn't generate lie ideas.");
      setLieOptions(data.lies); setSelectedLies([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn't generate lie ideas."); }
    finally { setGeneratingLies(false); }
  }

  async function suggestMiniQuestion(category: QuestionCategory, hint: string) {
    if (!game) return "";
    setSuggestingMiniQuestion(true); setError("");
    try {
      const categories = category === "session" || category === "custom" ? activeThemeKeys(game.room.themeCategory) : [category];
      const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "question", category: categories, customTheme: category === "custom" || category === "session" ? game.room.customTheme : null, questionHint: hint.trim().slice(0, 160) }) });
      const data = await response.json() as { question?: string };
      if (!response.ok || !data.question?.trim()) throw new Error("We couldn't think of a question.");
      return data.question.trim();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn't think of a question."); return ""; }
    finally { setSuggestingMiniQuestion(false); }
  }

  function updateLie(index: number, value: string) { setLieOptions((items) => items.map((item, i) => i === index ? value : item)); }
  function toggleLie(index: number) { setSelectedLies((items) => items.includes(index) ? items.filter((item) => item !== index) : items.length < 2 ? [...items, index] : items); }

  async function submitStories(event: FormEvent) {
    event.preventDefault();
    if (!truthText.trim() || selectedLies.length !== 2) { setError("Write your truth and choose exactly two lies."); return; }
    const chosen = [truthText.trim(), ...selectedLies.map((index) => lieOptions[index].trim())];
    const shuffled = chosen.map((statement, index) => ({ statement, isTruth: index === 0 })).sort(() => Math.random() - 0.5);
    const result = await act("submit", { prompt, statements: shuffled.map((item) => item.statement), truthIndex: shuffled.findIndex((item) => item.isTruth) });
    if (result) { setTruthText(""); setLieOptions([]); setSelectedLies([]); newPrompt(); }
  }

  async function guess(index: number) {
    if (!game?.activeRound) return;
    const currentStatements = [game.activeRound.statementOne, game.activeRound.statementTwo, game.activeRound.statementThree];
    const data = await act("guess", { guessedIndex: index });
    if (data?.reveal) { setReveal({ ...data.reveal, authorId: game.activeRound.authorId, guesserId: game.meId, statements: currentStatements }); setSeenRevealRound(data.reveal.roundNumber); }
  }

  if (!session) return <Landing mode={mode} setMode={setMode} name={name} setName={setName} code={joinCode} setCode={setJoinCode} enter={enter} busy={busy} error={error} />;
  if (!game) return <main className="loading"><div className="stamp">本当?!</div><p>{t.loading}</p><button className="text-button" onClick={leave}>{t.common.back}</button></main>;

  const closeReminder = () => { setReminderOpen(false); setReminderZeroTick(null); };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={leave} aria-label="Back to home"><span>HONTO</span><b>?!</b></button>
        <div className="room-pill"><span className="live-dot" /> {t.room} <strong>{game.room.code}</strong></div>
        <div className="session-tools">{game.room.status !== "lobby" && <div className="session-control"><div className="session-clock"><span>{game.room.sessionPaused ? t.paused : t.session} {formatClock(elapsedSeconds)}</span>{me?.isHost && <button className="session-pause" type="button" aria-label={game.room.sessionPaused ? t.resume : t.pause} title={game.room.sessionPaused ? t.resume : t.pause} onClick={() => act("pause")}><PauseIcon paused={game.room.sessionPaused} /></button>}</div></div>}<button className="tiny-button" onClick={leave}>{t.common.exit}</button></div>
      </header>
      {error && <div className="toast error-toast" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}
      {game.room.status === "lobby" && <Lobby game={game} me={me} busy={busy} copied={copied} copyInvite={copyInvite} act={act} />}
      {game.room.status === "playing" && (
        <section className="game-stage">
          <div className="round-strip">
            <span>{t.round} <b>{game.room.currentRound}</b>/{game.room.roundCount}</span>
            <div className="progress"><i style={{ width: `${(game.room.currentRound / game.room.roundCount) * 100}%` }} /></div>
            {nextTimerSip !== null && <span className={`timer ${nextTimerSip === 0 ? "urgent" : ""}`}>{t.groupSipIn} {formatClock(nextTimerSip)}</span>}
            {turnRemaining !== null && <span className={`timer ${turnRemaining < 30 ? "urgent" : ""} ${turnRemaining <= 10 ? "countdown-alert" : ""}`} aria-live="polite">⏱ {formatClock(turnRemaining)}{turnRemaining <= 10 ? " · TIME" : ""}</span>}
          </div>
          <ScoreRail players={game.players} meId={game.meId} />
          {game.room.gameMode === "truth_sips" ? <Waiting title={game.miniGame ? "Truth or Sips is ready" : "Getting the next question ready…"} text="Write a question, answer it out loud, or take the sips. The round count stays the same." /> : <>
            {!game.activeRound && author?.id === game.meId && <Writer prompt={prompt} setPrompt={setPrompt} newPrompt={newPrompt} suggestPrompt={suggestPrompt} suggestingPrompt={suggestingPrompt} truthText={truthText} setTruthText={setTruthText} lieOptions={lieOptions} selectedLies={selectedLies} toggleLie={toggleLie} updateLie={updateLie} generateLies={generateLies} generatingLies={generatingLies} submit={submitStories} busy={busy} />}
            {!game.activeRound && author?.id !== game.meId && <Waiting title={`${author?.name} ${t.waiting.writingSuffix}`} text={t.waiting.writingBody} />}
            {game.activeRound && game.activeRound.authorId === game.meId && <Waiting title={t.waiting.sentTitle} text={t.waiting.sentBody} />}
            {game.activeRound && game.activeRound.authorId !== game.meId && <Guesser round={game.activeRound} onGuess={guess} busy={busy} />}
          </>}
        </section>
      )}
      {game.room.status === "finished" && <Finished players={game.players} leave={leave} />}
      {reveal && <Reveal reveal={reveal} players={game.players} meId={game.meId} close={() => { setReveal(null); refresh(); }} groupSipEvery={game.room.groupSipEvery && reveal.roundNumber % game.room.groupSipEvery === 0 ? game.room.groupSipEvery : null} />}
      {reminderOpen && <ReminderModal close={closeReminder} minutes={game.room.timerMinutes ?? 0} />}
      {timeoutNotice && <TimeoutModal notice={timeoutNotice} players={game.players} close={() => { setTimeoutNotice(null); refresh(); }} />}
      {game.miniGame && !reveal && !timeoutNotice && !reminderOpen && <MiniGameModal miniGame={game.miniGame} meId={game.meId} act={act} busy={busy} categories={activeThemeKeys(game.room.themeCategory)} customTheme={game.room.customTheme} suggestQuestion={suggestMiniQuestion} suggestingQuestion={suggestingMiniQuestion} />}
    </main>
  );
}

function Landing(props: { mode: "create" | "join"; setMode: (m: "create" | "join") => void; name: string; setName: (v: string) => void; code: string; setCode: (v: string) => void; enter: (e: FormEvent) => void; busy: boolean; error: string }) {
  return <main className="landing">
    <div className="doodle doodle-one">嘘</div><div className="doodle doodle-two">本当</div>
    <nav><div className="logo"><span>HONTO</span><b>?!</b></div><span className="microcopy">TWO LIES. ONE TRUTH.</span></nav>
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow">{t.landing.kicker}</div><h1>{t.landing.headlineStart}<br/><em>{t.landing.headlineEmphasis}</em>?</h1><p>{t.landing.body}</p><div className="rule-cards">{t.landing.steps.map((step, index) => <span key={step}><b>{["①","②","③"][index]}</b> {step}</span>)}</div></div>
      <form className="entry-card" onSubmit={props.enter}>
        <div className="card-tabs"><button type="button" className={props.mode === "create" ? "active" : ""} onClick={() => props.setMode("create")}>{t.landing.createTab}</button><button type="button" className={props.mode === "join" ? "active" : ""} onClick={() => props.setMode("join")}>{t.landing.joinTab}</button></div>
        <label>{t.landing.nameLabel}<input autoFocus value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder={t.landing.namePlaceholder} maxLength={24}/></label>
        {props.mode === "join" && <label>{t.landing.codeLabel}<input value={props.code} onChange={(e) => props.setCode(e.target.value.toUpperCase())} placeholder="YUZU-42" maxLength={12}/></label>}
        {props.error && <p className="form-error">{props.error}</p>}
        <button className="primary-button" disabled={props.busy}>{props.busy ? t.landing.busy : props.mode === "create" ? t.landing.createCta : t.landing.joinCta}</button>
        <small>{t.landing.note}</small>
      </form>
    </section>
    <footer>本当？ <span>HONTO?</span> {t.landing.footer}</footer>
  </main>;
}

function Lobby({ game, me, busy, copied, copyInvite, act }: { game: GameState; me?: Player; busy: boolean; copied: boolean; copyInvite: () => void; act: (action: string, extras?: Record<string, unknown>) => Promise<any> }) {
  const host = Boolean(me?.isHost);
  const configure = (extra: Record<string, unknown>) => act("configure", { roundCount: game.room.roundCount, groupSipEvery: game.room.groupSipEvery, reminderMinutes: game.room.timerMinutes, writeTimerMinutes: game.room.writeTimerMinutes, guessTimerMinutes: game.room.guessTimerMinutes, themeCategory: game.room.themeCategory, exclusiveThemes: game.room.exclusiveThemes, customTheme: game.room.customTheme, gameMode: game.room.gameMode, miniGameEnabled: game.room.miniGameEnabled, miniGameEvery: game.room.miniGameEvery, ...extra });
  const custom = (value: number | null, fallback: number) => value && ![1, 3, 5, 10, 15, 20, 30].includes(value) ? value : fallback;
  const selectedThemes = storedThemeKeys(game.room.themeCategory);
  const toggleTheme = (key: ThemeKey) => {
    const next = selectedThemes.includes(key) ? selectedThemes.filter((item) => item !== key) : [...selectedThemes, key];
    configure({ themeCategory: next.length ? next.join(",") : "safe" });
  };
  return <section className="lobby">
    <div className="lobby-head"><span className="eyebrow">{t.lobby.kicker}</span><h1>{t.lobby.titleStart} <em>{t.lobby.titleEmphasis}</em> {t.lobby.titleEnd}</h1><p>{t.lobby.subtitle}</p></div>
    <div className="lobby-grid">
      <div className="panel people-panel"><div className="panel-title"><h2>{t.lobby.atTable}</h2><span>{game.players.length}/8</span></div><div className="people-list">{game.players.map((player, index) => <div className="person" key={player.id}><span className={`avatar avatar-${index % 4}`}>{player.name[0]?.toUpperCase()}</span><div><strong>{player.name}</strong><small>{player.id === game.meId ? t.common.you : player.isHost ? t.lobby.host : t.lobby.ready}</small></div>{player.isHost ? <b className="crown">♛</b> : <i>✓</i>}</div>)}</div><button className="invite-button" onClick={copyInvite}>{copied ? t.lobby.copied : t.lobby.copy}</button></div>
      <div className="panel settings-panel"><div className="panel-title"><h2>{t.lobby.rules}</h2><span className="sticker">{t.lobby.yourCall}</span></div>
        <Setting label={t.lobby.length} value={game.room.roundCount} options={[10,20,30,-1]} labels={["10 rounds","20 rounds","30 rounds",t.lobby.custom]} customValue={custom(game.room.roundCount, 42)} min={1} max={100} disabled={!host} onChange={(roundCount) => configure({ roundCount })} />
        <Setting label={t.lobby.gameMode} value={game.room.gameMode === "truth_sips" ? 1 : 0} options={[0,1]} labels={[t.lobby.modeHonto,t.lobby.modeTruthSips]} disabled={!host} onChange={(value) => configure({ gameMode: value === 1 ? "truth_sips" : "honto" })} />
        <Setting label={t.lobby.everyoneSips} value={game.room.groupSipEvery ?? 0} options={[0,1,3,5,-1]} labels={[t.lobby.never,t.lobby.every1,t.lobby.every3,t.lobby.every5,t.lobby.custom]} customValue={custom(game.room.groupSipEvery, 7)} min={1} max={30} disabled={!host} onChange={(groupSipEvery) => configure({ groupSipEvery: groupSipEvery || null })} />
        <Setting label={t.lobby.timer} value={game.room.timerMinutes ?? 0} options={[0,10,15,-1]} labels={[t.lobby.off,"10 min","15 min",t.lobby.custom]} customValue={custom(game.room.timerMinutes, 20)} min={1} max={180} disabled={!host} onChange={(timerMinutes) => configure({ reminderMinutes: timerMinutes || null })} />
        <ToggleSetting label={t.lobby.writingTimer} enabled={Boolean(game.room.writeTimerMinutes)} value={game.room.writeTimerMinutes ?? 5} options={[1,3,5]} customValue={custom(game.room.writeTimerMinutes, 7)} min={1} max={60} disabled={!host} onToggle={(enabled) => configure({ writeTimerMinutes: enabled ? game.room.writeTimerMinutes || 5 : null })} onChange={(writeTimerMinutes) => configure({ writeTimerMinutes })} />
        <ToggleSetting label={t.lobby.guessingTimer} enabled={Boolean(game.room.guessTimerMinutes)} value={game.room.guessTimerMinutes ?? 5} options={[1,3,5]} customValue={custom(game.room.guessTimerMinutes, 7)} min={1} max={60} disabled={!host} onToggle={(enabled) => configure({ guessTimerMinutes: enabled ? game.room.guessTimerMinutes || 5 : null })} onChange={(guessTimerMinutes) => configure({ guessTimerMinutes })} />
        {game.room.gameMode === "honto" && <>
          <ToggleSetting label={t.lobby.truthOrDare} enabled={game.room.miniGameEnabled} value={1} options={[]} disabled={!host} onToggle={(enabled) => configure({ miniGameEnabled: enabled })} onChange={() => undefined} />
          {game.room.miniGameEnabled && <Setting label={t.lobby.miniGameFrequency} value={game.room.miniGameEvery} options={[2,3,5,8,-1]} labels={[t.lobby.miniEvery2, t.lobby.miniEvery3, t.lobby.miniEvery5, t.lobby.miniEvery8, t.lobby.custom]} customValue={custom(game.room.miniGameEvery, 6)} min={2} max={30} disabled={!host} onChange={(miniGameEvery) => configure({ miniGameEvery })} />}
        </>}
        <div className="setting theme-setting"><label>{t.lobby.theme}</label><p className="setting-hint">{t.lobby.selectSubjects}</p><div className="subject-checks">{(["mixed", "family", "innocent", "life", "flirty", "spicy"] as ThemeKey[]).map((key) => <label className={`subject-check ${key === "spicy" ? "spicy-check" : ""} ${selectedThemes.includes(key) ? "selected" : ""}`} key={key}><input type="checkbox" checked={selectedThemes.includes(key)} disabled={!host} onChange={() => toggleTheme(key)} /><span>{t.lobby[key]}</span></label>)}</div></div>
        <ToggleSetting label={t.lobby.exclusiveThemes} enabled={game.room.exclusiveThemes} value={1} options={[]} disabled={!host} onToggle={(exclusiveThemes) => configure({ exclusiveThemes })} onChange={() => undefined} />
        {game.room.exclusiveThemes && <div className="setting custom-theme-setting"><label>{t.lobby.customTheme}</label><input className="custom-setting" type="text" defaultValue={game.room.customTheme ?? ""} disabled={!host} placeholder={t.lobby.customThemePlaceholder} onBlur={(event) => configure({ customTheme: event.target.value.trim().slice(0, 80) })} /></div>}
        {host ? <button className="primary-button start-button" disabled={busy || game.players.length < 2} onClick={() => act("start")}>{game.players.length < 2 ? t.lobby.waiting : t.lobby.start}</button> : <div className="host-note">{t.lobby.hostNote}</div>}
      </div>
    </div>
  </section>;
}

function CustomNumberInput({ value, min, max, disabled, onCommit }: { value: number; min: number; max: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    if (!draft.trim()) { setDraft(String(min)); onCommit(min); return; }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const next = Math.max(min, Math.min(max, Math.trunc(parsed)));
    setDraft(String(next));
    onCommit(next);
  };
  return <input className="custom-setting" type="number" inputMode="numeric" min={min} max={max} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />;
}

function Setting({ label, value, options, labels, suffix="", customValue, min=1, max=100, disabled, onChange }: { label: string; value: number; options: number[]; labels?: string[]; suffix?: string; customValue?: number; min?: number; max?: number; disabled: boolean; onChange: (v: number) => void }) {
  const isCustom = !options.filter((option) => option >= 0).includes(value);
  return <div className="setting"><label>{label}</label><div className="segmented">{options.map((option, index) => <button type="button" key={option} disabled={disabled} className={option === -1 ? (isCustom ? "active" : "") : value === option ? "active" : ""} onClick={() => onChange(option === -1 ? customValue ?? min : option)}>{labels?.[index] ?? `${option}${suffix}`}</button>)}</div>{isCustom && <CustomNumberInput value={customValue ?? min} min={min} max={max} disabled={disabled} onCommit={onChange} />}</div>;
}

function ToggleSetting({ label, enabled, value, options, labels, customValue, min=1, max=60, disabled, onToggle, onChange }: { label: string; enabled: boolean; value: number; options: number[]; labels?: string[]; customValue?: number; min?: number; max?: number; disabled: boolean; onToggle: (enabled: boolean) => void; onChange: (value: number) => void }) {
  const isCustom = enabled && !options.includes(value);
  return <div className="setting toggle-setting"><div className="toggle-setting-head"><label>{label}</label><button type="button" className={`toggle ${enabled ? "on" : ""}`} aria-pressed={enabled} disabled={disabled} onClick={() => onToggle(!enabled)}><span />{enabled ? t.lobby.enabled : t.lobby.off}</button></div>{enabled && options.length > 0 && <div className="segmented">{options.map((option, index) => <button type="button" key={option} disabled={disabled} className={value === option ? "active" : ""} onClick={() => onChange(option)}>{labels?.[index] ?? `${option} min`}</button>)}{options.length < 4 && <><button type="button" disabled={disabled} className={isCustom ? "active" : ""} onClick={() => onChange(customValue ?? min)}>{t.lobby.custom}</button>{isCustom && <CustomNumberInput value={customValue ?? min} min={min} max={max} disabled={disabled} onCommit={onChange} />}</>}</div>}</div>;
}

function ScoreRail({ players, meId }: { players: Player[]; meId: string }) {
  return <aside className="score-rail">{players.map((p, i) => <div key={p.id}><span className={`avatar avatar-${i % 4}`}>{p.name[0]}</span><strong>{p.name}{p.id === meId ? ` · ${t.common.you}` : ""}</strong><small>{p.sips} {p.sips === 1 ? t.common.sip : t.common.sips}</small></div>)}</aside>;
}

function Writer({ prompt, setPrompt, newPrompt, suggestPrompt, suggestingPrompt, truthText, setTruthText, lieOptions, selectedLies, toggleLie, updateLie, generateLies, generatingLies, submit, busy }: { prompt: string; setPrompt: (v: string) => void; newPrompt: () => void; suggestPrompt: () => void; suggestingPrompt: boolean; truthText: string; setTruthText: (v: string) => void; lieOptions: string[]; selectedLies: number[]; toggleLie: (index: number) => void; updateLie: (index: number, value: string) => void; generateLies: () => void; generatingLies: boolean; submit: (e: FormEvent) => void; busy: boolean }) {
  return <form className="play-card writer" onSubmit={submit}><span className="turn-badge">{t.writer.badge}</span><h2>{t.writer.title}</h2><div className="prompt-row"><textarea className="prompt-input" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={140}/><button type="button" onClick={newPrompt} disabled={suggestingPrompt}><StarIcon />{suggestingPrompt ? t.writer.aiLoading : t.writer.another}</button></div><p className="hint">{t.writer.hint}</p><label className="truth-editor"><span>{t.writer.truthLabel}</span><textarea value={truthText} onChange={(e) => setTruthText(e.target.value)} placeholder={t.writer.truthPlaceholder} maxLength={180}/></label><button type="button" className="ai-button" onClick={generateLies} disabled={generatingLies || !truthText.trim()}>{generatingLies ? t.writer.generating : t.writer.generate}</button>{lieOptions.length > 0 && <><p className="hint">{t.writer.chooseTwo}</p><div className="lie-options">{lieOptions.map((lie, index) => <label key={index} className={selectedLies.includes(index) ? "selected" : ""}><input type="checkbox" checked={selectedLies.includes(index)} onChange={() => toggleLie(index)} /><textarea value={lie} onChange={(e) => updateLie(index, e.target.value)} maxLength={180}/><b>{selectedLies.includes(index) ? t.writer.selected : t.writer.select}</b></label>)}</div><button className="primary-button" disabled={busy || suggestingPrompt || selectedLies.length !== 2}>{t.writer.submit}</button></>}</form>;
}

function StarIcon() {
  return <svg className="star-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2Z" /></svg>;
}

function PauseIcon({ paused }: { paused: boolean }) {
  return paused ? <svg className="pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z" /></svg> : <svg className="pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>;
}

function Guesser({ round, onGuess, busy }: { round: ActiveRound; onGuess: (i: number) => void; busy: boolean }) {
  const stories = [round.statementOne, round.statementTwo, round.statementThree];
  return <div className="play-card guesser"><span className="turn-badge pink">{t.guesser.badge}</span><h2>{t.guesser.question} <em>{round.authorName}</em>{t.guesser.possessive}</h2><p className="prompt-caption">{t.guesser.theme}: {round.prompt.toUpperCase()}</p><div className="story-cards">{stories.map((story, index) => <button disabled={busy} onClick={() => onGuess(index)} key={index}><span>0{index + 1}</span><p>{story}</p><b>{t.guesser.choose}</b></button>)}</div><small>{t.guesser.warning}</small></div>;
}

function Waiting({ title, text }: { title: string; text: string }) {
  return <div className="play-card waiting"><div className="bobble">🤥</div><span className="turn-badge">{t.waiting.badge}</span><h2>{title}</h2><p>{text}</p><div className="typing"><i/><i/><i/></div></div>;
}

function ReminderModal({ close, minutes }: { close: () => void; minutes: number }) {
  return <div className="modal-backdrop"><div className="reminder-card"><div className="reminder-icon">{t.reminder.icon}</div><span className="eyebrow">{t.reminder.title}</span><h2>{`Everyone sips because the ${minutes}-minute reminder is up.`}</h2><button className="primary-button" onClick={close}>{t.reminder.ok}</button></div></div>;
}

function TimeoutModal({ notice, players, close }: { notice: { playerId: string; roundNumber: number; stage: "writing" | "guessing" }; players: Player[]; close: () => void }) {
  const player = players.find((item) => item.id === notice.playerId)?.name ?? "A player";
  return <div className="modal-backdrop"><div className="reminder-card timeout-card"><div className="reminder-icon">⏰</div><span className="eyebrow">TIME'S UP!</span><h2>{`${player} ran out of time.`}</h2><p>{`${player} takes a sip and the game moves to the next round.`}</p><button className="primary-button" onClick={close}>{t.reveal.next}</button></div></div>;
}

function MiniGameModal({ miniGame, meId, act, busy, categories, customTheme, suggestQuestion, suggestingQuestion }: { miniGame: { id: string; status: "ask" | "answer"; question: string | null; sips: number; assignedPlayerId: string; assignedPlayerName: string; askerName: string | null; targetPlayerName: string | null }; meId: string; act: (action: string, extras?: Record<string, unknown>) => Promise<any>; busy: boolean; categories: ThemeKey[]; customTheme: string | null; suggestQuestion: (category: QuestionCategory, hint: string) => Promise<string>; suggestingQuestion: boolean }) {
  const [question, setQuestion] = useState("");
  const [sips, setSips] = useState(1);
  const [choice, setChoice] = useState<"truth" | "dare" | null>(null);
  const [questionIdeaOpen, setQuestionIdeaOpen] = useState(false);
  const [ideaCategory, setIdeaCategory] = useState<QuestionCategory>("session");
  const [ideaHint, setIdeaHint] = useState("");
  useEffect(() => {
    setQuestion("");
    setSips(1);
    setChoice(null);
    setQuestionIdeaOpen(false);
    setIdeaCategory("session");
    setIdeaHint("");
  }, [miniGame.id]);
  const isMine = miniGame.assignedPlayerId === meId;
  const submitQuestion = async () => { if (question.trim().length < 3) return; await act("submitMiniQuestion", { question, sips }); };
  const chooseTruth = async () => { const result = await act("answerMini", { miniChoice: "truth" }); if (result) setChoice("truth"); };
  const chooseDare = async () => { await act("answerMini", { miniChoice: "dare" }); };
  const getQuestionIdea = async () => { const idea = await suggestQuestion(ideaCategory, ideaHint); if (idea) setQuestion(idea); };
  return <div className="modal-backdrop"><div className="reminder-card mini-game-card">
    <div className="reminder-icon">{miniGame.status === "ask" ? "❓" : choice === "dare" ? "🥃" : "💬"}</div>
    <span className="eyebrow">{t.miniGame.title}</span>
    {miniGame.status === "ask" && isMine && <>
      <h2>{t.miniGame.ask}</h2>
      <p className="mini-game-copy">{t.miniGame.askHint}</p>
      <textarea className="mini-game-input" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={180} placeholder={t.miniGame.questionPlaceholder} />
      <button type="button" className="mini-question-idea" disabled={busy} onClick={() => setQuestionIdeaOpen((open) => !open)}>{questionIdeaOpen ? t.miniGame.closeQuestionOptions : t.miniGame.getQuestionIdea}</button>
      {questionIdeaOpen && <div className="mini-question-options">
        <label><span>{t.miniGame.questionCategory}</span><select value={ideaCategory} disabled={suggestingQuestion || busy} onChange={(event) => setIdeaCategory(event.target.value as QuestionCategory)}><option value="session">{t.miniGame.sessionThemes}</option>{categories.map((category) => <option value={category} key={category}>{t.lobby[category]}</option>)}{customTheme && <option value="custom">{t.miniGame.customSubject}</option>}</select></label>
        <label><span>{t.miniGame.questionDirection}</span><textarea value={ideaHint} disabled={suggestingQuestion || busy} onChange={(event) => setIdeaHint(event.target.value)} maxLength={160} placeholder={t.miniGame.questionDirectionPlaceholder} /></label>
        <button type="button" className="mini-question-generate" disabled={suggestingQuestion || busy} onClick={getQuestionIdea}>{suggestingQuestion ? t.miniGame.thinkingQuestion : t.miniGame.generateQuestion}</button>
      </div>}
      <div className="mini-game-sips"><span>{t.miniGame.sipsLabel}</span><div className="sip-picker" role="group" aria-label={t.miniGame.sipsLabel}>{[1,2,3].map((value) => <button type="button" key={value} className={`sip-choice ${sips === value ? "active" : ""}`} aria-pressed={sips === value} onClick={() => setSips(value)}><BeerIcon active={sips === value} /><strong>{value}</strong><small>{value === 1 ? t.common.sip : t.common.sips}</small></button>)}</div></div>
      <button className="primary-button" disabled={busy || question.trim().length < 3} onClick={submitQuestion}>{t.miniGame.sendQuestion}</button>
    </>}
    {miniGame.status === "ask" && !isMine && <><h2>{miniGame.askerName ?? "Your friend"} {t.miniGame.writing}</h2><p className="mini-game-wait">{t.miniGame.ready}</p></>}
    {miniGame.status === "answer" && isMine && !choice && <>
      <h2>{miniGame.askerName ?? "Your friend"} {t.miniGame.wantsToKnow}</h2><p className="mini-game-question">{miniGame.question}</p><p className="mini-game-copy">{t.miniGame.chooseHint}</p>
      <div className="mini-game-actions"><button className="primary-button" disabled={busy} onClick={chooseTruth}>{t.miniGame.truth}</button><button className="primary-button dare-button" disabled={busy} onClick={chooseDare}>{t.miniGame.dare} · {t.miniGame.take} {miniGame.sips} {miniGame.sips === 1 ? t.common.sip.toUpperCase() : t.common.sips.toUpperCase()}</button></div>
    </>}
    {miniGame.status === "answer" && !isMine && <><h2>{miniGame.targetPlayerName ?? "Your friend"} {t.miniGame.choosing}</h2><p className="mini-game-question">{miniGame.question}</p><p className="mini-game-wait">{t.miniGame.waitingChoice}</p></>}
  </div></div>;
}

function BeerIcon({ active }: { active: boolean }) {
  return <svg className={`beer-icon ${active ? "active" : ""}`} viewBox="0 0 32 32" aria-hidden="true"><path className="beer-foam" d="M6 8.5c0-1.4 1.1-2.5 2.5-2.5.7 0 1.3.3 1.8.7.5-1 1.5-1.7 2.7-1.7s2.3.7 2.8 1.8c.5-.5 1.2-.8 2-.8 1.5 0 2.7 1.2 2.7 2.7V11H6V8.5Z"/><path className="beer-liquid" d="M6 11h16v13H6z"/><path className="beer-outline" d="M6 10.5h16v14H6zM22 14h3.5a2.5 2.5 0 0 1 0 5H22"/></svg>;
}

function Reveal({ reveal, players, meId, close, groupSipEvery }: { reveal: { correct: boolean; truthIndex: number; drinkerId: string; roundNumber: number; authorId: string; guesserId: string; statements: string[] }; players: Player[]; meId: string; close: () => void; groupSipEvery: number | null }) {
  const drinker = players.find((p) => p.id === reveal.drinkerId)?.name;
  const guesser = players.find((p) => p.id === reveal.guesserId)?.name ?? "That player";
  const isGuesser = meId === reveal.guesserId;
  const isAuthor = meId === reveal.authorId;
  const viewerFailed = (reveal.correct && isAuthor) || (!reveal.correct && isGuesser);
  const title = reveal.correct ? (isAuthor ? t.reveal.foundTruth : `${drinker} ${t.reveal.drinks}`) : (isGuesser ? t.reveal.wrong : t.reveal.bluffSuccess);
  const outcome = reveal.correct ? (isAuthor ? t.reveal.yourSip : t.reveal.drinks) : (isGuesser ? `${drinker}, ${t.reveal.yourTurn}` : t.reveal.theySip);
  const eyebrow = viewerFailed ? (isAuthor ? t.reveal.busted : t.reveal.wrong) : (reveal.correct ? t.reveal.correct : t.reveal.bluffSuccess);
  return <div className="modal-backdrop"><div className={`reveal-card ${viewerFailed ? "wrong" : "correct"}`}><div className="result-mark">{viewerFailed ? "×" : "✓"}</div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{outcome}</p><p>{t.reveal.truthWas}</p><blockquote>“{reveal.statements[reveal.truthIndex]}”</blockquote>{groupSipEvery && <div className="group-sip">Everyone sips because the house rule triggers every {groupSipEvery} rounds.</div>}<button className="primary-button" onClick={close}>{t.reveal.next}</button></div></div>;
}

function Finished({ players, leave }: { players: Player[]; leave: () => void }) {
  const sorted = useMemo(() => [...players].sort((a,b) => a.sips - b.sips), [players]);
  return <section className="finished"><span className="eyebrow">{t.finished.kicker}</span><h1>{t.finished.title}</h1><div className="winner">🏆<strong>{sorted[0]?.name}</strong><span>{sorted[0]?.sips} {sorted[0]?.sips === 1 ? t.common.sip : t.common.sips}</span></div><div className="final-list">{sorted.map((p, i) => <div key={p.id}><b>#{i+1}</b><span>{p.name}</span><small>{p.sips} {p.sips === 1 ? t.common.sip : t.common.sips}</small></div>)}</div><button className="primary-button" onClick={leave}>{t.finished.newTable}</button></section>;
}

function formatClock(totalSeconds: number) { const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0"); const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0"); return `${minutes}:${seconds}`; }
