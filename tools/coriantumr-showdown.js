#!/usr/bin/env node
/*
 * coriantumr-showdown.js -- the two-piece showdown, solved exactly and used to check the engine.
 *
 * THE RULE (owner, 2026-10-07). When exactly two pieces remain, one per side, a square touched by either piece
 * since the showdown began (both starting squares included) may not be landed on again. A capture is exempt and
 * ends the game; a slide may pass over a touched square; a piece with no untouched landing square and no capture
 * has no ordinary move, so it must sacrifice itself and loses. Both pieces are 4-square sliders.
 *
 * WHY EXACT. The showdown is a finite game with no draw, so one side wins under perfect play from every position.
 * Whether that is a fair or an interesting game is a different question, and the only honest way to answer it is
 * to solve it. The full 8x8 board is too big (20 million nodes did not finish a single start), so this tool
 * (1) solves every start on 3x3, 4x4 and 5x5 boards, and (2) solves LATE showdowns on the real board, where few
 * squares are left, and compares the answer with what the engine's search says.
 *
 * INDEPENDENCE. The solver below shares no code with src/tyranny.html: its own board, its own move rule written
 * from the sentence above, forward search with a transposition table. Moving onto a square the enemy can capture
 * loses at once, so those moves are pruned; that is exact, not a heuristic.
 *
 *   node tools/coriantumr-showdown.js --small [--max 5] [--reading shared|own] [--write]
 *                                                            every start on 3x3 .. NxN boards (5x5 takes ~5 minutes);
 *                                                            --write records _context/coriantumr-showdown.json (shared reading only);
 *                                                            --reading own is the rejected reading, kept to show why
 *   node tools/coriantumr-showdown.js --check-engine [N] [--free F]
 *                                                            N late showdowns on 8x8 with at most F untouched
 *                                                            squares left (default 18; 22 takes ~30 s): engine against the solver
 */
const fs = require('fs');
const path = require('path');

const ALL8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function makeSolver(nb, ttBits) {
  const N = nb * nb;
  const RANGE = [], IN = new Uint8Array(64 * 64);
  for (let s = 0; s < 64; s++) RANGE.push([]);
  for (let s = 0; s < N; s++) {
    const r = Math.floor(s / nb), c = s % nb;
    for (const [dr, dc] of ALL8) {
      for (let k = 1; k <= 4; k++) {
        const nr = r + dr * k, nc = c + dc * k;
        if (nr < 0 || nr >= nb || nc < 0 || nc >= nb) break;
        RANGE[s].push(nr * nb + nc); IN[s * 64 + nr * nb + nc] = 1;
      }
    }
  }
  const TT = 1 << (ttBits || 22);
  const ttLo = new Int32Array(TT), ttHi = new Int32Array(TT), ttMo = new Int16Array(TT).fill(-1), ttVal = new Int8Array(TT);
  let nodes = 0, limit = Infinity;
  class Over extends Error {}
  const has = (lo, hi, s) => (s < 32 ? (lo >>> s) & 1 : (hi >>> (s - 32)) & 1);
  function slot(lo, hi, mo) {
    let h = Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((hi + mo) | 0, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
    return h & (TT - 1);
  }
  /* Does the side to move (on m, enemy on o, touched set lo/hi) win? */
  function win(m, o, lo, hi) {
    if (++nodes > limit) throw new Over();
    if (IN[m * 64 + o]) return true;                              // it can capture
    const mo = m * 64 + o, i = slot(lo, hi, mo);
    if (ttMo[i] === mo && ttLo[i] === lo && ttHi[i] === hi) return ttVal[i] === 1;
    let res = false;
    const cand = RANGE[m];
    for (let k = 0; k < cand.length && !res; k++) {
      const x = cand[k];
      if (has(lo, hi, x) || IN[o * 64 + x]) continue;             // touched, or the enemy captures it there
      const nlo = x < 32 ? lo | (1 << x) : lo, nhi = x < 32 ? hi : hi | (1 << (x - 32));
      if (!win(o, x, nlo, nhi)) res = true;
    }
    ttMo[i] = mo; ttLo[i] = lo; ttHi[i] = hi; ttVal[i] = res ? 1 : 2;     // no safe move at all means it loses
    return res;
  }
  return {
    IN,
    /* The REJECTED reading: each piece may not re-enter its OWN touched squares, but the other piece's old squares stay
       usable. Kept so the README can say why it was not built (the side to move loses every start on 3x3 and 4x4). */
    solveOwn(m, o, nodeLimit) {
      const memo = new Map();
      let n = 0;
      function winOwn(a, b, va, vb) {                                // a to move on its square, b the enemy; va/vb BigInt sets
        if (++n > nodeLimit) throw new Over();
        if (IN[a * 64 + b]) return true;
        const key = a + ',' + b + ',' + va + ',' + vb;
        const hit = memo.get(key); if (hit !== undefined) return hit;
        let res = false;
        for (const x of RANGE[a]) {
          if ((va >> BigInt(x)) & 1n) continue;                      // its own square, already touched
          if (x === b || IN[b * 64 + x]) continue;                   // the enemy's square, or one the enemy captures
          if (!winOwn(b, x, vb, va | (1n << BigInt(x)))) { res = true; break; }
        }
        memo.set(key, res); return res;
      }
      try { return { solved: true, moverWins: winOwn(m, o, 1n << BigInt(m), 1n << BigInt(o)), nodes: n }; }
      catch (e) { if (e instanceof Over) return { solved: false, nodes: n }; throw e; }
    },
    /* touched: array of squares (must include m and o). Returns {solved, moverWins, nodes}. */
    solve(m, o, touched, nodeLimit) {
      nodes = 0; limit = nodeLimit || Infinity; ttMo.fill(-1);
      let lo = 0, hi = 0;
      for (const s of touched) { if (s < 32) lo |= 1 << s; else hi |= 1 << (s - 32); }
      try { return { solved: true, moverWins: win(m, o, lo, hi), nodes }; }
      catch (e) { if (e instanceof Over) return { solved: false, nodes }; throw e; }
    },
  };
}

// ------------------------------------------------------------------------------------------ small boards
function small(maxBoard, reading) {
  const rows = [];
  for (let nb = 3; nb <= maxBoard; nb++) {
    const sv = makeSolver(nb, nb >= 5 ? 24 : 20);
    let starts = 0, wins = 0, losses = 0, unsolved = 0, maxNodes = 0;
    const t0 = Date.now();
    for (let m = 0; m < nb * nb; m++) for (let o = 0; o < nb * nb; o++) {
      if (m === o || sv.IN[m * 64 + o]) continue;                  // a start where the mover can already capture is not a duel
      starts++;
      const r = reading === 'own' ? sv.solveOwn(m, o, 4e8) : sv.solve(m, o, [m, o], 4e8);
      maxNodes = Math.max(maxNodes, r.nodes);
      if (!r.solved) unsolved++; else if (r.moverWins) wins++; else losses++;
    }
    const row = { reading: reading || 'shared', board: nb + 'x' + nb, starts, sideToMoveWins: wins, sideToMoveLoses: losses, unsolved, maxNodes,
                  seconds: Math.round((Date.now() - t0) / 100) / 10 };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  return rows;
}

// -------------------------------------------------------------------------------- engine against the solver
function checkEngine(count, maxFree) {
  const E = require(path.join(__dirname, '..', 'tests', 'engine.js'));
  const sv = makeSolver(8, 22);
  const sqIdx = (n) => n;                                          // both use row * 8 + column on the 8x8 board
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const reset = () => { E.ai.gameKeys = new Set(); E.ai.path = []; E.ai.killers = []; E.ai.hist = {}; E.ai.depthDone = 1; E.ai.deadline = Infinity; E.ai.aborted = false; E.ai.selfCap = true; E.ai.cp = E.CPC; };
  const blank = () => new Array(64).fill(null);
  const base = (bd, turn) => ({ b: bd, turn, cast: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1, v: 'c' });
  const positions = [];                                            // {S, own, byCapture}
  for (let g = 0; positions.length < count && g < 4000; g++) {
    const rnd = mulberry32(9000 + g);
    const byCapture = g % 2 === 1;
    let S = null, own = null;
    while (!S) {
      const a = (rnd() * 64) | 0, b = (rnd() * 64) | 0, c = (rnd() * 64) | 0;
      if (a === b || (byCapture && (c === a || c === b))) continue;
      const bd = blank(); bd[a] = 'wk'; bd[b] = 'bk';
      if (!byCapture) {                                            // two pieces from the start, nothing capturable
        const cand = base(bd, 'w');
        if (!E.legal(cand, true).some((m) => m.cap)) { S = cand; own = [a, b]; }
      } else {                                                     // White king and knight against Black's king, Black to move:
        bd[c] = 'wn';                                              // Black takes the knight, which begins the showdown by a capture
        const cand = base(bd, 'b');
        const takes = E.legal(cand, true).filter((m) => m.cap === 'wn');
        const kingSafe = !E.legal(cand, true).some((m) => m.cap === 'wk');
        if (takes.length && kingSafe) { S = E.apply(cand, takes[0]); own = [a, S.b.indexOf('bk')]; }
      }
    }
    const hist = [S];
    for (let ply = 0; ply < 70; ply++) {
      const ms = E.legal(S, true);
      if (!ms.length) break;
      let m;
      if (rnd() < 0.7) { reset(); m = E.think(S, { ms: 1e9, maxDepth: 2, history: hist }).move; }
      else m = ms[(rnd() * ms.length) | 0];
      if (!m.sac) own = own.concat([m.to]);                        // the tool's own record of every square touched
      S = E.apply(S, m); hist.push(S);
      if (!E.hasPieces(S, 'w') || !E.hasPieces(S, 'b')) break;
      const free = 64 - S.sd.length;
      if (free <= maxFree && free >= 4 && !E.legal(S, true).some((x) => x.cap)) positions.push({ S, own: own.slice(), byCapture });
    }
  }
  const picked = positions.slice(0, count);
  let agree = 0, differ = 0, unsolved = 0, undecided = 0, wins = 0, maxNodes = 0, touchedDrift = 0, byCaptureCount = 0;
  for (const { S, own, byCapture } of picked) {
    if (byCapture) byCaptureCount++;
    if (new Set(S.sd).size !== S.sd.length || S.sd.length !== own.length || S.sd.slice().sort((x, y) => x - y).join() !== own.slice().sort((x, y) => x - y).join()) touchedDrift++;
    const m = S.b.indexOf(S.turn + 'k') >= 0 ? S.b.indexOf(S.turn + 'k') : S.b.indexOf(S.turn + 'q');
    const o = S.b.findIndex((p) => p && p[0] !== S.turn);
    const exact = sv.solve(sqIdx(m), sqIdx(o), S.sd.map(sqIdx), 5e7);
    maxNodes = Math.max(maxNodes, exact.nodes);
    if (!exact.solved) { unsolved++; continue; }
    reset();
    const score = E.search(S, 64 - S.sd.length + 3, -Infinity, Infinity, 0);
    const engineWins = score >= E.MATE - 200, engineLoses = score <= -E.MATE + 200;
    if (!engineWins && !engineLoses) { undecided++; continue; }
    if (engineWins === exact.moverWins) agree++; else { differ++; console.log('DIFFER: engine ' + (engineWins ? 'wins' : 'loses') + ', solver ' + (exact.moverWins ? 'wins' : 'loses') + ', touched ' + S.sd.length); }
    if (exact.moverWins) wins++;
  }
  const result = { positions: picked.length, beganByCapture: byCaptureCount, agree, differ, undecided, unsolved, touchedDrift,
                   moverWins: wins, moverLoses: agree + differ - wins, maxNodes };
  console.log(JSON.stringify(result));
  return result;
}

function main() {
  const a = process.argv.slice(2);
  if (a.includes('--small')) {
    const i = a.indexOf('--max');
    const rd = a.indexOf('--reading');
    const rows = small(i >= 0 ? Number(a[i + 1]) : 4, rd >= 0 ? a[rd + 1] : 'shared');
    if (!a.includes('--write') || a.includes('--reading')) return 0;
    const out = path.join(__dirname, '..', '_context', 'coriantumr-showdown.json');
    const rec = { tool: 'tools/coriantumr-showdown.js', rule: 'two pieces, touched squares cannot be landed on again, captures exempt, slides may pass over touched squares, a piece with no move loses',
                  covers: 'every start where neither piece can capture the other at once, on boards of the given size; the 8x8 board is NOT solved', results: rows };
    fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n', 'utf8');
    console.log('wrote ' + path.relative(process.cwd(), out));
    return 0;
  }
  if (a.includes('--check-engine')) {
    const i = a.indexOf('--check-engine');
    const n = Number(a[i + 1]) || 250;
    const f = a.indexOf('--free');
    const r = checkEngine(n, f >= 0 ? Number(a[f + 1]) : 18);
    return (r.differ === 0 && r.undecided === 0 && r.touchedDrift === 0 && r.positions >= Math.min(n, 200)) ? 0 : 1;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
  return 2;
}
process.exitCode = main();      // not process.exit(): that can cut off output a test is reading through a pipe
