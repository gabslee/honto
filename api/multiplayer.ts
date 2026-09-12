/** Authoritative, immutable multiplayer transitions. Never send the private state to clients. */
export type MultiplayerCardType = 'honto' | 'preference' | 'estimate' | 'wouldrather' | 'who' | 'challenge' | 'both';
export type MultiplayerCard = { id: string; type: MultiplayerCardType; prompt?: string; options?: string[]; promptEn?: string; promptJa?: string; optionsEn?: string[]; optionsJa?: string[]; answer?: number; challenge?: 'coin' | 'staring' | 'rps' | 'surprise' };
export type MultiplayerPlayer = { id: string; name: string };
export type MultiplayerWheel = { id: string; playerIds: string[]; values: number[]; value: number | null; spunAt: number | null };
export type MultiplayerAction = { type: string; cardId?: string; round?: number; prompt?: string; options?: string[]; answer?: number; value?: string | number | boolean; playerId?: string; wheelId?: string };
export type MultiplayerState = {
  players: MultiplayerPlayer[]; cards: MultiplayerCard[]; card: MultiplayerCard; currentIndex: number; round: number;
  authorId: string; phase: 'draw' | 'prepare' | 'answer' | 'opponent' | 'duel' | 'coin' | 'result' | 'finished';
  scores: Record<string, number>; answers: Record<string, string | number | boolean>; wheels: MultiplayerWheel[];
  ready: string[]; finished: boolean; winners: string[]; losers: string[]; wagers: Record<string, string>;
  opponentId: string | null; confirmations: Record<string, string>; coinResult: 'heads' | 'tails' | null;
  endReason: string | null; turnOrder: string[];
};
const normal = [1, 2, 3];
const skipValues = [2, 3, 4];
const guessing = (c: MultiplayerCard) => ['honto', 'preference', 'estimate'].includes(c.type);
function requireRule(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function wheel(s: MultiplayerState, ids: string[], values = normal) {
  if (ids.length) s.wheels.push({ id: `${s.card.id}:${s.round}:${s.wheels.length}`, playerIds: ids, values: [...values], value: null, spunAt: null });
}
function finish(s: MultiplayerState, reason: string) {
  s.finished = true; s.phase = 'finished'; s.endReason = reason;
  const scores = s.players.map(p => s.scores[p.id]);
  s.winners = s.players.filter(p => s.scores[p.id] === Math.min(...scores)).map(p => p.id);
  s.losers = s.winners.length === 1 ? s.players.filter(p => s.scores[p.id] === Math.max(...scores) && p.id !== s.winners[0]).map(p => p.id) : [];
  if (reason !== 'completed') { s.winners = []; s.losers = []; }
}
function begin(s: MultiplayerState) {
  s.card = structuredClone(s.cards[s.currentIndex]); s.answers = {}; s.wheels = []; s.ready = [];
  s.opponentId = null; s.confirmations = {}; s.coinResult = null; s.round = 0;
  s.phase = 'draw';
}
function draw(s: MultiplayerState) {
  if (guessing(s.card) || s.card.type === 'wouldrather') s.phase = 'prepare';
  else if (s.card.type === 'both') { s.phase = 'result'; wheel(s, s.players.map(p => p.id)); }
  else if (s.card.type === 'challenge' && s.card.challenge === 'coin') s.phase = 'coin';
  else if (s.card.type === 'challenge' && ['rps', 'staring'].includes(s.card.challenge!)) s.phase = 'opponent';
  else s.phase = 'answer';
}
export function createMultiplayerState(input: { players: MultiplayerPlayer[]; cards: MultiplayerCard[]; wagers?: Record<string, string> }): MultiplayerState {
  requireRule(input.players.length >= 3 && input.players.length <= 6, 'Multiplayer requires 3–6 players');
  requireRule(new Set(input.players.map(p => p.id)).size === input.players.length && input.players.every(p => p.id && p.name), 'Invalid players');
  requireRule(input.cards.length > 0 && input.cards.length <= 120, 'Invalid deck length');
  requireRule(new Set(input.cards.map(c => c.id)).size === input.cards.length, 'Duplicate card IDs');
  for (const c of input.cards) {
    requireRule(c.id && ['honto','preference','estimate','wouldrather','who','challenge','both'].includes(c.type), 'Invalid card type');
    if (c.type === 'challenge') requireRule(['coin','staring','rps','surprise'].includes(c.challenge!), 'Invalid challenge');
  }
  const s: MultiplayerState = { players: structuredClone(input.players), cards: structuredClone(input.cards), card: structuredClone(input.cards[0]), currentIndex: 0, round: 0, authorId: input.players[0].id, phase: 'prepare', scores: Object.fromEntries(input.players.map(p => [p.id, 0])), answers: {}, wheels: [], ready: [], finished: false, winners: [], losers: [], wagers: structuredClone(input.wagers ?? {}), opponentId: null, confirmations: {}, coinResult: null, endReason: null, turnOrder: input.players.map(p => p.id) };
  begin(s); return s;
}
function respondents(s: MultiplayerState) { return s.players.filter(p => !guessing(s.card) || p.id !== s.authorId).map(p => p.id); }
function resolveAnswers(s: MultiplayerState) {
  const ids = respondents(s);
  if (!ids.every(id => Object.hasOwn(s.answers, id))) return;
  s.phase = 'result';
  if (guessing(s.card)) {
    const correct = ids.filter(id => s.answers[id] === s.card.answer);
    wheel(s, ids.filter(id => s.answers[id] !== s.card.answer));
    if (correct.length >= Math.ceil(ids.length / 2)) {
      const values = correct.length === ids.length ? [3,4,5] : ids.length === 2 ? normal : correct.length === ids.length - 1 ? skipValues : normal;
      wheel(s, [s.authorId], values);
    }
  } else if (s.card.type === 'wouldrather') {
    const a = ids.filter(id => s.answers[id] === 0); const b = ids.filter(id => s.answers[id] === 1);
    if (a.length && b.length && a.length !== b.length) wheel(s, a.length < b.length ? a : b);
    for (const id of ids.filter(id => s.answers[id] === 'skip')) wheel(s, [id], skipValues);
  } else if (s.card.type === 'who') {
    const votes: Record<string, number> = {};
    for (const id of ids) { const v = s.answers[id]; if (v === 'skip') wheel(s, [id], skipValues); else if (typeof v === 'string' && ids.includes(v)) votes[v] = (votes[v] ?? 0) + 1; }
    const max = Math.max(0, ...Object.values(votes));
    if (max) for (const id of ids.filter(id => votes[id] === max)) wheel(s, [id]);
  } else if (s.card.challenge === 'surprise') {
    for (const id of ids.filter(id => s.answers[id] === true)) wheel(s, [id]);
  }
}
function advance(s: MultiplayerState) {
  if (!s.players.every(p => s.ready.includes(p.id))) return;
  s.currentIndex++;
  if (s.currentIndex === s.cards.length) return finish(s, 'completed');
  const authorIndex = s.turnOrder.indexOf(s.authorId);
  for (let step = 1; step <= s.turnOrder.length; step++) {
    const id = s.turnOrder[(Math.max(authorIndex, 0) + step) % s.turnOrder.length];
    if (s.players.some(p => p.id === id)) { s.authorId = id; break; }
  }
  begin(s);
}
export function reduceMultiplayer(state: MultiplayerState, actorId: string, action: MultiplayerAction, random: () => number = Math.random, now: number = Date.now()): MultiplayerState {
  requireRule(state.players.some(p => p.id === actorId), 'Player is not in this match');
  requireRule(!state.finished, 'Match has ended');
  const s = structuredClone(state);
  if (action.type === 'leave') {
    s.players = s.players.filter(p => p.id !== actorId); delete s.answers[actorId]; delete s.confirmations[actorId]; s.ready = s.ready.filter(id => id !== actorId);
    if (s.players.length < 3) { finish(s, 'insufficient_players'); return s; }
    if ((actorId === s.authorId || actorId === s.opponentId) && s.phase !== 'result') { s.phase = 'result'; s.wheels = []; }
    else if (s.phase === 'answer') resolveAnswers(s);
    for (const w of s.wheels) w.playerIds = w.playerIds.filter(id => id !== actorId);
    s.wheels = s.wheels.filter(w => w.playerIds.length);
    if (s.phase === 'result') advance(s);
    return s;
  }
  requireRule(action.cardId === s.card.id && action.round === s.round, 'Stale card or round');
  const author = actorId === s.authorId;
  if (action.type === 'draw') {
    requireRule(s.phase === 'draw' && author, 'Only the author can draw'); draw(s);
  } else if (action.type === 'prepare') {
    requireRule(s.phase === 'prepare' && author, 'Only the author can prepare this card');
    let options = s.card.type === 'preference' && s.card.options ? s.card.options : action.options;
    let answer = action.answer;
    const prompt = action.prompt ?? s.card.prompt;
    const count = s.card.type === 'wouldrather' ? 2 : 3;
    requireRule(typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 500, 'Enter a prompt of 1–500 characters');
    if (s.card.type === 'estimate') {
      requireRule(Number.isInteger(answer) && answer! >= 0 && answer! <= 1000000, 'Enter an integer from 0 to 1000000');
      const target = answer!; const candidates = new Set<number>([target]);
      const spread = Math.max(2, Math.ceil(target * 0.3));
      // Bounded fallback also works with deterministic test random sources.
      for (let attempt = 0; candidates.size < 3 && attempt < 12; attempt++) candidates.add(Math.max(0, Math.min(1000000, target + Math.floor(random() * (2 * spread + 1)) - spread)));
      for (let offset = 1; candidates.size < 3; offset++) candidates.add(target + offset <= 1000000 ? target + offset : target - offset);
      options = [...candidates].sort((a,b) => a-b).map(String); answer = options.indexOf(String(target));
    }
    requireRule(Array.isArray(options) && options.length === count && options.every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 240), 'Invalid answer options');
    requireRule(new Set(options.map(v => v.trim().toLowerCase())).size === count, 'Options must be distinct');
    if (guessing(s.card)) requireRule(Number.isInteger(answer) && answer! >= 0 && answer! < count, 'Invalid correct answer');
    s.card.prompt = prompt.trim(); s.card.options = options.map(v => v.trim());
    if (guessing(s.card)) s.card.answer = answer;
    s.phase = 'answer';
  } else if (action.type === 'answer' || action.type === 'skip') {
    if (action.type === 'skip' && author && s.phase === 'prepare') { s.phase = 'result'; wheel(s, [actorId], skipValues); return s; }
    if (action.type === 'skip' && actorId === s.opponentId && s.phase === 'duel') {
      requireRule(!Object.hasOwn(s.answers, actorId) && !Object.hasOwn(s.confirmations, actorId), 'Already participated in this duel');
      s.phase = 'result'; wheel(s, [actorId], skipValues); return s;
    }
    requireRule(s.phase === 'answer' && respondents(s).includes(actorId), 'Cannot answer this card');
    requireRule(!Object.hasOwn(s.answers, actorId), 'Already answered');
    if (action.type === 'skip') { requireRule(['wouldrather','who'].includes(s.card.type), 'Skip is unavailable for this card'); s.answers[actorId] = 'skip'; }
    else {
      const v = action.value;
      if (s.card.type === 'who') requireRule(typeof v === 'string' && v !== actorId && s.players.some(p => p.id === v), 'Vote for another player');
      else if (s.card.challenge === 'surprise') requireRule(typeof v === 'boolean', 'Answer yes or no');
      else requireRule(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < (s.card.options?.length ?? 0), 'Invalid option');
      s.answers[actorId] = v!;
    }
    resolveAnswers(s);
  } else if (action.type === 'chooseOpponent') {
    requireRule(s.phase === 'opponent' && author && action.playerId !== actorId && s.players.some(p => p.id === action.playerId), 'Choose another player');
    s.opponentId = action.playerId!; s.phase = 'duel';
  } else if (action.type === 'coin') {
    requireRule(s.phase === 'coin' && author, 'Only the author can toss this coin');
    s.coinResult = random() < 0.5 ? 'heads' : 'tails'; s.phase = 'result';
    wheel(s, s.coinResult === 'heads' ? [actorId] : s.players.map(p => p.id));
  } else if (action.type === 'duel' || action.type === 'confirmLoser') {
    requireRule(s.phase === 'duel' && (author || actorId === s.opponentId), 'Only duel participants can respond');
    const duo = [s.authorId, s.opponentId!];
    if (action.type === 'duel') {
      requireRule(s.card.challenge === 'rps' && ['rock','paper','scissors'].includes(String(action.value)), 'Invalid duel move');
      requireRule(!Object.hasOwn(s.answers, actorId), 'Already played'); s.answers[actorId] = action.value!;
      if (duo.every(id => Object.hasOwn(s.answers,id))) {
        const a = s.answers[duo[0]], b = s.answers[duo[1]];
        if (a === b) { s.answers = {}; s.round++; }
        else { const aWins = (a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper'); s.phase = 'result'; wheel(s, [duo[aWins ? 1 : 0]]); }
      }
    } else {
      requireRule(s.card.challenge === 'staring' && duo.includes(action.playerId!), 'Invalid loser');
      requireRule(!Object.hasOwn(s.confirmations, actorId), 'Already confirmed'); s.confirmations[actorId] = action.playerId!;
      if (duo.every(id => Object.hasOwn(s.confirmations,id))) {
        if (s.confirmations[duo[0]] !== s.confirmations[duo[1]]) { s.confirmations = {}; s.round++; }
        else { s.phase = 'result'; wheel(s, [s.confirmations[duo[0]]]); }
      }
    }
  } else if (action.type === 'spin') {
    requireRule(s.phase === 'result', 'The card is not resolved');
    const w = s.wheels.find(w => w.id === action.wheelId);
    requireRule(w && w.playerIds.includes(actorId), 'This is not your wheel');
    requireRule(w.value === null, 'Wheel already spun');
    const r = random(); requireRule(Number.isFinite(r) && r >= 0 && r < 1, 'Invalid random source');
    w.value = w.values[Math.floor(r * w.values.length)]; w.spunAt = now;
    for (const id of w.playerIds) s.scores[id] += w.value;
  } else if (action.type === 'next') {
    requireRule(s.phase === 'result' && s.wheels.every(w => w.value !== null && now >= w.spunAt! + 6500), 'Wait for all wheels to finish');
    requireRule(!s.ready.includes(actorId), 'Already ready'); s.ready.push(actorId); advance(s);
  } else throw new Error('Unknown multiplayer action');
  return s;
}
export function publicMultiplayer(state: MultiplayerState, viewerId: string, locale: 'en' | 'ja' = 'en') {
  requireRule(state.players.some(p => p.id === viewerId), 'Player is not in this match');
  const { cards, wagers, turnOrder, card: privateCard, ...visible } = structuredClone(state);
  void cards; void turnOrder;
  const card: Omit<MultiplayerCard, 'type'> & { type: MultiplayerCardType | 'hidden' } = state.phase === 'draw' ? { id: privateCard.id, type: 'hidden' } : privateCard;
  if (card.type !== 'hidden') {
    card.prompt = locale === 'ja' ? card.promptJa ?? card.prompt : card.promptEn ?? card.prompt;
    card.options = locale === 'ja' ? card.optionsJa ?? card.options : card.optionsEn ?? card.options;
    delete card.promptEn; delete card.promptJa; delete card.optionsEn; delete card.optionsJa;
  }
  const reveal = state.phase === 'result' || state.finished;
  if (!reveal && viewerId !== state.authorId) delete card.answer;
  if (!reveal) {
    visible.answers = Object.hasOwn(state.answers,viewerId) ? { [viewerId]: state.answers[viewerId] } : {};
    visible.confirmations = Object.hasOwn(state.confirmations,viewerId) ? { [viewerId]: state.confirmations[viewerId] } : {};
  }
  return { ...visible, card, answeredIds: Object.keys(state.answers), confirmedIds: Object.keys(state.confirmations), totalCards: state.cards.length, winningWager: state.finished && state.winners.length === 1 ? wagers[state.winners[0]] ?? null : null };
}
export type PublicMultiplayerState = ReturnType<typeof publicMultiplayer>;
