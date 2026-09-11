"use client";

import { createContext, FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { questionLibrary, questionLibraryJa, type Locale } from "./i18n";
import { loadRoomSession, removeRoomSession, saveRoomSession } from "./session-store";

type ThemeKey = "general" | "life" | "relationships" | "spicy";
type Player = { id: string; name: string; isHost: number; sips: number; joinedAt: string; connected?: boolean; hasWager: boolean; wager?: string | null };
type Card = {
  id: string; cardNumber: number; type: "hidden" | "honto" | "question" | "wouldrather" | "preference" | "estimate" | "rps" | "both"; completedAt?: string | null;
  status: "hidden" | "ready" | "guess" | "choose" | "complete";
  actorId: string; actorName: string; targetId: string; targetName: string;
  payload: { prompt?: string; statements?: string[]; question?: string; sips?: number; options?: Array<number | string>; wrongGuesses?: number[]; hasChosen?: boolean; tieCount?: number };
  secret?: { truthIndex?: number; preferenceIndex?: number; correctNumber?: number };
  revealedBy?: string[];
  result: { correct?: boolean; guessedIndex?: number; choice?: "answer" | "skip"; wouldRatherIndex?: number; skipped?: boolean; skipById?: string | null; drinkerId?: string | null; spinById?: string | null; wheelStartedAt?: string; sips?: number; correctNumber?: number; wrongGuesses?: number[]; firstTry?: boolean; actorChoice?: RpsChoice; targetChoice?: RpsChoice; bothDrink?: boolean };
};
type GameState = {
  room: { code: string; status: "lobby" | "playing" | "finished" | "abandoned"; roundCount: number; currentRound: number; themeCategory: string; customTheme: string | null; cardTypes?: string; welcomeAck: string[]; locale: Locale; startedAt: string | null; canUseSpicy?: boolean; canCustomizeDeck?: boolean };
  players: Player[]; activeCard: Card | null; lastCard: Card | null; meId: string;
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const THEME_KEYS: ThemeKey[] = ["general", "life", "relationships", "spicy"];
const THEME_LABELS: Record<ThemeKey, string> = { general: "General", life: "Life & stories", relationships: "Relationships", spicy: "Spicy · 18+" };
const THEME_LABELS_JA: Record<ThemeKey, string> = { general: "一般", life: "人生と物語", relationships: "人間関係", spicy: "スパイシー・18歳以上" };
const DECK_KEYS = ["honto", "question", "wouldrather", "preference", "estimate", "rps", "both"] as const;
const LEGACY_THEME_MAP: Record<string, ThemeKey> = { general: "general", relationships: "relationships", mixed: "general", family: "general", innocent: "general", life: "life", flirty: "relationships", spicy: "spicy", wild: "general" };
const CARD_META = {
  honto: { icon: "🤥", label: "TWO LIES, ONE TRUTH", color: "yellow" },
  question: { icon: "❓", label: "QUESTION OR SIPS", color: "mint" },
  wouldrather: { icon: "↔", label: "WOULD YOU RATHER?", color: "yellow" },
  preference: { icon: "🧠", label: "READ MY MIND", color: "blue" },
  estimate: { icon: "🎯", label: "NUMBER ESTIMATE", color: "pink" },
  rps: { icon: "✊", label: "JOKEN-PÔ", color: "blue" },
  both: { icon: "🍻", label: "BOTH DRINK", color: "yellow" },
} as const;
const CARD_META_JA: Record<keyof typeof CARD_META, { label: string }> = {
  honto: { label: "嘘2つ・本当1つ" }, question: { label: "質問かシップ" }, wouldrather: { label: "どちらを選ぶ？" }, preference: { label: "心を読む" }, estimate: { label: "数字当て" }, rps: { label: "じゃんけん" }, both: { label: "2人で飲む" },
};
type RpsChoice = "rock" | "paper" | "scissors";

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void; roomCode?: string; sessionToken?: string }>({ locale: "en", setLocale: () => undefined });
function useLocale() { return useContext(LocaleContext); }
function LanguageMenu({ onChange, landing = false }: { onChange?: (locale: Locale) => void; landing?: boolean } = {}) {
  const { locale, setLocale } = useLocale(); const [open, setOpen] = useState(false); const ja = locale === "ja";
  const choose = (next: Locale) => { setLocale(next); onChange?.(next); setOpen(false); };
  return <div className={landing ? "language-picker" : "language-menu"}><button type="button" className="language-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={ja ? "言語を選択" : "Choose language"} onClick={() => setOpen((current) => !current)}><span aria-hidden="true">{landing ? (ja ? "言語" : "LANGUAGE") : "文"}</span><strong>{locale === "ja" ? "日本語" : "EN"}</strong><i aria-hidden="true">⌄</i></button>{open && <div className="language-options" role="listbox" aria-label={ja ? "言語" : "Language"}><button type="button" role="option" aria-selected={locale === "en"} className={locale === "en" ? "selected" : ""} onClick={() => choose("en")}>EN</button><button type="button" role="option" aria-selected={locale === "ja"} className={locale === "ja" ? "selected" : ""} onClick={() => choose("ja")}>日本語</button></div>}</div>;
}
function AccountControl() {
  const [user, setUser] = useState<{ email: string; displayName?: string; role?: string; plan?: string; subscriptionStatus?: string; trialEndsAt?: string | null; stripeCustomerId?: string | null } | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => setUser(data.user ?? null)).catch(() => undefined); }, []);
  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>(".entry-card");
    const note = form?.querySelector("small");
    if (!form || !note) return;
    const slot = document.createElement("div"); slot.className = "account-slot"; note.before(slot); setMount(slot);
    return () => { slot.remove(); setMount(null); };
  }, []);
  useEffect(() => {
    const icon = mount?.querySelector<SVGElement>(".apple-mark");
    if (!icon) return;
    icon.innerHTML = '<path fill="currentColor" d="M19.665 13.544c-.028-3.169 2.584-4.703 2.704-4.775-1.474-2.155-3.765-2.45-4.573-2.48-1.938-.203-3.817 1.159-4.785 1.159-.985 0-2.513-1.14-4.14-1.105-2.096.032-4.056 1.245-5.145 3.128-2.244 3.892-.57 9.62 1.605 12.773 1.086 1.545 2.356 3.264 4.04 3.202 1.617-.067 2.226-1.027 4.179-1.027 1.896 0 2.488 1.027 4.173.988 1.733-.028 2.833-1.542 3.881-3.102 1.256-1.772 1.761-3.517 1.781-3.607-.041-.013-3.689-1.41-3.72-5.154ZM16.493 4.306c.86-1.043 1.447-2.474 1.282-3.906-1.24.049-2.735.828-3.631 1.856-.791.909-1.48 2.36-1.304 3.737 1.391.106 2.81-.707 3.653-1.687Z" transform="translate(-1 -1) scale(.92)"/>';
  }, [mount]);
  if (!mount) return null;
  const openCheckout = async (interval: "month" | "year") => { const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ interval }) }); const data = await response.json(); if (data.url) window.location.href = data.url; };
  const openPortal = async () => { const response = await fetch("/api/billing/portal", { method: "POST" }); const data = await response.json(); if (data.url) window.location.href = data.url; };
  if (Boolean(user)) return createPortal(<><div className="account-stack"><span className="account-control signed-in-account account-identity"><span>{user!.displayName ?? user!.email}</span><button type="button" aria-label="Sign out" onClick={() => setConfirmSignOut(true)}>×</button></span>{user!.role === "admin" ? <span className="account-control signed-in-account account-status account-status-admin">ADMIN · UNLIMITED</span> : user!.plan === "premium" || user!.subscriptionStatus === "active" ? user!.stripeCustomerId ? <button type="button" className="account-control curated-button account-premium-button" onClick={() => void openPortal()}>MANAGE PREMIUM</button> : <span className="account-control signed-in-account account-status account-status-premium">PREMIUM ACTIVE</span> : <button type="button" className="account-control curated-button account-trial-button" onClick={() => { window.location.href = "/pricing"; }}>START 7-DAY PREMIUM TRIAL</button>}</div>{confirmSignOut && <div className="modal-backdrop account-confirm-backdrop" role="presentation" onClick={() => setConfirmSignOut(false)}><section className="account-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="signout-title" onClick={(event) => event.stopPropagation()}><span className="eyebrow">HONTO · ACCOUNT</span><h2 id="signout-title">Do you want to disconnect from your account?</h2><p>Your account will stay safe, and you can sign in again anytime.</p><div className="account-confirm-actions"><button type="button" className="primary-button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); setConfirmSignOut(false); setUser(null); }}>YES, DISCONNECT</button><button type="button" className="curated-button" onClick={() => setConfirmSignOut(false)}>NO, STAY SIGNED IN</button></div></section></div>}</>, mount);
  const content = !user ? <div className="account-auth-buttons"><a className="account-control curated-button" aria-label="Sign in with Google" title="Sign in with Google" href="/api/auth/google/start"><svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.26Z"/><path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.37l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.29v2.53A9.74 9.74 0 0 0 12 21.7Z"/><path fill="#FBBC05" d="M6.53 13.77A5.85 5.85 0 0 1 6.22 12c0-.62.11-1.22.31-1.77V7.7H3.29A9.74 9.74 0 0 0 2.25 12c0 1.57.38 3.05 1.04 4.3l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.2c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.25 14.63 2.3 12 2.3a9.74 9.74 0 0 0-8.71 5.4l3.24 2.53C7.3 7.92 9.46 6.2 12 6.2Z"/></svg></a><button type="button" className="account-control apple-auth-button" aria-label="Sign in with Apple — coming soon" title="Sign in with Apple — coming soon" disabled><svg className="apple-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.05 12.54c-.02-2.15 1.76-3.18 1.84-3.23a3.96 3.96 0 0 0-3.12-1.69c-1.31-.14-2.58.78-3.25.78-.68 0-1.72-.76-2.83-.74a4.17 4.17 0 0 0-3.5 2.14c-1.51 2.62-.38 6.49 1.06 8.62.72 1.04 1.56 2.2 2.67 2.16 1.08-.04 1.49-.69 2.61-2.1.82-1.2 1.16-2.36 1.18-2.42a3.75 3.75 0 0 1-2.28-3.5ZM14.9 6.22a3.78 3.78 0 0 0 .86-2.73 3.84 3.84 0 0 0-2.48 1.28 3.59 3.59 0 0 0-.88 2.62 3.18 3.18 0 0 0 2.5-1.17Z"/></svg></button></div> : <span className="account-control signed-in-account account-identity">{user.displayName ?? user.email}</span>;
  return createPortal(content, mount);
}

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
function aiFallbackNotice(locale: Locale, reason?: string) {
  if (reason === "rate_limited") return locale === "ja" ? "このルームのAI利用上限に達しました。内蔵の候補を表示しています。" : "This room has reached its AI limit, so these are built-in suggestions.";
  if (reason === "quota_exhausted") return locale === "ja" ? "AIのクレジットが不足しているため、内蔵の候補を表示しています。" : "AI credits are unavailable right now, so these are built-in suggestions.";
  if (reason === "safety_refusal") return locale === "ja" ? "AIはこの内容に回答できなかったため、内蔵の候補を表示しています。" : "AI could not answer this request, so these are built-in suggestions.";
  if (reason === "invalid_response") return locale === "ja" ? "AIの回答が不完全だったため、内蔵の候補を表示しています。もう一度試せます。" : "AI returned an incomplete answer, so these are built-in suggestions. You can try again.";
  return locale === "ja" ? "AIに接続できなかったため、内蔵の候補を表示しています。" : "AI could not be reached, so these are built-in suggestions.";
}
async function gameApi(body: Record<string, unknown>) {
  const response = await fetch("/api/game", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "cache-control": "no-cache" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function localizeError(message: string, locale: Locale) {
  if (locale !== "ja") return message;
  const translations: Record<string, string> = {
    "Something went wrong.": "問題が発生しました。",
    "Connection error.": "接続エラーです。",
    "We couldn't enter the room.": "ルームに入れませんでした。",
    "This room already has two players.": "このルームは満員です。",
    "The game has already started.": "ゲームはすでに始まっています。",
    "Only the host can change the room settings.": "ルーム設定を変更できるのはホストだけです。",
    "Honto needs exactly two players.": "Hontoには2人のプレイヤーが必要です。",
    "The other player is responsible for spinning this wheel.": "このルーレットはもう1人が回します。",
    "Write what the other player must do if you win.": "勝ったら相手にしてほしいことを書いてください。",
    "Both players need to lock in their wagers first.": "先に2人とも賭けを確定してください。",
  };
  return translations[message] ?? message;
}

export default function GameClient() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [locale, setLocale] = useState<Locale>("en");
  const [session, setSession] = useState<{ code: string; token: string } | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dismissedReveal, setDismissedReveal] = useState<string | null>(null);
  const [headerHidden, setHeaderHidden] = useState(false);
  const mutationEpoch = useRef(0);
  const mutationActive = useRef(false);

  useEffect(() => {
    if (!session || !game) { setHeaderHidden(false); return; }
    const scroller = document.querySelector<HTMLElement>(".app-shell > .lobby-composite, .app-shell > .game-stage, .app-shell > .finished");
    if (!scroller) return;
    setHeaderHidden(false);
    const header = document.querySelector<HTMLElement>(".app-shell > .topbar");
    const measureHeader = () => {
      if (header) header.style.setProperty("--topbar-height", `${header.getBoundingClientRect().height}px`);
    };
    measureHeader();
    const observer = new ResizeObserver(measureHeader);
    if (header) observer.observe(header);
    let previous = scroller.scrollTop;
    const onScroll = () => {
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const current = Math.max(0, Math.min(scroller.scrollTop, maximum));
      // Reclaiming the header's space can clamp scrollTop at the bottom.
      const baseline = Math.min(previous, maximum);
      if (current > baseline + 5 && current > 24) setHeaderHidden(true);
      else if (current < baseline - 5 || (current === 0 && baseline > 0)) setHeaderHidden(false);
      previous = current;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [session, game?.room.status]);

  useEffect(() => {
    const savedLocale = localStorage.getItem("honto-locale");
    if (savedLocale === "ja" || savedLocale === "en") setLocale(savedLocale);
    const room = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
    if (!room) { setSession(null); setJoinCode(""); setMode("create"); return; }
    const saved = loadRoomSession(localStorage, room, SESSION_TTL_MS);
    if (saved) setSession(saved);
    else {
      const legacy = sessionStorage.getItem("honto-session");
      if (legacy) try {
        const parsed = JSON.parse(legacy) as { code?: string; token?: string; savedAt?: number };
        if (parsed.code?.toUpperCase() === room && parsed.token && parsed.savedAt && Date.now() - parsed.savedAt < SESSION_TTL_MS) {
          const migrated = { code: room, token: parsed.token };
          saveRoomSession(localStorage, migrated, parsed.savedAt);
          setSession(migrated);
        }
      } catch { /* ignore an invalid legacy session */ }
      sessionStorage.removeItem("honto-session");
    }
    setJoinCode(room); setMode("join");
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!session || mutationActive.current) return;
    const requestEpoch = mutationEpoch.current;
    try {
      const response = await fetch(`/api/game?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}&_=${Date.now()}`, { cache: "no-store", headers: { "cache-control": "no-cache" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "This room is no longer available.");
      if (mutationActive.current || requestEpoch !== mutationEpoch.current) return;
      setGame(data);
      if (!quiet) setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Connection error.";
      if (/room not found|no longer available|session is not valid|invalid session/i.test(message)) { removeRoomSession(localStorage, session.code); sessionStorage.removeItem("honto-session"); setSession(null); setGame(null); setDismissedReveal(null); }
      if (!quiet) setError(message);
    }
  }, [session]);

  useEffect(() => { localStorage.setItem("honto-locale", locale); }, [locale]);
  useEffect(() => { document.documentElement.lang = locale === "ja" ? "ja" : "en"; document.title = locale === "ja" ? "HONTO?! — 2人で遊ぶ共有カードゲーム" : "HONTO?! — A shared card game for two"; }, [locale]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => void refresh(true), 1800);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  async function enter(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await gameApi({ action: mode, name, code: joinCode, locale });
      const next = { code: data.code, token: data.token };
      saveRoomSession(localStorage, next);
      sessionStorage.removeItem("honto-session");
      history.replaceState({}, "", `?room=${encodeURIComponent(data.code)}`); setSession(next);
    } catch (cause) { setError(localizeError(cause instanceof Error ? cause.message : "We couldn't enter the room.", locale)); }
    finally { setBusy(false); }
  }

  async function act(action: string, extras: Record<string, unknown> = {}) {
    if (!session) return null;
    mutationActive.current = true; mutationEpoch.current += 1;
    setBusy(true); setError("");
    try { const data = await gameApi({ action, ...session, ...extras }); setGame(data); return data; }
    catch (cause) { setError(localizeError(cause instanceof Error ? cause.message : "Something went wrong.", locale)); return null; }
    finally { mutationActive.current = false; setBusy(false); }
  }

  async function leave() {
    const current = session;
    if (current) {
      try { await gameApi({ action: "leave", ...current }); } catch { /* local exit must remain available offline */ }
      removeRoomSession(localStorage, current.code);
    }
    sessionStorage.removeItem("honto-session"); history.replaceState({}, "", location.pathname);
    setSession(null); setGame(null); setDismissedReveal(null);
  }

  if (!session) return <LocaleContext.Provider value={{ locale, setLocale, roomCode: undefined, sessionToken: undefined }}><AccountControl/><Landing name={name} setName={setName} joinCode={joinCode} setJoinCode={setJoinCode} mode={mode} setMode={setMode} enter={enter} busy={busy} error={error} /></LocaleContext.Provider>;
  if (!game) return <main className="loading"><div className="stamp">HONTO?!</div><p>{locale === "ja" ? "デッキをシャッフル中…" : "Shuffling the deck…"}</p>{error && <p className="form-error">{error}</p>}</main>;

  const host = game.players.find((player) => player.id === game.meId)?.isHost;
  const reveal = game.room.status !== "abandoned" && game.lastCard && game.lastCard.id !== dismissedReveal ? game.lastCard : null;
  const copyInvite = async () => { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${game.room.code}`); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  const changeLocale = (next: Locale) => { setLocale(next); };

  return <LocaleContext.Provider value={{ locale, setLocale, roomCode: session.code, sessionToken: session.token }}><main className="app-shell">
    <header className={`topbar ${headerHidden ? "topbar-hidden" : ""}`}><button className="brand" onClick={leave}><span>HONTO?</span><b>!</b></button><div className="room-pill"><strong>{game.room.code}</strong></div><div className="session-tools"><LanguageMenu onChange={changeLocale}/><button className="tiny-button" onClick={leave}>{locale === "ja" ? "退出" : "EXIT"}</button></div></header>
    {error && <div className="toast error-toast">{error}<button onClick={() => setError("")}>×</button></div>}
    {game.room.status === "lobby" && <Lobby game={game} host={Boolean(host)} busy={busy} copied={copied} copyInvite={copyInvite} act={act} />}
    {game.room.status === "playing" && <GameTable game={game} busy={busy} act={act} />}
    {game.room.status === "finished" && !reveal && <Finished players={game.players} restart={() => act("newTable")} />}
    {game.room.status === "abandoned" && <Abandoned leave={leave} />}
    {reveal && <Reveal card={reveal} players={game.players} meId={game.meId} isFinal={reveal.cardNumber === game.room.roundCount} close={() => setDismissedReveal(reveal.id)} spinWheel={() => act("startWheel")} />}
  </main></LocaleContext.Provider>;
}

function Landing(props: { name: string; setName: (value: string) => void; joinCode: string; setJoinCode: (value: string) => void; mode: "create" | "join"; setMode: (value: "create" | "join") => void; enter: (event: FormEvent) => void; busy: boolean; error: string }) {
  const { locale, setLocale } = useLocale();
  const landingTypes = ["honto", "question", "wouldrather", "preference", "estimate", "rps", "both"] as const;
  const setJoinCode = props.setJoinCode;
  const ja = locale === "ja";
  return <main className="landing"><nav><div className="logo"><span>HONTO?</span><b>!</b></div><div className="landing-nav-tools"><span className="microcopy">{ja ? "2人で遊ぶ共有カードゲーム" : "A SHARED DECK FOR TWO"}</span><LanguageMenu landing /></div></nav><section className="hero"><div className="hero-copy"><span className="eyebrow">{ja ? "オンラインパーティーゲーム · 2人" : "ONLINE PARTY GAME · 2 PLAYERS"}</span><h1>{ja ? <>カードを引いて。<br/><em>相手を知ろう。</em></> : <>Draw a card.<br/><em>Read each other.</em></>}</h1><p>{ja ? "ブラフ、質問、心読み、数字当て、じゃんけん。カードが次に飲む人を決めます。" : "Bluff, ask, read their mind, estimate, or battle. Every card decides who takes the next sip."}</p><div className="rule-cards" aria-label={ja ? "7種類のミニゲーム" : "Seven Honto mini games"}>{landingTypes.map((type) => { const meta = CARD_META[type]; return <span className={`landing-mini-icon ${meta.color}`} key={type} role="img" aria-label={ja ? CARD_META_JA[type].label : meta.label} title={ja ? CARD_META_JA[type].label : meta.label}><MiniGameIcon type={type}/></span>; })}</div></div><form className="entry-card" onSubmit={props.enter}><div className="card-tabs"><button type="button" className={props.mode === "create" ? "active" : ""} onClick={() => props.setMode("create")}>{ja ? "ルームを作る" : "Create room"}</button><button type="button" className={props.mode === "join" ? "active" : ""} onClick={() => props.setMode("join")}>{ja ? "ルームに参加" : "Join room"}</button></div><label>{ja ? "名前を入力" : "WHAT SHOULD WE CALL YOU?"}<input value={props.name} onChange={(event) => props.setName(event.target.value)} maxLength={24} placeholder={ja ? "名前またはニックネーム" : "Your name or nickname"} required /></label>{props.mode === "join" && <label>{ja ? "ルームコード" : "ROOM CODE"}<input value={props.joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={16} placeholder="MOON-42" required /></label>}{props.error && <p className="form-error">{props.error}</p>}<button className="primary-button" disabled={props.busy}>{props.busy ? (ja ? "少々お待ちください…" : "ONE SECOND…") : props.mode === "create" ? (ja ? "デッキを作る →" : "CREATE THE DECK →") : (ja ? "ゲームに参加 →" : "JOIN THE GAME →")}</button><small>{ja ? "アカウント不要。お酒でもノンアルでも遊べます。" : "No account needed. Alcoholic or non-alcoholic drinks both count."}</small></form></section><footer>{ja ? "HONTOは日本語で「本当？」という意味です。" : "HONTO MEANS “IS IT TRUE?” IN JAPANESE."} · <a href="/pricing">Premium</a></footer></main>;
}

function LegacyLobby({ game, host, busy, copied, copyInvite, act }: { game: GameState; host: boolean; busy: boolean; copied: boolean; copyInvite: () => void; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const canUseSpicy = Boolean(game.room.canUseSpicy);
  const [roundCount, setRoundCount] = useState(game.room.roundCount);
  const [selected, setSelected] = useState<ThemeKey[]>(() => storedThemes(game.room.themeCategory).filter((key) => key !== "spicy" || canUseSpicy));
  const selectedRef = useRef(selected);
  const themeSaveQueue = useRef(Promise.resolve());
  const pendingThemeSaves = useRef(0);
  useEffect(() => {
    if (host && pendingThemeSaves.current > 0) return;
    const next = storedThemes(game.room.themeCategory).filter((key) => key !== "spicy" || canUseSpicy);
    selectedRef.current = next;
    setSelected(next);
  }, [game.room.themeCategory, host, canUseSpicy]);
  useEffect(() => { setRoundCount(game.room.roundCount); }, [game.room.roundCount]);
  const configure = (extra: Record<string, unknown>) => act("configure", extra);
  const toggleTheme = (key: ThemeKey) => {
    const current = selectedRef.current;
    if (key === "spicy" && !canUseSpicy) return;
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    selectedRef.current = next;
    setSelected(next);
    pendingThemeSaves.current += 1;
    themeSaveQueue.current = themeSaveQueue.current.then(() => configure({ themeCategory: next.join(",") })).then(() => undefined).finally(() => { pendingThemeSaves.current -= 1; });
  };
  return <section className="lobby"><div className="lobby-head"><span className="eyebrow">{ja ? "カードをシャッフル中" : "SHUFFLING THE CARDS"}</span><h1>{ja ? <>デッキの準備は<em>ほぼ</em>完了です。</> : <>Your deck is <em>almost</em> ready.</>}</h1><p>{ja ? "一緒に遊ぶ人を1人招待してください。このテーブルは2人専用です。" : "Invite one person. This table has exactly two seats."}</p></div><div className="lobby-grid"><div className="panel"><div className="panel-title"><h2>{ja ? "テーブル" : "At the table"} <small className="room-name-tip" title={`${ja ? "ルーム" : "Room"} ${game.room.code}`}>{ja ? "ルーム" : "ROOM"} {game.room.code}</small></h2><span>{game.players.length}/2</span></div><div className="people-list">{game.players.map((player, index) => <div className="person" key={player.id}><span className={`avatar avatar-${index}`}>{player.name[0]}</span><div><strong>{player.name}</strong><small>{player.isHost ? (ja ? "ホスト" : "host") : (ja ? "参加済み" : "ready to play")}</small></div><i>●</i></div>)}</div><button className="invite-button" onClick={copyInvite}>{copied ? (ja ? "リンクをコピーしました ✓" : "LINK COPIED! ✓") : (ja ? "招待リンクをコピー" : "COPY INVITE LINK")}</button></div><div className="panel"><div className="panel-title"><h2>{ja ? "デッキ" : "The deck"}</h2><span className="sticker">{ja ? "7種類のカード" : "7 CARD TYPES"}</span></div><div className="setting"><label>{ja ? "カード枚数" : "Number of cards"}</label><div className="segmented">{[8, 12, 16, 24].map((count) => <button key={count} disabled={!host} className={roundCount === count ? "active" : ""} onClick={() => { setRoundCount(count); void configure({ roundCount: count }); }}>{count}</button>)}</div></div><div className="setting"><label>{ja ? "テーマカテゴリ" : "Theme categories"}</label><p className="setting-hint">{ja ? "質問カードと心読みカードの内容を決めます。" : "These guide the question and preference cards."}</p><div className="subject-checks">{THEME_KEYS.map((key) => <label className={`subject-check ${key === "spicy" ? "spicy-check" : ""} ${selected.includes(key) ? "selected" : ""} ${key === "spicy" && !canUseSpicy ? "locked" : ""}`} key={key}><input type="checkbox" checked={selected.includes(key)} disabled={!host || (key === "spicy" && !canUseSpicy)} onChange={() => toggleTheme(key)} /><span>{ja ? THEME_LABELS_JA[key] : THEME_LABELS[key]}{key === "spicy" && !canUseSpicy && <small className="premium-lock">PREMIUM</small>}</span></label>)}</div></div><div className="setting"><label>{ja ? "追加テーマ（任意）" : "Optional custom subject"}</label><input className="custom-setting" defaultValue={game.room.customTheme ?? ""} disabled={!host} placeholder={ja ? "例：旅行の思い出" : "e.g. our travel stories"} onBlur={(event) => configure({ customTheme: event.target.value })}/></div>{host ? <button className="primary-button start-button" disabled={busy || game.players.length !== 2} onClick={() => act("start")}>{game.players.length === 2 ? (ja ? "シャッフルして開始 →" : "SHUFFLE & START →") : (ja ? "2人目の参加を待っています…" : "WAITING FOR PLAYER TWO…")}</button> : <div className="host-note">{ja ? "ホストがデッキを設定しています。" : "The host is choosing the deck."}</div>}</div></div></section>;
}

function Lobby(props: { game: GameState; host: boolean; busy: boolean; copied: boolean; copyInvite: () => void; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja"; const { game } = props;
  const canCustomizeDeck = Boolean(game.room.canCustomizeDeck); const [selected, setSelected] = useState<string[]>(() => String(game.room.cardTypes ?? DECK_KEYS.join(",")).split(","));
  const [deckOpen, setDeckOpen] = useState(false);
  useEffect(() => { setSelected(String(game.room.cardTypes ?? DECK_KEYS.join(",")).split(",")); }, [game.room.cardTypes]);
  useEffect(() => { if (window.matchMedia("(max-width: 800px)").matches) setDeckOpen(false); }, []);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lobby-composite");
    if (!root) return;
    let cancelled = false;
    let auth: HTMLDivElement | null = null;
    void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (cancelled || data.user || root.querySelector(".lobby-google-button")) return;
    const link = document.createElement("a"); link.href = "/api/auth/google/start"; link.className = "lobby-auth-button lobby-google-button"; link.setAttribute("aria-label", "Sign in with Google"); link.innerHTML = '<svg class="google-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.26Z"/><path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.37l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.29v2.53A9.74 9.74 0 0 0 12 21.7Z"/><path fill="#FBBC05" d="M6.53 13.77A5.85 5.85 0 0 1 6.22 12c0-.62.11-1.22.31-1.77V7.7H3.29A9.74 9.74 0 0 0 2.25 12c0 1.57.38 3.05 1.04 4.3l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.2c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.25 14.63 2.3 12 2.3a9.74 9.74 0 0 0-8.71 5.4l3.24 2.53C7.3 7.92 9.46 6.2 12 6.2Z"/></svg>';
    const apple = document.createElement("button"); apple.type = "button"; apple.disabled = true; apple.className = "lobby-auth-button lobby-apple-button"; apple.setAttribute("aria-label", "Sign in with Apple — coming soon"); apple.innerHTML = '<svg class="apple-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.665 13.544c-.028-3.169 2.584-4.703 2.704-4.775-1.474-2.155-3.765-2.45-4.573-2.48-1.938-.203-3.817 1.159-4.785 1.159-.985 0-2.513-1.14-4.14-1.105-2.096.032-4.056 1.245-5.145 3.128-2.244 3.892-.57 9.62 1.605 12.773 1.086 1.545 2.356 3.264 4.04 3.202 1.617-.067 2.226-1.027 4.179-1.027 1.896 0 2.488 1.027 4.173.988 1.733-.028 2.833-1.542 3.881-3.102 1.256-1.772 1.761-3.517 1.781-3.607-.041-.013-3.689-1.41-3.72-5.154ZM16.493 4.306c.86-1.043 1.447-2.474 1.282-3.906-1.24.049-2.735.828-3.631 1.856-.791.909-1.48 2.36-1.304 3.737 1.391.106 2.81-.707 3.653-1.687Z" transform="translate(-1 -1) scale(.92)"/></svg>';
    auth = document.createElement("div"); auth.className = "lobby-auth-buttons"; auth.append(link, apple); root.appendChild(auth);
    }).catch(() => undefined);
    return () => { cancelled = true; auth?.remove(); };
  }, []);
  const toggle = (key: string) => { if (!canCustomizeDeck) return; const next = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]; if (next.length < 3) return; setSelected(next); void props.act("configure", { cardTypes: next.join(",") }); };
  return <div className="lobby-composite"><LegacyLobby {...props}/><section className="lobby deck-filter-lobby"><div className="panel deck-filter-panel"><button type="button" className="deck-filter-toggle" aria-expanded={deckOpen} onClick={() => setDeckOpen((value) => !value)}><span>{ja ? "デッキをカスタマイズしますか？" : "Want to personalize your deck?"}</span><b>{deckOpen ? "−" : "+"}</b></button>{deckOpen && <div className="deck-filter-content"><div className="panel-title"><h2>{ja ? "カードの種類" : "Card types"}</h2><span className="sticker">{canCustomizeDeck ? "PREMIUM" : (ja ? "ロック中" : "PREMIUM")}</span></div><p className="setting-hint">{canCustomizeDeck ? (ja ? "使いたいカードだけを選べます。順番はシャッフルされます。" : "Choose the games you want. The order stays shuffled.") : (ja ? "Premiumで遊ぶカードを選べます。" : "Choose which games to play with Premium.")}</p><div className="subject-checks card-type-checks">{DECK_KEYS.map((key) => <label className={`subject-check card-type-check ${selected.includes(key) ? "selected" : ""} ${!canCustomizeDeck ? "locked" : ""}`} key={key}><input type="checkbox" checked={selected.includes(key)} disabled={!props.host || !canCustomizeDeck || (selected.length <= 3 && selected.includes(key))} onChange={() => toggle(key)}/><span>{ja ? CARD_META_JA[key].label : CARD_META[key].label}</span></label>)}</div><small className="deck-filter-note">{ja ? "最低3種類。枚数と順番は自動で決まります。" : "Choose at least 3 types. Counts and order stay automatic."}</small></div>}</div></section></div>;
}

function GameTable({ game, busy, act }: { game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
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
  if (game.room.welcomeAck.length < 2) return <WelcomeScreen game={game} busy={busy} act={act} />;
  let content;
  if (!card) content = <Waiting title={ja ? "次のカードを探しています…" : "Finding the next card…"} text={ja ? "共有デッキを同期中です。" : "The shared deck is syncing."}/>;
  else if (card.status === "hidden") content = <DrawCard key={card.id} card={card} meId={game.meId} busy={busy} draw={() => act("drawCard")}/>;
  else if (!revealComplete) content = <Waiting title={ja ? "カードの公開を待っています。" : "Waiting for the card reveal."} text={ja ? `${card.actorName}が2人のために公開します。` : `${card.actorName} will reveal it for both players.`}/>;
  else if (card.type === "honto") content = <HontoCard key={card.id} card={card} meId={game.meId} game={game} busy={busy} act={act}/>;
  else if (card.type === "question") content = <QuestionCard key={card.id} card={card} meId={game.meId} game={game} busy={busy} act={act}/>;
  else if (card.type === "wouldrather") content = <WouldRatherCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else if (card.type === "preference") content = <PreferenceCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else if (card.type === "estimate") content = <EstimateCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else if (card.type === "rps") content = <RpsCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  else content = <BothDrinkCard key={card.id} card={card} meId={game.meId} busy={busy} act={act}/>;
  const canSkip = Boolean(card && card.actorId === game.meId && revealComplete && ["ready", "guess", "choose"].includes(card.status));
  return <section className="game-stage"><div className="round-strip"><span>{ja ? "カード" : "CARD"}</span><b>{game.room.currentRound}/{game.room.roundCount}</b><div className="progress"><i style={{ width: `${(game.room.currentRound / game.room.roundCount) * 100}%` }}/></div><span>{ja ? `デッキに残り${game.room.roundCount - game.room.currentRound}枚` : `${game.room.roundCount - game.room.currentRound} LEFT IN THE DECK`}</span></div><div className="round-controls">{canSkip && <SkipButton busy={busy} skip={() => act("skipCard")}/>}</div><ScoreRail players={game.players} meId={game.meId}/>{content}{introCardId === card?.id && card && !revealComplete && <CardReveal card={card} meId={game.meId} acknowledge={() => act("ackReveal")}/>}</section>;
}

function WelcomeScreen({ game, busy, act }: { game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const [wager, setWager] = useState("");
  const me = game.players.find((player) => player.id === game.meId);
  const bothWagersReady = game.players.length === 2 && game.players.every((player) => player.hasWager);
  const acknowledged = game.room.welcomeAck.includes(game.meId);
  return <section className="game-stage welcome-stage"><div className="welcome-card"><span className="eyebrow">{ja ? "ゲーム前の賭け" : "BEFORE THE FIRST CARD"}</span><div className="welcome-mark" aria-hidden="true"><span>本当</span><b>?!</b></div>{!me?.hasWager ? <><h1>{ja ? "勝ったら、何をしてほしい？" : "What do you want if you win?"}</h1><p>{ja ? "相手にしてほしいことを秘密で書いてください。2人の賭けはゲーム終了時に公開され、負けた人は勝者のチャレンジを実行します。" : "Secretly write what the other player must do. Both wagers are revealed at the end, and the loser takes on the winner’s challenge."}</p><div className="wager-entry"><label htmlFor="game-wager">{ja ? "あなたの秘密のチャレンジ" : "YOUR SECRET CHALLENGE"}</label><textarea id="game-wager" className="mini-game-input" value={wager} onChange={(event) => setWager(event.target.value)} maxLength={220} placeholder={ja ? "例：次のデートの場所を選ばせて" : "e.g. Let me choose our next date"}/><button type="button" className="primary-button" disabled={busy || wager.trim().length < 3} onClick={() => void act("submitWager", { wager })}>{busy ? (ja ? "保存中…" : "LOCKING IT IN…") : (ja ? "秘密で確定 →" : "LOCK IT IN →")}</button></div></> : !bothWagersReady ? <><h1>{ja ? "賭けを確定しました。" : "Your wager is locked."}</h1><p>{ja ? "内容はゲーム終了まで秘密です。もう1人が賭けを書くのを待っています。" : "It stays secret until the game ends. Waiting for the other player to write theirs."}</p><div className="welcome-waiting"><span className="typing"><i/><i/><i/></span><strong>{ja ? "もう1人を待っています…" : "Waiting for the other wager…"}</strong></div></> : <><h1>{ja ? "賭けが決まりました。" : "The stakes are set."}</h1><p>{ja ? "2人のチャレンジは最後まで秘密です。カードを引き、お互いを読みながら、シップが少ない勝者を目指しましょう。" : "Both challenges stay secret until the end. Draw cards, read each other, and finish with the fewest sips to win."}</p><p className="welcome-flow"><strong>{ja ? "遊び方" : "How it works"}</strong><br/>{ja ? "1人が次のカードを引きます。2人に同じチャレンジが表示され、一緒に遊んで次のカードへ進みます。" : "One player draws the next card. Both players see the challenge, then play it together until the next card."}</p>{acknowledged ? <div className="welcome-waiting"><span className="typing"><i/><i/><i/></span><strong>{ja ? "もう1人の確認を待っています…" : "Waiting for the other player…"}</strong><small>{ja ? "2人が「ゲーム開始」を押すと最初のカードが開きます。" : "They need to tap START PLAYING before the first card opens."}</small></div> : <button type="button" className="primary-button welcome-button" disabled={busy} onClick={() => void act("ackWelcome")}>{busy ? (ja ? "保存中…" : "SAVING…") : (ja ? "ゲーム開始 →" : "START PLAYING →")}</button>}</>}</div></section>;
}

function SkipButton({ busy, skip }: { busy: boolean; skip: () => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  return <button type="button" className="skip-button" title={ja ? "このミニゲームをスキップ（2・3・4シップのルーレット）" : "Skip this mini game · spin for 2, 3 or 4 sips"} aria-label={ja ? "このミニゲームをスキップ" : "Skip this mini game. Spin for 2, 3 or 4 sips."} disabled={busy} onClick={() => void skip()}><span>↷</span><strong>{ja ? "スキップ" : "SKIP"}</strong><small><SipMug/> {ja ? "2〜4シップルーレット" : "2–4 SIP WHEEL"}</small></button>;
}

function DrawCard({ card, meId, busy, draw }: { card: Card; meId: string; busy: boolean; draw: () => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const mine = card.actorId === meId;
  const [flipping, setFlipping] = useState(false);
  const reveal = () => { if (busy || flipping) return; setFlipping(true); window.setTimeout(() => { void draw(); }, 720); };
  const cardFace = <><span className="playing-card-corner top">本当<small>?!</small></span><span className="playing-card-mark">!</span><span className="playing-card-center"><i>本当</i><strong>HONTO?!</strong><small>{mine ? (ja ? "引く" : "DRAW") : (ja ? "待機" : "WAIT")}</small></span><span className="playing-card-corner bottom">本当<small>?!</small></span></>;
  return <div className="play-card deck-draw"><span className="turn-badge">{ja ? "カード" : "CARD"} {card.cardNumber}</span><h2>{mine ? (ja ? "あなたがカードを引く番です。" : "Your turn to draw.") : (ja ? `${card.actorName}が次のカードを引いています…` : `${card.actorName} is drawing the next card…`)}</h2><p className="hint">{mine ? (ja ? "カードをタップして次のゲームを表示します。" : "Tap the card to reveal what comes next.") : (ja ? "カードは2人の画面に表示されます。" : "The card will reveal on both screens.")}</p><div className="draw-card-zone">{mine ? <button className={`honto-playing-card ${flipping ? "is-flipping" : ""}`} aria-label={ja ? "次のHontoカードを引く" : "Draw the next Honto card"} disabled={busy || flipping} onClick={reveal}>{cardFace}</button> : <div className="honto-playing-card waiting-card" aria-hidden="true">{cardFace}</div>}</div></div>;
}

function CardReveal({ card, meId, acknowledge }: { card: Card; meId: string; acknowledge: () => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
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
  const label = ja ? CARD_META_JA[card.type as Exclude<Card["type"], "hidden">].label : meta.label;
  return <div className="card-reveal-backdrop"><button type="button" className={`game-reveal-card reveal-${meta.color} ${turning ? "is-turning" : ""} ${waitingForActor ? "is-waiting" : ""}`} onClick={() => void reveal()} disabled={!isActor || actorHasRevealed || turning} aria-label={waitingForActor ? (ja ? `${card.actorName}の公開を待っています` : `Waiting for ${card.actorName} to reveal`) : actorHasRevealed ? (ja ? "次のゲームを開始します" : "Starting the next game") : (ja ? `${label}を公開` : `Reveal ${label}`)}><span className="game-reveal-kicker">{ja ? "次のチャレンジ" : "THE NEXT CHALLENGE"}</span><span className="game-reveal-icon"><MiniGameIcon type={card.type as Exclude<Card["type"], "hidden">}/></span><strong className="game-reveal-kanji">本当?!</strong><h2>{label}</h2>{waitingForActor ? <p className="game-reveal-status"><b>{ja ? `${card.actorName}がカードを公開しています。` : `${card.actorName} is revealing the card.`}</b><br/>{ja ? "公開されると一緒にミニゲームが始まります。" : "You'll join the mini game as soon as it opens."}</p> : actorHasRevealed ? <p className="game-reveal-status"><b>{ja ? "カードを公開しました！" : "Card revealed!"}</b><br/>{ja ? "ミニゲームを開始します。" : "Opening the mini game now."}</p> : <p>{ja ? "カードをタップして2人に公開します。" : "Tap the card to reveal it for both players."}</p>}<span className="game-reveal-cta">{waitingForActor ? (ja ? `${card.actorName}の公開を待っています…` : `WAITING FOR ${card.actorName.toUpperCase()}…`) : actorHasRevealed ? (ja ? "次のゲームを開始中…" : "OPENING NEXT GAME…") : (ja ? "タップして公開 →" : "TAP TO REVEAL →")}</span></button></div>;
}

function MiniGameIcon({ type }: { type: Exclude<Card["type"], "hidden"> }) {
  const fill = type === "honto" || type === "both" ? "#ffd644" : type === "question" ? "#a8e6cf" : type === "preference" || type === "rps" ? "#a9d5ff" : "#ff8eab";
  const face = <><circle cx="37" cy="45" r="3.5" fill="currentColor"/><circle cx="59" cy="45" r="3.5" fill="currentColor"/><path d="M38 61c6 5 14 5 20 0" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></>;
  let art = <><circle cx="48" cy="48" r="40" fill={fill} stroke="currentColor" strokeWidth="4"/>{face}</>;
  if (type === "honto") art = <><rect x="23" y="28" width="34" height="47" rx="6" fill="#ff8eab" stroke="currentColor" strokeWidth="4" transform="rotate(-10 23 28)"/><rect x="39" y="20" width="34" height="47" rx="6" fill={fill} stroke="currentColor" strokeWidth="4" transform="rotate(8 39 20)"/><path d="M49 37h14M49 47h9" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M76 64l5 8 8-4-5-8z" fill="#f04444" stroke="currentColor" strokeWidth="3"/></>;
  if (type === "question") art = <><path d="M18 25c0-7 6-12 13-12h34c7 0 13 5 13 12v25c0 7-6 12-13 12H42L28 77V62h-2c-5-2-8-6-8-12z" fill={fill} stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="M42 32c2-5 12-5 14 1 2 7-7 8-7 14M49 56h.1" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/></>;
  if (type === "wouldrather") art = <><rect x="9" y="23" width="34" height="50" rx="8" fill="#ffd644" stroke="currentColor" strokeWidth="4"/><rect x="53" y="23" width="34" height="50" rx="8" fill="#ff8eab" stroke="currentColor" strokeWidth="4"/><path d="M20 48h12M64 48h12M47 38l4 10-4 10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></>;
  if (type === "preference") art = <><circle cx="29" cy="47" r="17" fill="#ff8eab" stroke="currentColor" strokeWidth="4"/><circle cx="67" cy="31" r="17" fill={fill} stroke="currentColor" strokeWidth="4"/><circle cx="67" cy="67" r="17" fill="#a8e6cf" stroke="currentColor" strokeWidth="4"/><path d="M43 42l9-6M43 53l9 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>{face}</>;
  if (type === "estimate") art = <><circle cx="48" cy="48" r="34" fill={fill} stroke="currentColor" strokeWidth="4"/><circle cx="48" cy="48" r="20" fill="none" stroke="currentColor" strokeWidth="5"/><circle cx="48" cy="48" r="7" fill="#f04444" stroke="currentColor" strokeWidth="3"/><path d="M48 10v13M48 73v13M10 48h13M73 48h13" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M61 23l12 2-7 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></>;
  if (type === "rps") art = <><circle cx="48" cy="48" r="39" fill={fill} stroke="currentColor" strokeWidth="4"/><path d="M24 60V43c0-3 4-4 6-1l2 6V27c0-4 6-4 6 0v16-20c0-4 6-4 6 0v20-16c0-4 6-4 6 0v18-12c0-4 6-4 6 0v18c0 10-6 16-16 16H35c-6 0-11-4-11-7z" fill="#ff8eab" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/></>;
  if (type === "both") art = <><path d="M18 34h35v28c0 7-5 12-12 12H30c-7 0-12-5-12-12z" fill={fill} stroke="currentColor" strokeWidth="4"/><path d="M53 43h7c8 0 11 11 4 15h-9" fill="none" stroke="currentColor" strokeWidth="4"/><path d="M25 27h21M26 19h18" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M47 43h31v20c0 6-4 10-10 10H57" fill="#ff8eab" stroke="currentColor" strokeWidth="4"/><path d="M78 48h4c7 0 9 9 3 13h-7" fill="none" stroke="currentColor" strokeWidth="4"/></>;
  return <svg viewBox="0 0 96 96" className="mini-game-svg" aria-hidden="true" focusable="false">{art}</svg>;
}

function HontoCard({ card, meId, game, busy, act }: { card: Card; meId: string; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  if (card.status === "ready") return card.actorId === meId ? <HontoComposer card={card} game={game} busy={busy} act={act}/> : <Waiting title={ja ? `${card.actorName}がブラフを準備中…` : `${card.actorName} is preparing a bluff…`} text={ja ? "2つの嘘と、隠された1つの本当の話が届きます。" : "Two lies and one carefully hidden truth are on the way."}/>;
  if (card.status === "guess") return card.targetId === meId ? <div className="play-card guesser"><CardBadge type="honto"/><h2>{ja ? `${card.actorName}の本当の話はどれ？` : <>Which one is <em>{card.actorName}</em>&apos;s truth?</>}</h2><div className="story-cards">{card.payload.statements?.map((story, index) => <button disabled={busy} onClick={() => act("guessHonto", { guessedIndex: index })} key={index}><span>0{index + 1}</span><p>{story}</p><b>{ja ? "これは本当" : "THIS IS TRUE"}</b></button>)}</div><small><SipMug/> {ja ? "答えで1〜3シップのルーレットが決まります。" : "Your guess decides who faces the 1–3 sip wheel."}</small></div> : <Waiting title={ja ? "あなたの話が出ています。" : "Your stories are on the table."} text={ja ? `${card.targetName}が本当の話を探しています。` : `${card.targetName} is trying to find the truth.`}/>;
  return null;
}

function HontoComposer({ card, game, busy, act }: { card: Card; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale, roomCode, sessionToken } = useLocale(); const ja = locale === "ja";
  const prompt = "personal truth";
  const [truth, setTruth] = useState(""); const [lies, setLies] = useState<string[]>([]); const [selected, setSelected] = useState<number[]>([]); const [generating, setGenerating] = useState(false); const [aiNotice, setAiNotice] = useState("");
  const generate = async () => { setGenerating(true); setAiNotice(""); try { const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "lies", truth, locale, roomCode, sessionToken }) }); const data = await response.json(); if (!response.ok || !Array.isArray(data.lies)) throw new Error("No ideas available."); setLies(data.lies); setSelected([]); if (data.source !== "ai") setAiNotice(aiFallbackNotice(locale, data.reason)); } catch { setAiNotice(aiFallbackNotice(locale)); } finally { setGenerating(false); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); const chosen = selected.map((index) => lies[index]).filter(Boolean); if (chosen.length !== 2) return; const entries = [{ text: truth.trim(), truth: true }, ...chosen.map((text) => ({ text: text.trim(), truth: false }))].sort(() => Math.random() - .5); await act("submitHonto", { prompt, statements: entries.map((entry) => entry.text), truthIndex: entries.findIndex((entry) => entry.truth) }); };
  return <form className="play-card writer" onSubmit={submit}><CardBadge type="honto"/><h2>{ja ? <>本当の話を1つ。<br/><em>AIが5つの嘘を作ります。</em></> : <>Tell one truth.<br/><em>Let the AI write five lies.</em></>}</h2><p className="hint">{ja ? "本当の話を入力すると、AIが5つの嘘の候補を作ります。" : "Type one truth and the AI will help with 5 lie options."}</p><label className="truth-editor"><span>{ja ? "あなたの本当の話" : "YOUR TRUTH"}</span><textarea value={truth} onChange={(event) => setTruth(event.target.value)} maxLength={180} placeholder={ja ? "自分について本当の話を入力…" : "Type one true story about yourself…"}/></label><button type="button" className="ai-button" onClick={generate} disabled={generating || !truth.trim()}>{generating ? (ja ? "嘘を作成中…" : "WRITING LIES…") : (ja ? "嘘を5つ生成 ✦" : "GENERATE 5 LIES ✦")}</button>{aiNotice && <p className="ai-status-note" role="status">{aiNotice}</p>}{lies.length > 0 && <><p className="hint">{ja ? "5つから2つを選び、必要なら編集してください。" : "Choose two of the five options. You can edit them before sending."}</p><div className="lie-options">{lies.map((lie, index) => <label key={index} className={selected.includes(index) ? "selected" : ""}><input type="checkbox" checked={selected.includes(index)} onChange={() => setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : current.length < 2 ? [...current, index] : current)}/><textarea value={lie} maxLength={180} onChange={(event) => setLies((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}/><b>{selected.includes(index) ? (ja ? "選択中" : "SELECTED") : (ja ? "選択" : "SELECT")}</b></label>)}</div><button className="primary-button" disabled={busy || selected.length !== 2}>{ja ? "3つの話を送る →" : "SEND THREE STORIES →"}</button></>}</form>;
}

function QuestionCard({ card, meId, game, busy, act }: { card: Card; meId: string; game: GameState; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale, roomCode, sessionToken } = useLocale(); const ja = locale === "ja";
  const localQuestions = activeThemes(game.room.themeCategory).flatMap((key) => (ja ? questionLibraryJa[key] : questionLibrary[key]));
  const [question, setQuestion] = useState(""); const [sips, setSips] = useState(1); const [ideas, setIdeas] = useState<string[]>([]); const [selectedIdea, setSelectedIdea] = useState<string | null>(null); const [ideaSource, setIdeaSource] = useState<"ai" | "curated" | null>(null); const [aiNotice, setAiNotice] = useState(""); const questionPointer = useRef({ x: 0, y: 0, moved: false });
  const [showQuestionModal, setShowQuestionModal] = useState(false); const [questionHint, setQuestionHint] = useState(""); const [selectedThemes, setSelectedThemes] = useState<ThemeKey[]>(() => [activeThemes(game.room.themeCategory)[0] ?? "general"]); const [generating, setGenerating] = useState(false);
  const refreshIdeas = () => { setAiNotice(""); setSelectedIdea(null); if (ideaSource === "curated" && ideas.length) { setIdeas([]); setIdeaSource(null); return; } setIdeas(shuffleLocal(localQuestions).slice(0, 3)); setIdeaSource("curated"); };
  const generateWithAi = async () => { setGenerating(true); setAiNotice(""); setSelectedIdea(null); try { const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "question", count: 3, category: selectedThemes.length ? [selectedThemes[0]] : ["general"], customTheme: game.room.customTheme, questionHint, locale, roomCode, sessionToken }) }); const data = await response.json(); if (!response.ok || !Array.isArray(data.questions)) throw new Error("No questions available."); setIdeas(data.questions.slice(0, 3)); setIdeaSource(data.source === "ai" ? "ai" : "curated"); if (data.source !== "ai") setAiNotice(aiFallbackNotice(locale, data.reason)); setShowQuestionModal(false); } catch { setIdeas(shuffleLocal(localQuestions).slice(0, 3)); setIdeaSource("curated"); setAiNotice(aiFallbackNotice(locale)); setShowQuestionModal(false); } finally { setGenerating(false); } };
  if (card.status === "ready") return card.actorId === meId ? <><div className="play-card question-card"><CardBadge type="question"/><h2>{ja ? `${card.targetName}に質問しよう。` : <>Ask <em>{card.targetName}</em> anything.</>}</h2><p className="hint">{ja ? "候補から選ぶか、AIに聞くか、自分で質問を書きます。答えたらあなたが飲み、スキップしたら相手が飲みます。" : "Choose a curated prompt, ask the AI for ideas, or write your own. If they answer out loud, you drink. If they skip, they drink."}</p><textarea className="mini-game-input" value={question} onChange={(event) => { setQuestion(event.target.value); setSelectedIdea(null); }} maxLength={220} placeholder={ja ? "質問を書いてください…" : "Write your question…"}/><div className="question-tools"><button type="button" className="ai-button" onClick={() => setShowQuestionModal(true)}>{ja ? "AI質問を3つ生成 ✦" : "GET 3 AI QUESTIONS ✦"}</button><button type="button" className="curated-button" onClick={refreshIdeas}>{ideaSource === "curated" && ideas.length ? (ja ? "候補を隠す ↑" : "HIDE SUGGESTIONS ↑") : (ja ? "候補を表示 ↻" : "SHOW CURATED QUESTIONS ↻")}</button></div>{aiNotice && <p className="ai-status-note" role="status">{aiNotice}</p>}{ideas.length > 0 && <div className="question-option-list"><span>{ja ? (ideaSource === "ai" ? "AIの候補から1つ選択" : "内蔵の候補から1つ選択") : ideaSource === "ai" ? "CHOOSE ONE · AI SUGGESTIONS" : "CHOOSE ONE · BUILT-IN SUGGESTIONS"}</span>{ideas.map((idea) => <button type="button" className={selectedIdea === idea ? "question-option selected" : "question-option"} aria-pressed={selectedIdea === idea} key={idea} onPointerDown={(event) => { questionPointer.current = { x: event.clientX, y: event.clientY, moved: false }; }} onPointerMove={(event) => { if (Math.hypot(event.clientX - questionPointer.current.x, event.clientY - questionPointer.current.y) > 10) questionPointer.current.moved = true; }} onPointerCancel={() => { questionPointer.current.moved = true; }} onClick={(event) => { if (questionPointer.current.moved && event.detail !== 0) { event.preventDefault(); return; } setQuestion(idea); setSelectedIdea(idea); }}>{idea}</button>)}</div>}<SipPicker value={sips} onChange={setSips}/><button className="primary-button" disabled={busy || question.trim().length < 3} onClick={() => act("submitQuestion", { question, sips })}>{ja ? "質問を送る →" : "SEND QUESTION →"}</button></div>{showQuestionModal && <div className="question-ai-backdrop" role="presentation"><div className="question-ai-modal" role="dialog" aria-modal="true" aria-labelledby="question-ai-title"><button type="button" className="question-modal-close" aria-label={ja ? "質問ヘルパーを閉じる" : "Close question helper"} onClick={() => setShowQuestionModal(false)}>×</button><span className="eyebrow">{ja ? "質問ヘルパー" : "QUESTION HELPER"}</span><h2 id="question-ai-title">{ja ? "どんな質問をしますか？" : "What kind of question do you want to ask?"}</h2><textarea className="question-hint-input" value={questionHint} onChange={(event) => setQuestionHint(event.target.value)} maxLength={180} placeholder={ja ? "例：初デートについて楽しい質問" : "e.g. something playful about a first date"}/><fieldset className="question-theme-fieldset"><legend>{ja ? "テーマを1つ選択" : "Choose one theme"}</legend><div className="question-theme-checks">{THEME_KEYS.map((key) => <label key={key} className={selectedThemes.includes(key) ? "selected" : ""}><input type="radio" name="question-theme" checked={selectedThemes.includes(key)} onChange={() => setSelectedThemes([key])}/><span>{ja ? THEME_LABELS_JA[key] : THEME_LABELS[key]}</span></label>)}</div></fieldset><button type="button" className="primary-button" disabled={generating} onClick={generateWithAi}>{generating ? (ja ? "考え中…" : "THINKING…") : (ja ? "質問を3つ生成 →" : "GENERATE 3 QUESTIONS →")}</button><p className="question-modal-note">{ja ? "カテゴリを1つ選ぶとAIが質問を考えます。" : "Choose one category to guide the AI. Leave the text empty for broad prompts."}</p></div></div>}</> : <Waiting title={ja ? `${card.actorName}が質問を選んでいます…` : `${card.actorName} is choosing a question…`} text={ja ? "正直に答えるか、シップを選びます。" : "Answer honestly or take the sips."}/>;
  if (card.status === "choose") return card.targetId === meId ? <div className="play-card question-card"><CardBadge type="question"/><h2>{ja ? `${card.actorName}が聞いています…` : `${card.actorName} wants to know…`}</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint"><SipMug/> {ja ? `声に出して答えると${card.actorName}が${card.payload.sips}シップ。スキップするとあなたが飲みます。` : `Answer out loud and ${card.actorName} takes ${card.payload.sips} ${card.payload.sips === 1 ? "sip" : "sips"}. Skip and you take them.`}</p><div className="mini-game-actions"><button className="primary-button" disabled={busy} onClick={() => act("answerQuestion", { choice: "answer" })}>{ja ? "答える" : "I’LL ANSWER"}</button><button className="primary-button dare-button" disabled={busy} onClick={() => act("answerQuestion", { choice: "skip" })}><SipMug/> {ja ? `${card.payload.sips}シップ飲む` : `TAKE ${card.payload.sips} SIPS`}</button></div></div> : <Waiting title={ja ? `${card.targetName}が決めています…` : `${card.targetName} is deciding…`} text={card.payload.question ?? (ja ? "質問が出ています。" : "The question is on the table.")}/>;
  return null;
}

function WouldRatherCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const [first, setFirst] = useState(""); const [second, setSecond] = useState("");
  const options = (card.payload.options ?? []).filter((option): option is string => typeof option === "string");
  if (card.status === "ready") return card.actorId === meId ? <div className="play-card would-rather-card"><CardBadge type="wouldrather"/><h2>{ja ? `${card.targetName}に2つの選択肢を出そう。` : <>Give <em>{card.targetName}</em> two choices.</>}</h2><p className="hint">{ja ? "「どちらを選ぶ？」の2つの選択肢を書いてください。選びたくなければ、相手はスキップして2〜4シップのルーレットを回せます。" : "Write two Would You Rather options. If neither works for them, they can skip and spin the 2–4 sip wheel."}</p><div className="would-rather-compose"><label><span>{ja ? "選択肢A" : "OPTION A"}</span><textarea className="mini-game-input" value={first} onChange={(event) => setFirst(event.target.value)} maxLength={140} placeholder={ja ? "例：過去に戻る" : "e.g. Go back in time"}/></label><b>{ja ? "または" : "OR"}</b><label><span>{ja ? "選択肢B" : "OPTION B"}</span><textarea className="mini-game-input" value={second} onChange={(event) => setSecond(event.target.value)} maxLength={140} placeholder={ja ? "例：未来へ行く" : "e.g. Travel to the future"}/></label></div><button className="primary-button" disabled={busy || first.trim().length < 2 || second.trim().length < 2} onClick={() => act("submitWouldRather", { statements: [first, second] })}>{ja ? "2つの選択肢を送る →" : "SEND BOTH OPTIONS →"}</button></div> : <Waiting title={ja ? `${card.actorName}が2つの選択肢を書いています…` : `${card.actorName} is writing two choices…`} text={ja ? "難しい選択が届きます。" : "A difficult choice is on the way."}/>;
  if (card.status === "choose") return card.targetId === meId ? <div className="play-card would-rather-card"><CardBadge type="wouldrather"/><h2>{ja ? "どちらを選ぶ？" : "Would you rather…"}</h2><div className="would-rather-options">{options.slice(0, 2).map((option, index) => <button type="button" key={option} disabled={busy} onClick={() => act("answerWouldRather", { wouldRatherIndex: index })}><span>{index === 0 ? "A" : "B"}</span><strong>{option}</strong><small>{ja ? "これを選ぶ" : "CHOOSE THIS"}</small></button>)}<button type="button" className="would-rather-skip" disabled={busy} onClick={() => act("answerWouldRather", { wouldRatherIndex: 2 })}><span>↷</span><strong>{ja ? "どちらも選ばない" : "SKIP BOTH"}</strong><small><SipMug/> {ja ? "2〜4シップのルーレット" : "SPIN FOR 2–4 SIPS"}</small></button></div></div> : <Waiting title={ja ? `${card.targetName}が選んでいます…` : `${card.targetName} is choosing…`} text={ja ? "2つの選択肢とスキップがあります。" : "Two choices and one skip are on the table."}/>;
  return null;
}

function PreferenceCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const options = (card.payload.options ?? []).filter((option): option is string => typeof option === "string");
  const choiceButtons = (action: "choosePreference" | "guessPreference") => <div className="preference-options">{options.map((option, index) => <button key={option} aria-label={`${ja ? "選択肢" : "Option"} ${index + 1}: ${option}`} disabled={busy} onClick={() => act(action, { preferenceIndex: index })}><span className="preference-number">0{index + 1}</span><p className="preference-label">{option}</p><small>{ja ? "これを選ぶ" : "CHOOSE THIS"}</small></button>)}</div>;
  if (card.status === "ready") return card.actorId === meId ? <div className="play-card preference-card"><CardBadge type="preference"/><h2>{ja ? "あなたならどれを選ぶ？" : <>What would <em>you</em> choose?</>}</h2><div className="preference-question-wrap"><blockquote className="big-question">{card.payload.question}</blockquote><button type="button" className="preference-next-button" disabled={busy} onClick={() => void act("nextPreference")} aria-label={ja ? "次の選択質問を表示" : "Show the next choice question"}>{ja ? "次の質問 ↻" : "NEXT QUESTION ↻"}</button></div><p className="hint">{ja ? `秘密に選んでください。${card.targetName}があなたの答えを当てます。` : `Choose secretly. ${card.targetName} will try to read your mind.`}</p>{choiceButtons("choosePreference")}</div> : <Waiting title={ja ? `${card.actorName}が秘密の選択中…` : `${card.actorName} is choosing secretly…`} text={card.payload.question ?? (ja ? "3つの選択肢があります。" : "Three options are on the table.")}/>;
  if (card.status === "guess") return card.targetId === meId ? <div className="play-card preference-card"><CardBadge type="preference"/><h2>{ja ? `${card.actorName}の心を読もう。` : <>Read <em>{card.actorName}</em>&apos;s mind.</>}</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint"><SipMug/> {ja ? `正解なら${card.actorName}がルーレット。外れたらあなたが回します。` : `Guess correctly and ${card.actorName} faces the sip wheel. Miss and you face it.`}</p>{choiceButtons("guessPreference")}</div> : <Waiting title={ja ? `${card.targetName}があなたの心を読んでいます…` : `${card.targetName} is trying to read your mind…`} text={card.payload.question ?? (ja ? "選択はロックされています。" : "Your choice is locked.")}/>;
  return null;
}

function EstimateCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const [answer, setAnswer] = useState("");
  const [writingQuestion, setWritingQuestion] = useState(false);
  const [customQuestion, setCustomQuestion] = useState("");
  const [wrongPopup, setWrongPopup] = useState(false);
  const wrong = card.payload.wrongGuesses ?? [];
  const options = (card.payload.options ?? []).filter((option): option is number => typeof option === "number");
  const seenWrong = useRef(0);
  useEffect(() => {
    if (card.status === "guess" && wrong.length > seenWrong.current) setWrongPopup(true);
    seenWrong.current = wrong.length;
  }, [card.status, wrong.length]);
  useEffect(() => { setAnswer(""); setWritingQuestion(false); setCustomQuestion(""); }, [card.payload.question]);
  const chosenQuestion = writingQuestion ? customQuestion.trim() : (card.payload.question ?? "");
  if (card.status === "ready") return card.actorId === meId ? <div className="play-card estimate-card"><CardBadge type="estimate"/><h2>{ja ? "本当の数字を入力" : "Give the real number."}</h2>{writingQuestion ? <div className="estimate-custom-question"><label htmlFor={`estimate-question-${card.id}`}>{ja ? "数字で答えられる質問" : "YOUR NUMBER QUESTION"}</label><textarea id={`estimate-question-${card.id}`} className="mini-game-input" value={customQuestion} onChange={(event) => setCustomQuestion(event.target.value)} maxLength={220} autoFocus placeholder={ja ? "例：今までに何か国を訪れましたか？" : "e.g. How many concerts have you been to?"}/><button type="button" className="estimate-back-button" onClick={() => { setWritingQuestion(false); setCustomQuestion(""); }}>{ja ? "← 用意された質問に戻る" : "← BACK TO THE SUGGESTED QUESTION"}</button></div> : <div className="estimate-question-wrap"><blockquote className="big-question">{card.payload.question}</blockquote><div className="estimate-question-actions"><button type="button" className="estimate-next-button" disabled={busy} onClick={() => void act("nextEstimate")} aria-label={ja ? "別の数字当て質問を選ぶ" : "Choose another estimate question"}>{ja ? "次の質問 ↻" : "NEXT ESTIMATE ↻"}</button><button type="button" className="estimate-write-button" disabled={busy} onClick={() => setWritingQuestion(true)}>{ja ? "自分で書く ✎" : "WRITE MY OWN ✎"}</button></div></div>}<p className="hint">{ja ? "答えは秘密です。もっともらしい4つの選択肢に混ぜます。" : "Your answer stays secret. We will mix it with four believable options."}</p><input className="number-answer" type="number" min="0" max="1000000" step="1" inputMode="numeric" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={ja ? "正確な数字" : "Your exact answer"}/><button className="primary-button" disabled={busy || answer === "" || chosenQuestion.length < 3} onClick={() => act("submitEstimate", { correctNumber: Number(answer), question: chosenQuestion })}>{ja ? "答えを確定 →" : "LOCK MY ANSWER →"}</button></div> : <Waiting title={ja ? `${card.actorName}が数字を入力中…` : `${card.actorName} is locking in the real number…`} text={card.payload.question ?? (ja ? "数字の質問が届きます。" : "A numeric question is coming.")}/>;
  if (card.status === "guess") return card.targetId === meId ? <><div className="play-card estimate-card"><CardBadge type="estimate"/><h2>{ja ? `${card.actorName}の数字を当てよう` : <>How well do you know <em>{card.actorName}</em>?</>}</h2><blockquote className="big-question">{card.payload.question}</blockquote><p className="hint"><SipMug/> {ja ? "間違えるたびに1シップ。正解するまで続けます。" : "A wrong guess costs one sip. Keep guessing until you find it."}</p><div className="estimate-options">{options.map((option) => <button key={option} className={wrong.includes(option) ? "eliminated" : ""} disabled={busy || wrong.includes(option) || wrongPopup} onClick={() => void act("guessEstimate", { estimate: option })}><strong>{option.toLocaleString()}</strong>{wrong.includes(option) && <small><SipMug/> {ja ? "不正解 · 1シップ" : "WRONG · 1 SIP"}</small>}</button>)}</div><p className="attempt-count">{wrong.length ? <><SipMug/> {ja ? `${wrong.length}回不正解 · ${wrong.length}シップ` : `${wrong.length} wrong ${wrong.length === 1 ? "guess" : "guesses"} · ${wrong.length} ${wrong.length === 1 ? "sip" : "sips"}`}</> : <><SipMug/> {ja ? `1回目で正解すると${card.actorName}が2〜4シップのルーレットを回します。` : `First try: if you nail it, ${card.actorName} spins the 2–4 SIP wheel.`}</>}</p></div>{wrongPopup && <div className="estimate-miss-backdrop"><div className="estimate-miss-card" role="alertdialog" aria-modal="true" aria-labelledby="estimate-miss-title"><div className="estimate-miss-mark">×</div><span className="eyebrow">{ja ? "不正解" : "WRONG GUESS"}</span><h2 id="estimate-miss-title">{ja ? "今回は違います。" : "Not this time."}</h2><p><SipMug/> {ja ? "1シップ飲んで、もう一度。" : <>Take <strong>1 SIP</strong>, then try again.</>}</p><button type="button" className="primary-button" onClick={() => setWrongPopup(false)}>{ja ? "もう一度 →" : "TRY AGAIN →"}</button></div></div>}</> : <Waiting title={ja ? `${card.targetName}が数字を考えています…` : `${card.targetName} is estimating…`} text={`${wrong.length} ${ja ? "回不正解" : wrong.length === 1 ? "wrong guess" : "wrong guesses"} ${ja ? "です。" : "so far."}`}/>;
  return null;
}

const RPS_OPTIONS: Array<{ value: RpsChoice; icon: string; label: string }> = [
  { value: "rock", icon: "✊", label: "ROCK" },
  { value: "paper", icon: "✋", label: "PAPER" },
  { value: "scissors", icon: "✌️", label: "SCISSORS" },
];

function RpsCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const opponent = card.actorId === meId ? card.targetName : card.actorName;
  const [showTie, setShowTie] = useState(false); const seenTie = useRef(0);
  useEffect(() => { const tieCount = Number(card.payload.tieCount ?? 0); if (tieCount > seenTie.current) { seenTie.current = tieCount; setShowTie(true); const timer = window.setTimeout(() => setShowTie(false), 2800); return () => window.clearTimeout(timer); } return undefined; }, [card.payload.tieCount]);
  if (card.payload.hasChosen) return <Waiting title={ja ? "選択がロックされました。" : "Your move is locked."} text={ja ? `${opponent}の選択を待っています。相手はあなたの手を見ることができません。` : `Waiting for ${opponent} to choose. They cannot see your move.`}/>;
  return <><div className="play-card rps-card"><CardBadge type="rps"/><h2>{card.payload.tieCount ? (ja ? "あいこ！もう一度Joken-pô。" : "Tie! Joken-pô again.") : (ja ? `${opponent}とJoken-pô。` : `Joken-pô vs ${opponent}.`)}</h2><p className="hint"><SipMug/> {ja ? "秘密に手を選んでください。負けた人が1〜3シップのルーレットを回します。" : "Pick secretly. The loser spins the 1–3 SIP wheel."}</p><div className="rps-options">{RPS_OPTIONS.map((option) => <button key={option.value} disabled={busy || showTie} onClick={() => act("chooseRps", { rpsChoice: option.value })}><span>{option.icon}</span><strong>{option.label}</strong></button>)}</div></div>{showTie && <div className="rps-tie-backdrop"><div className="rps-tie-card" role="status" aria-live="polite"><span className="eyebrow">JOKEN-PÔ</span><div className="rps-tie-hands"><span>✊</span><b>VS</b><span>✊</span></div><h2>{ja ? "あいこ！" : "Tie!"}</h2><p>{ja ? "同じ手でした。もう一度いきましょう。" : "You both chose the same move. Get ready to try again."}</p><div className="reveal-dots"><i/><i/><i/></div></div></div>}</>;
}

function BothDrinkCard({ card, meId, busy, act }: { card: Card; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const mine = card.actorId === meId;
  return <div className="play-card both-card"><CardBadge type="both"/><h2>{ja ? <>推測なし。<br/><em>2人とも飲みます。</em></> : <>No guessing.<br/><em>Both of you drink.</em></>}</h2><p className="hint"><SipMug/> {ja ? "1回だけ回し、結果を2人に適用します。" : "Spin once. The result applies to both players."}</p>{mine ? <button className="primary-button spin-button" disabled={busy} onClick={() => act("spinBoth")}><SipMug/> {ja ? "2人分を回す →" : "SPIN FOR BOTH →"}</button> : <div className="both-waiting"><span className="both-waiting-orbit"/><strong>{ja ? `${card.actorName}がシップルーレットを回しています…` : `${card.actorName} is rolling the sip wheel…`}</strong><small>{ja ? "結果のシップを2人で飲みます。" : "You will both drink the result."}</small></div>}</div>;
}

function CardBadge({ type }: { type: Exclude<Card["type"], "hidden"> }) { const { locale } = useLocale(); const meta = CARD_META[type]; return <span className={`card-type-badge ${meta.color}`}><b>{meta.icon}</b>{locale === "ja" ? CARD_META_JA[type].label : meta.label}</span>; }
function SipMug() { return <span className="sip-mug" aria-hidden="true">🍺</span>; }
function SipPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) { const { locale } = useLocale(); const ja = locale === "ja"; return <div className="sip-picker-wrap"><span><SipMug/> {ja ? "何シップ？" : "HOW MANY SIPS?"}</span><div className="sip-picker">{[1, 2, 3].map((sips) => <button type="button" key={sips} className={value === sips ? "active" : ""} onClick={() => onChange(sips)}><SipMug/><strong>{sips}</strong><small>{ja ? "シップ" : sips === 1 ? "SIP" : "SIPS"}</small></button>)}</div></div>; }
function Waiting({ title, text }: { title: string; text: string }) { const { locale } = useLocale(); return <div className="play-card waiting"><div className="bobble">🃏</div><span className="turn-badge">{locale === "ja" ? "少々お待ちください" : "HANG TIGHT"}</span><h2>{title}</h2><p>{text}</p><div className="typing"><i/><i/><i/></div></div>; }
function ScoreRail({ players, meId }: { players: Player[]; meId: string }) { const { locale } = useLocale(); const ja = locale === "ja"; return <aside className="score-rail">{players.map((player, index) => <div key={player.id}><span className={`avatar avatar-${index}`}>{player.name[0]}</span><strong>{player.name}{player.id === meId ? (ja ? " · あなた" : " · you") : ""}</strong><small><SipMug/> {player.sips} {ja ? "シップ" : player.sips === 1 ? "sip" : "sips"}</small></div>)}</aside>; }

function Reveal({ card, players, meId, isFinal, close, spinWheel }: { card: Card; players: Player[]; meId: string; isFinal: boolean; close: () => void; spinWheel: () => Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const hasWheel = Boolean(card.result.skipped) || card.type === "honto" || card.type === "wouldrather" || card.type === "preference" || card.type === "rps" || card.type === "both" || (card.type === "estimate" && card.result.firstTry);
  const estimateFirstTry = card.type === "estimate" && Boolean(card.result.firstTry);
  const highSips = Boolean(card.result.skipped) || estimateFirstTry;
  const wheelValues = highSips ? [2, 3, 4] : [1, 2, 3];
  const wheelSegment = Math.max(0, wheelValues.indexOf(card.result.sips ?? wheelValues[0]));
  const wheelClass = `sip-wheel sip-wheel-stop-${wheelSegment + 1}`;
  const [requestingSpin, setRequestingSpin] = useState(false);
  const initialCompleteElapsed = Math.max(0, Date.now() - (card.completedAt ? new Date(card.completedAt).getTime() : Date.now()));
  const initialSpinElapsed = card.result.wheelStartedAt ? Math.max(0, Date.now() - new Date(card.result.wheelStartedAt).getTime()) : 0;
  const introDuration = card.type === "rps" ? 3800 : 1200;
  const wheelDuration = 6500;
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
  if (card.type === "wouldrather" && !card.result.skipped) { const choice = card.payload.options?.[card.result.wouldRatherIndex ?? 0]; icon = "↔"; eyebrow = ja ? "選択しました" : "CHOICE MADE"; title = ja ? `${card.targetName}が選びました。` : `${card.targetName} made a choice.`; detail = ja ? `選んだ答え：「${choice}」` : `They chose “${choice}”.`; }
  if (card.type === "honto") { icon = card.result.correct ? "✓" : "×"; eyebrow = card.result.correct ? (ja ? "本当を発見" : "TRUTH FOUND") : (ja ? "ブラフ成功" : "BLUFF SUCCESS"); title = card.result.correct ? (ja ? `${card.targetName}が本当を当てました。${drinker}が${card.result.sips}シップ。` : `${card.targetName} found the truth. ${drinker} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`) : (ja ? `${card.targetName}がブラフに引っかかり、${card.result.sips}シップ。` : `${card.targetName} fell for the bluff and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`); detail = ja ? `本当の話：「${card.payload.statements?.[card.secret?.truthIndex ?? 0]}」` : `The truth was: “${card.payload.statements?.[card.secret?.truthIndex ?? 0]}”`; }
  if (card.type === "question") { icon = card.result.choice === "answer" ? "💬" : "🥃"; eyebrow = card.result.choice === "answer" ? (ja ? "声に出して回答" : "ANSWERED OUT LOUD") : (ja ? "質問をスキップ" : "QUESTION SKIPPED"); title = ja ? `${drinker}が${card.result.sips}シップ。` : `${drinker} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = card.result.choice === "answer" ? (ja ? `${card.targetName}が答えたので、質問した人が飲みます。` : `${card.targetName} chose to answer, so the asker drinks.`) : (ja ? `${card.targetName}は答えず、シップを選びました。` : `${card.targetName} chose not to answer.`); }
  if (card.type === "preference") { const chosen = card.payload.options?.[card.secret?.preferenceIndex ?? 0]; icon = card.result.correct ? "🧠" : "×"; eyebrow = card.result.correct ? (ja ? "心を読めました" : "MIND READ") : (ja ? "不正解" : "NOT EVEN CLOSE"); title = card.result.correct ? (ja ? `${card.targetName}が正解。${card.actorName}が${card.result.sips}シップ。` : `${card.targetName} guessed it. ${card.actorName} takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`) : (ja ? `${card.targetName}が外し、${card.result.sips}シップ。` : `${card.targetName} missed and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`); detail = ja ? `${card.actorName}の選択：「${chosen}」` : `${card.actorName} chose “${chosen}”.`; }
  if (card.type === "estimate") { icon = "🎯"; eyebrow = card.result.firstTry ? (ja ? "一発正解" : "FIRST TRY") : (ja ? "数字を発見" : "NUMBER FOUND"); title = card.result.firstTry ? (ja ? `${card.targetName}が一発で正解。${card.actorName}が飲みます。` : `${card.targetName} nailed it. ${card.actorName} drinks.`) : (ja ? `${card.targetName}が${card.result.wrongGuesses?.length}回間違えて正解しました。` : `${card.targetName} found it after ${card.result.wrongGuesses?.length} misses.`); detail = ja ? `正解は${card.result.correctNumber}でした。` : `The correct answer was ${card.result.correctNumber}.`; }
  if (card.type === "rps") { const labels = ja ? { rock: "グー ✊", paper: "パー ✋", scissors: "チョキ ✌️" } : { rock: "Rock ✊", paper: "Paper ✋", scissors: "Scissors ✌️" }; icon = "⚔️"; eyebrow = ja ? "JOKEN-PÔ 完了" : "JOKEN-PÔ COMPLETE"; title = ja ? `${drinker}が負け、${card.result.sips}シップ。` : `${drinker} loses and takes ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = `${card.actorName}: ${labels[card.result.actorChoice ?? "rock"]} · ${card.targetName}: ${labels[card.result.targetChoice ?? "rock"]}`; }
  if (card.type === "both") { icon = "🍻"; eyebrow = ja ? "2人とも飲む" : "BOTH DRINK"; title = ja ? `2人とも${card.result.sips}シップ。` : `Both take ${card.result.sips} ${card.result.sips === 1 ? "sip" : "sips"}.`; detail = ja ? `${players.map((player) => player.name).join("と")}、乾杯！` : `${players.map((player) => player.name).join(" & ")}, cheers!`; }
  if (card.result.skipped) { const skipper = players.find((player) => player.id === (card.result.skipById ?? card.result.drinkerId))?.name ?? (ja ? "プレイヤー" : "The player"); icon = "↷"; eyebrow = ja ? "ミニゲームをスキップ" : "MINI GAME SKIPPED"; title = ja ? `${skipper}がスキップし、${card.result.sips}シップ。` : `${skipper} skips and takes ${card.result.sips} sips.`; detail = ja ? "スキップ時のルーレットは2・3・4シップです。" : "Skipping uses the 2, 3, or 4 sip wheel."; }
  const viewerDrinks = card.result.drinkerId === meId;
  const spinnerId = card.result.spinById ?? (card.type === "both" ? card.actorId : card.result.drinkerId);
  const spinnerName = players.find((player) => player.id === spinnerId)?.name ?? (ja ? "プレイヤー" : "The player");
  const rpsEmojis = { rock: "✊", paper: "✋", scissors: "✌️" };
  const rpsLoserName = drinker ? spinnerName : (ja ? "負けた人" : "The loser");
  const introTitle = card.result.skipped ? (ja ? "スキップしてシップ！" : "Skip & sip!") : estimateFirstTry ? (ja ? "一発正解！" : "First try!") : card.type === "rps" ? "Joken-pô!" : card.type === "both" ? (ja ? "みんなで乾杯！" : "Everyone, cheers!") : card.type === "honto" ? (ja ? "本当？ブラフ？" : "Truth or bluff?") : card.type === "wouldrather" ? (ja ? "選択完了！" : "Choice made!") : (ja ? "心読み完了！" : "Mind read complete!");
  if (revealPhase === "intro") return <div className="modal-backdrop reveal-intro-backdrop"><div className={`reveal-card reveal-intro ${card.type === "rps" ? "rps-reveal-intro" : ""}`} role="status" aria-live="polite"><div className="result-mark">{icon}</div><span className="eyebrow">{eyebrow}</span>{card.type === "rps" ? <><h2>Joken-pô!</h2><div className="rps-reveal-battle"><div><span>{rpsEmojis[card.result.actorChoice ?? "rock"]}</span><small>{card.actorName}</small></div><b>VS</b><div><span>{rpsEmojis[card.result.targetChoice ?? "rock"]}</span><small>{card.targetName}</small></div></div><p className="rps-winner-callout"><strong>{rpsLoserName}</strong> {ja ? "がこのラウンドで負けました。" : "loses this round."}</p></> : <><h2>{introTitle}</h2><p className="reveal-intro-copy">{ja ? "次に飲む人を決めるため、テーブルの準備をしています。" : "The table is getting ready to find out who takes the next sip."}</p><div className="reveal-dots"><i/><i/><i/></div></>}</div></div>;
  if (revealPhase === "ready") return <div className="modal-backdrop"><div className="reveal-card wheel-ready" role="dialog" aria-live="polite"><div className="result-mark">{icon}</div><span className="eyebrow"><SipMug/> {ja ? "シップルーレット" : "SIP WHEEL"}</span><h2>{ja ? "回す準備はできましたか？" : "Ready to spin?"}</h2><p className="reveal-intro-copy">{card.result.skipped ? (ja ? "スキップでは2・3・4シップのルーレットを使います。" : "Skipping uses the 2, 3, or 4 sip wheel.") : estimateFirstTry ? (ja ? `${card.actorName}は一発正解のため、2・3・4シップのルーレットを回します。` : `${card.actorName} faces the 2, 3, or 4 sip wheel after that first-try guess.`) : card.type === "both" ? (ja ? "1回の結果を2人に適用します。" : "One spin sets the SIPs for both players.") : (ja ? `${spinnerName}がルーレットを回します。` : `${spinnerName} takes the wheel.`)}</p><div className="sip-wheel-stage wheel-ready-stage"><i className="sip-wheel-pointer"/><div className={`${wheelClass} sip-wheel-static`}><span className="sip-wheel-number one">{highSips ? 2 : 1}</span><span className="sip-wheel-number two">{highSips ? 3 : 2}</span><span className="sip-wheel-number three">{highSips ? 4 : 3}</span></div></div>{meId === spinnerId ? <button type="button" className="wheel-start-button" aria-label={ja ? "シップルーレットを回す" : "Spin the sip wheel"} disabled={requestingSpin} onClick={async () => { setRequestingSpin(true); try { await spinWheel(); } finally { setRequestingSpin(false); } }}>{requestingSpin ? (ja ? "開始中…" : "STARTING THE WHEEL…") : <><SipMug/> {ja ? "回す" : "SPIN"}</>}</button> : <p className="wheel-waiting"><strong>{spinnerName}</strong> {ja ? "がルーレットを回す準備中…" : "is ready to spin the wheel…"}</p>}</div></div>;
  if (revealPhase === "spinning") return <div className="modal-backdrop"><div className="reveal-card wheel-card" role="status" aria-live="polite"><span className="eyebrow"><SipMug/> {ja ? "シップルーレット" : "SIP WHEEL"}</span><h2>{ja ? "何シップ？" : "How many sips?"}</h2><div className="sip-wheel-stage"><i className="sip-wheel-pointer"/><div className={wheelClass}><span className="sip-wheel-number one">{highSips ? 2 : 1}</span><span className="sip-wheel-number two">{highSips ? 3 : 2}</span><span className="sip-wheel-number three">{highSips ? 4 : 3}</span></div></div><p><SipMug/> {ja ? `${spinnerName}がルーレットを回しています…` : `${spinnerName} is spinning the wheel…`}</p></div></div>;
  return <div className="modal-backdrop"><div className={`reveal-card ${viewerDrinks || card.type === "both" ? "wrong" : "correct"}`}><div className="result-mark">{icon}</div><span className="eyebrow">{eyebrow}</span>{hasWheel && <><div className="sip-wheel-stage wheel-result-stage"><i className="sip-wheel-pointer"/><div className={`${wheelClass} sip-wheel-static sip-wheel-final`} aria-label={ja ? `ルーレットの結果：${card.result.sips}シップ` : `Final wheel result: ${card.result.sips} sips`}><span className="sip-wheel-number one">{highSips ? 2 : 1}</span><span className="sip-wheel-number two">{highSips ? 3 : 2}</span><span className="sip-wheel-number three">{highSips ? 4 : 3}</span></div></div><div className="wheel-result"><span>{ja ? "ルーレットの結果" : "THE WHEEL SAYS"}</span><strong>{card.result.sips}</strong><small><SipMug/> {ja ? "シップ" : card.result.sips === 1 ? "SIP" : "SIPS"}</small></div></>}<h2>{(card.result.drinkerId || card.type === "both") && <SipMug/>} {title}</h2><blockquote>{detail}</blockquote><button className="primary-button" onClick={close}>{isFinal ? (ja ? "勝者を見る →" : "SEE THE CHAMPION →") : (ja ? "次のカード →" : "NEXT CARD →")}</button></div></div>;
}

function Abandoned({ leave }: { leave: () => void | Promise<void> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  return <section className="finished"><span className="eyebrow">{ja ? "ゲーム終了" : "TABLE CLOSED"}</span><h1>{ja ? "プレイヤーが退出しました。" : "A player left the table."}</h1><p>{ja ? "このゲームは安全に終了しました。新しいテーブルを作ってもう一度プレイできます。" : "This game was ended safely. Start a new table whenever you are ready to play again."}</p><button className="primary-button" onClick={() => void leave()}>{ja ? "新しいテーブル →" : "NEW TABLE →"}</button></section>;
}

function Finished({ players, restart }: { players: Player[]; restart: () => void | Promise<unknown> }) {
  const { locale } = useLocale(); const ja = locale === "ja";
  const sorted = useMemo(() => [...players].sort((a, b) => a.sips - b.sips), [players]);
  const tied = sorted.length === 2 && sorted[0].sips === sorted[1].sips;
  const winner = tied ? null : sorted[0]; const loser = tied ? null : sorted[1];
  return <section className="finished"><span className="eyebrow">{ja ? "デッキが空になりました" : "THE DECK IS EMPTY"}</span><h1>{tied ? (ja ? "引き分けです！" : "It’s a tie!") : (ja ? "一番飲まなかったのは…" : "The lightest drinker was…")}</h1>{winner && <div className="winner">🏆<strong>{winner.name}</strong><span><SipMug/> {winner.sips} {ja ? "シップ" : winner.sips === 1 ? "sip" : "sips"}</span></div>}<div className="final-list">{sorted.map((player, index) => <div key={player.id}><b>{tied ? "=" : `#${index + 1}`}</b><span>{player.name}</span><small><SipMug/> {player.sips} {ja ? "シップ" : player.sips === 1 ? "sip" : "sips"}</small></div>)}</div><div className="wager-reveal"><span className="eyebrow">{ja ? "賭けを公開" : "THE WAGERS REVEALED"}</span>{winner && loser ? <><h2>{ja ? `${loser.name}のチャレンジ` : `${loser.name}’s challenge`}</h2><blockquote>“{winner.wager}”</blockquote><p>{ja ? `${winner.name}がゲーム前に書いたチャレンジです。` : `Written by ${winner.name} before the game began.`}</p></> : <><h2>{ja ? "負けた人はいません。" : "No loser this time."}</h2><p>{ja ? "引き分けなので、2人の秘密の賭けだけを公開します。" : "Since it’s a tie, both secret wagers are simply revealed."}</p></>}<div className="all-wagers">{players.map((player) => <div key={player.id}><strong>{player.name}</strong><span>“{player.wager}”</span></div>)}</div></div><button className="primary-button" onClick={() => void restart()}>{ja ? "新しいテーブル →" : "NEW TABLE →"}</button></section>;
}
