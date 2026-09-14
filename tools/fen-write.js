/*
 * fen-write.js — the inverse of the engine's fen() parser.
 *
 * The engine could always READ a FEN; nothing could write one, so a generated
 * position had no way to be stored. This closes that.
 *
 * Verified, not assumed: `node tools/fen-write.js --verify [games]` runs a
 * round trip over real playout positions and checks BOTH directions —
 *   toFen(fen(s)) === s          the string survives
 *   fen(toFen(S)) deep-equals S  the state survives
 * The second is the one that matters. A writer that drops the en-passant square
 * or a castling right still passes the first on most positions, because most
 * positions have neither.
 */
const path = require('path');
const E = require('./../tests/engine.js');
const { idx, sqName, fen, legal, apply, startState, rOf, cOf } = E;

const LET = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

function toFen(S) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '', e = 0;
    for (let c = 0; c < 8; c++) {
      const p = S.b[idx(r, c)];
      if (!p) { e++; continue; }
      if (e) { row += e; e = 0; }
      const ch = LET[p[1]];
      row += p[0] === 'w' ? ch.toUpperCase() : ch;
    }
    if (e) row += e;
    rows.push(row);
  }
  const cs = ((S.cast.K ? 'K' : '') + (S.cast.Q ? 'Q' : '') +
              (S.cast.k ? 'k' : '') + (S.cast.q ? 'q' : '')) || '-';
  return rows.join('/') + ' ' + S.turn + ' ' + cs + ' ' +
         (S.ep >= 0 ? sqName(S.ep) : '-') + ' ' + S.half + ' ' + S.full;
}

module.exports = { toFen };

/* ------------------------------ verification ------------------------------ */

function stateDiff(A, B) {
  const d = [];
  for (let i = 0; i < 64; i++) if ((A.b[i] || null) !== (B.b[i] || null)) d.push('square ' + sqName(i) + ': ' + A.b[i] + ' vs ' + B.b[i]);
  if (A.turn !== B.turn) d.push('turn ' + A.turn + ' vs ' + B.turn);
  for (const k of ['K', 'Q', 'k', 'q']) if (!!A.cast[k] !== !!B.cast[k]) d.push('cast.' + k + ' ' + A.cast[k] + ' vs ' + B.cast[k]);
  if (A.ep !== B.ep) d.push('ep ' + A.ep + ' vs ' + B.ep);
  if (A.half !== B.half) d.push('half ' + A.half + ' vs ' + B.half);
  if (A.full !== B.full) d.push('full ' + A.full + ' vs ' + B.full);
  return d;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (require.main === module) {
  const games = parseInt(process.argv[3] || '400', 10);
  const rnd = mulberry32(20260914);
  let positions = 0, strFail = 0, stateFail = 0;
  const withEp = { n: 0, bad: 0 }, withCast = { n: 0, bad: 0 }, withHalf = { n: 0, bad: 0 };
  const samples = [];

  for (let g = 0; g < games; g++) {
    let S = startState();
    for (let ply = 0; ply < 160; ply++) {
      positions++;
      const s1 = toFen(S);
      const back = fen(s1);
      const s2 = toFen(back);
      const diff = stateDiff(S, back);

      if (S.ep >= 0) { withEp.n++; if (diff.length) withEp.bad++; }
      if (S.cast.K || S.cast.Q || S.cast.k || S.cast.q) { withCast.n++; if (diff.length) withCast.bad++; }
      if (S.half > 0) { withHalf.n++; if (diff.length) withHalf.bad++; }

      if (s1 !== s2) { strFail++; if (samples.length < 5) samples.push('STRING ' + s1 + '  ->  ' + s2); }
      if (diff.length) { stateFail++; if (samples.length < 5) samples.push('STATE  ' + s1 + '  ::  ' + diff.join(', ')); }

      const ms = legal(S, true);
      if (!ms.length) break;
      S = apply(S, ms[(rnd() * ms.length) | 0]);
    }
  }

  console.log('positions round-tripped : ' + positions.toLocaleString());
  console.log('string mismatches       : ' + strFail);
  console.log('state mismatches        : ' + stateFail);
  console.log('  of which carried ep   : ' + withEp.bad + ' bad of ' + withEp.n.toLocaleString() + ' positions with an ep square');
  console.log('  of which had castling : ' + withCast.bad + ' bad of ' + withCast.n.toLocaleString() + ' positions with a castling right');
  console.log('  of which had half>0   : ' + withHalf.bad + ' bad of ' + withHalf.n.toLocaleString() + ' positions with a nonzero halfmove clock');
  if (samples.length) { console.log('\nsamples:'); samples.forEach(function (s) { console.log('  ' + s); }); }
  const ok = strFail === 0 && stateFail === 0 && withEp.n > 0 && withCast.n > 0 && withHalf.n > 0;
  console.log('\n' + (ok ? 'ROUND TRIP CLEAN, and all three risk classes were actually exercised'
                        : 'PROBLEM: either a mismatch, or a risk class never occurred (so it is untested)'));
  process.exit(ok ? 0 : 1);
}
