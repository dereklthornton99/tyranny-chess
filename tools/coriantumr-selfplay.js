/*
 * coriantumr-selfplay.js - plain counts for engine games under the Coriantumr rules.
 *
 *   node tools/coriantumr-selfplay.js [--vs-random N] [--vs-engine N] [--cap PLIES] [--depth D] [--showdowns N] [--showdown-depth D]
 *
 * Defaults: 100 engine-vs-random games, 20 engine-vs-engine games, 150-ply cap, depth 3, 100 showdowns at depth 3.
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
 * counts. The endings mirror the page's outcome(): the only result is a side with no pieces
 * (the other side is the last one standing). Coriantumr has no draws at all: no fifty-move
 * rule, no repetition, no stalemate; a boxed-in royal sacrifices itself, and two pieces left
 * play the showdown. The ply cap is this tool's own limit, not a rule.
 */
const fs = require('fs');
const path = require('path');
const E = require(process.env.CORI_ENGINE || './../tests/engine.js');   // CORI_ENGINE lets an experiment swap in another engine build

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
/* null while the game goes on, else {kind, winner}. Coriantumr has no draws: the only ending is a side with no pieces
   (the other side is the last one standing), and the ply cap is the harness's, not a rule. */
function ending(S) {
  const w = E.hasPieces(S, 'w'), b = E.hasPieces(S, 'b');
  if (w && b) return null;
  return { kind: 'no pieces', winner: w ? 'w' : 'b' };
}

function play(pickWhite, pickBlack, openRnd) {
  let S = E.startState('c');
  const hist = [S];
  const r = { plies: 0, illegal: 0, tagLost: 0, end: null, moves: [], showdown: false, sacrifices: 0 };
  while (r.plies < CAP) {
    const e = ending(S);
    if (e) { r.end = e; break; }
    const legal = E.legal(S, true);
    const m = (openRnd && r.plies < 6) ? randomMover(openRnd)(S) : (S.turn === 'w' ? pickWhite : pickBlack)(S, hist);
    r.moves.push(m.from + '-' + m.to + (m.promo || ''));
    if (!legal.some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)) r.illegal++;
    S = E.apply(S, m);
    hist.push(S);
    r.plies++;
    if (S.v !== 'c') r.tagLost++;
    if (S.sd) r.showdown = true;
    if (m.sac) r.sacrifices++;
  }
  if (!r.end) r.end = { kind: 'ply cap', winner: null };
  const w = S.b.filter((p) => p && p[0] === 'w').length, b = S.b.filter((p) => p && p[0] === 'b').length;
  r.final = w === 1 && b === 1 ? 'showdown (one piece each)' : (w === 1 || b === 1) && w + b > 2 && w * b > 0 ? 'a lone piece against two or more' : w * b > 0 ? 'balanced, both sides have two or more' : 'one side empty';
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
  o.reachedShowdown = games.filter((g) => g.showdown).length;
  o.sacrifices = games.reduce((n, g) => n + g.sacrifices, 0);
  o.endings = kinds;
  o.cappedWhere = {};
  for (const g of games) if (g.end.kind === 'ply cap') o.cappedWhere[g.final] = (o.cappedWhere[g.final] || 0) + 1;
  console.log('\n' + label + ': ' + o.games + ' games, mean length ' + o.meanPlies + ' plies, ' + o.distinctGames + ' distinct, ' + o.reachedShowdown + ' reached a showdown, ' + o.sacrifices + ' sacrifices, illegal moves ' + o.illegal + ', tag lost ' + o.tagLost);
  console.log('  endings: ' + JSON.stringify(kinds));
  if (Object.keys(o.cappedWhere).length) console.log('  games that hit the cap ended up as: ' + JSON.stringify(o.cappedWhere));
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

/* Showdowns: seeded two-piece starts where neither king can capture the other, engine against engine at --showdown-depth. */
const SHOWDOWNS = arg('--showdowns', 100), SD_DEPTH = arg('--showdown-depth', 3);
{
  const st = { games: 0, byCapture: 0, bySacrifice: 0, sideToMoveWins: 0, sideToMoveLoses: 0, longest: 0, plies: 0, illegal: 0, unfinished: 0 };
  for (let g = 0; g < SHOWDOWNS; g++) {
    const rnd = mulberry32(8000 + g);
    let S = null;
    while (!S) {
      const a = (rnd() * 64) | 0, b2 = (rnd() * 64) | 0;
      if (a === b2) continue;
      const bd = new Array(64).fill(null); bd[a] = 'wk'; bd[b2] = 'bk';
      const cand = { b: bd, turn: 'w', cast: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1, v: 'c' };
      if (!E.legal(cand, true).some((m) => m.cap)) S = cand;
    }
    const hist = [S];
    let n = 0, done = false;
    while (n < 100) {
      const res = E.think(S, { ms: NEVER, maxDepth: SD_DEPTH, history: hist });
      if (!E.legal(S, true).some((x) => x.from === res.move.from && x.to === res.move.to && x.promo === res.move.promo)) st.illegal++;
      const T = E.apply(S, res.move);
      n++;
      if (!E.hasPieces(T, 'w') || !E.hasPieces(T, 'b')) {
        done = true;
        res.move.sac ? st.bySacrifice++ : st.byCapture++;
        E.hasPieces(T, 'w') ? st.sideToMoveWins++ : st.sideToMoveLoses++;
        break;
      }
      S = T; hist.push(S);
    }
    if (!done) st.unfinished++;
    st.games++; st.plies += n; st.longest = Math.max(st.longest, n);
  }
  st.meanPlies = +(st.plies / st.games).toFixed(1);
  out.showdowns = Object.assign({ depth: SD_DEPTH }, st);
  console.log('\nshowdowns (engine vs engine, depth ' + SD_DEPTH + ', two kings that cannot capture each other at the start): ' + st.games + ' games');
  console.log('  ended by capture ' + st.byCapture + ', by sacrifice ' + st.bySacrifice + ', unfinished ' + st.unfinished + '; the side to move won ' + st.sideToMoveWins + ' and lost ' + st.sideToMoveLoses + '; mean length ' + st.meanPlies + ' plies, longest ' + st.longest + ', illegal moves ' + st.illegal);
}

const bad = out.vsRandom.illegal + out.vsRandom.tagLost + out.vsEngine.illegal + out.vsEngine.tagLost + out.showdowns.illegal + out.showdowns.unfinished;
fs.writeFileSync(path.join(__dirname, '..', '_context', 'coriantumr-selfplay.json'), JSON.stringify(out, null, 2) + '\n');
console.log('\n' + (bad === 0 ? 'no illegal move and no lost rule-set tag in any game' : 'PROBLEM: ' + bad + ' illegal moves or lost tags'));
process.exit(bad === 0 ? 0 : 1);
