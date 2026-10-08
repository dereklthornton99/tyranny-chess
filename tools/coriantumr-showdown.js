#!/usr/bin/env node
/*
 * coriantumr-showdown.js -- the last-piece rule in a showdown, solved exactly and used to check the engine.
 *
 * THE RULE (owner, 2026-10-07, side-specific). A side down to one piece may not land on a square that piece has stood
 * on since it became the last piece; the square it stands on counts. The opponent's squares stay available. A capture
 * is exempt and ends the game; a slide may pass over a used square. When both sides are down to one piece (the
 * showdown) both lists begin afresh. A last piece with no unused landing square and no capture has no ordinary move,
 * so it must sacrifice itself and loses. Both pieces are 4-square sliders.
 *
 * WHY EXACT. The showdown is a finite game with no draw, so one side wins under perfect play from every position.
 * Whether that is a fair or an interesting game is a different question, and the only honest way to answer it is to
 * solve it. The full 8x8 board is too big (20 million nodes did not finish a single start of the earlier shared-set
 * reading), so this tool (1) solves every start on 3x3, 4x4 and 5x5 boards, and (2) solves LATE showdowns on the real
 * board, where few squares are left, and compares the answer with what the engine's search says.
 *
 * INDEPENDENCE. The solver below shares no code with src/tyranny.html: its own board, its own move rule written from
 * the sentences above, forward search with memoisation. Moving onto a square the enemy can capture loses at once, so
 * those moves are pruned; that is exact, not a heuristic.
 *
 * TWO READINGS ARE KEPT. "own" is the owner's (each piece has its own list). "shared" is my earlier reading (one list
 * for both pieces), kept only so the README can show why the owner's differs: on small boards it is not decided by
 * who moves first.
 *
 *   node tools/coriantumr-showdown.js --small [--max 5] [--reading own|shared|both] [--write]
 *                                                            every start on 3x3 .. NxN boards; --write records
 *                                                            _context/coriantumr-showdown.json (needs --reading both)
 *   node tools/coriantumr-showdown.js --check-engine [N] [--keep K] [--budget NODES]
 *                                                            N constructed late showdowns on 8x8 (each piece keeps 2 to K
 *                                                            unused squares, default 7): the engine must report exactly the
 *                                                            number of plies the solver does; the lists the engine carries
 *                                                            through real games are checked against the tool's own
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
  class Over extends Error {}

  // ---- the shared reading (one list for both pieces): typed-array transposition table ----
  const TT = 1 << (ttBits || 22);
  const ttLo = new Int32Array(TT), ttHi = new Int32Array(TT), ttMo = new Int16Array(TT).fill(-1), ttVal = new Int8Array(TT);
  let nodes = 0, limit = Infinity;
  const has = (lo, hi, s) => (s < 32 ? (lo >>> s) & 1 : (hi >>> (s - 32)) & 1);
  function slot(lo, hi, mo) {
    let h = Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((hi + mo) | 0, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
    return h & (TT - 1);
  }
  function winShared(m, o, lo, hi) {
    if (++nodes > limit) throw new Over();
    if (IN[m * 64 + o]) return true;
    const mo = m * 64 + o, i = slot(lo, hi, mo);
    if (ttMo[i] === mo && ttLo[i] === lo && ttHi[i] === hi) return ttVal[i] === 1;
    let res = false;
    const cand = RANGE[m];
    for (let k = 0; k < cand.length && !res; k++) {
      const x = cand[k];
      if (has(lo, hi, x) || IN[o * 64 + x]) continue;
      const nlo = x < 32 ? lo | (1 << x) : lo, nhi = x < 32 ? hi : hi | (1 << (x - 32));
      if (!winShared(o, x, nlo, nhi)) res = true;
    }
    ttMo[i] = mo; ttLo[i] = lo; ttHi[i] = hi; ttVal[i] = res ? 1 : 2;
    return res;
  }

  return {
    IN,
    /* The owner's reading. a to move on its square, b the enemy; va and vb are BigInt sets of the squares each piece
       has stood on (its own square included). A landing must be outside the mover's own set; the enemy's squares are free. */
    solveOwnFrom(m, o, listM, listO, nodeLimit) {
      const memo = new Map();
      let n = 0;
      const mask = (arr) => arr.reduce((acc, q) => acc | (1n << BigInt(q)), 0n);
      function winOwn(a, b, va, vb) {
        if (++n > nodeLimit) throw new Over();
        if (IN[a * 64 + b]) return true;                              // it can capture
        const key = a + ',' + b + ',' + va + ',' + vb;
        const hit = memo.get(key); if (hit !== undefined) return hit;
        let res = false;
        for (const x of RANGE[a]) {
          if ((va >> BigInt(x)) & 1n) continue;                       // a square this piece has stood on
          if (x === b || IN[b * 64 + x]) continue;                    // the enemy's square, or one the enemy captures on
          if (!winOwn(b, x, vb, va | (1n << BigInt(x)))) { res = true; break; }
        }
        memo.set(key, res); return res;                               // no safe move at all means it loses
      }
      try { return { solved: true, moverWins: winOwn(m, o, mask(listM), mask(listO)), nodes: n }; }
      catch (e) { if (e instanceof Over || e instanceof RangeError) return { solved: false, nodes: n }; throw e; }   // RangeError: the memo table outgrew memory
    },
    solveOwn(m, o, nodeLimit) { return this.solveOwnFrom(m, o, [m], [o], nodeLimit || Infinity); },
    /* The same game with its length: > 0 means the mover wins in that many plies (the quickest win), < 0 means it
       loses in that many plies (the longest it can hold out). A capture ends the game in one ply. A move onto a square
       the enemy captures on is legal and loses in two. A mover with no legal move at all sacrifices itself and loses in
       one. These are exactly the numbers an alpha-beta search to that depth reports as +-(MATE - plies). */
    depthOwnFrom(m, o, listM, listO, nodeLimit) {
      const memo = new Map();
      let n = 0;
      const mask = (arr) => arr.reduce((acc, q) => acc | (1n << BigInt(q)), 0n);
      function val(a, b, va, vb) {
        if (++n > nodeLimit) throw new Over();
        if (IN[a * 64 + b]) return 1;
        const key = a + ',' + b + ',' + va + ',' + vb;
        const hit = memo.get(key); if (hit !== undefined) return hit;
        let bestWin = Infinity, worstLose = 0, unsafe = false;
        for (const x of RANGE[a]) {
          if ((va >> BigInt(x)) & 1n) continue;
          if (x === b) continue;
          if (IN[b * 64 + x]) { unsafe = true; continue; }          // legal, but the enemy captures it: a loss in two
          const cv = val(b, x, vb, va | (1n << BigInt(x)));
          if (cv < 0) bestWin = Math.min(bestWin, -cv + 1); else worstLose = Math.max(worstLose, cv + 1);
        }
        let res;
        if (bestWin < Infinity) res = bestWin;
        else {
          if (unsafe) worstLose = Math.max(worstLose, 2);
          res = worstLose === 0 ? -1 : -worstLose;
        }
        memo.set(key, res); return res;
      }
      try { return { solved: true, value: val(m, o, mask(listM), mask(listO)), nodes: n }; }
      catch (e) { if (e instanceof Over || e instanceof RangeError) return { solved: false, nodes: n }; throw e; }   // RangeError: the memo table outgrew memory
    },
    /* The earlier shared reading: touched is one list for both pieces (must include m and o). */
    solveShared(m, o, touched, nodeLimit) {
      nodes = 0; limit = nodeLimit || Infinity; ttMo.fill(-1);
      let lo = 0, hi = 0;
      for (const s of touched) { if (s < 32) lo |= 1 << s; else hi |= 1 << (s - 32); }
      try { return { solved: true, moverWins: winShared(m, o, lo, hi), nodes }; }
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
      const r = reading === 'shared' ? sv.solveShared(m, o, [m, o], 4e8) : sv.solveOwn(m, o, 4e8);
      maxNodes = Math.max(maxNodes, r.nodes);
      if (!r.solved) unsolved++; else if (r.moverWins) wins++; else losses++;
    }
    const row = { reading, board: nb + 'x' + nb, starts, sideToMoveWins: wins, sideToMoveLoses: losses, unsolved, maxNodes,
                  seconds: Math.round((Date.now() - t0) / 100) / 10 };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  return rows;
}

// -------------------------------------------------------------------------------- engine against the solver
/*
 * Two checks that need each other. (1) BOOKKEEPING: engine-played showdowns, from two kings and from a capture that
 * leaves one piece each, are followed move by move; at every position the lists the engine carries must equal lists
 * this tool tracked itself. (2) SEARCH: exact solving is only possible when few squares are unused, and a real game
 * ends by capture long before that, so late positions are CONSTRUCTED: take a real position and mark all but a few
 * squares as already used by each piece. Both the solver and the engine are then given the same pieces and lists; the
 * engine's search, to a depth that reaches the end, must report exactly the number of plies the solver does.
 */
function checkEngine(count, keepMax, budget) {
  const E = require(path.join(__dirname, '..', 'tests', 'engine.js'));
  const sv = makeSolver(8, 20);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const reset = () => { E.ai.gameKeys = new Set(); E.ai.path = []; E.ai.killers = []; E.ai.hist = {}; E.ai.depthDone = 1; E.ai.deadline = Infinity; E.ai.aborted = false; E.ai.selfCap = true; E.ai.cp = E.CPC; E.ai.rep = null; E.ai.gameCount = new Map(); };
  const blank = () => new Array(64).fill(null);
  const base = (bd, turn) => ({ b: bd, turn, cast: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1, v: 'c' });
  const snaps = [];                                                // {S, own: {w, b}, byCapture}
  let bookkept = 0, listDrift = 0;
  for (let g = 0; snaps.length < count * 3 && g < 3000; g++) {
    const rnd = mulberry32(9000 + g);
    const byCapture = g % 2 === 1;
    let S = null, own = null;
    while (!S) {
      const a = (rnd() * 64) | 0, b = (rnd() * 64) | 0, c = (rnd() * 64) | 0;
      if (a === b || (byCapture && (c === a || c === b))) continue;
      const bd = blank(); bd[a] = 'wk'; bd[b] = 'bk';
      if (!byCapture) {                                            // two pieces from the start, nothing capturable
        const cand = base(bd, 'w');
        if (!E.legal(cand, true).some((m) => m.cap)) { S = cand; own = { w: [a], b: [b] }; }
      } else {                                                     // White king and knight against Black's king, Black to move:
        bd[c] = 'wn';                                              // Black takes the knight, which begins the showdown by a capture
        const cand = base(bd, 'b');
        const takes = E.legal(cand, true).filter((m) => m.cap === 'wn');
        const kingSafe = !E.legal(cand, true).some((m) => m.cap === 'wk');
        if (takes.length && kingSafe) { S = E.apply(cand, takes[0]); own = { w: [a], b: [S.b.indexOf('bk')] }; }
      }
    }
    const hist = [S];
    for (let ply = 0; ply < 140; ply++) {
      const ms = E.legal(S, true);
      if (!ms.length) break;
      const sameList = (side) => { const u = E.usedSquares(S, side); return !!u && u.slice().sort((x, y) => x - y).join() === Array.from(new Set(own[side])).sort((x, y) => x - y).join(); };
      bookkept++;
      if (!sameList('w') || !sameList('b')) listDrift++;
      if (ply % 3 === 0) snaps.push({ S, own: { w: own.w.slice(), b: own.b.slice() }, byCapture });
      let m;
      if (rnd() < 0.7) { reset(); m = E.think(S, { ms: 1e9, maxDepth: 2, history: hist }).move; }
      else m = ms[(rnd() * ms.length) | 0];
      const mover = S.turn;
      if (!m.sac) own[mover] = own[mover].concat([m.to]);           // the tool's own record of every square each piece has used
      S = E.apply(S, m); hist.push(S);
      if (!E.hasPieces(S, 'w') || !E.hasPieces(S, 'b')) break;
    }
  }
  const rnd2 = mulberry32(424242);
  let agree = 0, differ = 0, unsolved = 0, trivial = 0, wins = 0, maxNodes = 0, longest = 0, compared = 0, byCaptureCount = 0;
  for (const snap of snaps) {
    if (compared >= count) break;
    const { S, byCapture } = snap;
    // keep between 2 and keepMax unused squares for each piece, chosen at random; mark the rest as used
    const lists = {};
    for (const side of ['w', 'b']) {
      const used = new Set(snap.own[side]);
      const unused = [];
      for (let q = 0; q < 64; q++) if (!used.has(q)) unused.push(q);
      const keep = 2 + Math.floor(rnd2() * (keepMax - 1));
      for (let k = unused.length - 1; k > 0; k--) { const j = Math.floor(rnd2() * (k + 1)); [unused[k], unused[j]] = [unused[j], unused[k]]; }
      const freed = new Set(unused.slice(0, Math.min(keep, unused.length)));
      lists[side] = [];
      for (let q = 0; q < 64; q++) if (!freed.has(q)) lists[side].push(q);
    }
    const mine = S.turn, theirs = mine === 'w' ? 'b' : 'w';
    const m = S.b.indexOf(mine + 'k') >= 0 ? S.b.indexOf(mine + 'k') : S.b.indexOf(mine + 'q');
    const o = S.b.findIndex((p) => p && p[0] !== mine);
    if (!lists[mine].includes(m) || !lists[theirs].includes(o)) continue;     // each piece's own square must be in its list
    const exact = sv.depthOwnFrom(m, o, lists[mine], lists[theirs], budget);
    maxNodes = Math.max(maxNodes, exact.nodes);
    if (!exact.solved) { unsolved++; continue; }
    const v = exact.value;
    if (v === 1) { trivial++; continue; }                            // the mover can simply capture: nothing to compare
    compared++;
    if (byCapture) byCaptureCount++;
    longest = Math.max(longest, Math.abs(v));
    const T = Object.assign({}, S, { lv: { w: lists.w.slice(), b: lists.b.slice() } });
    reset();
    const score = E.search(T, Math.abs(v) + 2, -Infinity, Infinity, 0);
    const want = v > 0 ? E.MATE - v : -(E.MATE - (-v));
    if (score === want) agree++; else { differ++; if (differ <= 5) console.log('DIFFER: solver says ' + v + ' plies, the engine scored ' + score + ' (expected ' + want + ')'); }
    if (v > 0) wins++;
  }
  const result = { positions: compared, beganByCapture: byCaptureCount, agree, differ, unsolved, trivial, listDrift, bookkept,
                   moverWins: wins, moverLoses: compared - wins, longestPlies: longest, maxNodes };
  console.log(JSON.stringify(result));
  return result;
}

function main() {
  const a = process.argv.slice(2);
  if (a.includes('--small')) {
    const i = a.indexOf('--max');
    const maxB = i >= 0 ? Number(a[i + 1]) : 4;
    const rd = a.indexOf('--reading');
    const reading = rd >= 0 ? a[rd + 1] : 'own';
    const readings = reading === 'both' ? ['own', 'shared'] : [reading];
    const out = {};
    // the owner's reading has far more states than the shared one: its memo table outgrows memory at 5x5, so it stops at 4x4
    for (const r of readings) out[r] = small(r === 'own' ? Math.min(maxB, 4) : maxB, r);
    if (!a.includes('--write')) return 0;
    if (reading !== 'both') { console.error('--write needs --reading both'); return 2; }
    const file = path.join(__dirname, '..', '_context', 'coriantumr-showdown.json');
    const rec = { tool: 'tools/coriantumr-showdown.js',
                  rule: 'own: each last piece may not land on a square it has stood on since it became the last piece; captures exempt, slides may pass over used squares, the opponent\'s squares stay available; a piece with no move loses. shared: one list for both pieces (my earlier reading, kept for comparison)',
                  covers: 'every start where neither piece can capture the other at once, on boards of the given size; the 8x8 board is NOT solved', own: out.own, shared: out.shared };
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', 'utf8');
    console.log('wrote ' + path.relative(process.cwd(), file));
    return 0;
  }
  if (a.includes('--check-engine')) {
    const i = a.indexOf('--check-engine');
    const n = Number(a[i + 1]) || 250;
    const f = a.indexOf('--keep');
    const bd = a.indexOf('--budget');
    const r = checkEngine(n, f >= 0 ? Number(a[f + 1]) : 7, bd >= 0 ? Number(a[bd + 1]) : 3e5);
    return (r.differ === 0 && r.listDrift === 0 && r.positions >= Math.min(n, 200)) ? 0 : 1;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
  return 2;
}
process.exitCode = main();      // not process.exit(): that can cut off output a test is reading through a pipe
