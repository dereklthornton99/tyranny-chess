/*
 * ai-selfcapture.js — does the engine ever execute its own piece ON PURPOSE?
 *
 *   node tools/ai-selfcapture.js [--games N] [--positions N] [--depth D] [--seed S]
 *   node tools/ai-selfcapture.js --probes          the constructed positions only
 *
 * Derek, 2026-09-17: "I have yet to see it take its own piece for a strategic
 * purpose rather than just to save the king from imminent checkmate."
 *
 * THE HYPOTHESIS, written down before the numbers so the numbers cannot be read
 * to fit it afterwards. The SEARCH is rule-agnostic — a self-capture is an
 * ordinary entry in the move list and nothing special happens to it — but the
 * EVALUATION is stock piece-square-table material, which can only ever price an
 * execution as a loss of exactly the piece taken. If that is the whole story
 * then the engine plays a self-capture only when the search sees a concrete,
 * in-horizon payoff that outweighs the material: mate, or survival. It would
 * never play one for a reason the evaluation cannot name.
 *
 * THIS IS A MEASUREMENT, NOT A TUNING RUN. No evaluation change is proposed
 * here (M4-T2-AC4). A count of zero in the "other" bucket is a publishable
 * result and is reported as one.
 *
 * DETERMINISM (M4-T2-AC5): every engine call in the bulk sample pins maxDepth
 * and hands think() a deadline it cannot reach, so the time budget never binds
 * and the same --depth and --seed reproduce the same counts. The page's own
 * Easy / Medium / Hard are TIME-bounded and therefore are not reproducible;
 * --probes runs them anyway, because AC3 asks for the engine's choice at each
 * strength, and prints a depth-pinned column beside them so there is at least
 * one column a rerun can be compared against.
 */
const fs = require('fs');
const path = require('path');
const E = require('./../tests/engine.js');
const { startState, legal, apply, inCheck, fen, san, sqName, think, MATE } = E;
const { toFen } = require('./fen-write.js');

const NEVER = 1e9;                 // a deadline think() cannot reach, so depth binds
const CP = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/* The page's own three strengths, copied from src/tyranny.html so the probe
   table reports what a player actually faces rather than a stand-in. */
const LEVELS = { easy: { ms: 150, depth: 2 }, medium: { ms: 600, depth: 6 }, hard: { ms: 1800, depth: 9 } };

function isMate(T) { return legal(T, true).length === 0 && inCheck(T, T.turn); }
function forcesMateIn2(S, m) {
  const T = apply(S, m);
  if (isMate(T)) return false;                       // that is mate-in-1, a different thing
  const rep = legal(T, true);
  if (!rep.length) return false;
  return rep.every(function (r) {
    const U = apply(T, r);
    return legal(U, true).some(function (x) { return isMate(apply(U, x)); });
  });
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * Classify ONE engine decision. Buckets are Derek's four, in his order, and
 * every raw flag is kept alongside so the ordering cannot hide anything: a
 * self-capture that both escapes check and mates is counted once in the
 * headline and appears under both flags in the cross-tab.
 */
function classify(S, m, history) {
  const ms = legal(S, true);
  const ords = ms.filter(function (x) { return x.kind !== 'self'; });
  const checked = inCheck(S, S.turn);
  const mate = isMate(apply(S, m));
  const forcing = forcesMateIn2(S, m);
  const forced = ms.length === 1;

  const bucket = forced ? 'forced'
    : checked ? 'escape-from-check'
    : mate ? 'mate-delivering'
    : 'other';

  return {
    fen: toFen(S),
    uci: sqName(m.from) + sqName(m.to) + (m.promo || ''),
    san: san(S, m, true),
    side: S.turn,
    bucket: bucket,
    /* the sub-split of "other" is where the real question lives: a self-capture
       that forces mate a move later is strategic but still in-horizon, while a
       quiet one would mean the engine valued something its evaluation cannot
       name. */
    otherKind: bucket !== 'other' ? null : (forcing ? 'forces-mate-in-2' : 'quiet'),
    flags: {
      forced: forced, inCheck: checked, deliversMate: mate, forcesMateIn2: forcing,
      hadOrdinaryAlternatives: ords.length > 0,
      legalMoves: ms.length,
      selfCaptureOptions: ms.length - ords.length,
      capturedPiece: S.b[m.to] ? S.b[m.to][1] : null,
      centipawnsGivenUp: S.b[m.to] ? CP[S.b[m.to][1]] : 0
    }
  };
}

/*
 * Was the self-capture actually PREFERRED, or was the engine indifferent?
 *
 * This is the question a raw bucket count cannot answer, and getting it wrong
 * in the flattering direction is the obvious way to misread this whole exercise.
 * In a position where every move loses, the engine still has to return one, and
 * if it happens to return a self-capture that is not a preference for anything.
 *
 * think()'s own per-move m._r values CANNOT be used for this, and the goal tree
 * says so in its non_goals: the root loop raises alpha as it goes, so every
 * value after the first is an upper bound on an inferior move rather than a
 * score. 68 of 71 were wrong on one measured position. So each root move is
 * re-searched here with a FULL window, which costs more and means something.
 */
function scoreRootMoves(S, depth) {
  const ms = legal(S, true);
  E.ai.nodes = 0; E.ai.aborted = false; E.ai.selfCap = true;
  E.ai.killers = []; E.ai.hist = {}; E.ai.path = []; E.ai.depthDone = 0;
  E.ai.gameKeys = new Set();
  E.ai.deadline = Date.now() + NEVER;
  return ms.map(function (m) {
    return { m: m, score: -E.search(apply(S, m), depth - 1, -Infinity, Infinity, 1) };
  });
}

function preference(S, chosen, depth) {
  const scored = scoreRootMoves(S, depth);
  const key = function (m) { return m.from + ':' + m.to + ':' + (m.promo || '-'); };
  const mine = scored.filter(function (x) { return key(x.m) === key(chosen); })[0];
  const ords = scored.filter(function (x) { return x.m.kind !== 'self'; });
  if (!mine || !ords.length) return null;
  let best = ords[0];
  for (const o of ords) if (o.score > best.score) best = o;
  const top = Math.max.apply(null, scored.map(function (x) { return x.score; }));
  /* Every move losing by force makes the choice meaningless, so it is named
     rather than counted as a preference in either direction. */
  const allLost = top <= -(MATE - 200);
  const gap = mine.score - best.score;
  return {
    selfCaptureScore: mine.score,
    bestOrdinaryScore: best.score,
    bestOrdinary: san(S, best.m, true),
    centipawnGap: gap,
    verdict: allLost ? 'every-move-loses-by-force'
      : gap > 0 ? 'strictly-better-than-every-ordinary-move'
      : gap === 0 ? 'tied-with-the-best-ordinary-move'
      : 'worse-than-an-ordinary-move'
  };
}

/* ------------------------------ the sample ------------------------------ */

function run(opts) {
  const rnd = mulberry32(opts.seed);
  const events = [];
  const buckets = { forced: 0, 'escape-from-check': 0, 'mate-delivering': 0, other: 0 };
  const otherKinds = { 'forces-mate-in-2': 0, quiet: 0 };
  let decisions = 0, gamesPlayed = 0, positionsProbed = 0;
  const t0 = Date.now();

  const ask = function (S, history) {
    const r = think(S, { ms: NEVER, maxDepth: opts.depth, selfCap: true, history: history || [] });
    return r && r.move;
  };
  const record = function (S, m, history) {
    decisions++;
    if (m.kind !== 'self') return;
    const ev = classify(S, m, history);
    buckets[ev.bucket]++;
    if (ev.otherKind) otherKinds[ev.otherKind]++;
    if (ev.bucket === 'other' || events.length < 400) events.push(ev);
  };

  /* 1. Whole games. The engine is deterministic from a given position, so every
        game needs a distinct random opening prefix or all N would be the same
        game played N times. */
  for (let g = 0; g < opts.games; g++) {
    let S = startState();
    const hist = [S];
    const prefix = 4 + ((rnd() * 9) | 0);
    for (let i = 0; i < prefix; i++) {
      const ms = legal(S, true);
      if (!ms.length) break;
      S = apply(S, ms[(rnd() * ms.length) | 0]);
      hist.push(S);
    }
    for (let ply = 0; ply < opts.maxPly; ply++) {
      const ms = legal(S, true);
      if (!ms.length) break;
      const m = ask(S, hist);
      if (!m) break;
      record(S, m, hist);
      S = apply(S, m);
      hist.push(S);
      if (Date.now() - t0 > opts.msBudget) break;
    }
    gamesPlayed++;
    if (Date.now() - t0 > opts.msBudget) break;
  }

  /* 2. Single decisions from check-biased playout positions, which reach shapes
        a self-play game between two copies of the same engine never visits. */
  for (let i = 0; i < opts.positions; i++) {
    let S = startState();
    const hist = [S];
    const depth = 6 + ((rnd() * 60) | 0);
    let ok = true;
    for (let k = 0; k < depth; k++) {
      const ms = legal(S, true);
      if (!ms.length) { ok = false; break; }
      const checks = ms.filter(function (m) { const T = apply(S, m); return inCheck(T, T.turn); });
      const pool = (checks.length && rnd() < 0.5) ? checks : ms;
      S = apply(S, pool[(rnd() * pool.length) | 0]);
      hist.push(S);
    }
    if (!ok || !legal(S, true).length) continue;
    const m = ask(S, hist);
    if (!m) continue;
    record(S, m, hist);
    positionsProbed++;
    if (Date.now() - t0 > opts.msBudget) break;
  }

  /* Second pass, only over the bucket that matters. A quiet self-capture is
     only interesting if the engine PREFERRED it, so each one is re-scored with
     a full window against the best ordinary move available in that position. */
  const preferences = {};
  events.forEach(function (ev) {
    if (ev.bucket !== 'other') return;
    const S = fen(ev.fen);
    const ms = legal(S, true);
    const key = ev.uci;
    const m = ms.filter(function (x) { return sqName(x.from) + sqName(x.to) + (x.promo || '') === key; })[0];
    if (!m) return;
    ev.preference = preference(S, m, opts.depth);
    if (ev.preference) preferences[ev.preference.verdict] = (preferences[ev.preference.verdict] || 0) + 1;
  });

  const selfTotal = buckets.forced + buckets['escape-from-check'] + buckets['mate-delivering'] + buckets.other;
  return {
    /* Determinism (AC5) holds only while the wall-clock budget does NOT bind:
       the sweep breaks on elapsed time, so a run that hits the ceiling stops at
       a different place each time and the counts move with it. Stated as a flag
       rather than left implicit, because a reader comparing two runs needs to
       know which of the two properties they are looking at. */
    budgetBound: (Date.now() - t0) > opts.msBudget,
    sample: { gamesPlayed: gamesPlayed, positionsProbed: positionsProbed,
              engineDecisions: decisions, depth: opts.depth, seed: opts.seed,
              seconds: +((Date.now() - t0) / 1000).toFixed(1) },
    selfCapturesChosen: selfTotal,
    buckets: buckets,
    otherKinds: otherKinds,
    otherPreference: preferences,
    events: events
  };
}

/* ------------------------------ the probes ------------------------------ */

/*
 * Positions where a self-capture is objectively best and it is NEITHER an
 * immediate mate NOR an escape from check (M4-T2-AC3). "Objectively best" is a
 * proof here, not an opinion: in each one exactly one move forces mate within
 * three plies, that move is a self-capture, the mover is not in check, and no
 * move mates at once. The proof is re-run below before the engine is asked, so
 * a probe that stops being best fails loudly instead of quietly measuring
 * nothing.
 */
const PROBES = [
  /*
   * CONSTRUCTED, and constructed in a way that can be checked rather than
   * asserted: built from the skeleton of a position the sweep threw up, by
   * deleting one man at a time and keeping a deletion only when the whole
   * property still held afterwards — not in check, nothing mates in one,
   * exactly one move forces mate in two, and that move still the same
   * self-capture. Four pieces came out (white pawns on c6, b4 and e3, a black
   * pawn on b3) and what is left is the mechanism with nothing else on it.
   *
   *   Black: Kg7, Rd7, Rg6, pawn d6.   White: Ke8.   Black to move.
   *
   * The answer is Rd⊗d6: the d7 rook eats its OWN pawn, because d6 is the
   * square the mating net needs and Black's own pawn is standing on it. White
   * then has exactly one legal reply, Ke7, and Rge6 is mate.
   *
   * Two details make this a positional claim rather than a tactical one. The
   * move gives no check and wins no material — it spends a pawn to occupy a
   * square. And the OTHER rook taking the same pawn, Rg⊗d6, does NOT force
   * mate. So the idea is not "remove the obstruction", it is "which of the two
   * rooks should end up there" — a distinction a piece-square table has no way
   * to express.
   */
  { id: 'clearance-min', fen: '4K3/3r2k1/3p2r1/8/8/8/8/8 b - - 8 38',
    note: 'Constructed by minimisation. Black spends its own pawn to put the RIGHT rook on d6; the other rook taking the same pawn does not force mate. No check, no material won, payoff two plies away.' },
  { id: 'mul-0004', fen: '4K3/3r2k1/2Pp2r1/8/1P6/1p2P3/8/8 b - - 8 38',
    note: 'The same idea as it actually arose in play, before minimisation, with four more pieces on the board to see past.' }
];

function proveProbe(S) {
  const ms = legal(S, true);
  const mate1 = ms.filter(function (m) { return isMate(apply(S, m)); });
  const forcing = ms.filter(function (m) { return forcesMateIn2(S, m); });
  return {
    inCheck: inCheck(S, S.turn),
    legalMoves: ms.length,
    mateInOneMoves: mate1.length,
    forcingMoves: forcing.map(function (m) { return sqName(m.from) + sqName(m.to); }),
    uniqueForcing: forcing.length === 1 ? forcing[0] : null,
    forcingIsSelfCapture: forcing.length === 1 && forcing[0].kind === 'self'
  };
}

function probes(list) {
  return list.map(function (P) {
    const S = fen(P.fen);
    const proof = proveProbe(S);
    const best = proof.uniqueForcing;
    const row = { id: P.id, fen: P.fen, note: P.note, proof: {
      moverInCheck: proof.inCheck,
      legalMoves: proof.legalMoves,
      movesThatMateAtOnce: proof.mateInOneMoves,
      movesThatForceMateInTwo: proof.forcingMoves,
      theBestMoveIsASelfCapture: proof.forcingIsSelfCapture,
      bestMove: best ? san(S, best, true) : null
    }, engine: {} };

    if (!best || proof.inCheck || proof.mateInOneMoves || !proof.forcingIsSelfCapture) {
      row.probeValid = false;
      return row;
    }
    row.probeValid = true;
    const bestKey = best.from + ':' + best.to;

    ['easy', 'medium', 'hard'].forEach(function (lv) {
      const L = LEVELS[lv];
      // as shipped: TIME-bounded, so this column is not reproducible and says so
      const asShipped = think(S, { ms: L.ms, maxDepth: L.depth, selfCap: true, history: [S] });
      // depth-pinned twin: the same nominal strength with the clock taken out
      const pinned = think(S, { ms: NEVER, maxDepth: L.depth, selfCap: true, history: [S] });
      row.engine[lv] = {
        asShipped: {
          move: san(S, asShipped.move, true),
          foundIt: (asShipped.move.from + ':' + asShipped.move.to) === bestKey,
          isSelfCapture: asShipped.move.kind === 'self',
          score: asShipped.score, depthReached: asShipped.depth, timeBoundedSoNotReproducible: true
        },
        depthPinned: {
          move: san(S, pinned.move, true),
          foundIt: (pinned.move.from + ':' + pinned.move.to) === bestKey,
          isSelfCapture: pinned.move.kind === 'self',
          score: pinned.score, depthReached: pinned.depth
        }
      };
    });
    return row;
  });
}

/* ------------------------------ cli ------------------------------ */

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

if (require.main === module) {
  const onlyProbes = process.argv.includes('--probes');
  /* --probes writes somewhere else by default. It produces a report with no
     sample in it, and pointing it at the same file silently replaced a full
     measurement with a probes-only stub once already. */
  const out = arg('--out', path.join(__dirname, '..', '_context',
    onlyProbes ? 'ai-selfcapture-probes.json' : 'ai-selfcapture.json'));
  const opts = {
    games: onlyProbes ? 0 : parseInt(arg('--games', '40'), 10),
    positions: onlyProbes ? 0 : parseInt(arg('--positions', '600'), 10),
    depth: parseInt(arg('--depth', '4'), 10),
    seed: parseInt(arg('--seed', '20260917'), 10),
    maxPly: parseInt(arg('--maxply', '120'), 10),
    msBudget: parseInt(arg('--ms', '900000'), 10)
  };

  const report = { ranAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), budget: opts };

  if (!onlyProbes) {
    console.error('sampling: ' + opts.games + ' games + ' + opts.positions +
                  ' single decisions, depth ' + opts.depth + ', seed ' + opts.seed);
    const r = run(opts);
    Object.assign(report, r);
    console.error('engine decisions: ' + r.sample.engineDecisions +
                  '   self-captures chosen: ' + r.selfCapturesChosen + '   in ' + r.sample.seconds + 's');
    console.error('  forced             ' + r.buckets.forced);
    console.error('  escape-from-check  ' + r.buckets['escape-from-check']);
    console.error('  mate-delivering    ' + r.buckets['mate-delivering']);
    console.error('  OTHER              ' + r.buckets.other +
                  '   (' + r.otherKinds['forces-mate-in-2'] + ' force mate in two, ' +
                  r.otherKinds.quiet + ' quiet)');
    Object.keys(r.otherPreference).forEach(function (k) {
      console.error('      ' + String(r.otherPreference[k]).padStart(4) + '  ' + k);
    });
  }

  console.error('running ' + PROBES.length + ' constructed probe(s)...');
  report.probes = probes(PROBES);
  report.probes.forEach(function (p) {
    if (!p.probeValid) { console.error('  ' + p.id + '  PROBE NO LONGER VALID: ' + JSON.stringify(p.proof)); return; }
    console.error('  ' + p.id + '  best = ' + p.proof.bestMove + '  (unique forcing move, not a check, not mate-in-1)');
    ['easy', 'medium', 'hard'].forEach(function (lv) {
      const e = p.engine[lv];
      console.error('    ' + lv.padEnd(7) + 'as shipped ' + e.asShipped.move.padEnd(9) +
        (e.asShipped.foundIt ? 'FOUND IT ' : 'missed   ') +
        '| depth-pinned ' + e.depthPinned.move.padEnd(9) +
        (e.depthPinned.foundIt ? 'FOUND IT' : 'missed'));
    });
  });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.error('wrote ' + out);
}

module.exports = { classify, run, probes, proveProbe, PROBES, forcesMateIn2, isMate, preference, scoreRootMoves };
