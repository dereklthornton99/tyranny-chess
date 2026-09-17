/*
 * shed-sweep.js — is a king shed ever SOUND, or is the demo a swindle?
 *
 *   node tools/shed-sweep.js [--samples N] [--games N] [--seed N] [--out path]
 *   node tools/shed-sweep.js --check "<fen>"     classify one position
 *
 * The claim under test, which the page and the README both make today:
 * "stalemate becomes reachable on purpose." The shipped demo
 * (7k/5K1n/8/8/8/Q7/8/8 b) does NOT support it — after K(x)h7 White has exactly
 * one stalemating move and exactly one mate, so the shed only draws against an
 * opponent who errs. That is a swindle, not a resource.
 *
 * WHAT COUNTS AS SOUND HERE, stated before the search rather than after:
 *
 *   NECESSARY  every ordinary move loses — after it the opponent either mates
 *              at once or forces mate within three plies. Without this clause a
 *              "sound shed" is just any drawn position with a spare piece to
 *              throw away, which proves nothing.
 *   DRAWN      after the shed the game is decided drawn by rule, by one of four
 *              mechanisms below. Not "the engine doesn't see a win" — decided.
 *
 * The four drawing mechanisms, all terminal or one ply from terminal, so each is
 * an exhaustive fact rather than a search result:
 *
 *   OPP_STALEMATE       the opponent, to move, has no legal move and no check
 *   INSUFFICIENT        the shed leaves neither side able to mate
 *   FORCED_STALEMATE    EVERY opponent reply stalemates the shedder
 *   FORCED_INSUFFICIENT EVERY opponent reply leaves insufficient material
 *
 * Deliberately depth-free, like the puzzle predicates: legal(), apply(),
 * inCheck() and insufficient() only. think() is not used and must not be — its
 * root loop raises alpha as it goes, so its per-move values are upper bounds on
 * inferior moves rather than scores.
 *
 * ANYTHING ELSE IS REPORTED AS UNDETERMINED, NOT AS SOUND. A position where the
 * opponent has no forced mate within the budget is not thereby drawn; it is
 * unresolved, and this tool says so. That distinction is the whole point of the
 * exercise, since the claim being checked is exactly the kind that gets made
 * from an absence of evidence.
 */
const fs = require('fs');
const path = require('path');
const E = require('./../tests/engine.js');
const { startState, legal, apply, inCheck, fen, san, sqName, idx, insufficient } = E;
const { toFen } = require('./fen-write.js');

/* --------------------------- the classification --------------------------- */

function isMate(T) { return legal(T, true).length === 0 && inCheck(T, T.turn); }
function isStale(T) { return legal(T, true).length === 0 && !inCheck(T, T.turn); }

/* the side to move at T has a move that mates now, or one that forces mate on
   the move after any reply — i.e. T is lost within three plies */
function lostIn3(T) {
  const ms = legal(T, true);
  for (const m of ms) if (isMate(apply(T, m))) return true;
  for (const m of ms) {
    const U = apply(T, m);
    const rep = legal(U, true);
    if (!rep.length) continue;
    let all = true;
    for (const r of rep) {
      const V = apply(U, r);
      if (!legal(V, true).some(function (x) { return isMate(apply(V, x)); })) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

/* Classify the position AFTER a shed. Opponent is to move at T. */
function classifyShed(T) {
  if (isMate(T)) return { verdict: 'SHEDDER_WINS', how: 'the shed is mate' };
  if (insufficient(T.b)) return { verdict: 'DRAWN', how: 'INSUFFICIENT' };
  if (isStale(T)) return { verdict: 'DRAWN', how: 'OPP_STALEMATE' };

  const rep = legal(T, true);
  // an immediate loss for the shedder settles it without looking further
  for (const r of rep) if (isMate(apply(T, r))) return { verdict: 'OPP_WINS', how: 'mate in 1: ' + sqName(r.from) + sqName(r.to) };

  let allStale = true, allInsuff = true;
  for (const r of rep) {
    const U = apply(T, r);
    if (!isStale(U)) allStale = false;
    if (!insufficient(U.b)) allInsuff = false;
    if (!allStale && !allInsuff) break;
  }
  if (allStale) return { verdict: 'DRAWN', how: 'FORCED_STALEMATE' };
  if (allInsuff) return { verdict: 'DRAWN', how: 'FORCED_INSUFFICIENT' };

  if (lostIn3(T)) return { verdict: 'OPP_WINS', how: 'opponent forces mate within three plies' };
  return { verdict: 'UNDETERMINED', how: 'no forced mate and no forced draw inside the budget' };
}

/* Examine one position. Returns every self-capture with its verdict, plus
   whether the shed was actually NEEDED. */
function examine(S, opts) {
  const ms = legal(S, true);
  const selfs = ms.filter(function (m) { return m.kind === 'self'; });
  if (!selfs.length) return null;
  const ords = ms.filter(function (m) { return m.kind !== 'self'; });

  const sheds = selfs.map(function (m) {
    const piece = S.b[m.from];
    const c = classifyShed(apply(S, m));
    return {
      uci: sqName(m.from) + sqName(m.to),
      san: san(S, m, true),
      kingShed: piece && piece[1] === 'k',
      verdict: c.verdict,
      how: c.how
    };
  });
  /* NECESSARY: every ordinary move hands the opponent a forced mate.

     Computed LAZILY, and that is a 30x speed difference, not a micro-optimisation.
     It costs one lostIn3() per ordinary move -- twenty to forty of them in a
     typical position -- and it can only ever matter when some shed already came
     back DRAWN. Running it on every position spent the entire sweep budget on
     positions whose sheds all lost anyway: 9,696 positions in 470s before this
     change. Pass {eager:true} to force it, which is what --check does so that
     inspecting one position still prints the full picture. */
  const anyDrawn = sheds.some(function (sh) { return sh.verdict === 'DRAWN'; });
  let necessary = null, survivingOrdinary = null;
  if (anyDrawn || (opts && opts.eager)) {
    const surviving = ords.filter(function (m) { return !lostIn3(apply(S, m)); });
    survivingOrdinary = surviving.length;
    necessary = ords.length === 0 || surviving.length === 0;
  }
  return { necessary: necessary, survivingOrdinary: survivingOrdinary,
           ordinaryCount: ords.length, sheds: sheds };
}

/* ------------------------------ the search space ------------------------------ */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EDGE = [];
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
  const i = idx(r, c), edge = (r === 0 || r === 7 || c === 0 || c === 7);
  EDGE.push({ i: i, r: r, c: c, edge: edge });
}
function neighbours(i) {
  const r = (i / 8) | 0, c = i % 8, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) out.push(idx(nr, nc));
  }
  return out;
}

/*
 * Constructed sparse endgames, biased HARD toward the shape a shed needs: the
 * shedder's king on an edge or in a corner with one or two of its own pieces
 * right beside it, and enemy force nearby. Random playouts from the opening
 * almost never reach this, which is why a playout-only sweep would report
 * "nothing found" while never having looked in the right place.
 */
function randomEndgame(rnd) {
  const pick = function (a) { return a[(rnd() * a.length) | 0]; };
  const b = new Array(64).fill(null);
  const me = rnd() < 0.5 ? 'w' : 'b';
  const you = me === 'w' ? 'b' : 'w';

  const edges = EDGE.filter(function (s) { return s.edge; });
  const myK = pick(rnd() < 0.85 ? edges : EDGE).i;
  b[myK] = me + 'k';

  // one or two of my OWN pieces adjacent to my king: the shed candidates
  const adj = neighbours(myK).filter(function (i) { return !b[i]; });
  const nOwn = 1 + ((rnd() * 2) | 0);
  const OWN = ['p', 'n', 'b', 'r', 'q'];
  for (let k = 0; k < nOwn && adj.length; k++) {
    const sq = adj.splice((rnd() * adj.length) | 0, 1)[0];
    const t = pick(OWN);
    const r = (sq / 8) | 0;
    if (t === 'p' && (r === 0 || r === 7)) { k--; continue; }   // no pawn on the back ranks
    b[sq] = me + t;
  }

  // the enemy king, never adjacent to mine
  const far = EDGE.filter(function (s) { return !b[s.i] && neighbours(s.i).indexOf(myK) < 0 && s.i !== myK; });
  if (!far.length) return null;
  const yourK = pick(far).i;
  b[yourK] = you + 'k';

  // enemy force
  const nYou = 1 + ((rnd() * 3) | 0);
  const THEIRS = ['q', 'r', 'b', 'n', 'p'];
  for (let k = 0; k < nYou; k++) {
    const free = EDGE.filter(function (s) { return !b[s.i]; });
    if (!free.length) break;
    const sq = pick(free).i;
    const t = pick(THEIRS);
    const r = (sq / 8) | 0;
    if (t === 'p' && (r === 0 || r === 7)) { k--; continue; }
    b[sq] = you + t;
  }

  const S = { b: b, turn: me, cast: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1 };
  if (inCheck(S, you)) return null;            // the side not to move cannot already be in check
  if (!legal(S, true).length) return null;     // already over
  return S;
}

/* ------------------------------ the sweep ------------------------------ */

function sweep(opts) {
  const rnd = mulberry32(opts.seed);
  const seen = new Set();
  const hits = [];
  const tally = { DRAWN: 0, OPP_WINS: 0, UNDETERMINED: 0, SHEDDER_WINS: 0 };
  const byMechanism = {};
  let built = 0, examined = 0, withSheds = 0, necessaryPositions = 0;
  const t0 = Date.now();

  const consider = function (S) {
    const f = toFen(S);
    if (seen.has(f)) return;
    seen.add(f);
    examined++;
    const r = examine(S);
    if (!r) return;
    withSheds++;
    if (r.necessary) necessaryPositions++;
    for (const sh of r.sheds) {
      tally[sh.verdict] = (tally[sh.verdict] || 0) + 1;
      if (sh.verdict === 'DRAWN') byMechanism[sh.how] = (byMechanism[sh.how] || 0) + 1;
      /* A SOUND shed: the position was lost without it, and it is drawn WITH it.
         Both halves, or it is not the claim the page makes. */
      if (sh.verdict === 'DRAWN' && r.necessary) {
        hits.push({ fen: f, shed: sh.uci, san: sh.san, kingShed: sh.kingShed,
                    mechanism: sh.how, ordinaryMoves: r.ordinaryCount });
      }
    }
  };

  // 1. constructed endgames
  for (let i = 0; i < opts.samples; i++) {
    const S = randomEndgame(rnd);
    if (!S) continue;
    built++;
    consider(S);
    if (Date.now() - t0 > opts.msBudget) break;
  }

  // 2. real play, so the answer is not an artefact of the construction
  for (let g = 0; g < opts.games; g++) {
    let S = startState();
    for (let ply = 0; ply < 220; ply++) {
      const ms = legal(S, true);
      if (!ms.length) break;
      consider(S);
      const checks = ms.filter(function (m) { const T = apply(S, m); return inCheck(T, T.turn); });
      const pool = (checks.length && rnd() < 0.5) ? checks : ms;
      S = apply(S, pool[(rnd() * pool.length) | 0]);
    }
    if (Date.now() - t0 > opts.msBudget) break;
  }

  return { hits: hits, tally: tally, byMechanism: byMechanism, built: built,
           examined: examined, withSheds: withSheds, necessaryPositions: necessaryPositions,
           seconds: +((Date.now() - t0) / 1000).toFixed(1) };
}

/* ------------------------------ cli ------------------------------ */

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

if (require.main === module) {
  const one = arg('--check', null);
  if (one) {
    const S = fen(one);
    console.log(toFen(S));
    const r = examine(S, { eager: true });
    if (!r) { console.log('  no self-capture is legal here'); process.exit(0); }
    console.log('  ordinary moves: ' + r.ordinaryCount + ', of which ' + r.survivingOrdinary +
                ' do NOT lose within three plies');
    console.log('  shed is NECESSARY: ' + r.necessary);
    r.sheds.forEach(function (sh) {
      console.log('  ' + sh.san.padEnd(8) + (sh.kingShed ? '[king shed] ' : '            ') +
                  sh.verdict.padEnd(14) + sh.how);
    });
    process.exit(0);
  }

  const opts = {
    samples: parseInt(arg('--samples', '400000'), 10),
    games: parseInt(arg('--games', '400'), 10),
    seed: parseInt(arg('--seed', '20260917'), 10),
    msBudget: parseInt(arg('--ms', '600000'), 10)
  };
  console.error('shed sweep: ' + opts.samples + ' constructed endgames + ' + opts.games +
                ' playouts, seed ' + opts.seed + ', budget ' + (opts.msBudget / 1000) + 's');
  const r = sweep(opts);

  const kingHits = r.hits.filter(function (h) { return h.kingShed; });
  /*
   * Two of the four drawing mechanisms have never been reached by any input, and
   * a zero next to two counters that may be incapable of being anything else is
   * not a measurement. They are named here so a reader does not add them to the
   * evidence, and the argument for why is stated rather than left to inference.
   *
   * FORCED_STALEMATE needs every opponent reply to stalemate the shedder, which
   * needs the opponent to have NO checking move at all -- a check against a side
   * with no legal moves is mate. And the cage has to survive every reply, which
   * in THIS variant is the hard part: self-capture makes any friendly piece
   * standing next to another a legal destination, so no piece can ever be
   * frozen, and a caging piece always has a move that breaks the cage. The rule
   * that makes stalemate offerable is the same rule that makes it unforceable.
   *
   * FORCED_INSUFFICIENT has a simpler problem: if the material is already thin
   * enough, INSUFFICIENT fires first, one branch earlier.
   *
   * The retraction does NOT rest on either of these. It rests on zero SOUND
   * sheds, and on OPP_STALEMATE, which IS exercised by tests/shed.js and which
   * came back zero across every verdict here.
   */
  const UNEXERCISED = ['FORCED_STALEMATE', 'FORCED_INSUFFICIENT'];
  const report = {
    ranAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    budget: opts,
    searched: { constructed: r.built, positionsExamined: r.examined,
                positionsWithASelfCapture: r.withSheds,
                positionsWhereEveryOrdinaryMoveLoses: r.necessaryPositions,
                seconds: r.seconds },
    shedVerdicts: r.tally,
    drawMechanisms: r.byMechanism,
    mechanismsNeverReachedByAnyInput: UNEXERCISED,
    mechanismsExercisedByTests: ['INSUFFICIENT', 'OPP_STALEMATE'],
    soundSheds: r.hits.length,
    soundKingSheds: kingHits.length,
    examples: r.hits.slice(0, 25),
    kingShedExamples: kingHits.slice(0, 25)
  };
  const out = arg('--out', path.join(__dirname, '..', '_context', 'shed-sweep.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.error('examined ' + r.examined + ' positions (' + r.withSheds + ' with a self-capture) in ' + r.seconds + 's');
  console.error('shed verdicts: ' + JSON.stringify(r.tally));
  console.error('draw mechanisms: ' + JSON.stringify(r.byMechanism));
  console.error('  NOTE  ' + UNEXERCISED.join(' and ') + ' have never been reached by any input.');
  console.error('        Read them as unexercised branches, not as measurements. See the comment above.');
  console.error('SOUND sheds: ' + r.hits.length + '   of which KING sheds: ' + kingHits.length);
  console.error('wrote ' + out);
}

module.exports = { classifyShed, examine, lostIn3, isMate, isStale, randomEndgame, sweep };
