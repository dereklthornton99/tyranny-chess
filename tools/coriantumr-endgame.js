#!/usr/bin/env node
/*
 * coriantumr-endgame.js -- can the last capture be FORCED?
 *
 * Coriantumr is won by capturing every enemy piece, and the last piece on a side is always a king or queen,
 * which both slide up to 4 squares. Whether "last man standing" can be reached at all depends on whether a few
 * pieces can trap a lone 4-square slider. Nobody knew, so this measures it instead of guessing.
 *
 * METHOD. Retrograde analysis ("work backwards from the wins"). The attackers hold two pieces (a 4-square slider S
 * plus a second piece X) or one; the defender holds a lone S. A position is a forced win for the attackers in 1
 * ply if they can capture; an attacker-to-move position wins in n plies if some move reaches a defender-to-move
 * position that loses in n-1; a defender-to-move position loses in n plies if EVERY defender move, including
 * capturing an attacker, reaches a position the attackers win in n-1 or fewer. Levels are processed in order, so
 * every value is the true minimum number of plies, not an upper bound.
 *
 * CAPTURING AN ATTACKER MATTERS. When the defender captures one, the survivor is no longer a pair: if it is not a
 * king or queen the succession rule crowns it (a lone rook becomes a king), so the position falls to the one-piece
 * table "S against S". That is exactly what the engine does, and --self-test checks it.
 *
 * WHAT IT DOES NOT COVER, stated up front: pawns (a pawn that promotes becomes a slider, so it reduces to these
 * tables plus a race), three or more attackers, and positions a real game might never reach. The counts are over ALL
 * legal placements, not over positions that arise in play. Repetition and the 50-move rule are not applied: this
 * reports what is forceable, not what the draw rules would allow.
 *
 *   node tools/coriantumr-endgame.js                 solve and write _context/coriantumr-endgame.json
 *   node tools/coriantumr-endgame.js --self-test     check the move generator and succession against the engine
 */
const fs = require('fs');
const path = require('path');

const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ALL8 = DIAG.concat(ORTH);
const FILES = 'abcdefgh';
const name = (s) => FILES[s & 7] + (8 - (s >> 3));

/* RAYS[type][square] = list of rays, each a list of squares in order outward. Same indexing as the engine
   (square = row*8 + column, row 0 = rank 8). 'S' is the 4-square slider, i.e. the king and the queen. */
function buildRays(type) {
  const table = [];
  for (let sq = 0; sq < 64; sq++) {
    const r = sq >> 3, c = sq & 7, rays = [];
    if (type === 'N') {
      for (const [dr, dc] of KN) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) rays.push(Int8Array.of(nr * 8 + nc));
      }
    } else {
      const dirs = type === 'S' ? ALL8 : type === 'R' ? ORTH : DIAG;
      const reach = type === 'S' ? 4 : 7;
      for (const [dr, dc] of dirs) {
        const ray = [];
        for (let k = 1; k <= reach; k++) {
          const nr = r + dr * k, nc = c + dc * k;
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) break;
          ray.push(nr * 8 + nc);
        }
        if (ray.length) rays.push(Int8Array.from(ray));
      }
    }
    table.push(rays);
  }
  return table;
}
const RAYS = { S: buildRays('S'), R: buildRays('R'), B: buildRays('B'), N: buildRays('N') };

/* Does the attacker piece of `type` on `from` attack `target`, given the one other attacker square `other`? */
function attacks(type, from, target, other) {
  const rays = RAYS[type][from];
  for (let r = 0; r < rays.length; r++) {
    const ray = rays[r];
    for (let q = 0; q < ray.length; q++) {
      const sq = ray[q];
      if (sq === target) return true;
      if (sq === other) break;
    }
  }
  return false;
}

function solve(types, subVal) {
  const k = types.length;
  const idx = k === 1
    ? (t, a0, a1, d) => (t * 64 + a0) * 64 + d
    : (t, a0, a1, d) => ((t * 64 + a0) * 64 + a1) * 64 + d;
  const val = new Int16Array(2 * Math.pow(64, k + 1));
  const list = [];
  for (let t = 0; t < 2; t++) {
    for (let a0 = 0; a0 < 64; a0++) {
      for (let a1 = 0; a1 < (k === 2 ? 64 : 1); a1++) {
        if (k === 2 && a1 === a0) continue;
        for (let d = 0; d < 64; d++) {
          if (d === a0 || (k === 2 && d === a1)) continue;
          list.push(t, a0, k === 2 ? a1 : 0, d);
        }
      }
    }
  }
  const L = Int16Array.from(list);
  const n = L.length / 4;
  let maxSub = 0;
  if (subVal) for (let i = 0; i < subVal.length; i++) if (subVal[i] > maxSub) maxSub = subVal[i];

  function attackerWins(a0, a1, d, level) {
    for (let i = 0; i < k; i++) {
      const rays = RAYS[types[i]][i === 0 ? a0 : a1];
      const other = k === 2 ? (i === 0 ? a1 : a0) : -1;
      for (let r = 0; r < rays.length; r++) {
        const ray = rays[r];
        for (let q = 0; q < ray.length; q++) {
          const sq = ray[q];
          if (sq === d) return level === 1;                 // capture the defender: the game is over
          if (sq === other) break;                          // own piece blocks the ray
          if (level > 1) {
            const v = val[i === 0 ? idx(1, sq, a1, d) : idx(1, a0, sq, d)];
            if (v > 0 && v <= level - 1) return true;
          }
        }
      }
    }
    return false;
  }

  /* Returns the value the defender-to-move position loses in, or 0 if some defender move escapes. */
  function defenderLoses(a0, a1, d, level) {
    const rays = RAYS.S[d];
    let max = 0;
    for (let r = 0; r < rays.length; r++) {
      const ray = rays[r];
      for (let q = 0; q < ray.length; q++) {
        const sq = ray[q];
        if (sq === a0 || (k === 2 && sq === a1)) {
          if (k === 1) return 0;                            // the defender captured the last attacker: it has won
          const survivor = sq === a0 ? a1 : a0;
          const v = subVal[(0 * 64 + survivor) * 64 + sq];  // S against S, attackers to move (a survivor is crowned)
          if (!(v > 0 && v <= level)) return 0;
          if (v > max) max = v;
          break;
        }
        const v = val[idx(0, a0, a1, sq)];
        if (!(v > 0 && v <= level)) return 0;
        if (v > max) max = v;
      }
    }
    return max ? max + 1 : 0;
  }

  let level = 1;
  for (;;) {
    let changed = 0;
    for (let s = 0; s < n; s++) {
      if (L[s * 4] !== 0) continue;
      const a0 = L[s * 4 + 1], a1 = L[s * 4 + 2], d = L[s * 4 + 3];
      const i = idx(0, a0, a1, d);
      if (!val[i] && attackerWins(a0, a1, d, level)) { val[i] = level; changed++; }
    }
    for (let s = 0; s < n; s++) {
      if (L[s * 4] !== 1) continue;
      const a0 = L[s * 4 + 1], a1 = L[s * 4 + 2], d = L[s * 4 + 3];
      const i = idx(1, a0, a1, d);
      if (!val[i]) { const v = defenderLoses(a0, a1, d, level); if (v) { val[i] = v; changed++; } }
    }
    if (!changed && level > maxSub + 2) break;
    level += 2;
    if (level > 400) throw new Error('did not converge by 400 plies');
  }
  return { val, idx, list: L, n, passes: (level + 1) / 2 };
}

function summarise(types, sol) {
  const { val, idx, list: L, n } = sol;
  const k = types.length;
  const row = { pieces: types.join('+') + ' against S', attackerToMove: { positions: 0, forcedWins: 0 },
                defenderToMove: { positions: 0, forcedWins: 0 }, longestWinPlies: 0, winsNeedingMoreThan50Moves: 0,
                winsByPlies: {}, defenderLossExamples: [],
                longestExample: null };
  let longest = 0, example = null;
  for (let s = 0; s < n; s++) {
    const t = L[s * 4], a0 = L[s * 4 + 1], a1 = L[s * 4 + 2], d = L[s * 4 + 3];
    if (k === 2 && types[0] === types[1] && a0 > a1) continue;   // two identical pieces: (x, y) and (y, x) are ONE position
    const side = t === 0 ? row.attackerToMove : row.defenderToMove;
    side.positions++;
    const v = val[idx(t, a0, a1, d)];
    if (v > 0) {
      row.winsByPlies[v] = (row.winsByPlies[v] || 0) + 1;
      if (t === 1 && row.defenderLossExamples.length < 20) {
        row.defenderLossExamples.push(types.map((ty, i) => ty + '@' + name(i === 0 ? a0 : a1)).join(' ') +
                                      ' vs S@' + name(d) + ' (' + v + ' plies)');
      }
      side.forcedWins++;
      if (v > 100) row.winsNeedingMoreThan50Moves++;
      if (v > longest) {
        longest = v;
        example = { toMove: t === 0 ? 'attackers' : 'defender',
                    attackers: types.map((ty, i) => ty + '@' + name(i === 0 ? a0 : a1)).join(' '),
                    defender: 'S@' + name(d), plies: v };
      }
    }
  }
  row.longestWinPlies = longest;
  row.longestExample = example;
  return row;
}

// ------------------------------------------------------------------ cross-check against the engine
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function selfTest() {
  const E = require(path.join(__dirname, '..', 'tests', 'engine.js'));
  const rnd = mulberry32(20261007);
  const sets = [['S'], ['S', 'S'], ['S', 'R'], ['S', 'B'], ['S', 'N']];
  const code = { S: ['wq', 'wk'], R: ['wr'], B: ['wb'], N: ['wn'] };
  let checked = 0, moveBad = 0, crownChecked = 0, crownBad = 0, captureChecked = 0, captureBad = 0;
  for (let trial = 0; trial < 6000; trial++) {
    const types = sets[trial % sets.length];
    const sqs = [];
    while (sqs.length < types.length + 1) {
      const s = (rnd() * 64) | 0;
      if (sqs.indexOf(s) < 0) sqs.push(s);
    }
    const turn = trial % 2;                                  // 0 attackers to move, 1 defender
    const b = new Array(64).fill(null);
    const used = { S: 0 };
    types.forEach((ty, i) => { b[sqs[i]] = ty === 'S' ? code.S[used.S++] : code[ty][0]; });
    const d = sqs[types.length];
    b[d] = 'bk';
    const S = { b, turn: turn === 0 ? 'w' : 'b', cast: { K: false, Q: false, k: false, q: false },
                ep: -1, half: 0, full: 1, v: 'c' };
    const engine = E.legal(S, true).map((m) => m.from * 64 + m.to).sort((x, y) => x - y);
    const mine = [];
    if (turn === 0) {
      types.forEach((ty, i) => {
        const from = sqs[i], other = types.length === 2 ? sqs[1 - i] : -1;
        for (const ray of RAYS[ty][from]) {
          for (const sq of ray) {
            if (sq === other) break;
            mine.push(from * 64 + sq);
            if (sq === d) break;
          }
        }
      });
    } else {
      for (const ray of RAYS.S[d]) {
        for (const sq of ray) {
          mine.push(d * 64 + sq);
          if (sqs.slice(0, types.length).indexOf(sq) >= 0) break;
        }
      }
    }
    mine.sort((x, y) => x - y);
    checked++;
    if (engine.join() !== mine.join()) moveBad++;
    if (turn === 1 && types.length === 2) {                  // the defender captures an attacker: who is crowned?
      for (const m of E.legal(S, true)) {
        if (!m.cap) continue;
        const T = E.apply(S, m);
        const survivors = T.b.map((p, i) => [p, i]).filter(([p]) => p && p[0] === 'w');
        const expectType = 'S';                              // the survivor is, or is crowned to, a king
        crownChecked++;
        if (survivors.length !== 1 || !(survivors[0][0][1] === 'k' || survivors[0][0][1] === 'q') ||
            expectType !== 'S') crownBad++;
      }
    }
    if (turn === 0) {                                        // the attackers capture the defender: it has no pieces
      for (const m of E.legal(S, true)) {
        if (m.to !== d) continue;
        captureChecked++;
        if (E.hasPieces(E.apply(S, m), 'b') || E.legal(E.apply(S, m), true).length !== 0) captureBad++;
      }
    }
  }
  console.log('move generation: ' + checked + ' positions compared with the engine, ' + moveBad + ' differ');
  console.log('succession: ' + crownChecked + ' defender captures, survivor is a king or queen in all but ' + crownBad);
  console.log('last piece: ' + captureChecked + ' captures of the defender, ' + captureBad + ' left it with pieces or moves');
  return moveBad + crownBad + captureBad === 0 && checked > 0 && crownChecked > 0 && captureChecked > 0 ? 0 : 1;
}

// ------------------------------------------------------------------------------------------- main
function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const t0 = Date.now();
  const one = solve(['S'], null);
  const subVal = one.val;
  const rows = [summarise(['S'], one)];
  console.log('solved S against S in ' + one.passes + ' passes');
  for (const second of ['S', 'R', 'B', 'N']) {
    const types = ['S', second];
    const s0 = Date.now();
    const sol = solve(types, subVal);
    const row = summarise(types, sol);
    rows.push(row);
    console.log('solved ' + types.join('+') + ' against S in ' + sol.passes + ' passes, ' +
                ((Date.now() - s0) / 1000).toFixed(1) + 's');
  }
  console.log('');
  console.log('attackers'.padEnd(14) + 'to move: wins / positions'.padEnd(34) + 'defender to move: wins / positions'.padEnd(38) + 'longest win');
  for (const r of rows) {
    const a = r.attackerToMove, d = r.defenderToMove;
    console.log(r.pieces.replace(' against S', '').padEnd(14) +
      (a.forcedWins + ' / ' + a.positions).padEnd(34) + (d.forcedWins + ' / ' + d.positions).padEnd(38) +
      (r.longestWinPlies ? Math.ceil(r.longestWinPlies / 2) + ' moves (' + r.longestWinPlies + ' plies)' : 'none'));
  }
  const record = {
    tool: 'tools/coriantumr-endgame.js',
    what: 'Retrograde analysis: which small endings can force the capture of a lone 4-square king or queen.',
    covers: 'ALL legal placements of the pieces, not positions that arise in play; no pawns; at most two attackers; ' +
            'no repetition or 50-move rule applied (forceable, not allowed-by-the-draw-rules).',
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    results: rows,
  };
  const out = path.join(__dirname, '..', '_context', 'coriantumr-endgame.json');
  const text = JSON.stringify(record, null, 2) + '\n';
  JSON.parse(text);
  fs.writeFileSync(out, text, 'utf8');
  console.log('\nwrote ' + path.relative(process.cwd(), out) + ' in ' + record.seconds + 's');
  return 0;
}

process.exit(main());
