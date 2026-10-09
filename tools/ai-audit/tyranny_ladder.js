'use strict';
/*
 * tyranny_ladder.js - do the tiers still order Easy < Medium < Hard under TYRANNY rules (self-capture on, the page's default)?
 * Stockfish cannot referee self-capture, so the engine's own rules judge these games: mate, stalemate, dead material, the
 * fifty-move rule and threefold repetition. The tiers are read from the page (src/tyranny.html), so what is played is what
 * ships, with every move's draw seeded. This checks ORDER only; head-to-head games between tiers overstate the size of a gap,
 * and the audit's ratings come from Stockfish games under standard rules.
 *
 *   node tools/ai-audit/tyranny_ladder.js SHARD NSHARDS     one slice of the games; tools/ai-audit/tyranny_ladder_all.sh runs six
 */
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', '..', 'tests', 'engine.js'));
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'tyranny.html'), 'utf8');
const LEVELS = (new Function('return (' + PAGE.match(/var LEVELS\s*=\s*(\{[^;]*\});/)[1] + ')'))();
const OPENINGS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '_context', 'ai-audit', 'openings.json'), 'utf8')).openings;
const shard = +process.argv[2] || 0, nshards = +process.argv[3] || 1;
const uci = (m) => E.sqName(m.from) + E.sqName(m.to) + (m.promo || '');

const PAIRS = [['medium', 'easy', 16], ['hard', 'medium', 12], ['hard', 'easy', 8]];

function play(whiteTier, blackTier, opening, seedBase) {
  let S = E.startState();
  const hist = [S];
  for (const u of opening) {
    const m = E.legal(S, true).find((x) => uci(x) === u);
    S = E.apply(S, m); hist.push(S);
  }
  for (let ply = 0; ply < 500; ply++) {
    const ms = E.legal(S, true);
    if (!ms.length) return E.inCheck(S, S.turn) ? (S.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2';
    if (E.insufficient(S.b) || S.half >= 100) return '1/2-1/2';
    const key = E.zkey(S);
    if (hist.filter((h) => E.zkey(h) === key).length >= 3) return '1/2-1/2';
    const L = LEVELS[S.turn === 'w' ? whiteTier : blackTier];
    const r = E.think(S, { ms: L.ms, maxDepth: L.depth, selfCap: true, history: hist, temp: L.temp, mop: L.mop, seed: seedBase * 1000 + ply });
    S = E.apply(S, r.move); hist.push(S);
  }
  return '1/2-1/2';
}

const results = {};
let k = 0;
for (const [a, b, n] of PAIRS) {
  const key = a + ' v ' + b;
  results[key] = { w: 0, d: 0, l: 0 };
  for (let g = 0; g < n; g++, k++) {
    if (k % nshards !== shard) continue;
    const opening = OPENINGS[(g >> 1) % OPENINGS.length];
    const aWhite = g % 2 === 0;
    const res = aWhite ? play(a, b, opening, k + 1) : play(b, a, opening, k + 1);
    const aScore = res === '1/2-1/2' ? 0.5 : ((res === '1-0') === aWhite ? 1 : 0);
    if (aScore === 1) results[key].w++; else if (aScore === 0) results[key].l++; else results[key].d++;
  }
}
console.log(JSON.stringify({ shard, results }));
