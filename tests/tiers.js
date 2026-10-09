/*
 * tiers.js -- the two engine options the weaker tiers use (R5): seeded move sampling (temp) and the bare-king approach
 * weight (mop). Both are off unless asked for, and Hard asks for neither, so what must hold is:
 *
 *   1. off means off: with temp absent or 0 the engine's move, score, depth and node count are what they always were, and
 *      one call's mop never leaks into the next;
 *   2. sampling is a weakness of a particular kind: only legal moves, never a self-capture, never a move scoring more than
 *      3 x temp below the best, never when the best is a forced mate or the only move, replayable from a seed, weighted by
 *      score (the best move is drawn about as often as the formula says), and a higher temperature really does pick worse moves;
 *   3. mop changes only bare-king endings, and its default is the 4 the evaluation always used.
 *
 * Like the other engine suites this is a battery run on the real engine and on deliberately broken ones. Every position is a
 * FEN and every draw is seeded; nothing depends on the clock (depth binds, time never does) or on a random deal.
 * The page's own tier table is read from src/tyranny.html and pinned below. That Hard is bit-for-bit what it was at commit
 * 69f47e2 is proved separately, by tools/ai-audit/hard_equality_all.sh, which compares 2,948 searches.
 */
const fs = require('fs');
const path = require('path');

const ENGINE_TEXT = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'tyranny.html'), 'utf8');

function loadEngine(text) {
  const m = { exports: {} };
  new Function('module', 'exports', text)(m, m.exports);
  return m.exports;
}

const P = {
  start: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  openGame: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  middle: 'r3k2r/pp1qppbp/2n1bnp1/2p5/2p4N/P2P2P1/1P1NPPBP/1RBQ1RK1 w kq - 0 11',
  endgame: '8/5pk1/6p1/3P4/4K3/8/5PPP/8 w - - 0 40',
};
const MATE_IN_1 = '6k1/5ppp/8/3n4/8/8/8/R6K w - - 0 1';           // Ra8# (Black keeps a knight on d5, so this is not a bare-king ending)
const ONE_REPLY = '5K2/7k/8/8/4q3/8/8/4r3 w - - 0 1';           // White has exactly one legal move (asserted below)
const KQK = '8/5Q2/8/4k3/8/5K2/8/8 w - - 0 1';                   // some queen moves hang the queen: moves far below the best exist

function battery(E, opts) {
  opts = opts || {};
  const out = [];
  const t = (name, got, want) => out.push({ name, ok: String(got) === String(want), got, want });
  const uci = (m) => E.sqName(m.from) + E.sqName(m.to) + (m.promo || '');
  const same = (a, b) => a && b && a.move.from === b.move.from && a.move.to === b.move.to && a.move.promo === b.move.promo &&
    a.score === b.score && a.depth === b.depth && a.nodes === b.nodes;
  const run = (fen, o, selfCap, depth) => {
    const S = E.fen(fen);
    return E.think(S, Object.assign({ ms: 1e9, maxDepth: depth || 3, selfCap: !!selfCap, history: [S] }, o || {}));
  };
  const exactScore = (fen, m, depth, selfCap) => {           // the full-window score of one root move, from the mover's side
    const S = E.fen(fen), ai = E.ai;
    ai.nodes = 0; ai.aborted = false; ai.selfCap = !!selfCap; ai.killers = []; ai.hist = {}; ai.path = []; ai.depthDone = 1; ai.deadline = Infinity;
    ai.gameKeys = new Set([E.zkey(S)]);
    return -E.search(E.apply(S, m), depth - 1, -Infinity, Infinity, 1);
  };

  // ---- 1. off means off ---------------------------------------------------------------------------------------
  for (const n of ['start', 'openGame', 'endgame']) {
    const a = run(P[n]), b = run(P[n], { temp: 0 }), c = run(P[n], { temp: undefined, seed: 99, mop: undefined });
    t('temp absent, temp 0 and an unused seed give the identical result (' + n + ')', same(a, b) && same(a, c), true);
    t('and no sampling is reported (' + n + ')', a.sampled === undefined && b.sampled === undefined, true);
  }
  t('the same call twice is identical (the search is deterministic at a pinned depth)', same(run(P.openGame), run(P.openGame)), true);

  // ---- 2. sampling ---------------------------------------------------------------------------------------------
  const T = 100;
  const cases = [['start', false], ['endgame', false], ['endgame', true]];
  if (opts.full) cases.push(['middle', false], ['middle', true]);
  for (const [n, selfCap] of cases) {
    const seeds = n === 'middle' ? 6 : 10;
    const S = E.fen(P[n]);
    const legal = new Set(E.legal(S, selfCap).map(uci));
    const best = run(P[n], null, selfCap);
    let allLegal = true, anyDiff = false, withinMargin = true, noSelf = true;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = run(P[n], { temp: T, seed }, selfCap);
      if (!legal.has(uci(r.move))) allLegal = false;
      if (r.move.kind === 'self') noSelf = false;
      if (uci(r.move) !== uci(best.move)) {
        anyDiff = true;
        if (exactScore(P[n], r.move, best.depth, selfCap) < best.score - 3 * T - 1) withinMargin = false;
      }
    }
    const tag = ' (' + n + ', self-capture ' + (selfCap ? 'on' : 'off') + ')';
    t('every sampled move is legal' + tag, allLegal, true);
    t('every sampled move scores within 3 x temp of the best' + tag, withinMargin, true);
    t('sampling is not a self-capture' + tag, noSelf, true);
    t('CONTROL: sampling does sometimes play something other than the best move' + tag, anyDiff, true);
  }
  // the sampler itself, with the random draw replaced by a fixed number so the outcome is exact: 0 picks the first candidate (the
  // best), just under 1 picks the LAST one, which must still be inside the margin. Root moves are handed over best first.
  {
    const S = E.fen(KQK), base = run(KQK, null, false, 3);
    const ranked = E.legal(S, false).map((m) => ({ m, v: exactScore(KQK, m, base.depth, false) })).sort((a, b) => b.v - a.v);
    const ms = ranked.map((x) => x.m), worst = ranked[ranked.length - 1].v;
    t('CONTROL: some root move is more than 3 x 100 below the best (a queen hang), or the margin test below is vacuous', worst < base.score - 300, true);
    E.ai.nodes = 0; E.ai.aborted = false; E.ai.selfCap = false; E.ai.killers = []; E.ai.hist = {}; E.ai.path = []; E.ai.depthDone = 1; E.ai.gameKeys = new Set([E.zkey(S)]);
    const first = E.sampleRoot(S, ms, base.move, base.score, base.depth, 100, () => 0);
    t('a draw of 0 picks the best move', uci(first), uci(base.move));
    E.ai.path = [];
    const last = E.sampleRoot(S, ms, base.move, base.score, base.depth, 100, () => 0.999999);
    const lastScore = exactScore(KQK, last, base.depth, false);
    t('a draw just under 1 picks the last candidate, and that move is still within 3 x temp of the best', lastScore >= base.score - 300 - 1 && lastScore < base.score, true);
  }
  // a huge temperature makes every move a candidate, so a rule that merely fails to PREFER good moves cannot hide
  let selfDrawn = false, mateSampledAway = false;
  for (let seed = 1; seed <= 40; seed++) if (run(P.endgame, { temp: 5000, seed }, true).move.kind === 'self') selfDrawn = true;
  for (let seed = 1; seed <= 20; seed++) if (uci(run(MATE_IN_1, { temp: 1e6, seed }).move) !== 'a1a8') mateSampledAway = true;
  t('CONTROL: a self-capture is legal in the endgame position when self-capture is on', E.legal(E.fen(P.endgame), true).some((m) => m.kind === 'self'), true);
  t('even with a huge temperature and self-capture on, sampling never draws a self-capture', selfDrawn, false);
  t('even with a huge temperature, a found mate is always played', mateSampledAway, false);
  let kqkSampled = false;
  for (let seed = 1; seed <= 20; seed++) if (run(KQK, { temp: 5000, seed }).sampled) kqkSampled = true;
  t('in a bare-king ending sampling is switched off: the side that is ahead always plays its best move', kqkSampled, false);
  const oneLegal = E.legal(E.fen(ONE_REPLY), false);
  t('CONTROL: the single-reply position really has exactly one legal move', oneLegal.length, 1);
  let oneOk = oneLegal.length === 1;
  for (let seed = 1; seed <= 10 && oneOk; seed++) if (uci(run(ONE_REPLY, { temp: 1e6, seed }).move) !== uci(oneLegal[0])) oneOk = false;
  t('with one legal move, sampling returns it', oneOk, true);

  const a1 = run(P.openGame, { temp: 1e4, seed: 7 }), a2 = run(P.openGame, { temp: 1e4, seed: 7 });
  t('the same seed on the same position gives the same move', uci(a1.move), uci(a2.move));
  const distinct = new Set();
  for (let seed = 1; seed <= 24; seed++) distinct.add(uci(run(P.start, { temp: T, seed }).move));
  t('different seeds give different moves from the start position (at least 4 different first moves in 24 draws)', distinct.size >= 4, true);

  // the weights: with temperature 40 the best move should be drawn about as often as 1 / sum(exp((score - best) / 40)) says
  const S0 = E.fen(P.endgame), best0 = run(P.endgame);
  const ex = E.legal(S0, false).map((m) => ({ u: uci(m), v: exactScore(P.endgame, m, best0.depth, false) }));
  const top = Math.max(...ex.map((x) => x.v));
  const expected = 1 / ex.filter((x) => x.v >= top - 120).reduce((s, x) => s + Math.exp((x.v - top) / 40), 0);
  let hits = 0;
  const N = 120;
  for (let seed = 1; seed <= N; seed++) if (uci(run(P.endgame, { temp: 40, seed: 1000 + seed }).move) === uci(best0.move)) hits++;
  t('the best move is drawn about as often as the weights say (expected ' + expected.toFixed(2) + ', within 0.13)', Math.abs(hits / N - expected) <= 0.13, true);

  const mean = (temp) => {
    let sum = 0;
    for (let seed = 1; seed <= 40; seed++) sum += exactScore(P.endgame, run(P.endgame, { temp, seed }).move, 3, false);
    return sum / 40;
  };
  t('a higher temperature plays worse moves on average (mean score at 20 > at 300)', mean(20) > mean(300), true);

  // ---- 3. the bare-king approach weight ---------------------------------------------------------------------------
  const d4 = run(KQK, { maxDepth: 1 }, false, 1), d4x = run(KQK, { mop: 4 }, false, 1), d30 = run(KQK, { mop: 30 }, false, 1);
  t('mop 4 is the default: explicit 4 equals absent in a king-and-queen ending', same(d4, d4x), true);
  t('mop 30 changes the evaluation in a king-and-queen ending', d30.score !== d4.score, true);
  let midSame = true;
  for (const n of ['start', 'openGame', 'middle']) midSame = midSame && same(run(P[n], null, false, 2), run(P[n], { mop: 30 }, false, 2));
  t('mop changes nothing outside bare-king endings (three middlegame positions identical)', midSame, true);
  run(KQK, { mop: 30 }, false, 1);
  t('one call\'s mop does not leak into the next call', same(run(KQK, null, false, 1), d4), true);
  return out;
}

let pass = 0, fail = 0;
const failures = [];
const hd = (title) => console.log('\n== ' + title);
function report(list) {
  for (const r of list) {
    if (r.ok) pass++;
    else { fail++; failures.push(r.name); console.log('FAIL  ' + r.name + '   got ' + r.got + ', want ' + r.want); }
  }
}

hd('The weaker tiers\' options: seeded sampling and the bare-king weight');
const REAL = loadEngine(ENGINE_TEXT);
const results = battery(REAL, { full: true });
report(results);
console.log('      ' + results.length + ' checks on the real engine');

hd('The page\'s tier table');
const lm = PAGE.match(/var LEVELS\s*=\s*(\{[^;]*\});/);
const LEVELS = lm ? (new Function('return (' + lm[1] + ')'))() : null;
const chk = (name, got, want) => report([{ name, ok: JSON.stringify(got) === JSON.stringify(want), got: JSON.stringify(got), want: JSON.stringify(want) }]);
chk('the tier table is found in the page', !!LEVELS, true);
if (LEVELS) {
  chk('Hard is exactly what it has always been: 1800 ms, depth 9, no sampling, the default mating weight', LEVELS.hard, { ms: 1800, depth: 9 });
  chk('Easy and Medium carry a sampling temperature and a mating weight', [typeof LEVELS.easy.temp, typeof LEVELS.easy.mop, typeof LEVELS.medium.temp, typeof LEVELS.medium.mop], ['number', 'number', 'number', 'number']);
  chk('the three tiers are ordered by depth (Easy below Medium below Hard)', LEVELS.easy.depth < LEVELS.medium.depth && LEVELS.medium.depth < LEVELS.hard.depth, true);
}
chk('the page hands temp and mop to the engine', /think\(S, \{[^}]*temp:L\.temp[^}]*mop:L\.mop/.test(PAGE), true);

const MUTANTS = [
  ['sampling ignores the margin', 'lo = bestScore - 3*temp - 1,', 'lo = -Infinity,'],
  ['sampling may draw a self-capture', 'if(sameMove(m, best) || m.kind === "self") continue;', 'if(sameMove(m, best)) continue;'],
  ['sampling ignores the seed', 'mulberry32(opts.seed !== undefined ? opts.seed : (Math.random() * 4294967296) >>> 0)', 'mulberry32((Math.random() * 4294967296) >>> 0)'],
  ['a found mate can be sampled away', 'if(Math.abs(bestScore) >= MATE - 200 || ms.length < 2) return best;', 'if(ms.length < 2) return best;'],
  ['every candidate has the same weight', 'w[i] = Math.exp((cands[i].v - bestScore) / temp);', 'w[i] = 1;'],
  ['the default mating weight is wrong', 'ai.mop = (opts.mop === undefined) ? 4 : opts.mop;', 'ai.mop = (opts.mop === undefined) ? 5 : opts.mop;'],
  ['a call\'s mating weight leaks into the next', 'ai.mop = (opts.mop === undefined) ? 4 : opts.mop;', 'if(opts.mop !== undefined) ai.mop = opts.mop;'],
  ['sampling continues in bare-king endings', 'if(opts.temp > 0 && ai.depthDone >= 1 && !(S.v !== "c" && bareKingEnding(S))){', 'if(opts.temp > 0 && ai.depthDone >= 1){'],
  ['the mating weight applies outside bare-king endings', 'if(bNP===0 && wNP>=500 && wK>=0 && bK>=0) score += mopUp(wK,bK);', 'if(wNP>=500 && wK>=0 && bK>=0) score += mopUp(wK,bK);'],
];

hd('Mutation: the checks above must be able to fail (' + MUTANTS.length + ' deliberate breaks of the engine source)');
for (const [name, from, to] of MUTANTS) {
  const occurrences = ENGINE_TEXT.split(from).length - 1;
  if (occurrences !== 1) {
    fail++; failures.push('mutant anchor: ' + name);
    console.log('FAIL  mutant "' + name + '": anchor occurs ' + occurrences + ' times, expected exactly 1');
    continue;
  }
  let verdict;
  try {
    const failed = battery(loadEngine(ENGINE_TEXT.replace(from, to))).filter((r) => !r.ok);
    verdict = failed.length ? 'caught by ' + failed.length + ' check(s), first: "' + failed[0].name.slice(0, 70) + '"' : null;
  } catch (e) {
    verdict = 'caught: the broken engine threw (' + String(e.message).slice(0, 50) + ')';
  }
  if (verdict) { pass++; console.log('PASS  mutant "' + name + '"   ' + verdict); }
  else { fail++; failures.push('MUTANT SURVIVED: ' + name); console.log('FAIL  MUTANT SURVIVED: ' + name); }
}

hd(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
