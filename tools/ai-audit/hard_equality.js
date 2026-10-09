'use strict';
/*
 * hard_equality.js - is Hard bit-for-bit unchanged? Runs the engine as it was at commit 69f47e2 (saved at
 * _context/ai-audit/engine-baseline-69f47e2.js) and the engine as it is now on the same positions, called exactly as the
 * page calls Hard (no temp, no mop), at pinned depths so the clock never decides, and compares the move, the score, the
 * depth reached and the node count. Equal node counts mean the searches visited the same tree.
 *
 *   node tools/ai-audit/hard_equality.js SHARD NSHARDS     one slice of the 478 audit positions plus Coriantumr positions
 *   node tools/ai-audit/hard_equality.js SHARD NSHARDS control    the same, but the new engine is given temp 100: it MUST report mismatches,
 *                                                       which shows the comparison is able to see a difference
 *   (run all shards and read the totals: tools/ai-audit/hard_equality_all.sh)
 */
const fs = require('fs');
const path = require('path');
const OLD = require(path.join(__dirname, '..', '..', '_context', 'ai-audit', 'engine-baseline-69f47e2.js'));
const NEW = require(path.join(__dirname, '..', '..', 'tests', 'engine.js'));

const shard = +process.argv[2] || 0, nshards = +process.argv[3] || 1, control = process.argv[4] === 'control';
const positions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '_context', 'ai-audit', 'positions.json'), 'utf8')).positions;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const jobs = [];
positions.forEach((p, i) => { if (i % nshards === shard) jobs.push({ kind: 'standard', fen: p.fen, depths: [3, 4, 5] }); });
// Coriantumr positions: seeded random playouts from the variant start
const rnd = mulberry32(555);
for (let g = 0; g < 40; g++) {
  let S = NEW.startState('c');
  const hist = [S];
  for (let ply = 0; ply < 6 + g; ply++) {
    const ms = NEW.legal(S, true);
    if (!ms.length) break;
    S = NEW.apply(S, ms[(rnd() * ms.length) | 0]);
  }
  if (g % nshards === shard) jobs.push({ kind: 'coriantumr', moves: null, state: S, depths: [3, 4] });
}

function same(a, b) {
  return a.move.from === b.move.from && a.move.to === b.move.to && a.move.promo === b.move.promo && a.move.kind === b.move.kind &&
    a.score === b.score && a.depth === b.depth && a.nodes === b.nodes;
}

let checked = 0;
const mism = [];
for (const j of jobs) {
  for (const selfCap of (j.kind === 'standard' ? [false, true] : [true])) {
    for (const d of j.depths) {
      const s1 = j.fen ? OLD.fen(j.fen) : JSON.parse(JSON.stringify(j.state));
      const s2 = j.fen ? NEW.fen(j.fen) : JSON.parse(JSON.stringify(j.state));
      const a = OLD.think(s1, { ms: 1e9, maxDepth: d, selfCap, history: [s1] });
      const b = NEW.think(s2, { ms: 1e9, maxDepth: d, selfCap, history: [s2], temp: control ? 100 : undefined, seed: control ? 1000 + checked : 7, mop: undefined });   // the control varies the seed: one fixed seed draws the same number every time and can pick the best move everywhere
      checked++;
      if (!a || !b || !same(a, b)) mism.push({ fen: j.fen || 'coriantumr', selfCap, depth: d, old: a && { m: a.move.from + '-' + a.move.to, s: a.score, n: a.nodes }, now: b && { m: b.move.from + '-' + b.move.to, s: b.score, n: b.nodes } });
    }
  }
}
console.log(JSON.stringify({ shard, checked, mismatches: mism.length, examples: mism.slice(0, 3) }));
