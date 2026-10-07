/*
 * coriantumr-selfplay.js - plain counts for engine games under the Coriantumr rules.
 *
 *   node tools/coriantumr-selfplay.js [--vs-random N] [--vs-engine N] [--cap PLIES] [--depth D]
 *
 * Defaults: 100 engine-vs-random games, 20 engine-vs-engine games, 150-ply cap, depth 3.
 *
 * THIS IS A COUNT, NOT A GRADE. It reports how games ended and how long they ran. It does
 * not say the engine is strong, and it sets no pass mark. What it does prove: every engine
 * move is legal, the rule-set tag is on every position, nothing throws, and every game
 * ends or reaches the cap.
 *
 * DETERMINISM: depth is pinned and the deadline cannot be reached, so the clock never
 * decides a move; the random mover is seeded per game. Two identical engines are
 * deterministic, so engine-vs-engine games would all be the same game; each one therefore
 * starts with 6 seeded random plies (3 per side) and the report counts how many of the
 * games are actually different. The same arguments give the same
 * counts. The endings mirror the page's outcome(): no pieces is a loss, no legal move
 * with pieces is a draw, fifty moves, threefold repetition. There is no
 * insufficient-material draw.
 */
const fs = require('fs');
const path = require('path');
const E = require('./../tests/engine.js');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}
const VS_RANDOM = arg('--vs-random', 100), VS_ENGINE = arg('--vs-engine', 20);
const CAP = arg('--cap', 150), DEPTH = arg('--depth', 3);
const NEVER = 1e9;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const key = (S) => S.b.map((p) => p || '.').join('') + '|' + S.turn + '|' + S.ep + '|' + S.v;

/* null while the game goes on, else {kind, winner}. */
function ending(S, hist) {
  if (!E.hasPieces(S, S.turn)) return { kind: 'no pieces', winner: S.turn === 'w' ? 'b' : 'w' };
  if (E.legal(S, true).length === 0) return { kind: 'no legal move', winner: null };
  if (S.half >= 100) return { kind: 'fifty-move', winner: null };
  const k = key(S);
  let n = 0;
  for (const h of hist) if (key(h) === k) n++;
  if (n >= 3) return { kind: 'repetition', winner: null };
  return null;
}

function play(pickWhite, pickBlack, openRnd) {
  let S = E.startState('c');
  const hist = [S];
  const r = { plies: 0, illegal: 0, tagLost: 0, end: null, moves: [] };
  while (r.plies < CAP) {
    const e = ending(S, hist);
    if (e) { r.end = e; break; }
    const legal = E.legal(S, true);
    const m = (openRnd && r.plies < 6) ? randomMover(openRnd)(S) : (S.turn === 'w' ? pickWhite : pickBlack)(S, hist);
    r.moves.push(m.from + '-' + m.to + (m.promo || ''));
    if (!legal.some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)) r.illegal++;
    S = E.apply(S, m);
    hist.push(S);
    r.plies++;
    if (S.v !== 'c') r.tagLost++;
  }
  if (!r.end) r.end = { kind: 'ply cap', winner: null };
  return r;
}
const engine = (S, hist) => E.think(S, { ms: NEVER, maxDepth: DEPTH, history: hist }).move;
const randomMover = (rnd) => (S) => {
  const ms = E.legal(S, true), caps = ms.filter((x) => x.cap);
  return caps.length && rnd() < 0.5 ? caps[(rnd() * caps.length) | 0] : ms[(rnd() * ms.length) | 0];
};

function summarise(label, games) {
  const kinds = {}, o = { games: games.length, illegal: 0, tagLost: 0, plies: 0 };
  for (const g of games) {
    o.illegal += g.illegal; o.tagLost += g.tagLost; o.plies += g.plies;
    kinds[g.end.kind] = (kinds[g.end.kind] || 0) + 1;
  }
  o.meanPlies = +(o.plies / o.games).toFixed(1);
  o.distinctGames = new Set(games.map((g) => g.moves.join(' '))).size;
  o.endings = kinds;
  console.log('\n' + label + ': ' + o.games + ' games, mean length ' + o.meanPlies + ' plies, ' + o.distinctGames + ' distinct, illegal moves ' + o.illegal + ', tag lost ' + o.tagLost);
  console.log('  endings: ' + JSON.stringify(kinds));
  return o;
}

const out = { depth: DEPTH, cap: CAP, when: new Date().toISOString() };

const vsRandom = [];
let engWins = 0, rndWins = 0;
for (let g = 0; g < VS_RANDOM; g++) {
  const engineWhite = g % 2 === 0, rnd = mulberry32(5000 + g);
  const r = play(engineWhite ? engine : randomMover(rnd), engineWhite ? randomMover(rnd) : engine);
  if (r.end.winner) ((r.end.winner === 'w') === engineWhite ? engWins++ : rndWins++);
  vsRandom.push(r);
}
out.vsRandom = summarise('engine vs random', vsRandom);
out.vsRandom.engineWins = engWins; out.vsRandom.randomWins = rndWins;
console.log('  engine wins ' + engWins + ', random wins ' + rndWins);

const vsEngine = [];
let whiteWins = 0, blackWins = 0;
for (let g = 0; g < VS_ENGINE; g++) {
  const r = play(engine, engine, mulberry32(7000 + g));
  if (r.end.winner) (r.end.winner === 'w' ? whiteWins++ : blackWins++);
  vsEngine.push(r);
}
out.vsEngine = summarise('engine vs engine', vsEngine);
out.vsEngine.whiteWins = whiteWins; out.vsEngine.blackWins = blackWins;
console.log('  White wins ' + whiteWins + ', Black wins ' + blackWins);

const bad = out.vsRandom.illegal + out.vsRandom.tagLost + out.vsEngine.illegal + out.vsEngine.tagLost;
fs.writeFileSync(path.join(__dirname, '..', '_context', 'coriantumr-selfplay.json'), JSON.stringify(out, null, 2) + '\n');
console.log('\n' + (bad === 0 ? 'no illegal move and no lost rule-set tag in any game' : 'PROBLEM: ' + bad + ' illegal moves or lost tags'));
process.exit(bad === 0 ? 0 : 1);
