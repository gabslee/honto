"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Locale } from "./i18n";
import type { PublicMultiplayerState } from "../api/multiplayer";

type Participant = { id: string; name: string; isHost: number; sips: number; connected?: boolean; hasWager: boolean; wager?: string | null };
type GroupView = PublicMultiplayerState;
type Props = { group: GroupView; players: Participant[]; meId: string; busy: boolean; act: (action: string, extras?: Record<string, unknown>) => void | Promise<unknown>; locale: Locale; roomCode: string; sessionToken: string; canRestart: boolean; welcomeAck: string[] };
type Send = (type: string, fields?: Record<string, unknown>) => void;
type Translate = (en: string, ja: string) => string;

const LABELS: Record<string, [string, string]> = {
  honto: ["Two Lies, One Truth", "嘘2つ・本当1つ"], preference: ["Read My Mind", "心を読む"],
  estimate: ["Number Estimate", "数字当て"], wouldrather: ["Would You Rather?", "どちらを選ぶ？"],
  who: ["Who at the table…?", "この中で誰が…？"], both: ["Everyone Drinks", "みんなで飲む"],
  everyone: ["Everyone Drinks", "みんなで飲む"], challenge: ["Table Challenge", "テーブルチャレンジ"],
};
const CARD_UI: Record<string, { icon: string; color: string; className: string }> = {
  honto: { icon: "🤥", color: "yellow", className: "writer" },
  preference: { icon: "🧠", color: "blue", className: "preference-card" },
  estimate: { icon: "🎯", color: "pink", className: "estimate-card" },
  wouldrather: { icon: "↔", color: "yellow", className: "would-rather-card" },
  who: { icon: "👥", color: "mint", className: "question-card" },
  challenge: { icon: "⚡", color: "pink", className: "question-card" },
  both: { icon: "🍻", color: "yellow", className: "both-card" },
  hidden: { icon: "?", color: "yellow", className: "deck-draw" },
};

function GroupCardBadge({ type, t }: { type: string; t: Translate }) {
  const ui = CARD_UI[type] ?? CARD_UI.challenge;
  const label = LABELS[type] ?? LABELS.challenge;
  return <span className={`card-type-badge ${ui.color}`}><b>{ui.icon}</b>{t(label[0].toUpperCase(), label[1])}</span>;
}

function GroupWheel({ values, value, spinning }: { values: number[]; value: number | null; spinning: boolean }) {
  const segment = Math.max(0, values.indexOf(value ?? values[0]));
  return <div className="sip-wheel-stage"><i className="sip-wheel-pointer"/><div className={`sip-wheel sip-wheel-stop-${segment + 1} ${spinning ? "" : "sip-wheel-static"}`}><span className="sip-wheel-number one">{values[0]}</span><span className="sip-wheel-number two">{values[1]}</span><span className="sip-wheel-number three">{values[2]}</span></div></div>;
}

function WaitingCard({ title }: { title: string }) {
  return <div className="waiting"><div className="bobble">🃏</div><h2>{title}</h2><div className="typing"><i/><i/><i/></div></div>;
}

function GroupDrawCard({ mine, busy, cardNumber, actorName, send, t }: { mine: boolean; busy: boolean; cardNumber: number; actorName: string; send: Send; t: Translate }) {
  const [flipping, setFlipping] = useState(false);
  const face = <><span className="playing-card-corner top">本当<small>?!</small></span><span className="playing-card-mark">!</span><span className="playing-card-center"><i>本当</i><strong>HONTO?!</strong><small>{mine ? t("DRAW", "引く") : t("WAIT", "待機")}</small></span><span className="playing-card-corner bottom">本当<small>?!</small></span></>;
  const reveal = () => { if (busy || flipping) return; setFlipping(true); window.setTimeout(() => send("draw"), 720); };
  return <><span className="turn-badge">{t("CARD", "カード")} {cardNumber}</span><h2>{mine ? t("Your turn to draw.", "あなたがカードを引く番です。") : t(`${actorName} is drawing the next card…`, `${actorName}が次のカードを引いています…`)}</h2><p className="hint">{mine ? t("Tap the card to reveal what comes next.", "カードをタップして次のゲームを表示します。") : t("The card will reveal on every screen.", "カードは全員の画面に表示されます。")}</p><div className="draw-card-zone">{mine ? <button className={`honto-playing-card ${flipping ? "is-flipping" : ""}`} disabled={busy || flipping} onClick={reveal}>{face}</button> : <div className="honto-playing-card waiting-card" aria-hidden="true">{face}</div>}</div></>;
}

export function MultiplayerGame({ group, players, meId, busy, act, locale, roomCode, sessionToken, canRestart, welcomeAck }: Props) {
  const t: Translate = (en, ja) => locale === "ja" ? ja : en;
  const [removeId, setRemoveId] = useState<string | null>(null);
  const me = players.find((player) => player.id === meId);
  const playerName = (id: string) => players.find((player) => player.id === id)?.name ?? t("Player left", "退出したプレイヤー");
  const send: Send = (type, fields = {}) => { void act("multiplayer", { groupAction: { type, cardId: group.card?.id, round: group.round, ...fields } }); };
  const welcome = !group.finished && (!players.every((player) => player.hasWager) || !players.every((player) => welcomeAck.includes(player.id)));
  const title = group.phase === "draw" ? ["Your next card awaits.", "次のカードを引こう。"] : LABELS[group.card?.type ?? ""] ?? LABELS.challenge;
  const cardType = group.card?.type ?? "hidden";
  return <section className={`game-stage ${welcome ? "welcome-stage" : ""}`}>
    {!welcome && <><div className="round-strip"><span>{t("MULTIPLAYER", "マルチプレイヤー")} · {players.length}/6</span><div className="progress"><i style={{ width: `${((group.currentIndex + 1) / group.totalCards) * 100}%` }}/></div><span>{t("CARD", "カード")} {Math.min(group.currentIndex + 1, group.totalCards)}/{group.totalCards}</span></div>
    <div className="score-rail" aria-label={t("Table scores", "みんなのスコア")}>{players.map((player, index) => <div key={player.id}><span className={`avatar avatar-${index}`}>{player.name[0]}</span><strong>{player.name}{player.id === meId ? t(" (you)", "（あなた）") : ""}</strong><small>{group.scores[player.id] ?? player.sips} {t("sips", "シップ")}{player.id === group.authorId ? ` · ${t("turn", "手番")}` : ""}</small></div>)}</div></>}
    {welcome ? <GroupWelcome key={meId} players={players} meId={meId} busy={busy} act={act} welcomeAck={welcomeAck} t={t}/> : group.finished ? <GroupFinished group={group} players={players} busy={busy} canRestart={canRestart} act={act} t={t}/> : <article className={`play-card ${CARD_UI[cardType]?.className ?? "question-card"}`} key={`${group.card?.id}:${group.round}`}>
      {cardType !== "hidden" && <><GroupCardBadge type={cardType} t={t}/><span className="turn-badge">{playerName(group.authorId)} · {t("CARD AUTHOR", "このカードの出題者")}</span><h2>{title[locale === "ja" ? 1 : 0]}</h2></>}
      <RoundContent group={group} meId={meId} busy={busy} send={send} t={t} locale={locale} roomCode={roomCode} sessionToken={sessionToken} playerName={playerName}/>
    </article>}
    {Boolean(me?.isHost) && !group.finished && <details className="mp-management"><summary>{t("Manage players", "プレイヤー管理")}</summary><p>{t("Remove someone who has left so the table can continue. With fewer than three players, this game ends.", "退出した人を削除するとゲームを続けられます。3人未満になると終了します。")}</p>{players.filter((player) => player.id !== meId).map((player) => <div className="mp-remove" key={player.id}><span>{player.name}</span><button type="button" className="mp-secondary" disabled={busy} onClick={() => setRemoveId(player.id)}>{t("Remove", "削除")}</button></div>)}{removeId && <div className="mp-confirm" role="alert"><p>{t(`Remove ${playerName(removeId)} from this game? They cannot rejoin this match.`, `${playerName(removeId)}を削除しますか？このゲームには戻れません。`)}</p><div className="mp-actions"><button type="button" className="mp-secondary" onClick={() => setRemoveId(null)}>{t("Cancel", "キャンセル")}</button><button type="button" className="primary-button" disabled={busy} onClick={() => { void act("removePlayer", { playerId: removeId }); setRemoveId(null); }}>{t("Remove player", "プレイヤーを削除")}</button></div></div>}</details>}
  </section>;
}

function GroupWelcome({ players, meId, busy, act, welcomeAck, t }: Pick<Props, "players" | "meId" | "busy" | "act" | "welcomeAck"> & { t: Translate }) {
  const [wager, setWager] = useState("");
  const me = players.find((player) => player.id === meId);
  const allWagers = players.every((player) => player.hasWager);
  return <div className="welcome-card"><span className="eyebrow">{t("BEFORE THE FIRST CARD", "最初のカードの前に")}</span><div className="welcome-mark" aria-hidden="true"><span>本当</span><b>?!</b></div><h1>{t("Set the stakes.", "チャレンジを決めよう。")}</h1><p>{t("Write a secret challenge for the player(s) finishing with the most sips, if you win. Fewest sips wins. A tie for first means no final challenge.", "あなたが優勝した時、シップ数が最多の人にしてほしいことを書こう。最少シップで優勝。同率優勝なら最後のチャレンジはありません。")}</p>{!me?.hasWager ? <form className="wager-entry" onSubmit={(event) => { event.preventDefault(); void act("submitWager", { wager }); }}><label>{t("YOUR SECRET CHALLENGE", "秘密のチャレンジ")}</label><textarea className="mini-game-input" maxLength={220} minLength={3} required value={wager} onChange={(event) => setWager(event.target.value)}/><button type="submit" className="primary-button" disabled={busy || wager.trim().length < 3}>{t("LOCK IT IN →", "確定する →")}</button></form> : <div className="welcome-waiting"><span className="typing"><i/><i/><i/></span><strong>{t("Your challenge is locked.", "チャレンジを確定しました。")}</strong></div>}<p className="welcome-flow"><strong>{players.filter((player) => player.hasWager).length}/{players.length} {t("challenges ready", "チャレンジ確定")}</strong></p>{allWagers && <><p className="welcome-flow"><strong>{t("How it works", "遊び方")}</strong><br/>{t("Take turns drawing the same Honto cards. Answers stay secret until the table reveals them together. The familiar sip wheel decides every penalty.", "同じHontoカードを順番に引きます。回答は全員が揃うまで秘密で、いつものシップルーレットで罰を決めます。")}</p><button type="button" className="primary-button welcome-button" disabled={busy || welcomeAck.includes(meId)} onClick={() => void act("ackWelcome")}>{welcomeAck.includes(meId) ? t("WAITING FOR THE TABLE…", "みんなを待っています…") : t("START PLAYING →", "ゲーム開始 →")}</button><p className="mp-progress" role="status">{welcomeAck.length}/{players.length} {t("ready", "準備完了")}</p></>}</div>;
}

function RoundContent({ group, meId, busy, send, t, locale, roomCode, sessionToken, playerName }: { group: GroupView; meId: string; busy: boolean; send: Send; t: Translate; locale: Locale; roomCode: string; sessionToken: string; playerName: (id: string) => string }) {
  const card = group.card;
  if (!card) return <p role="status">{t("Preparing the next card…", "次のカードを準備中…")}</p>;
  const author = group.authorId === meId;
  const answered = group.answeredIds.includes(meId);
  const isGuess = ["honto", "preference", "estimate"].includes(card.type);
  const choiceClass = card.type === "honto" ? "story-cards" : card.type === "preference" ? "preference-options" : card.type === "estimate" ? "estimate-options" : card.type === "wouldrather" ? "would-rather-options" : "mp-choices";
  const expected = group.players.length - (isGuess ? 1 : 0);
  if (group.phase === "draw") return <GroupDrawCard mine={author} busy={busy} cardNumber={group.currentIndex + 1} actorName={playerName(group.authorId)} send={send} t={t}/>;
  if (group.phase === "prepare") return author ? <PrepareCard card={card} busy={busy} send={send} t={t} locale={locale} roomCode={roomCode} sessionToken={sessionToken}/> : <WaitingCard title={t(`${playerName(group.authorId)} is preparing this card…`, `${playerName(group.authorId)}がカードを準備しています…`)} />;
  if (group.phase === "result") return <RoundResult group={group} meId={meId} busy={busy} send={send} t={t} playerName={playerName}/>;
  if (group.phase === "opponent") return <><p className="mp-copy">{card.prompt}</p><p>{card.challenge === "rps" ? t("A quick round of rock, paper, scissors. The loser spins 1–3.", "じゃんけん対決。負けた人は1〜3のルーレットを回します。") : t("Look at each other without laughing. First to laugh spins 1–3. Both players confirm the loser.", "笑わずに見つめ合おう。先に笑った人は1〜3のルーレット。2人で負けた人を確認します。")}</p>{author ? <div className="mp-choices">{group.players.filter((player) => player.id !== meId).map((player) => <button className="mp-choice" disabled={busy} key={player.id} onClick={() => send("chooseOpponent", { playerId: player.id })}>{player.name}</button>)}</div> : <p className="mp-progress">{t("The author is choosing an opponent.", "出題者が対戦相手を選んでいます。")}</p>}</>;
  if (group.phase === "coin") return <><p className="mp-copy">{t("Heads: the author drinks. Tails: everyone drinks. One shared wheel decides how many sips.", "表なら出題者、裏なら全員が飲みます。共通のルーレットでシップ数を決めます。")}</p><div className="mp-wheel-disc" aria-hidden="true">◉</div>{author ? <button className="primary-button" disabled={busy} onClick={() => send("coin")}>{t("FLIP THE COIN →", "コインを投げる →")}</button> : <p className="mp-progress">{t(`Waiting for ${playerName(group.authorId)} to flip.`, `${playerName(group.authorId)}がコインを投げます。`)}</p>}</>;
  if (group.phase === "duel") {
    const dueling = author || meId === group.opponentId;
    const pair = [group.authorId, group.opponentId].filter((id): id is string => Boolean(id));
    return <>{group.round > 0 && <p className="mp-progress" role="status">{card.challenge === "rps" ? t("A tie! Choose again.", "引き分け！もう一度選んでください。") : t("The confirmations differed. Play again and agree on who laughed first.", "確認が一致しませんでした。もう一度対決してください。")}</p>}<p className="mp-copy">{pair.map(playerName).join(" × ")}</p>{card.challenge === "rps" ? <><p>{t("Choose secretly. A tie starts another round.", "秘密で選んでください。引き分けならもう一度。")}</p>{dueling && !answered && <div className="mp-choices">{[["rock", "✊", t("Rock", "グー")], ["paper", "✋", t("Paper", "パー")], ["scissors", "✌", t("Scissors", "チョキ")]].map(([value, icon, label]) => <button key={value} className="mp-choice" disabled={busy} onClick={() => send("duel", { value })}>{icon} {label}</button>)}</div>}{(!dueling || answered) && <p className="mp-progress" role="status">{t("Waiting for both secret choices…", "2人の選択を待っています…")}</p>}</> : <><p>{t("First to laugh loses. Confirm once each. If you disagree, both choices reset so you can play again.", "先に笑った人が負けです。2人とも一度ずつ確認します。意見が違えば回答がリセットされ、再対決できます。")}</p>{dueling ? <div className="mp-choices">{pair.map((id) => <button key={id} className="mp-choice" disabled={busy || Boolean(group.confirmations[meId])} aria-pressed={group.confirmations[meId] === id} onClick={() => send("confirmLoser", { playerId: id })}>{t(`${playerName(id)} laughed first`, `${playerName(id)}が先に笑った`)}</button>)}</div> : <p className="mp-progress">{t("The two players are confirming the result.", "対戦した2人が結果を確認しています。")}</p>}</>}{meId === group.opponentId && !answered && !group.confirmations[meId] && <SkipButton busy={busy} send={send} t={t} label={t("Decline challenge · 2–4 sips", "対決を断る · 2〜4シップ")}/>}</>;
  }
  if (group.phase === "answer") return <><p className="mini-game-question">{card.prompt ?? (isGuess ? t("Which answer is true?", "正しい答えは？") : "")}</p>{isGuess && <p className="hint">{t("One secret guess each. No changes after submitting.", "1人1回、秘密で回答します。送信後は変更できません。")}</p>}{card.type === "wouldrather" && <p className="hint">{t("The minority spins 1–3. A tie is safe. A skip spins 2–4 and does not count as a vote.", "少数派は1〜3シップ。同数なら罰なし。スキップは2〜4で、投票には数えません。")}</p>}{card.type === "who" && <p className="hint">{t("Vote secretly for someone else. The most voted players each spin 1–3; ties share the lead.", "自分以外に秘密で投票。最多票の人はそれぞれ1〜3シップ。同票なら全員が対象です。")}</p>}{answered || (isGuess && author) ? <WaitingCard title={answered ? t("Your answer is locked. Waiting for the table…", "回答を確定しました。みんなを待っています…") : t("Your answer stays secret until everyone has guessed.", "全員の回答が揃うまで正解は秘密です。")}/> : <><div className={choiceClass}>{card.challenge === "surprise" ? [true, false].map((value) => <button type="button" key={String(value)} className="mp-choice" disabled={busy} onClick={() => send("answer", { value })}>{value ? t("Yes, that's me", "はい、当てはまります") : t("No", "いいえ")}</button>) : card.type === "who" ? group.players.filter((player) => player.id !== meId).map((player) => <button type="button" key={player.id} className="mp-choice" disabled={busy} onClick={() => send("answer", { value: player.id })}>{player.name}</button>) : card.options?.map((option, index) => <button type="button" key={index} className={card.type === "honto" ? "" : "mp-choice"} disabled={busy} onClick={() => send("answer", { value: index })}>{card.type === "honto" && <span>0{index + 1}</span>}<p>{option}</p>{card.type === "honto" && <b>{t("THIS IS TRUE", "これは本当")}</b>}</button>)}</div>{["wouldrather", "who"].includes(card.type) && <SkipButton busy={busy} send={send} t={t}/>}</>}<p className="mp-progress" role="status">{group.answeredIds.length}/{expected} {t("answers locked · revealed together", "回答済み · 全員揃ったら公開")}</p></>;
  return <p role="status">{t("Waiting for the table…", "みんなを待っています…")}</p>;
}

function PrepareCard({ card, busy, send, t, locale, roomCode, sessionToken }: { card: NonNullable<GroupView["card"]>; busy: boolean; send: Send; t: Translate; locale: Locale; roomCode: string; sessionToken: string }) {
  const [prompt, setPrompt] = useState(card.prompt ?? "");
  const [options, setOptions] = useState<string[]>(card.options ?? (card.type === "wouldrather" ? ["", ""] : ["", "", ""]));
  const [answer, setAnswer] = useState(0);
  const [number, setNumber] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiLies, setAiLies] = useState<string[]>([]);
  const [selectedLies, setSelectedLies] = useState<number[]>([]);
  const numeric = card.type === "estimate";
  const curatedPreference = card.type === "preference" && Boolean(card.options?.length);
  const validOptions = options.every((option) => option.trim()) && new Set(options.map((option) => option.trim().toLowerCase())).size === options.length;
  const validNumber = number.trim() !== "" && Number.isInteger(Number(number)) && Number(number) >= 0 && Number(number) <= 1_000_000;
  const hontoWithAi = card.type === "honto" && aiLies.length > 0;
  const valid = numeric ? validNumber : card.type === "honto" ? Boolean(prompt.trim()) && selectedLies.length === 2 : validOptions;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (card.type === "honto") {
      const statements = [prompt.trim(), ...selectedLies.map((index) => aiLies[index].trim())].sort(() => Math.random() - .5);
      send("prepare", { prompt: t("Which statement is true?", "本当の話はどれ？"), options: statements, answer: statements.indexOf(prompt.trim()) });
      return;
    }
    send("prepare", { prompt: prompt.trim(), ...(numeric ? { answer: Number(number) } : { options: options.map((option) => option.trim()), answer }) });
  };
  const generateLies = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "lies", truth: prompt, locale, roomCode, sessionToken }) });
      const data = await response.json();
      if (Array.isArray(data.lies)) { setAiLies(data.lies); setSelectedLies([]); }
    } finally { setGenerating(false); }
  };
  const description = card.type === "honto"
    ? t("Write two lies and one truth. Mark the truth secretly below.", "嘘を2つと本当の話を1つ書き、本当の話を秘密で選びます。")
    : numeric
      ? t("Enter your real number secretly. The table will see three numerical choices and gets one guess each.", "本当の数字を秘密で入力してください。みんなには3つの選択肢が表示され、1回ずつ回答します。")
      : card.type === "wouldrather"
        ? t("Write two alternatives for the whole table to choose between.", "みんなが選ぶ2つの選択肢を書いてください。")
        : t("Pick your real preference secretly. Everyone else tries to read your mind.", "自分の好みを秘密で選んでください。みんながあなたの心を読みます。");
  return <>
    <p className="mp-copy">{description}</p>
    <form className="mp-form" onSubmit={submit}>
      {card.type === "honto" ? <><label className="truth-editor"><span>{t("YOUR TRUTH", "あなたの本当の話")}</span><textarea maxLength={180} required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("Type one true story about yourself…", "自分について本当の話を入力…")}/></label><button type="button" className="ai-button" disabled={generating || !prompt.trim()} onClick={() => void generateLies()}>{generating ? t("WRITING LIES…", "嘘を作成中…") : t("GENERATE 5 LIES ✦", "嘘を5つ生成 ✦")}</button>{hontoWithAi && <div className="lie-options">{aiLies.map((lie, index) => <label key={index} className={selectedLies.includes(index) ? "selected" : ""}><input type="checkbox" checked={selectedLies.includes(index)} onChange={() => setSelectedLies((current) => current.includes(index) ? current.filter((item) => item !== index) : current.length < 2 ? [...current, index] : current)}/><textarea value={lie} maxLength={180} onChange={(event) => setAiLies((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}/><b>{selectedLies.includes(index) ? t("SELECTED", "選択中") : t("SELECT", "選択")}</b></label>)}</div>}</> : curatedPreference ? <p className="mini-game-question">{prompt}</p> : <label>{t("Question", "質問")}<textarea className="mini-game-input" maxLength={300} required value={prompt} onChange={(event) => setPrompt(event.target.value)}/></label>}
      {numeric ? <label>{t("Your secret number · 0 to 1,000,000", "秘密の数字 · 0〜1,000,000")}<input className="mini-game-input" type="number" min={0} max={1000000} step={1} required value={number} onChange={(event) => setNumber(event.target.value)}/></label> : curatedPreference ? <div className="mp-choices" role="group" aria-label={t("Your secret preference", "秘密の好み")}>{options.map((option, index) => <button type="button" className="mp-choice" key={index} aria-pressed={answer === index} onClick={() => setAnswer(index)}>{option}</button>)}</div> : options.map((option, index) => <label key={index}>{t("Option", "選択肢")} {index + 1}<input className="mini-game-input" type="text" maxLength={220} required value={option} onChange={(event) => setOptions((current) => current.map((item, i) => i === index ? event.target.value : item))}/></label>)}
      {!numeric && !curatedPreference && card.type !== "wouldrather" && <label>{t("Correct answer · only you can see this", "正解 · あなたにだけ表示")}<select value={answer} onChange={(event) => setAnswer(Number(event.target.value))}>{options.map((_, index) => <option key={index} value={index}>{t("Option", "選択肢")} {index + 1}</option>)}</select></label>}
      <button className="primary-button" type="submit" disabled={busy || !valid}>{t("SEND TO THE TABLE →", "みんなに送信 →")}</button>
    </form>
    <SkipButton busy={busy} send={send} t={t} label={t("Skip this card · 2–4 sips", "このカードをスキップ · 2〜4シップ")}/>
  </>;
}

function SkipButton({ busy, send, t, label }: { busy: boolean; send: Send; t: Translate; label?: string }) {
  return <div className="mp-actions"><button type="button" className="mp-secondary" disabled={busy} onClick={() => send("skip")}>{label ?? t("Skip my answer · 2–4 sips", "回答をスキップ · 2〜4シップ")}</button></div>;
}

function RoundResult({ group, meId, busy, send, t, playerName }: { group: GroupView; meId: string; busy: boolean; send: Send; t: Translate; playerName: (id: string) => string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 200); return () => window.clearInterval(timer); }, []);
  const complete = group.wheels.every((wheel) => wheel.spunAt !== null && now >= wheel.spunAt + 6500);
  const answerLabel = (value: string | number | boolean) => value === "skip" ? t("Skipped", "スキップ") : typeof value === "boolean" ? value ? t("Yes", "はい") : t("No", "いいえ") : group.card?.type === "who" && typeof value === "string" ? playerName(value) : typeof value === "number" ? group.card?.options?.[value] ?? String(value) : ({ rock: t("Rock", "グー"), paper: t("Paper", "パー"), scissors: t("Scissors", "チョキ") }[value] ?? value);
  return <><h3>{t("The table has spoken.", "結果発表。")}</h3>{group.card?.prompt && <p className="mp-copy">{group.card.prompt}</p>}{group.coinResult && <p className="mini-game-question">{group.coinResult === "heads" ? t("Heads — the author spins!", "表 — 出題者が回します！") : t("Tails — everyone drinks!", "裏 — 全員が飲みます！")}</p>}{typeof group.card?.answer === "number" && <p className="mini-game-question">{t("Correct answer: ", "正解：")}{group.card.options?.[group.card.answer]}</p>}<ul className="mp-results">{Object.entries(group.answers).map(([id, answer]) => <li key={id}><strong>{playerName(id)}</strong><span>{answerLabel(answer)}</span></li>)}</ul>{!group.wheels.length && <p className="mp-progress">{t("No sips this time.", "今回はシップなし。")}</p>}<div className="mp-wheels">{group.wheels.map((wheel) => {
    const spinning = wheel.spunAt !== null && now < wheel.spunAt + 6500;
    const spun = wheel.spunAt !== null;
    const spinner = wheel.playerIds[0];
    return <section className="group-wheel" key={wheel.id}><h3>{wheel.playerIds.map(playerName).join(" · ")}</h3><p className="hint">{wheel.values.join(" / ")} {t("sips", "シップ")}</p><GroupWheel values={wheel.values} value={wheel.value} spinning={spinning}/>{spun ? <div className="wheel-result" role="status"><span>{spinning ? t("Spinning…", "回転中…") : t("THE WHEEL SAYS", "ルーレットの結果")}</span><strong>{spinning ? "…" : wheel.value}</strong><small>{t("SIPS EACH", "1人あたりシップ")}</small></div> : wheel.playerIds.includes(meId) ? <button type="button" className="wheel-start-button" disabled={busy} onClick={() => send("spin", { wheelId: wheel.id })}>{t("SPIN →", "回す →")}</button> : <p className="wheel-waiting">{t(`Waiting for ${playerName(spinner)} to spin.`, `${playerName(spinner)}が回します。`)}</p>}</section>;
  })}</div><button className="primary-button" disabled={busy || !complete || group.ready.includes(meId)} onClick={() => send("next")}>{group.ready.includes(meId) ? t("WAITING FOR THE TABLE…", "みんなの確認待ち…") : !complete ? t("FINISH THE WHEELS FIRST", "ルーレットを終えてください") : t("CONTINUE →", "次へ →")}</button><p className="mp-progress" role="status">{group.ready.length}/{group.players.length} {t("ready for the next card", "次のカードへ準備完了")}</p></>;
}

function GroupFinished({ group, players, busy, canRestart, act, t }: Pick<Props, "group" | "players" | "busy" | "canRestart" | "act"> & { t: Translate }) {
  const sorted = [...players].sort((a, b) => (group.scores[a.id] ?? a.sips) - (group.scores[b.id] ?? b.sips));
  const winner = group.winners.length === 1 ? players.find((player) => player.id === group.winners[0]) : undefined;
  const losers = players.filter((player) => group.losers.includes(player.id));
  return <article className="play-card"><span className="eyebrow">{t("THE FINAL TABLE", "最終結果")}</span><h2>{winner ? t(`${winner.name} wins!`, `${winner.name}が優勝！`) : t("The game is over.", "ゲーム終了。")}</h2>{!winner && <p className="mp-copy">{t("No unique winner, so there is no final challenge.", "単独優勝者がいないので最後のチャレンジはありません。")}</p>}<ol className="mp-results">{sorted.map((player) => <li key={player.id}><strong>{player.name}</strong><span>{group.scores[player.id] ?? player.sips} {t("sips", "シップ")}</span></li>)}</ol>{winner && losers.length > 0 && <div className="mp-wager"><strong>{t("Final challenge for ", "最後のチャレンジ：")}{losers.map((player) => player.name).join(" · ")}</strong><blockquote>{group.winningWager ?? winner.wager}</blockquote><p>{t(`Written by ${winner.name} before the game.`, `${winner.name}がゲーム前に書いたチャレンジです。`)}</p></div>}<h3>{t("The secret challenges", "秘密のチャレンジ")}</h3><ul className="mp-results">{players.map((player) => <li key={player.id}><strong>{player.name}</strong><span>{player.wager}</span></li>)}</ul>{canRestart ? <button type="button" className="primary-button" disabled={busy} onClick={() => void act("newTable")}>{t("NEW GAME →", "新しいゲーム →")}</button> : <p className="mp-copy">{t("A Premium host can start another multiplayer game.", "Premiumのホストが次のマルチプレイヤーゲームを開始できます。")}</p>}</article>;
}
