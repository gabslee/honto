"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getMessages, themeCategories } from "./i18n";

type Player = { id: string; name: string; isHost: number; sips: number; joinedAt: string };
type ActiveRound = {
  id: string; roundNumber: number; authorId: string; authorName: string; prompt: string;
  statementOne: string; statementTwo: string; statementThree: string; createdAt?: string;
  guessedIndex: number | null; guesserId: string | null; result: string | null; truthIndex: number | null;
};
type GameState = {
  room: { code: string; status: "lobby" | "playing" | "finished"; roundCount: number; currentRound: number; groupSipEvery: number | null; timerMinutes: number | null; writeTimerMinutes: number | null; guessTimerMinutes: number | null; themeCategory: string; startedAt: string | null; roundStartedAt: string | null; sessionPaused: boolean; pausedAt: string | null; pausedSeconds: number };
  players: Player[]; activeRound: ActiveRound | null; lastReveal: { roundNumber: number; authorId: string; guesserId: string; truthIndex: number; guessedIndex: number; result: "correct" | "wrong"; statementOne: string; statementTwo: string; statementThree: string; drinkerId: string } | null; meId: string;
};

const t = getMessages();
const PROMPTS: string[] = [...t.prompts];
const THEME_KEYS = ["mixed", "family", "innocent", "life", "spicy", "wild"] as const;
type ThemeKey = (typeof THEME_KEYS)[number];

function storedThemeKeys(value: string | null | undefined): ThemeKey[] {
  if (!value || value === "safe") return [];
  return value.split(",").filter((key): key is ThemeKey => THEME_KEYS.includes(key as ThemeKey));
}

function activeThemeKeys(value: string | null | undefined): ThemeKey[] {
  const selected = storedThemeKeys(value);
  return selected.length ? selected : ["mixed", "family", "innocent", "life"];
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
  const [suggestingPrompt, setSuggestingPrompt] = useState(false);
  const [truthText, setTruthText] = useState("");
  const [lieOptions, setLieOptions] = useState<string[]>([]);
  const [selectedLies, setSelectedLies] = useState<number[]>([]);
  const [generatingLies, setGeneratingLies] = useState(false);
  const [reveal, setReveal] = useState<{ correct: boolean; truthIndex: number; drinkerId: string; roundNumber: number; authorId: string; guesserId: string; statements: string[] } | null>(null);
  const [seenRevealRound, setSeenRevealRound] = useState<number | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [dismissedReminder, setDismissedReminder] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const saved = localStorage.getItem("honto-session");
    if (saved) { try { setSession(JSON.parse(saved)); } catch { localStorage.removeItem("honto-session"); } }
    const room = new URLSearchParams(location.search).get("room");
    if (room) { setJoinCode(room.toUpperCase()); setMode("join"); }
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!session) return;
    try {
      const response = await fetch(`/api/game?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t.errors.refresh);
      setGame(data);
      if (!quiet) setError("");
    } catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : t.errors.connection); }
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
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const nextTimerSip = game?.room.timerMinutes ? game.room.timerMinutes - (elapsedMinutes % game.room.timerMinutes) : null;
  const reminderTick = game?.room.timerMinutes && elapsedMinutes > 0 ? Math.floor(elapsedMinutes / game.room.timerMinutes) : 0;
  const turnStartedAt = game?.activeRound?.createdAt ?? game?.room.roundStartedAt;
  const turnLimit = game?.activeRound ? game.room.guessTimerMinutes : game?.room.writeTimerMinutes;
  const turnElapsed = turnStartedAt ? Math.max(0, Math.floor((now - parseTime(turnStartedAt)) / 1000)) : 0;
  const turnRemaining = turnLimit ? Math.max(0, turnLimit * 60 - turnElapsed) : null;

  useEffect(() => {
    if (!game || (game.room.status !== "playing" && game.room.status !== "finished")) return;
    if (game.lastReveal && game.lastReveal.roundNumber !== seenRevealRound && (game.lastReveal.roundNumber < game.room.currentRound || game.room.status === "finished")) {
      const result = game.lastReveal;
      setReveal({ correct: result.result === "correct", truthIndex: result.truthIndex, drinkerId: result.drinkerId, roundNumber: result.roundNumber, authorId: result.authorId, guesserId: result.guesserId, statements: [result.statementOne, result.statementTwo, result.statementThree] });
      setSeenRevealRound(result.roundNumber);
    }
  }, [game, seenRevealRound]);

  useEffect(() => {
    if (reminderTick > 0 && reminderTick !== dismissedReminder && !game?.room.sessionPaused) {
      setReminderOpen(true);
      setDismissedReminder(reminderTick);
      try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 660; gain.gain.value = 0.04; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.12); } catch { /* audio needs browser permission */ }
    }
  }, [reminderTick, dismissedReminder, game?.room.sessionPaused]);

  async function enter(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await gameApi({ action: mode, name, code: joinCode });
      const next = { code: data.code, token: data.token };
      localStorage.setItem("honto-session", JSON.stringify(next)); setSession(next);
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
    localStorage.removeItem("honto-session"); setSession(null); setGame(null); setReveal(null); setReminderOpen(false); setLieOptions([]); setSelectedLies([]); setTruthText("");
    history.replaceState(null, "", location.pathname);
  }

  async function copyInvite() {
    const url = `${location.origin}${location.pathname}?room=${session?.code}`;
    await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600);
  }

  function newPrompt() {
    const list = game ? activeThemeKeys(game.room.themeCategory).flatMap((key) => themeCategories[key]) : PROMPTS;
    const next = (promptIndex + 1) % list.length; setPromptIndex(next); setPrompt(list[next]);
  }

  async function suggestPrompt() {
    setSuggestingPrompt(true);
    try {
      const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "theme", category: activeThemeKeys(game?.room.themeCategory), exclude: [prompt] }) });
      const data = await response.json() as { prompt?: string };
      if (response.ok && data.prompt) setPrompt(data.prompt);
      else newPrompt();
    } catch { newPrompt(); }
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={leave} aria-label="Back to home"><span>HONTO</span><b>?!</b></button>
        <div className="room-pill"><span className="live-dot" /> {t.room} <strong>{game.room.code}</strong></div>
        <div className="session-tools">{game.room.status !== "lobby" && <span className="session-clock">{game.room.sessionPaused ? t.paused : t.session} {formatClock(elapsedSeconds)}</span>}{me?.isHost && game.room.status === "playing" && <button className="tiny-button" onClick={() => act("pause")}>{game.room.sessionPaused ? t.resume : t.pause}</button>}<button className="tiny-button" onClick={leave}>{t.common.exit}</button></div>
      </header>
      {error && <div className="toast error-toast" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}
      {game.room.status === "lobby" && <Lobby game={game} me={me} busy={busy} copied={copied} copyInvite={copyInvite} act={act} />}
      {game.room.status === "playing" && (
        <section className="game-stage">
          <div className="round-strip">
            <span>{t.round} <b>{game.room.currentRound}</b>/{game.room.roundCount}</span>
            <div className="progress"><i style={{ width: `${(game.room.currentRound / game.room.roundCount) * 100}%` }} /></div>
            {nextTimerSip && <span className="timer">{t.groupSipIn} {nextTimerSip} {t.minutesShort}</span>}
            {turnRemaining !== null && <span className={`timer ${turnRemaining < 30 ? "urgent" : ""}`}>⏱ {formatClock(turnRemaining)}</span>}
          </div>
          <ScoreRail players={game.players} meId={game.meId} />
          {!game.activeRound && author?.id === game.meId && <Writer prompt={prompt} setPrompt={setPrompt} newPrompt={newPrompt} suggestPrompt={suggestPrompt} suggestingPrompt={suggestingPrompt} truthText={truthText} setTruthText={setTruthText} lieOptions={lieOptions} selectedLies={selectedLies} toggleLie={toggleLie} updateLie={updateLie} generateLies={generateLies} generatingLies={generatingLies} submit={submitStories} busy={busy} />}
          {!game.activeRound && author?.id !== game.meId && <Waiting title={`${author?.name} ${t.waiting.writingSuffix}`} text={t.waiting.writingBody} />}
          {game.activeRound && game.activeRound.authorId === game.meId && <Waiting title={t.waiting.sentTitle} text={t.waiting.sentBody} />}
          {game.activeRound && game.activeRound.authorId !== game.meId && <Guesser round={game.activeRound} onGuess={guess} busy={busy} />}
        </section>
      )}
      {game.room.status === "finished" && <Finished players={game.players} leave={leave} />}
      {reveal && <Reveal reveal={reveal} players={game.players} meId={game.meId} close={() => { setReveal(null); refresh(); }} groupSip={Boolean(game.room.groupSipEvery && reveal.roundNumber % game.room.groupSipEvery === 0)} />}
      {reminderOpen && <ReminderModal close={() => setReminderOpen(false)} />}
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
  const configure = (extra: Record<string, unknown>) => act("configure", { roundCount: game.room.roundCount, groupSipEvery: game.room.groupSipEvery, reminderMinutes: game.room.timerMinutes, writeTimerMinutes: game.room.writeTimerMinutes, guessTimerMinutes: game.room.guessTimerMinutes, themeCategory: game.room.themeCategory, ...extra });
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
        <Setting label={t.lobby.everyoneSips} value={game.room.groupSipEvery ?? 0} options={[0,1,3,5,-1]} labels={[t.lobby.never,t.lobby.every1,t.lobby.every3,t.lobby.every5,t.lobby.custom]} customValue={custom(game.room.groupSipEvery, 7)} min={1} max={30} disabled={!host} onChange={(groupSipEvery) => configure({ groupSipEvery: groupSipEvery || null })} />
        <Setting label={t.lobby.timer} value={game.room.timerMinutes ?? 0} options={[0,10,15,-1]} labels={[t.lobby.off,"10 min","15 min",t.lobby.custom]} customValue={custom(game.room.timerMinutes, 20)} min={1} max={180} disabled={!host} onChange={(timerMinutes) => configure({ reminderMinutes: timerMinutes || null })} />
        <ToggleSetting label={t.lobby.writingTimer} enabled={Boolean(game.room.writeTimerMinutes)} value={game.room.writeTimerMinutes ?? 5} options={[1,3,5,10]} customValue={custom(game.room.writeTimerMinutes, 7)} min={1} max={60} disabled={!host} onToggle={(enabled) => configure({ writeTimerMinutes: enabled ? game.room.writeTimerMinutes || 5 : null })} onChange={(writeTimerMinutes) => configure({ writeTimerMinutes })} />
        <ToggleSetting label={t.lobby.guessingTimer} enabled={Boolean(game.room.guessTimerMinutes)} value={game.room.guessTimerMinutes ?? 5} options={[1,3,5]} customValue={custom(game.room.guessTimerMinutes, 7)} min={1} max={60} disabled={!host} onToggle={(enabled) => configure({ guessTimerMinutes: enabled ? game.room.guessTimerMinutes || 5 : null })} onChange={(guessTimerMinutes) => configure({ guessTimerMinutes })} />
        <div className="setting theme-setting"><label>{t.lobby.theme}</label><p className="setting-hint">{t.lobby.selectSubjects}</p><div className="subject-checks">{(["mixed", "family", "innocent", "life", "spicy", "wild"] as ThemeKey[]).map((key) => <label className={`subject-check ${selectedThemes.includes(key) ? "selected" : ""}`} key={key}><input type="checkbox" checked={selectedThemes.includes(key)} disabled={!host} onChange={() => toggleTheme(key)} /><span>{t.lobby[key]}</span></label>)}</div></div>
        {host ? <button className="primary-button start-button" disabled={busy || game.players.length < 2} onClick={() => act("start")}>{game.players.length < 2 ? t.lobby.waiting : t.lobby.start}</button> : <div className="host-note">{t.lobby.hostNote}</div>}
      </div>
    </div>
  </section>;
}

function Setting({ label, value, options, labels, suffix="", customValue, min=1, max=100, disabled, onChange }: { label: string; value: number; options: number[]; labels?: string[]; suffix?: string; customValue?: number; min?: number; max?: number; disabled: boolean; onChange: (v: number) => void }) {
  const isCustom = !options.filter((option) => option >= 0).includes(value);
  return <div className="setting"><label>{label}</label><div className="segmented">{options.map((option, index) => <button type="button" key={option} disabled={disabled} className={option === -1 ? (isCustom ? "active" : "") : value === option ? "active" : ""} onClick={() => onChange(option === -1 ? customValue ?? min : option)}>{labels?.[index] ?? `${option}${suffix}`}</button>)}</div>{isCustom && <input className="custom-setting" type="number" min={min} max={max} value={customValue ?? min} disabled={disabled} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} />}</div>;
}

function ToggleSetting({ label, enabled, value, options, customValue, min=1, max=60, disabled, onToggle, onChange }: { label: string; enabled: boolean; value: number; options: number[]; customValue?: number; min?: number; max?: number; disabled: boolean; onToggle: (enabled: boolean) => void; onChange: (value: number) => void }) {
  const isCustom = enabled && !options.includes(value);
  return <div className="setting toggle-setting"><div className="toggle-setting-head"><label>{label}</label><button type="button" className={`toggle ${enabled ? "on" : ""}`} aria-pressed={enabled} disabled={disabled} onClick={() => onToggle(!enabled)}><span />{enabled ? t.lobby.enabled : t.lobby.off}</button></div>{enabled && <><div className="segmented">{options.map((option) => <button type="button" key={option} disabled={disabled} className={value === option ? "active" : ""} onClick={() => onChange(option)}>{option} min</button>)}<button type="button" disabled={disabled} className={isCustom ? "active" : ""} onClick={() => onChange(customValue ?? min)}>{t.lobby.custom}</button></div>{isCustom && <input className="custom-setting" type="number" min={min} max={max} value={customValue ?? min} disabled={disabled} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} />}</>}</div>;
}

function ScoreRail({ players, meId }: { players: Player[]; meId: string }) {
  return <aside className="score-rail">{players.map((p, i) => <div key={p.id}><span className={`avatar avatar-${i % 4}`}>{p.name[0]}</span><strong>{p.name}{p.id === meId ? ` · ${t.common.you}` : ""}</strong><small>{p.sips} {p.sips === 1 ? t.common.sip : t.common.sips}</small></div>)}</aside>;
}

function Writer({ prompt, setPrompt, newPrompt, suggestPrompt, suggestingPrompt, truthText, setTruthText, lieOptions, selectedLies, toggleLie, updateLie, generateLies, generatingLies, submit, busy }: { prompt: string; setPrompt: (v: string) => void; newPrompt: () => void; suggestPrompt: () => void; suggestingPrompt: boolean; truthText: string; setTruthText: (v: string) => void; lieOptions: string[]; selectedLies: number[]; toggleLie: (index: number) => void; updateLie: (index: number, value: string) => void; generateLies: () => void; generatingLies: boolean; submit: (e: FormEvent) => void; busy: boolean }) {
  return <form className="play-card writer" onSubmit={submit}><span className="turn-badge">{t.writer.badge}</span><h2>{t.writer.title}</h2><div className="prompt-row"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={100}/><button type="button" onClick={newPrompt}>{t.writer.another}</button><button type="button" onClick={suggestPrompt} disabled={suggestingPrompt}>{suggestingPrompt ? t.writer.aiLoading : t.writer.aiIdea}</button></div><p className="hint">{t.writer.hint}</p><label className="truth-editor"><span>{t.writer.truthLabel}</span><textarea value={truthText} onChange={(e) => setTruthText(e.target.value)} placeholder={t.writer.truthPlaceholder} maxLength={180}/></label><button type="button" className="ai-button" onClick={generateLies} disabled={generatingLies || !truthText.trim()}>{generatingLies ? t.writer.generating : t.writer.generate}</button>{lieOptions.length > 0 && <><p className="hint">{t.writer.chooseTwo}</p><div className="lie-options">{lieOptions.map((lie, index) => <label key={index} className={selectedLies.includes(index) ? "selected" : ""}><input type="checkbox" checked={selectedLies.includes(index)} onChange={() => toggleLie(index)} /><textarea value={lie} onChange={(e) => updateLie(index, e.target.value)} maxLength={180}/><b>{selectedLies.includes(index) ? t.writer.selected : t.writer.select}</b></label>)}</div><button className="primary-button" disabled={busy || selectedLies.length !== 2}>{t.writer.submit}</button></>}</form>;
}

function Guesser({ round, onGuess, busy }: { round: ActiveRound; onGuess: (i: number) => void; busy: boolean }) {
  const stories = [round.statementOne, round.statementTwo, round.statementThree];
  return <div className="play-card guesser"><span className="turn-badge pink">{t.guesser.badge}</span><h2>{t.guesser.question} <em>{round.authorName}</em>{t.guesser.possessive}</h2><p className="prompt-caption">{t.guesser.theme}: {round.prompt.toUpperCase()}</p><div className="story-cards">{stories.map((story, index) => <button disabled={busy} onClick={() => onGuess(index)} key={index}><span>0{index + 1}</span><p>{story}</p><b>{t.guesser.choose}</b></button>)}</div><small>{t.guesser.warning}</small></div>;
}

function Waiting({ title, text }: { title: string; text: string }) {
  return <div className="play-card waiting"><div className="bobble">🤥</div><span className="turn-badge">{t.waiting.badge}</span><h2>{title}</h2><p>{text}</p><div className="typing"><i/><i/><i/></div></div>;
}

function ReminderModal({ close }: { close: () => void }) {
  return <div className="modal-backdrop"><div className="reminder-card"><div className="reminder-icon">{t.reminder.icon}</div><span className="eyebrow">{t.reminder.title}</span><h2>{t.reminder.body}</h2><button className="primary-button" onClick={close}>{t.reminder.ok}</button></div></div>;
}

function Reveal({ reveal, players, meId, close, groupSip }: { reveal: { correct: boolean; truthIndex: number; drinkerId: string; roundNumber: number; authorId: string; guesserId: string; statements: string[] }; players: Player[]; meId: string; close: () => void; groupSip: boolean }) {
  const drinker = players.find((p) => p.id === reveal.drinkerId)?.name;
  const guesser = players.find((p) => p.id === reveal.guesserId)?.name ?? "That player";
  const isGuesser = meId === reveal.guesserId;
  const isAuthor = meId === reveal.authorId;
  const title = reveal.correct ? (isAuthor ? t.reveal.foundTruth : `${drinker} ${t.reveal.drinks}`) : (isGuesser ? t.reveal.wrong : t.reveal.bluffSuccess);
  const outcome = reveal.correct ? (isAuthor ? t.reveal.yourSip : t.reveal.drinks) : (isGuesser ? `${drinker}, ${t.reveal.yourTurn}` : `${guesser} ${t.reveal.guessedWrong} ${t.reveal.theySip}`);
  return <div className="modal-backdrop"><div className={`reveal-card ${reveal.correct ? "correct" : "wrong"}`}><div className="result-mark">{reveal.correct ? "✓" : "×"}</div><span className="eyebrow">{reveal.correct ? t.reveal.correct : (isGuesser ? t.reveal.wrong : t.reveal.bluffSuccess)}</span><h2>{title}</h2><p>{outcome}</p><p>{t.reveal.truthWas}</p><blockquote>“{reveal.statements[reveal.truthIndex]}”</blockquote>{groupSip && <div className="group-sip">{t.reveal.group}</div>}<button className="primary-button" onClick={close}>{t.reveal.next}</button></div></div>;
}

function Finished({ players, leave }: { players: Player[]; leave: () => void }) {
  const sorted = useMemo(() => [...players].sort((a,b) => a.sips - b.sips), [players]);
  return <section className="finished"><span className="eyebrow">{t.finished.kicker}</span><h1>{t.finished.title}</h1><div className="winner">🏆<strong>{sorted[0]?.name}</strong><span>{sorted[0]?.sips} {sorted[0]?.sips === 1 ? t.common.sip : t.common.sips}</span></div><div className="final-list">{sorted.map((p, i) => <div key={p.id}><b>#{i+1}</b><span>{p.name}</span><small>{p.sips} {p.sips === 1 ? t.common.sip : t.common.sips}</small></div>)}</div><button className="primary-button" onClick={leave}>{t.finished.newTable}</button></section>;
}

function formatClock(totalSeconds: number) { const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0"); const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0"); return `${minutes}:${seconds}`; }
