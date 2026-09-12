import assert from 'node:assert/strict';
import test from 'node:test';
import { createMultiplayerState, reduceMultiplayer, publicMultiplayer } from '../api/multiplayer.ts';

const players = n => Array.from({length:n},(_,i)=>({id:`p${i}`,name:`Player ${i}`}));
const make = (type='honto',n=3,extra={}) => act(createMultiplayerState({players:players(n),cards:[{id:'c1',type,...extra},{id:'c2',type:'both'}]}),'p0','draw');
const act = (s,id,type,extra={}) => reduceMultiplayer(s,id,{type,cardId:s.card.id,round:s.round,...extra},()=>0,type==='next'?10000:1000);
const prepare = s => act(s,'p0','prepare',{prompt:'Question',options:['A','B','C'],answer:0});

test('capacity and unsupported cards are rejected',()=>{
  for(const n of [1,2,7]) assert.throws(()=>make('honto',n));
  assert.throws(()=>make('rps'));
  for(const n of [3,4,5,6]) assert.equal(make('honto',n).players.length,n);
});
test('author scoring exhausts every correct-count case at 3–6 players',()=>{
  const expected={3:[null,[1,2,3],[3,4,5]],4:[null,null,[2,3,4],[3,4,5]],5:[null,null,[1,2,3],[2,3,4],[3,4,5]],6:[null,null,null,[1,2,3],[2,3,4],[3,4,5]]};
  for(const n of [3,4,5,6]) for(let correct=0;correct<n;correct++) {
    let s=prepare(make('honto',n));
    for(let i=1;i<n;i++) s=act(s,`p${i}`,'answer',{value:i<=correct?0:1});
    assert.deepEqual(s.wheels.find(w=>w.playerIds.includes('p0'))?.values??null,expected[n][correct],`${n} players, ${correct} correct`);
    assert.equal(s.phase,'result');
  }
});
test('secrets, immutability, validation and replay guards',()=>{
  const initial=make(); const s=prepare(initial);
  assert.equal(initial.phase,'prepare');
  assert.equal(publicMultiplayer(s,'p1').card.answer,undefined);
  assert.equal(publicMultiplayer(s,'p1').cards,undefined);
  assert.throws(()=>act(s,'p1','skip'));
  assert.throws(()=>act(s,'p1','answer',{value:7}));
  const answered=act(s,'p1','answer',{value:0});
  assert.deepEqual(publicMultiplayer(answered,'p2').answers,{});
  assert.throws(()=>act(answered,'p1','answer',{value:1}));
  assert.throws(()=>reduceMultiplayer(answered,'p2',{type:'answer',cardId:'stale',round:0,value:0}));
  assert.throws(()=>act(s,'intruder','answer',{value:0}));
});
test('preparation skip cancels card, wheel scores once, everyone acknowledges',()=>{
  let s=act(make(),'p0','skip');
  assert.deepEqual(s.wheels[0].values,[2,3,4]);
  assert.throws(()=>act(s,'p0','next'));
  s=act(s,'p0','spin',{wheelId:s.wheels[0].id});
  assert.equal(s.scores.p0,2);
  assert.throws(()=>act(s,'p0','spin',{wheelId:s.wheels[0].id}));
  for(const p of players(3)) s=act(s,p.id,'next');
  assert.equal(s.card.id,'c2'); assert.equal(s.authorId,'p1');
});
test('would rather excludes skips, penalizes minority, not ties or unanimity',()=>{
  for(const values of [[0,1,'skip'],[0,0,0],[0,0,1]]) {
    let s=act(make('wouldrather'),'p0','prepare',{prompt:'Choose',options:['A','B']});
    for(let i=0;i<3;i++) s=act(s,`p${i}`,values[i]==='skip'?'skip':'answer',{value:values[i]});
    assert.equal(s.wheels.length,values[2]===0?0:1);
    if(s.wheels.length) assert.deepEqual(s.wheels[0].values,values[2]==='skip'?[2,3,4]:[1,2,3]);
  }
});
test('who forbids self voting, ties punish each leader, all skips only punish skip',()=>{
  let s=make('who'); assert.throws(()=>act(s,'p0','answer',{value:'p0'}));
  for(let i=0;i<3;i++) s=act(s,`p${i}`,'answer',{value:`p${(i+1)%3}`});
  assert.equal(s.wheels.length,3);
  s=make('who'); for(let i=0;i<3;i++) s=act(s,`p${i}`,'skip');
  assert.equal(s.wheels.length,3); assert.ok(s.wheels.every(w=>w.values[0]===2));
});
test('surprise yes responses get individual wheels, coin everyone shares one',()=>{
  let s=make('challenge',3,{challenge:'surprise'});
  for(let i=0;i<3;i++) s=act(s,`p${i}`,'answer',{value:i!==2});
  assert.equal(s.wheels.length,2);
  s=reduceMultiplayer(make('challenge',3,{challenge:'coin'}),'p0',{type:'coin',cardId:'c1',round:0},()=>0.9);
  assert.deepEqual(s.wheels[0].playerIds,['p0','p1','p2']);
});
test('duel refusal, disagreement and rps ties do not deadlock',()=>{
  let s=act(make('challenge',3,{challenge:'staring'}),'p0','chooseOpponent',{playerId:'p1'});
  s=act(s,'p0','confirmLoser',{playerId:'p0'}); s=act(s,'p1','confirmLoser',{playerId:'p1'});
  assert.equal(s.round,1); assert.deepEqual(s.confirmations,{});
  s=act(s,'p1','skip'); assert.deepEqual(s.wheels[0].values,[2,3,4]);
  s=act(make('challenge',3,{challenge:'rps'}),'p0','chooseOpponent',{playerId:'p1'});
  s=act(s,'p0','duel',{value:'rock'}); s=act(s,'p1','duel',{value:'rock'}); assert.equal(s.round,1);
  s=act(s,'p0','duel',{value:'rock'}); s=act(s,'p1','duel',{value:'paper'});
  assert.deepEqual(s.wheels[0].playerIds,['p0']);
});
test('departures finish under three and cancel author or duel disappearance',()=>{
  let s=reduceMultiplayer(make(),'p1',{type:'leave'}); assert.equal(s.finished,true);
  s=reduceMultiplayer(prepare(make('honto',4)),'p0',{type:'leave'}); assert.equal(s.phase,'result');
  assert.equal(s.wheels.length,0);
});

test('drawing hides card content and requires author; future cards and wagers remain private',()=>{
  const s=createMultiplayerState({players:players(3),cards:[{id:'x',type:'who',prompt:'Secret upcoming prompt'}],wagers:{p0:'Secret wager'}});
  assert.deepEqual(publicMultiplayer(s,'p0').card,{id:'x',type:'hidden'});
  assert.equal(publicMultiplayer(s,'p1').wagers,undefined);
  assert.throws(()=>act(s,'p1','draw'));
  assert.equal(act(s,'p0','draw').phase,'answer');
});
test('estimate generates three distinct bounded integer options and permits one attempt',()=>{
  for(const target of [0,1,42,999999,1000000]) {
    let s=act(make('estimate',3,{prompt:'How many?'}),'p0','prepare',{answer:target});
    assert.equal(s.card.options.length,3); assert.equal(new Set(s.card.options.map(Number)).size,3);
    assert.ok(s.card.options.map(Number).every(v=>Number.isInteger(v)&&v>=0&&v<=1000000));
    assert.equal(Number(s.card.options[s.card.answer]),target);
    s=act(s,'p1','answer',{value:0}); assert.throws(()=>act(s,'p1','answer',{value:1}));
  }
  for(const target of [-1,1.5,1000001,NaN]) assert.throws(()=>act(make('estimate',3,{prompt:'How many?'}),'p0','prepare',{answer:target}));
});
test('preference retains curated options and secret author choice',()=>{
  const s=act(make('preference',3,{prompt:'Pick',options:['A','B','C']}),'p0','prepare',{answer:1,options:['X','Y','Z']});
  assert.deepEqual(s.card.options,['A','B','C']); assert.equal(publicMultiplayer(s,'p1').card.answer,undefined);
});
test('wheel completion has a server clock gate and shared spin scores every affected player once',()=>{
  let s=make('both'); s=act(s,'p1','spin',{wheelId:s.wheels[0].id});
  assert.deepEqual(s.scores,{p0:1,p1:1,p2:1});
  assert.throws(()=>reduceMultiplayer(s,'p0',{type:'next',cardId:'c1',round:0},()=>0,7499));
  s=reduceMultiplayer(s,'p0',{type:'next',cardId:'c1',round:0},()=>0,7500); assert.deepEqual(s.ready,['p0']);
});
test('finish: tied winners have no mandatory wager; unique winner assigns all last places',()=>{
  for(const unique of [false,true]) {
    let s=createMultiplayerState({players:players(3),cards:[{id:'c1',type:'both'}],wagers:{p0:'Dance'}});
    s=act(s,'p0','draw'); if(unique) s.scores={p0:0,p1:2,p2:2};
    s=act(s,'p0','spin',{wheelId:s.wheels[0].id}); for(const p of players(3)) s=act(s,p.id,'next');
    assert.equal(s.finished,true); assert.deepEqual(s.losers,unique?['p1','p2']:[]);
    assert.equal(publicMultiplayer(s,'p0').winningWager,unique?'Dance':null);
  }
});
test('a missing respondent is removed from pending answers and departed vote targets do not win',()=>{
  let s=prepare(make('honto',4)); s=act(s,'p1','answer',{value:0}); s=act(s,'p2','answer',{value:1});
  s=reduceMultiplayer(s,'p3',{type:'leave'}); assert.equal(s.phase,'result');
  s=make('who',4); s=act(s,'p0','answer',{value:'p3'}); s=act(s,'p1','answer',{value:'p3'}); s=act(s,'p2','answer',{value:'p1'});
  s=reduceMultiplayer(s,'p3',{type:'leave'}); assert.deepEqual(s.wheels.map(w=>w.playerIds),[['p1']]);
});

test('all three guessing games apply identical author tiers at every table capacity',()=>{
  for(const type of ['honto','preference','estimate']) for(const n of [3,4,5,6]) for(let correct=0;correct<n;correct++) {
    let s=type==='estimate'?act(make(type,n,{prompt:'How many?'}),'p0','prepare',{answer:25}):prepare(make(type,n));
    const correctIndex=s.card.answer;
    for(let i=1;i<n;i++) s=act(s,`p${i}`,'answer',{value:i<=correct?correctIndex:(correctIndex+1)%3});
    const author=s.wheels.find(w=>w.playerIds.includes('p0'));
    const threshold=Math.ceil((n-1)/2);
    assert.equal(Boolean(author),correct>=threshold,`${type}, ${n}, ${correct}`);
    if(author) assert.deepEqual(author.values,correct===n-1?[3,4,5]:n===3?[1,2,3]:correct===n-2?[2,3,4]:[1,2,3]);
    const wrong=s.wheels.find(w=>!w.playerIds.includes('p0'));
    assert.equal(wrong?.playerIds.length??0,n-1-correct);
  }
});
test('everyone-drinks advances normally and departed author does not skip the next active turn',()=>{
  let s=make('both',4); s=act(s,'p0','spin',{wheelId:s.wheels[0].id});
  s=reduceMultiplayer(s,'p0',{type:'leave'});
  for(const id of ['p1','p2','p3']) s=act(s,id,'next');
  assert.equal(s.authorId,'p1'); assert.equal(s.phase,'draw'); assert.equal(s.currentIndex,1);
});
test('nonparticipants cannot spin, choose duels, or confirm losers and author cannot cancel submitted cards',()=>{
  let s=prepare(make()); assert.throws(()=>act(s,'p0','skip'));
  s=act(make('challenge',4,{challenge:'staring'}),'p0','chooseOpponent',{playerId:'p1'});
  assert.throws(()=>act(s,'p2','confirmLoser',{playerId:'p0'}));
  s=act(s,'p0','confirmLoser',{playerId:'p1'}); s=act(s,'p1','confirmLoser',{playerId:'p1'});
  assert.throws(()=>act(s,'p0','spin',{wheelId:s.wheels[0].id}));
});
test('all-negative surprise resolves without a wheel and lets the table continue',()=>{
  let s=make('challenge',3,{challenge:'surprise'});
  for(const p of players(3)) s=act(s,p.id,'answer',{value:false});
  assert.equal(s.phase,'result'); assert.deepEqual(s.wheels,[]);
  for(const p of players(3)) s=act(s,p.id,'next'); assert.equal(s.currentIndex,1);
});

test('complete decks at every capacity preserve scoring and privacy across every card subtype',()=>{
  for(const n of [3,4,5,6]) {
    const cards=['honto','preference','estimate','wouldrather','who','both','coin','staring','rps','surprise'].map((type,i)=>({id:`journey${i}`,type:i<6?type:'challenge',...(i>=6?{challenge:type}:{}),prompt:'Test prompt',...(type==='preference'?{options:['A','B','C']}:{})}));
    let s=createMultiplayerState({players:players(n),cards,wagers:{p0:'Secret'}});
    let totalAwarded=0, tick=100000;
    const go=(id,type,extra={})=>{
      const before=structuredClone(s);
      s=reduceMultiplayer(s,id,{type,cardId:s.card.id,round:s.round,...extra},()=>((tick/1000)%7)/7,tick);
      if(type==='spin') { const w=s.wheels.find(w=>w.id===extra.wheelId); totalAwarded+=w.value*w.playerIds.length; }
      assert.equal(Object.values(s.scores).reduce((a,b)=>a+b,0),totalAwarded);
      assert.deepEqual(before.scores,type==='spin'?before.scores:s.scores);
      for(const viewer of s.players) {
        const pub=publicMultiplayer(s,viewer.id);
        assert.equal(pub.cards,undefined); assert.equal(pub.wagers,undefined);
        if(!['result','finished'].includes(s.phase)) {
          assert.ok(Object.keys(pub.answers).every(id=>id===viewer.id));
          if(viewer.id!==s.authorId) assert.equal(pub.card.answer,undefined);
        }
      }
      tick+=1000;
    };
    while(!s.finished) {
      const author=s.authorId;
      go(author,'draw');
      if(s.phase==='prepare') {
        if(s.card.type==='estimate') go(author,'prepare',{answer:17});
        else if(s.card.type==='preference') go(author,'prepare',{answer:1});
        else go(author,'prepare',{prompt:'Prompt',options:s.card.type==='wouldrather'?['A','B']:['A','B','C'],answer:1});
      }
      if(s.phase==='answer') {
        const ids=s.players.filter(p=>!['honto','preference','estimate'].includes(s.card.type)||p.id!==author).map(p=>p.id);
        for(const [i,id] of ids.entries()) {
          let value;
          if(s.card.type==='who') value=s.players[(s.players.findIndex(p=>p.id===id)+1)%n].id;
          else if(s.card.challenge==='surprise') value=i%2===0;
          else value=i%2===0?1:0;
          go(id,'answer',{value});
        }
      }
      if(s.phase==='coin') go(author,'coin');
      if(s.phase==='opponent') go(author,'chooseOpponent',{playerId:s.players.find(p=>p.id!==author).id});
      if(s.phase==='duel') {
        const opponent=s.opponentId;
        if(s.card.challenge==='rps') { go(author,'duel',{value:'rock'}); go(opponent,'duel',{value:'paper'}); }
        else { go(author,'confirmLoser',{playerId:opponent}); go(opponent,'confirmLoser',{playerId:opponent}); }
      }
      assert.equal(s.phase,'result');
      for(const w of [...s.wheels]) go(w.playerIds[0],'spin',{wheelId:w.id});
      tick+=6500;
      for(const p of [...s.players]) go(p.id,'next');
    }
    assert.equal(s.endReason,'completed'); assert.equal(s.currentIndex,10);
  }
});

test('actions issued before author departure cannot resurrect canceled card',()=>{
  let s=prepare(make('honto',4));
  const stale={type:'answer',cardId:s.card.id,round:s.round,value:0};
  s=reduceMultiplayer(s,'p0',{type:'leave'});
  assert.throws(()=>reduceMultiplayer(s,'p1',stale));
  for(const id of ['p1','p2','p3']) s=act(s,id,'next');
  assert.throws(()=>reduceMultiplayer(s,'p1',stale));
});

test('the same multiplayer card is localized independently for each viewer',()=>{
  let state=createMultiplayerState({players:players(3),cards:[{id:'localized',type:'who',promptEn:'Who is ready?',promptJa:'準備ができたのは誰？'}]});
  state=act(state,'p0','draw');
  assert.equal(publicMultiplayer(state,'p0','en').card.prompt,'Who is ready?');
  assert.equal(publicMultiplayer(state,'p1','ja').card.prompt,'準備ができたのは誰？');
  assert.equal('promptJa' in publicMultiplayer(state,'p0','en').card,false);
});
