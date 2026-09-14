/*
 * gen-puzzles.js — sweep for Tyranny puzzles and write puzzles/puzzles.json.
 *
 *   node tools/gen-puzzles.js [--games N] [--seed N] [--bias 0.5] [--out path]
 *   node tools/gen-puzzles.js --inline        fill the PUZZLE-DATA markers in
 *                                             src/tyranny.html from puzzles.json
 *
 * --inline is provided but NEVER run by the generating seat; the orchestrator
 * runs it once after the merge, when the markers exist.
 *
 * Both predicates are DEPTH-FREE. No search, no engine scoring, no think().
 * think()'s root loop raises alpha as it goes, so its per-move _r values are
 * upper bounds on inferior moves rather than scores — 68 of 71 were wrong on one
 * measured position. Nothing here needs it.
 *
 * Search: check-biased playout from startState(). With probability `bias`, pick
 * uniformly among moves that give check; otherwise uniformly among all legal
 * moves. Seeded, so a given --seed reproduces byte-identical output.
 */
const fs = require('fs');
const path = require('path');
const E = require('./../tests/engine.js');
const { startState, legal, apply, inCheck, fen, san, sqName } = E;
const { toFen } = require('./fen-write.js');

const ROOT = path.join(__dirname, '..');
const OUT_DEFAULT = path.join(ROOT, 'puzzles', 'puzzles.json');
const SRC = path.join(ROOT, 'src', 'tyranny.html');
const MARK_BEGIN = '<!-- PUZZLE-DATA:BEGIN -->';
const MARK_END = '<!-- PUZZLE-DATA:END -->';

/* ------------------------------ predicates ------------------------------ */

function isMate(T) {
  return legal(T, true).length === 0 && inCheck(T, T.turn);
}

function matesIn2(S, m) {
  if (isMate(apply(S, m))) return true;
  const T = apply(S, m);
  const rep = legal(T, true);
  if (rep.length === 0) return false;
  return rep.every(function (r) {
    const U = apply(T, r);
    return legal(U, true).some(function (x) { return isMate(apply(U, x)); });
  });
}

/* ESCAPE: mate under standard rules, survivable under Tyranny.
   Every tyranny-legal move is then a self-capture by construction — the two
   move sets differ by exactly the self-captures — but the validator re-checks
   that rather than trusting it. */
function tryEscape(S) {
  if (!inCheck(S, S.turn)) return null;
  const ms = legal(S, true);
  if (ms.length < 1) return null;
  if (legal(S, false).length !== 0) return null;
  return ms;
}

/* TACTICAL: exactly one self-capture mates in 1, nothing else mates in 1, and
   no ordinary move forces mate within two.

   Check order is the whole performance story. The self-mate scan is one legal()
   per candidate and rejects ~99% of positions; matesIn2 is a nested sweep and
   runs only on what survives. Cheap test first, expensive test last. */
function tryTactical(S) {
  const ms = legal(S, true);
  let sole = null, n = 0;
  for (const m of ms) {
    if (m.kind !== 'self') continue;
    if (isMate(apply(S, m))) { n++; if (n > 1) return null; sole = m; }
  }
  if (n !== 1) return null;
  for (const m of ms) {
    if (m.kind === 'self') continue;
    if (isMate(apply(S, m))) return null;          // an ordinary move also mates
  }
  for (const m of ms) {                             // expensive, and last
    if (m.kind === 'self') continue;
    if (matesIn2(S, m)) return null;
  }
  return { sole: sole, ms: ms };
}

/* ------------------------------ plumbing ------------------------------ */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uci = function (m) { return sqName(m.from) + sqName(m.to) + (m.promo || ''); };
const plain = function (m) { return { from: m.from, to: m.to, promo: m.promo || null }; };

/* Difficulty is a stated rule, not a feel: how large a set you must reject to
   find the answer.
     escape   — forced (one legal move) is 1; a choice among several is 2.
     tactical — the legal-move count IS that set. Threshold 35 comes from the
                measured distribution over a 108k-position sweep: tacticals run
                26..67 legal moves, median 43. An earlier guess of <=20 was
                unreachable — zero of 25 tacticals fell under it, so every
                tactical scored 3 and the level was decorative.
   The orchestrator's pre-run fixture contained no difficulty-2 example at all,
   so no reader had ever exercised that branch. Both families can now produce
   one. */
function escapeDifficulty(ms) { return ms.length === 1 ? 1 : 2; }
function tacticalDifficulty(ms) { return ms.length <= 35 ? 2 : 3; }

/* Up to three legal moves that are NOT the solution. Checks and captures first,
   because a plausible distractor is the point. The solution is excluded by key,
   not by identity — the committed fixture shipped a decoy that WAS its solution
   and the validator caught it, so this is belt and braces. */
function pickDecoys(S, ms, solutions) {
  const banned = new Set(solutions.map(function (m) { return m.from + ':' + m.to + ':' + (m.promo || '-'); }));
  const cand = ms.filter(function (m) { return !banned.has(m.from + ':' + m.to + ':' + (m.promo || '-')); });
  const scored = cand.map(function (m) {
    const T = apply(S, m);
    let s = 0;
    if (inCheck(T, T.turn)) s += 4;
    if (m.cap) s += 2;
    if (m.kind === 'self') s += 1;
    return { m: m, s: s };
  });
  scored.sort(function (a, b) { return b.s - a.s || uci(a.m).localeCompare(uci(b.m)); });
  return scored.slice(0, 3).map(function (x) { return { uci: uci(x.m), san: san(S, x.m, true) }; });
}

function buildEntry(id, family, S, solutionMoves, ms, std) {
  const sols = solutionMoves.map(plain);
  return {
    id: id,
    family: family,
    fen: toFen(S),
    sideToMove: S.turn,
    legalMoveCount: ms.length,
    soleLegalMove: ms.length === 1,
    standardLegalMoveCount: std,
    solutions: sols,
    solutionsUci: solutionMoves.map(uci),
    solutionsSan: solutionMoves.map(function (m) { return san(S, m, true); }),
    decoys: family === 'tactical' ? pickDecoys(S, ms, solutionMoves) : [],
    rationale: family === 'escape'
      ? 'Checkmate under standard rules. Only an execution of your own piece survives.'
      : 'Executing your own piece mates at once, and no ordinary move forces mate within two.',
    difficulty: family === 'escape' ? escapeDifficulty(ms) : tacticalDifficulty(ms)
  };
}

/* ------------------------------ the sweep ------------------------------ */

function sweep(opts) {
  const rnd = mulberry32(opts.seed);
  const seen = new Set();
  const escapes = [], tacticals = [];
  let positions = 0, games = 0;
  const t0 = Date.now();

  for (let g = 0; g < opts.games; g++) {
    games++;
    let S = startState();
    for (let ply = 0; ply < 200; ply++) {
      const ms = legal(S, true);
      if (!ms.length) break;
      positions++;

      const f = toFen(S);
      if (!seen.has(f)) {
        seen.add(f);
        const esc = tryEscape(S);
        if (esc) {
          escapes.push(buildEntry('esc-' + String(escapes.length + 1).padStart(4, '0'),
            'escape', S, esc, ms, legal(S, false).length));
        } else {
          const tac = tryTactical(S);
          if (tac) {
            tacticals.push(buildEntry('tac-' + String(tacticals.length + 1).padStart(4, '0'),
              'tactical', S, [tac.sole], ms, legal(S, false).length));
          }
        }
      }

      const checks = ms.filter(function (m) { const T = apply(S, m); return inCheck(T, T.turn); });
      const pool = (checks.length && rnd() < opts.bias) ? checks : ms;
      S = apply(S, pool[(rnd() * pool.length) | 0]);

      if (escapes.length >= opts.target && tacticals.length >= opts.target) break;
    }
    if (escapes.length >= opts.target && tacticals.length >= opts.target) break;
    if (Date.now() - t0 > opts.msBudget) break;
  }
  return { escapes, tacticals, positions, games, ms: Date.now() - t0, unique: seen.size };
}

/* ------------------------------ --inline ------------------------------ */

/* srcPath/docPath are overridable so this path can be TESTED without editing the
   real src/tyranny.html, which the generating seat is not allowed to touch.
   Defaults are the real files, so the orchestrator's plain `--inline` is
   unchanged. */
function inline(srcPath, docPath) {
  const SRCF = srcPath || SRC;
  const DOCF = docPath || OUT_DEFAULT;
  if (!fs.existsSync(DOCF)) { console.error('inline: ' + DOCF + ' does not exist'); process.exit(1); }
  const doc = fs.readFileSync(DOCF, 'utf8');
  let src;
  try { src = fs.readFileSync(SRCF, 'utf8'); }
  catch (e) { console.error('inline: cannot read ' + SRCF); process.exit(1); }

  const a = src.indexOf(MARK_BEGIN), b = src.indexOf(MARK_END);
  if (a < 0 || b < 0 || b < a) {
    console.error('inline: PUZZLE-DATA markers not found in ' + SRCF + '.');
    console.error('  Expected, on their own lines, in this order:');
    console.error('    ' + MARK_BEGIN);
    console.error('    ' + MARK_END);
    console.error('  Nothing was written. This is not a generator defect: the markers are');
    console.error('  added by the UI lane, and --inline is meant to run after that merge.');
    process.exit(1);
  }
  /* same "</" escape build.js uses: an unescaped one would close the tag early */
  const json = JSON.stringify(JSON.parse(doc)).replace(/<\//g, '<\\/');
  const payload = MARK_BEGIN + '\n<script>window.TYRANNY_PUZZLES = ' + json + ';</script>\n' + MARK_END;
  const next = src.slice(0, a) + payload + src.slice(b + MARK_END.length);
  fs.writeFileSync(SRCF, next, 'utf8');
  console.log('inline: wrote ' + JSON.parse(doc).puzzles.length + ' puzzles into ' +
              path.basename(SRCF) + ' between the PUZZLE-DATA markers');
}

/* ------------------------------ cli ------------------------------ */

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

if (require.main === module) {
  if (process.argv.includes('--inline')) {
    inline(arg('--src', null), arg('--out', null));
    process.exit(0);
  }

  const opts = {
    games: parseInt(arg('--games', '2500'), 10),
    seed: parseInt(arg('--seed', '20260914'), 10),
    bias: parseFloat(arg('--bias', '0.5')),
    target: parseInt(arg('--target', '20'), 10),
    msBudget: parseInt(arg('--ms', '600000'), 10)
  };
  const out = arg('--out', OUT_DEFAULT);

  console.error('sweeping: games<=' + opts.games + ' seed=' + opts.seed + ' bias=' + opts.bias + ' target=' + opts.target + '/family');
  const r = sweep(opts);

  const puzzles = r.escapes.concat(r.tacticals);
  const doc = {
    schema: 2,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    generator: {
      strategy: 'check-biased playout from startState, depth-free predicates',
      checkBias: opts.bias,
      games: r.games,
      positionsVisited: r.positions,
      uniquePositions: r.unique,
      seed: opts.seed,
      tool: 'tools/gen-puzzles.js'
    },
    counts: { escape: r.escapes.length, tactical: r.tacticals.length },
    puzzles: puzzles
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  console.error('games=' + r.games + ' positions=' + r.positions + ' unique=' + r.unique +
                ' escape=' + r.escapes.length + ' tactical=' + r.tacticals.length +
                ' in ' + (r.ms / 1000).toFixed(1) + 's');
  console.error('wrote ' + out);
}

module.exports = { isMate, matesIn2, tryEscape, tryTactical, sweep, mulberry32 };
