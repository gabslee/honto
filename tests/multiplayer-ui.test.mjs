import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMultiplayerState, publicMultiplayer, reduceMultiplayer } from '../api/multiplayer.ts';

// Render the real TSX component with React; assertions cover visible choices and gates.
const source = readFileSync(new URL('../app/multiplayer-client.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source + '\nexport { GroupFinished };', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
new Function('require', 'exports', compiled)(createRequire(import.meta.url), exports);
const { MultiplayerGame } = exports;
const players = ['a', 'b', 'c'].map((id, index) => ({ id, name: `Player ${id}`, isHost: Number(index === 0), sips: 0, hasWager: true, wager: `Wager ${id}`, connected: false }));
function state(type = 'honto', extra = {}) { return createMultiplayerState({ players, cards: [{ id: 'card-1', type, ...extra }] }); }
function action(s, id, type, extra = {}) { return reduceMultiplayer(s, id, { type, cardId: s.card.id, round: s.round, ...extra }, () => 0, 100); }
function html(s, meId = 'a', extra = {}) { return renderToStaticMarkup(React.createElement(MultiplayerGame, { group: publicMultiplayer(s, meId), players, meId, busy: false, act: () => {}, locale: 'en', canRestart: true, welcomeAck: players.map(p => p.id), ...extra })); }

test('the completed-game restart button invokes the server newTable action', () => {
  let invoked;
  const tree = exports.GroupFinished({ group: { ...publicMultiplayer(state(), 'a'), winners: [], losers: [], finished: true }, players, busy: false, canRestart: true, act: (action) => { invoked = action; }, t: (en) => en });
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button' && node.props.children === 'NEW GAME →') node.props.onClick();
    React.Children.forEach(node.props?.children, visit);
  };
  visit(tree);
  assert.equal(invoked, 'newTable');
});

test('draw belongs to the author; anonymous players are not labeled disconnected', () => {
  const s = state();
  assert.match(html(s), /DRAW A CARD/);
  assert.doesNotMatch(html(s, 'b'), /DRAW A CARD/);
  assert.doesNotMatch(html(s), /Reconnecting/);
  assert.doesNotMatch(html(s), /Two Lies, One Truth/);
});

test('secret wagers and welcome acknowledgment gate the first card', () => {
  const s = state();
  const output = html(s, 'a', { players: players.map(p => ({ ...p, hasWager: false })), welcomeAck: [] });
  assert.match(output, /Your secret challenge/);
  assert.doesNotMatch(output, /DRAW A CARD/);
  assert.doesNotMatch(output, /Wager b/);
  assert.match(html(s, 'a', { welcomeAck: [] }), /START PLAYING/);
});

test('guessers see choices once, cannot skip, and cannot see others answers', () => {
  let s = action(state(), 'a', 'draw');
  s = action(s, 'a', 'prepare', { prompt: 'Find the truth', options: ['Secret A', 'Secret B', 'Secret C'], answer: 2 });
  assert.match(html(s, 'b'), /Secret A/);
  assert.doesNotMatch(html(s, 'b'), /Skip my answer|Correct answer:/);
  s = action(s, 'b', 'answer', { value: 1 });
  const output = html(s, 'b');
  assert.match(output, /Your answer is locked/);
  assert.doesNotMatch(output, /class="mp-choice"/);
  assert.doesNotMatch(html(s, 'c'), /Correct answer:/);
});

test('Who at the table excludes self and allows a personal skip', () => {
  const s = action(state('who', { prompt: 'Who would miss a flight?' }), 'a', 'draw');
  const output = html(s, 'b');
  assert.match(output, /Skip my answer/);
  assert.match(output, /class="mp-choice"[^>]*>Player a/);
  assert.doesNotMatch(output, /class="mp-choice"[^>]*>Player b/);
});

test('everyone can start their shared wheel; continue waits for all spins', () => {
  let s = action(state('both'), 'a', 'draw');
  for (const p of players) assert.match(html(s, p.id), /SPIN/);
  assert.match(html(s), /FINISH THE WHEELS FIRST/);
  s = action(s, 'b', 'spin', { wheelId: s.wheels[0].id });
  assert.match(html(s), /CONTINUE/);
  assert.doesNotMatch(html(s), />SPIN/);
});

test('staring confirmation locks and mismatch offers a new duel', () => {
  let s = action(state('challenge', { challenge: 'staring' }), 'a', 'draw');
  s = action(s, 'a', 'chooseOpponent', { playerId: 'b' });
  assert.match(html(s, 'b'), /Decline challenge/);
  s = action(s, 'b', 'confirmLoser', { playerId: 'a' });
  assert.doesNotMatch(html(s, 'b'), /Decline challenge/);
  assert.match(html(s, 'b'), /class="mp-choice" disabled/);
  s = action(s, 'a', 'confirmLoser', { playerId: 'b' });
  assert.match(html(s), /confirmations differed/);
  assert.match(html(s), /CARD.*1\/1/);
});

test('Japanese draw and malicious player text render safely', () => {
  const s = state();
  const output = html(s, 'a', { locale: 'ja', players: [{ ...players[0], name: '<script>bad()</script>' }, ...players.slice(1)] });
  assert.match(output, /カードを引く/);
  assert.doesNotMatch(output, /<script>/);
  assert.match(output, /&lt;script&gt;/);
});

test('surprise yes answers create personal wheels, with no participant skip', () => {
  let s = action(state('challenge', { challenge: 'surprise', prompt: 'Are you wearing black?' }), 'a', 'draw');
  assert.match(html(s, 'b'), /Yes, that/);
  assert.doesNotMatch(html(s, 'b'), /Skip my answer/);
  s = action(s, 'a', 'answer', { value: true });
  s = action(s, 'b', 'answer', { value: false });
  s = action(s, 'c', 'answer', { value: true });
  assert.equal((html(s, 'a').match(/>SPIN/g) ?? []).length, 1);
  assert.equal((html(s, 'c').match(/>SPIN/g) ?? []).length, 1);
  assert.doesNotMatch(html(s, 'b'), />SPIN/);
});

test('would-rather split and skip show individual revealed answers', () => {
  let s = action(state('wouldrather'), 'a', 'draw');
  s = action(s, 'a', 'prepare', { prompt: 'Choose', options: ['Beach', 'Mountain'] });
  assert.match(html(s, 'a'), /Skip my answer/);
  s = action(s, 'a', 'answer', { value: 0 });
  s = action(s, 'b', 'answer', { value: 1 });
  s = action(s, 'c', 'skip');
  assert.match(html(s), /Beach/);
  assert.match(html(s), /Mountain/);
  assert.match(html(s), /Skipped/);
  assert.doesNotMatch(html(s, 'a'), />SPIN/);
  assert.match(html(s, 'c'), />SPIN/);
});

test('spinning wheel hides its number and disables continue until server duration passes', () => {
  let s = action(state('both'), 'a', 'draw');
  s = reduceMultiplayer(s, 'a', { type: 'spin', cardId: s.card.id, round: s.round, wheelId: s.wheels[0].id }, () => 0, Date.now());
  const output = html(s);
  assert.match(output, /Spinning/);
  assert.match(output, /FINISH THE WHEELS FIRST/);
  assert.doesNotMatch(output, /1 sips each/);
});

test('estimate preparation asks for one secret number, preference uses curated choices', () => {
  const estimate = action(state('estimate', { prompt: 'How many countries have you visited?' }), 'a', 'draw');
  assert.match(html(estimate), /Your secret number/);
  assert.doesNotMatch(html(estimate), /Option 1/);
  const preference = action(state('preference', { prompt: 'My favorite season?', options: ['Summer', 'Winter', 'Spring'] }), 'a', 'draw');
  const output = html(preference);
  assert.match(output, /Summer/);
  assert.doesNotMatch(output, /type="text"/);
});

test('a completed tie has no final challenge, and insufficient players ends clearly', () => {
  let s = action(state('both'), 'a', 'draw');
  s = action(s, 'b', 'spin', { wheelId: s.wheels[0].id });
  for (const p of players) s = reduceMultiplayer(s, p.id, { type: 'next', cardId: s.card.id, round: s.round }, () => 0, 6600);
  assert.match(html(s), /No unique winner/);
  assert.doesNotMatch(html(s), /Final challenge for/);
  assert.match(html(s), /Wager a/);
  assert.match(html(s), /NEW GAME/);
  assert.doesNotMatch(html(s, 'b', { canRestart: false }), /NEW GAME/);
  const left = action(state(), 'c', 'leave');
  assert.match(html(left), /game is over/);
});
