"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Player = { id: string; name: string; isHost: number; sips: number; joinedAt: string };
type ActiveRound = {
  id: string; roundNumber: number; authorId: string; authorName: string; prompt: string;
  statementOne: string; statementTwo: string; statementThree: string;
  guessedIndex: number | null; guesserId: string | null; result: string | null; truthIndex: number | null;
};
type GameState = {
  room: { code: string; status: "lobby" | "playing" | "finished"; roundCount: number; currentRound: number; groupSipEvery: number | null; timerMinutes: number | null; startedAt: string | null };
  players: Player[]; activeRound: ActiveRound | null; meId: string;
};

const PROMPTS = [
  "sua vida amorosa", "uma viagem que deu errado", "uma vergonha de infância",
  "algo que você já fez escondido", "um encontro inesquecível", "uma habilidade inútil",
  "uma festa que saiu do controle", "um medo completamente irracional", "uma mensagem enviada por engano",
  "uma decisão impulsiva", "uma celebridade que você já encontrou", "um segredo de família inofensivo",
];

async function gameApi(body: Record<string, unknown>) {
  const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Algo deu errado.");
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
  const [statements, setStatements] = useState(["", "", ""]);
  const [truthIndex, setTruthIndex] = useState<number | null>(null);
  const [reveal, setReveal] = useState<{ correct: boolean; truthIndex: number; drinkerId: string; roundNumber: number; statements: string[] } | null>(null);
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
      if (!response.ok) throw new Error(data.error ?? "Não foi possível atualizar a sala.");
      setGame(data);
      if (!quiet) setError("");
    } catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : "Erro de conexão."); }
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
  const elapsedMinutes = game?.room.startedAt ? Math.floor((now - new Date(`${game.room.startedAt}Z`).getTime()) / 60000) : 0;
  const nextTimerSip = game?.room.timerMinutes ? game.room.timerMinutes - (elapsedMinutes % game.room.timerMinutes) : null;

  async function enter(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await gameApi({ action: mode, name, code: joinCode });
      const next = { code: data.code, token: data.token };
      localStorage.setItem("honto-session", JSON.stringify(next)); setSession(next);
      history.replaceState(null, "", `?room=${data.code}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar."); }
    finally { setBusy(false); }
  }

  async function act(action: string, extras: Record<string, unknown> = {}) {
    if (!session) return;
    setBusy(true); setError("");
    try {
      const data = await gameApi({ action, ...session, ...extras });
      if (data.room) setGame(data);
      return data;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Algo deu errado."); }
    finally { setBusy(false); }
  }

  function leave() {
    localStorage.removeItem("honto-session"); setSession(null); setGame(null); setReveal(null);
    history.replaceState(null, "", location.pathname);
  }

  async function copyInvite() {
    const url = `${location.origin}${location.pathname}?room=${session?.code}`;
    await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600);
  }

  function newPrompt() {
    const next = (promptIndex + 1) % PROMPTS.length; setPromptIndex(next); setPrompt(PROMPTS[next]);
  }

  async function submitStories(event: FormEvent) {
    event.preventDefault();
    const result = await act("submit", { prompt, statements, truthIndex });
    if (result) { setStatements(["", "", ""]); setTruthIndex(null); newPrompt(); }
  }

  async function guess(index: number) {
    if (!game?.activeRound) return;
    const currentStatements = [game.activeRound.statementOne, game.activeRound.statementTwo, game.activeRound.statementThree];
    const data = await act("guess", { guessedIndex: index });
    if (data?.reveal) setReveal({ ...data.reveal, statements: currentStatements });
  }

  if (!session) return <Landing mode={mode} setMode={setMode} name={name} setName={setName} code={joinCode} setCode={setJoinCode} enter={enter} busy={busy} error={error} />;
  if (!game) return <main className="loading"><div className="stamp">本当?!</div><p>Montando a mesa…</p><button className="text-button" onClick={leave}>Voltar</button></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={leave} aria-label="Voltar ao início"><span>HONTO</span><b>?!</b></button>
        <div className="room-pill"><span className="live-dot" /> SALA <strong>{game.room.code}</strong></div>
        <button className="tiny-button" onClick={leave}>Sair</button>
      </header>
      {error && <div className="toast error-toast" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}
      {game.room.status === "lobby" && <Lobby game={game} me={me} busy={busy} copied={copied} copyInvite={copyInvite} act={act} />}
      {game.room.status === "playing" && (
        <section className="game-stage">
          <div className="round-strip">
            <span>RODADA <b>{game.room.currentRound}</b>/{game.room.roundCount}</span>
            <div className="progress"><i style={{ width: `${(game.room.currentRound / game.room.roundCount) * 100}%` }} /></div>
            {nextTimerSip && <span className="timer">🥂 geral em {nextTimerSip} min</span>}
          </div>
          <ScoreRail players={game.players} meId={game.meId} />
          {!game.activeRound && author?.id === game.meId && <Writer prompt={prompt} setPrompt={setPrompt} newPrompt={newPrompt} statements={statements} setStatements={setStatements} truthIndex={truthIndex} setTruthIndex={setTruthIndex} submit={submitStories} busy={busy} />}
          {!game.activeRound && author?.id !== game.meId && <Waiting title={`${author?.name} está aprontando…`} text="Preparando duas mentiras bem convincentes e uma verdade." />}
          {game.activeRound && game.activeRound.authorId === game.meId && <Waiting title="Histórias enviadas!" text="Agora segura a expressão e espera o palpite." />}
          {game.activeRound && game.activeRound.authorId !== game.meId && <Guesser round={game.activeRound} onGuess={guess} busy={busy} />}
        </section>
      )}
      {game.room.status === "finished" && <Finished players={game.players} leave={leave} />}
      {reveal && <Reveal reveal={reveal} players={game.players} close={() => { setReveal(null); refresh(); }} groupSip={Boolean(game.room.groupSipEvery && reveal.roundNumber % game.room.groupSipEvery === 0)} />}
    </main>
  );
}

function Landing(props: { mode: "create" | "join"; setMode: (m: "create" | "join") => void; name: string; setName: (v: string) => void; code: string; setCode: (v: string) => void; enter: (e: FormEvent) => void; busy: boolean; error: string }) {
  return <main className="landing">
    <div className="doodle doodle-one">嘘</div><div className="doodle doodle-two">本当</div>
    <nav><div className="logo"><span>HONTO</span><b>?!</b></div><span className="microcopy">TWO LIES. ONE TRUTH.</span></nav>
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow">PARTY GAME ONLINE ・ 2–8 PESSOAS</div><h1>Você conhece<br/><em>mesmo</em> essa pessoa?</h1><p>Conte duas mentiras, esconda uma verdade e descubra quem vai pagar a rodada.</p><div className="rule-cards"><span><b>①</b> CONTE</span><span><b>②</b> BLEFE</span><span><b>③</b> BRINDE</span></div></div>
      <form className="entry-card" onSubmit={props.enter}>
        <div className="card-tabs"><button type="button" className={props.mode === "create" ? "active" : ""} onClick={() => props.setMode("create")}>Criar sala</button><button type="button" className={props.mode === "join" ? "active" : ""} onClick={() => props.setMode("join")}>Entrar</button></div>
        <label>COMO TE CHAMAM?<input autoFocus value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="Seu nome ou apelido" maxLength={24}/></label>
        {props.mode === "join" && <label>CÓDIGO DA SALA<input value={props.code} onChange={(e) => props.setCode(e.target.value.toUpperCase())} placeholder="YUZU-42" maxLength={12}/></label>}
        {props.error && <p className="form-error">{props.error}</p>}
        <button className="primary-button" disabled={props.busy}>{props.busy ? "Só um segundo…" : props.mode === "create" ? "CRIAR A MESA →" : "ENTRAR NA RODADA →"}</button>
        <small>Sem cadastro. Traga uma bebida — com ou sem álcool.</small>
      </form>
    </section>
    <footer>本当？ <span>HONTO?</span> QUER DIZER “É VERDADE?” EM JAPONÊS.</footer>
  </main>;
}

function Lobby({ game, me, busy, copied, copyInvite, act }: { game: GameState; me?: Player; busy: boolean; copied: boolean; copyInvite: () => void; act: (action: string, extras?: Record<string, unknown>) => Promise<any> }) {
  const host = Boolean(me?.isHost);
  return <section className="lobby">
    <div className="lobby-head"><span className="eyebrow">AQUECENDO OS COPOS</span><h1>A mesa está <em>quase</em> pronta.</h1><p>Chame alguém com coragem para mentir olhando na sua cara.</p></div>
    <div className="lobby-grid">
      <div className="panel people-panel"><div className="panel-title"><h2>Na mesa</h2><span>{game.players.length}/8</span></div><div className="people-list">{game.players.map((player, index) => <div className="person" key={player.id}><span className={`avatar avatar-${index % 4}`}>{player.name[0]?.toUpperCase()}</span><div><strong>{player.name}</strong><small>{player.id === game.meId ? "você" : player.isHost ? "anfitrião" : "pronto para blefar"}</small></div>{player.isHost ? <b className="crown">♛</b> : <i>✓</i>}</div>)}</div><button className="invite-button" onClick={copyInvite}>{copied ? "LINK COPIADO! ✓" : "COPIAR LINK DO CONVITE"}</button></div>
      <div className="panel settings-panel"><div className="panel-title"><h2>Regras da noite</h2><span className="sticker">VOCÊS MANDAM</span></div>
        <Setting label="Tamanho da partida" value={game.room.roundCount} options={[10,20,30]} suffix=" rodadas" disabled={!host} onChange={(roundCount) => act("configure", { roundCount, groupSipEvery: game.room.groupSipEvery, timerMinutes: game.room.timerMinutes })}/>
        <Setting label="Todo mundo brinda" value={game.room.groupSipEvery ?? 0} options={[0,3,5]} labels={["Nunca","A cada 3","A cada 5"]} disabled={!host} onChange={(groupSipEvery) => act("configure", { roundCount: game.room.roundCount, groupSipEvery: groupSipEvery || null, timerMinutes: game.room.timerMinutes })}/>
        <Setting label="Lembrete por tempo" value={game.room.timerMinutes ?? 0} options={[0,10,15]} labels={["Desligado","10 min","15 min"]} disabled={!host} onChange={(timerMinutes) => act("configure", { roundCount: game.room.roundCount, groupSipEvery: game.room.groupSipEvery, timerMinutes: timerMinutes || null })}/>
        {host ? <button className="primary-button start-button" disabled={busy || game.players.length < 2} onClick={() => act("start")}>{game.players.length < 2 ? "ESPERANDO +1 PESSOA…" : "COMEÇAR O JOGO →"}</button> : <div className="host-note">O anfitrião escolhe as regras e começa.</div>}
      </div>
    </div>
  </section>;
}

function Setting({ label, value, options, labels, suffix="", disabled, onChange }: { label: string; value: number; options: number[]; labels?: string[]; suffix?: string; disabled: boolean; onChange: (v: number) => void }) {
  return <div className="setting"><label>{label}</label><div className="segmented">{options.map((option, index) => <button key={option} disabled={disabled} className={value === option ? "active" : ""} onClick={() => onChange(option)}>{labels?.[index] ?? `${option}${suffix}`}</button>)}</div></div>;
}

function ScoreRail({ players, meId }: { players: Player[]; meId: string }) {
  return <aside className="score-rail">{players.map((p, i) => <div key={p.id}><span className={`avatar avatar-${i % 4}`}>{p.name[0]}</span><strong>{p.name}{p.id === meId ? " · você" : ""}</strong><small>{p.sips} {p.sips === 1 ? "gole" : "goles"}</small></div>)}</aside>;
}

function Writer({ prompt, setPrompt, newPrompt, statements, setStatements, truthIndex, setTruthIndex, submit, busy }: { prompt: string; setPrompt: (v: string) => void; newPrompt: () => void; statements: string[]; setStatements: (v: string[]) => void; truthIndex: number | null; setTruthIndex: (v: number) => void; submit: (e: FormEvent) => void; busy: boolean }) {
  return <form className="play-card writer" onSubmit={submit}><span className="turn-badge">SUA VEZ DE CONTAR</span><h2>Duas mentiras e uma verdade sobre…</h2><div className="prompt-row"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={100}/><button type="button" onClick={newPrompt}>✨ outra ideia</button></div><p className="hint">Escreva de um jeito parecido para não entregar o jogo. Só você verá qual é a verdade.</p><div className="story-inputs">{statements.map((statement, index) => <label key={index} className={truthIndex === index ? "is-truth" : ""}><span>{index + 1}</span><textarea value={statement} onChange={(e) => { const next = [...statements]; next[index] = e.target.value; setStatements(next); }} placeholder={index === 0 ? "Eu já…" : index === 1 ? "Uma vez eu…" : "Ninguém sabe, mas eu…"} maxLength={180}/><button type="button" onClick={() => setTruthIndex(index)}>{truthIndex === index ? "✓ VERDADE" : "MARCAR VERDADE"}</button></label>)}</div><button className="primary-button" disabled={busy}>ENVIAR AS TRÊS →</button></form>;
}

function Guesser({ round, onGuess, busy }: { round: ActiveRound; onGuess: (i: number) => void; busy: boolean }) {
  const stories = [round.statementOne, round.statementTwo, round.statementThree];
  return <div className="play-card guesser"><span className="turn-badge pink">AGORA É COM VOCÊ</span><h2>Qual é a verdade de <em>{round.authorName}</em>?</h2><p className="prompt-caption">TEMA: {round.prompt.toUpperCase()}</p><div className="story-cards">{stories.map((story, index) => <button disabled={busy} onClick={() => onGuess(index)} key={index}><span>0{index + 1}</span><p>{story}</p><b>ISSO É VERDADE</b></button>)}</div><small>Escolheu, escolheu. Não dá para voltar.</small></div>;
}

function Waiting({ title, text }: { title: string; text: string }) {
  return <div className="play-card waiting"><div className="bobble">🤥</div><span className="turn-badge">AGUARDE UM POUQUINHO</span><h2>{title}</h2><p>{text}</p><div className="typing"><i/><i/><i/></div></div>;
}

function Reveal({ reveal, players, close, groupSip }: { reveal: { correct: boolean; truthIndex: number; drinkerId: string; roundNumber: number; statements: string[] }; players: Player[]; close: () => void; groupSip: boolean }) {
  const drinker = players.find((p) => p.id === reveal.drinkerId)?.name;
  return <div className="modal-backdrop"><div className={`reveal-card ${reveal.correct ? "correct" : "wrong"}`}><div className="result-mark">{reveal.correct ? "✓" : "×"}</div><span className="eyebrow">{reveal.correct ? "NA MOSCA!" : "CAIU NO BLEFE!"}</span><h2>{reveal.correct ? `${drinker} bebe.` : `${drinker}, é sua vez de beber.`}</h2><p>A verdade era:</p><blockquote>“{reveal.statements[reveal.truthIndex]}”</blockquote>{groupSip && <div className="group-sip">🥂 E a regra da sala mandou: todo mundo brinda!</div>}<button className="primary-button" onClick={close}>PRÓXIMA RODADA →</button></div></div>;
}

function Finished({ players, leave }: { players: Player[]; leave: () => void }) {
  const sorted = useMemo(() => [...players].sort((a,b) => a.sips - b.sips), [players]);
  return <section className="finished"><span className="eyebrow">FIM DE PAPO. POR ENQUANTO.</span><h1>O maior detector de blefes foi…</h1><div className="winner">🏆<strong>{sorted[0]?.name}</strong><span>{sorted[0]?.sips} goles</span></div><div className="final-list">{sorted.map((p, i) => <div key={p.id}><b>#{i+1}</b><span>{p.name}</span><small>{p.sips} goles</small></div>)}</div><button className="primary-button" onClick={leave}>NOVA MESA →</button></section>;
}
