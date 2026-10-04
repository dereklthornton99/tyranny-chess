/*
 * line.js — the continuation a multi-move puzzle is played through.
 *
 *   node tools/line.js --self-test
 *
 * WHY THIS EXISTS. The multistep family was generated, validated and shipped as
 * a family of forced mates in two, and every one of them really is one -- but
 * the record carried a single move in `solutions` and nothing after it, so the
 * page judged that move correct and ended the puzzle. The data was right; there
 * was nowhere to put the rest of the line. Derek, 2026-10-02: "Some of the ones
 * that are in the app already say that they are multistep but are only one
 * step."
 *
 * WHAT A LINE IS. An ordered list of steps, alternating solver / opponent,
 * starting with the solver:
 *
 *   { "plies": 3, "steps": [
 *       { "side": "solver",   "accept": ["h7h5"], "acceptSan": ["Q(x)h5+"] },
 *       { "side": "opponent", "reply": "g7g6",    "replySan": "g6", "of": 1 },
 *       { "side": "solver",   "accept": ["h5g6"], "acceptSan": ["Q(x)g6#"],
 *         "mate": true } ] }
 *
 * `accept` holds EVERY move that is correct at that point, so a player who
 * finds a different mate is not told they are wrong. `of` is how many replies
 * the opponent actually had, so the page can say "the only legal reply" about
 * one position and "one of 26" about another instead of calling both forced.
 *
 * WHY ONE OPPONENT REPLY AND NOT ALL OF THEM. A multistep puzzle's defining
 * property is that every reply loses -- that is what "forces mate" means, and
 * the predicate rejects any position where even one reply escapes. So fixing
 * one reply loses no generality: whichever the opponent picks, the player's
 * task is the same shape. Storing one turns a combinatorial tree into a line
 * the player cannot walk off, and keeps both judging and revealing an O(1)
 * lookup in the page instead of a search the page would have to grow its own
 * copy of. The claim is not taken on trust: lineFor REFUSES to emit a line
 * unless every reply has a mating answer, and tests/puzzles.js re-derives that
 * independently.
 *
 * WHICH REPLY. The one with the fewest mating answers -- the hardest for the
 * player -- tie-broken by UCI string so the same input always produces the
 * same file.
 *
 * NOT `depth`. Survival puzzles already carry `depth`, meaning the survival
 * horizon (all 153 shipped rows are depth 1). Overloading it would be exactly
 * the drift this project has been bitten by twice, so the continuation gets
 * its own field and its own name.
 *
 * ONE WRITER. This file is a library. tools/gen-puzzles.js is the only thing
 * that writes puzzles.json, and it calls lineFor() for every multistep entry it
 * builds. An earlier version of this logic was a standalone backfill tool that
 * edited puzzles.json in place; the generator knew nothing about it, so
 * regenerating the file would have silently reverted the schema and dropped
 * every line. A repo ahead of its generator is reverted by it.
 */
const fs = require('fs');
const path = require('path');
const E = require('./../tests/engine.js');
const { legal, apply, inCheck, san, sqName } = E;

const uciOf = m => sqName(m.from) + sqName(m.to) + (m.promo || '');
const byUci = (a, b) => (uciOf(a) < uciOf(b) ? -1 : uciOf(a) > uciOf(b) ? 1 : 0);

function isMate(T) { return legal(T, true).length === 0 && inCheck(T, T.turn); }

/* Derive the line for a position and the move that opens it. Returns
   { line, replies } on success or { why } on refusal, so a caller can report
   WHICH replies escaped instead of just being told "no".

   It checks the one property the whole design rests on: every opponent reply
   leaves the mover a mate-in-1. A position where even one reply escapes is not
   a forced line and no line is emitted for it. */
function lineFor(S, m1) {
  const T = apply(S, m1);
  if (isMate(T)) return { why: 'the move is itself mate-in-1, not a line' };
  const rep = legal(T, true);
  if (!rep.length) return { why: 'the opponent has no legal reply (stalemate or mate)' };

  const replies = rep.map(function (r) {
    const U = apply(T, r);
    const kills = legal(U, true).filter(function (x) { return isMate(apply(U, x)); }).sort(byUci);
    return {
      reply: uciOf(r),
      replySan: san(T, r, true),
      mates: kills.map(uciOf),
      matesSan: kills.map(function (x) { return san(U, x, true); })
    };
  });

  const gaps = replies.filter(function (r) { return !r.mates.length; });
  if (gaps.length) {
    return { why: gaps.length + ' of ' + replies.length + ' replies have no mating answer: ' +
                  gaps.slice(0, 4).map(function (r) { return r.reply; }).join(',') };
  }

  /* Hardest first, then by name. Both halves matter: fewest-mates picks the
     reply that teaches most, and the UCI tie-break is what makes the output
     reproducible rather than dependent on move-generation order. */
  const chosen = replies.slice().sort(function (a, b) {
    return a.mates.length - b.mates.length ||
           (a.reply < b.reply ? -1 : a.reply > b.reply ? 1 : 0);
  })[0];

  return {
    line: {
      plies: 3,
      steps: [
        { side: 'solver', accept: [uciOf(m1)], acceptSan: [san(S, m1, true)] },
        { side: 'opponent', reply: chosen.reply, replySan: chosen.replySan, of: replies.length },
        { side: 'solver', accept: chosen.mates, acceptSan: chosen.matesSan, mate: true }
      ]
    },
    replies: replies
  };
}

/* --------------------------------- self-test ---------------------------------
   Run against the COMMITTED data, which this file did not write: each shipped
   multistep record's line must rebuild byte for byte from its own FEN and its
   own stored answer. */
function selfTest() {
  let pass = 0, fail = 0;
  function check(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '   got ' + JSON.stringify(got) +
                (ok ? '' : ', want ' + JSON.stringify(want)));
    ok ? pass++ : fail++;
  }
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'puzzles', 'puzzles.json'), 'utf8'));
  const muls = doc.puzzles.filter(function (p) { return p.family === 'multistep' && p.line; });
  check('found committed multistep records that carry a line', muls.length > 0, true);

  let identical = 0, firstMove = 0;
  for (const p of muls) {
    const S = E.fen(p.fen);
    const m1 = legal(S, true).filter(function (x) { return uciOf(x) === p.solutionsUci[0]; })[0];
    if (!m1) continue;
    firstMove++;
    const r = lineFor(S, m1);
    if (r.line && JSON.stringify(r.line) === JSON.stringify(p.line)) identical++;
  }
  check('every stored answer is a legal move in its own position', firstMove, muls.length);
  check('every line rebuilds byte-identically from FEN + answer', identical, muls.length);

  /* Refusals, each on a position whose answer is checkable by hand. */
  const tac = doc.puzzles.filter(function (p) { return p.family === 'tactical'; })[0];
  const St = E.fen(tac.fen);
  const mateIn1 = legal(St, true).filter(function (x) { return uciOf(x) === tac.solutionsUci[0]; })[0];
  check('refuses a move that is itself mate-in-1', !!lineFor(St, mateIn1).line, false);

  const Ss = E.startState();
  const quiet = legal(Ss, true)[0];
  check('refuses a move after which some reply escapes mate', !!lineFor(Ss, quiet).line, false);

  /* Determinism, and that the field set is exactly what the page reads. */
  const p0 = muls[0], S0 = E.fen(p0.fen);
  const m0 = legal(S0, true).filter(function (x) { return uciOf(x) === p0.solutionsUci[0]; })[0];
  check('lineFor is deterministic',
        JSON.stringify(lineFor(S0, m0).line) === JSON.stringify(lineFor(E.fen(p0.fen), m0).line), true);
  const L = lineFor(S0, m0).line;
  check('three plies', L.plies, 3);
  check('sides alternate solver / opponent / solver', L.steps.map(function (s) { return s.side; }),
        ['solver', 'opponent', 'solver']);
  check('the last step is flagged mate', L.steps[2].mate, true);
  check('the reply count is recorded', typeof L.steps[1].of, 'number');

  console.log('\n== ' + pass + ' passed, ' + fail + ' failed');
  return fail ? 1 : 0;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  console.error('line.js is a library. Run with --self-test.');
  process.exit(2);
}
module.exports = { lineFor };
