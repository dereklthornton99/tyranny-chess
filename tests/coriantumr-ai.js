/*
 * coriantumr-ai.js -- the engine opponent in Coriantumr (R4-M3).
 *
 * What changes for the search in this rule set, and so what is checked:
 *   * there is no check, so the search must not filter captures by king safety (quiescence used to skip EVERY
 *     capture for a side with no king piece, which a queen-only side now is) and must not extend on "check";
 *   * a side with no pieces has lost, so capturing the last piece scores as a mate and losing your own last
 *     piece scores as a loss (a royal-less side with no move is still scored a draw, but a boxed-in royal now
 *     sacrifices itself instead, and there is no repetition or fifty-move draw in the variant);
 *   * a lone king can still capture a lone king, so there is no insufficient-material draw;
 *   * king and queen are one 4-square piece, so they get one value, and the evaluation is colour-symmetric.
 *
 * Like coriantumr.js this is a battery over an engine, run on the real engine and on deliberately broken ones.
 * Every position is built from a FEN; nothing depends on a random deal, and the games use seeded generators.
 */
const fs = require('fs');
const path = require('path');

const ENGINE_TEXT = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'coriantumr-golden.json'), 'utf8'));

function loadEngine(text) {
  const m = { exports: {} };
  new Function('module', 'exports', text)(m, m.exports);
  return m.exports;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function battery(E, opts) {
  opts = opts || {};
  const out = [];
  const t = (name, got, want) => out.push({ name, ok: String(got) === String(want), got, want });
  const C = (f) => { const S = E.fen(f); S.v = 'c'; return S; };
  const san = (S, m) => E.san(S, m, true);
  const reset = () => {
    E.ai.gameKeys = new Set(); E.ai.path = []; E.ai.killers = []; E.ai.hist = {};
    E.ai.depthDone = 1; E.ai.deadline = Infinity; E.ai.aborted = false; E.ai.selfCap = true; E.ai.cp = E.CPC;
    E.ai.rep = null; E.ai.gameCount = new Map();
  };
  const pieceCount = (S, side) => S.b.filter((p) => p && p[0] === side).length;

  // ---- R4-M3-AC1: no king safety anywhere in the search ----------------------------------------------
  reset();
  // White has only a queen, so no king piece. The old quiescence skipped every capture for such a side.
  const noKing = C('3r3k/8/3Q4/8/8/8/8/8 w - - 0 1');   // Black rook d8? no: rook d8 with the queen on d6 attacking it
  const hang = C('7k/8/3r4/8/3Q4/8/8/8 w - - 0 1');     // White Qd4 only; Black Rd6 is free, Kh8 cannot recapture
  const standPat = E.evaluate(hang);
  const q = E.qsearch(hang, -Infinity, Infinity, 0);
  t('a side with no king piece still sees its captures in quiescence (free rook: value rises by more than 300)',
    q > standPat + 300, true);
  t('CONTROL: the free rook really is there to be captured',
    E.legal(hang, true).some((m) => m.cap === 'br'), true);
  reset();
  t('no check extension: inCheck is false even with a king under attack',
    E.inCheck(C('4k3/8/8/8/8/8/8/4RK2 b - - 0 1'), 'b'), false);

  // ---- R4-M3-AC2: terminal scoring -------------------------------------------------------------------------
  reset();
  const last = C('4k3/8/8/8/8/8/8/4R2K w - - 0 1');
  let r = E.think(last, { ms: 300, maxDepth: 4, history: [last] });
  t('captures the opponent\'s last piece (Rxe8)', san(last, r.move), 'Rxe8');
  t('...and scores it as a mate', r.score >= E.MATE - 2, true);
  reset();
  const kk = C('k7/K7/8/8/8/8/8/8 w - - 0 1');
  r = E.think(kk, { ms: 300, maxDepth: 4, history: [kk] });
  t('lone king beside lone king: the side to move captures and wins (no insufficient-material draw)',
    san(kk, r.move) + '/' + (r.score >= E.MATE - 2), 'Kxa8/true');
  reset();
  const onlyQueen = C('3r3k/8/8/8/3Q4/8/8/8 w - - 0 1');   // Qxd8 Kxd8 would lose the queen, White's last piece
  r = E.think(onlyQueen, { ms: 400, maxDepth: 5, history: [onlyQueen] });
  const after = E.apply(onlyQueen, r.move);
  t('does not walk its last piece into a recapture (not Qxd8)', san(onlyQueen, r.move) === 'Qxd8', false);
  t('...and after its move the opponent cannot capture its last piece',
    E.legal(after, true).some((m) => m.cap && m.cap[0] === 'w'), false);
  reset();
  t('a position with pieces but no legal move scores as a draw',
    E.search(C('8/8/8/8/p7/P7/8/8 w - - 0 1'), 3, -Infinity, Infinity, 1), 0);
  reset();
  t('a side with no pieces scores as lost at the right ply',
    E.search(E.apply(last, E.legal(last, true).find((m) => m.cap === 'bk')), 3, -Infinity, Infinity, 1) <= -E.MATE + 50, true);

  // ---- R4-M3-AC3: evaluation ---------------------------------------------------------------------------------
  // ---- the owner's ending rules (2026-10-07) in the search -----------------------------------------------------------------
  const sqIdx = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
  const withLv = (f, spec) => {
    const S = C(f);
    if (spec) { S.lv = {}; for (const k of Object.keys(spec)) S.lv[k] = spec[k].map(sqIdx); }
    return S;
  };
  const stuckRow = GOLDEN.lone.find((r) => /sacrifices/.test(r.name));
  const sdStuck = withLv(stuckRow.fen, stuckRow.lv);
  reset();
  const stuckRes = E.think(sdStuck, { ms: 300, maxDepth: 3, history: [sdStuck] });
  t('a boxed-in lone royal plays its only move, the sacrifice', !!stuckRes && stuckRes.move.sac === true, true);
  t('...and scores it as a lost game (its side is left with no pieces)', stuckRes.score <= -E.MATE + 50, true);
  const afterStuck = E.apply(sdStuck, stuckRes.move);
  reset();
  t('a position where the OTHER side has no pieces is already a win for the side to move, with no further move needed',
    E.search(afterStuck, 0, -Infinity, Infinity, 0) >= E.MATE - 50, true);
  reset();
  const repP = C('7k/8/8/8/8/8/8/K6R w - - 0 1');
  E.ai.gameKeys = new Set(E.legal(repP, true).map((m) => E.zkey(E.apply(repP, m))));
  t('a repeated position is not a draw in Coriantumr (White is still seen a rook up)',
    E.search(repP, 1, -Infinity, Infinity, 0) > 300, true);
  reset();
  const sdFresh = C('8/7k/8/8/3K4/8/8/8 w - - 0 1');
  const lateRow = GOLDEN.lone.find((r) => /late showdown/.test(r.name));
  const sdSqueezed = withLv(lateRow.fen, lateRow.lv);
  t('the showdown is evaluated by free squares: both sides squeezed to a few squares scores far below the same position fresh',
    E.evaluate(sdSqueezed) < E.evaluate(sdFresh), true);
  t('CONTROL: the fresh showdown is not scored as a dead draw', E.evaluate(sdFresh) !== 0, true);
  // a last piece against more is also evaluated by the squares it has left: White (two pieces) is better the fewer Black has
  const richList = withLv('8/7k/8/8/3K4/8/8/R7 w - - 0 1', { b: ['h7'] });
  const poorList = withLv('8/7k/8/8/3K4/8/8/R7 w - - 0 1', { b: ['h7', 'h8', 'g8', 'h6', 'h5', 'h4', 'h3', 'g7', 'f7', 'e7', 'd7', 'g6', 'f5', 'e4', 'd3'] });
  t('a bound last piece with few squares left makes its side score worse (White to move scores better against the poorer list)',
    E.evaluate(poorList) > E.evaluate(richList), true);

  // ---- repetition is refused in the search as well (2026-10-07) ----------------------------------------------------------
  const uciOf = (m) => E.sqName(m.from) + E.sqName(m.to) + (m.promo || '');
  const repFen = '8/p6k/8/8/8/8/P7/1K6 w - - 0 1';
  let RS = C(repFen);
  const rstates = [RS];
  for (const u of ['b1b2', 'h7h8', 'b2b1', 'h8h7', 'b1b2', 'h7h8', 'b2b1']) {
    RS = E.apply(RS, E.legal(RS, true).find((x) => uciOf(x) === u));
    rstates.push(RS);
  }
  reset();
  const refusedRes = E.think(RS, { ms: 1e9, maxDepth: 3, history: rstates });
  t('the engine does not play the move that would be a third occurrence (Kh8-h7)', uciOf(refusedRes.move) !== 'h8h7', true);
  t('CONTROL: that move is an ordinary legal move, so only the repetition rule keeps the engine from it',
    E.legal(RS, true).some((m) => uciOf(m) === 'h8h7'), true);
  // the engine playing both sides of a position where shuffling is easy: no position may ever occur three times
  {
    reset();
    let G = C(repFen);
    const hist2 = [G], tally = {};
    const tick = (T) => { const k = E.repKey(T); tally[k] = (tally[k] || 0) + 1; return tally[k]; };
    tick(G);
    let worst = 1, plies = 0;
    for (; plies < 120; plies++) {
      const res = E.think(G, { ms: 1e9, maxDepth: 2, history: hist2 });
      G = E.apply(G, res.move); hist2.push(G);
      worst = Math.max(worst, tick(G));
      if (!E.hasPieces(G, 'w') || !E.hasPieces(G, 'b')) break;
    }
    t('the engine playing both sides never lets a position occur a third time (most seen: ' + worst + ', over ' + plies + ' plies)', worst <= 2, true);
  }
  const flipTurn = Object.assign({}, RS, { turn: RS.turn === 'w' ? 'b' : 'w' });
  t('the engine names a position by placement AND side to move: the same pieces with the other side to move differ', E.repKey(RS) !== E.repKey(flipTurn), true);
  // every ordinary move refused: the engine sacrifices
  reset();
  const lone = C('8/7k/8/8/8/8/8/KR6 w - - 0 1');
  const kids = E.legal(lone, true).map((m) => E.apply(lone, m));
  const allRefused = E.think(lone, { ms: 1e9, maxDepth: 2, history: [lone].concat(kids, kids) });
  t('when every ordinary move would be a third occurrence the engine sacrifices its royal piece', allRefused.move.sac === true, true);
  // the search itself applies the rule inside its lines: with every position "seen twice" a lone king has only the sacrifice
  reset();
  E.think(C(repFen), { ms: 50, maxDepth: 1, history: [C(repFen)] });                  // builds the closure the search uses
  E.ai.rep = { keyOf: E.repKey, seen: () => 2 };
  const loneBlack = C('k7/8/8/8/8/8/8/KR6 b - - 0 1');
  t('inside a line, a side whose every move is a third occurrence loses its last piece (scored as lost)',
    E.search(loneBlack, 1, -Infinity, Infinity, 0) <= -E.MATE + 50, true);
  reset();
  E.think(C(repFen), { ms: 50, maxDepth: 1, history: [C(repFen)] });
  E.ai.gameCount = new Map([[777, 1]]); E.ai.path = [777, 777];
  t('the search counts the line it is searching as well as the game so far (1 + 2 = 3)', E.ai.rep.seen(777), 3);
  reset();

  const withQueen = C('3r3k/8/8/8/3Q4/8/8/8 w - - 0 1');
  const withKing = C('3r3k/8/8/8/3K4/8/8/8 w - - 0 1');
  t('king and queen on the same square are worth the same', E.evaluate(withKing), E.evaluate(withQueen));
  const mirrorState = (S) => {
    const b = new Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      const p = S.b[i];
      if (p) b[(7 - E.rOf(i)) * 8 + E.cOf(i)] = (p[0] === 'w' ? 'b' : 'w') + p[1];
    }
    return { b, turn: S.turn === 'w' ? 'b' : 'w', cast: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1, v: 'c' };
  };
  let asym = 0, probed = 0;
  for (const row of GOLDEN.children.slice(0, 60)) {
    const S = C(row.fen);
    probed++;
    if (E.evaluate(S) !== E.evaluate(mirrorState(S))) asym++;
  }
  t('evaluation is colour-symmetric in ' + probed + ' positions (a position and its colour-flipped mirror score the same)', asym, 0);
  t('CONTROL: the evaluation is not trivially zero',
    GOLDEN.children.slice(0, 60).some((row) => E.evaluate(C(row.fen)) !== 0), true);
  t('there is no bare-king or king-safety term: a lone king far from the action scores like a lone queen there',
    E.evaluate(C('7k/8/8/8/8/8/8/K6R w - - 0 1')), E.evaluate(C('7k/8/8/8/8/8/8/Q6R w - - 0 1')));

  // ---- R4-M3-AC5: the time budget holds in the variant, at each strength -------------------------------------
  if (!opts.fast) {
    for (const [label, ms, depth] of [['Easy', 150, 2], ['Medium', 600, 6], ['Hard', 1800, 9]]) {
      reset();
      const start = C('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
      const res = E.think(start, { ms, maxDepth: depth, history: [start] });
      t(label + ' move on the start position finishes within 1.7x its budget plus 200ms (' + res.ms + 'ms of ' + ms + ')',
        res.ms < ms * 1.7 + 200, true);
    }
  }

  // ---- R4-M3-AC4: games terminate, with no illegal move and no exception (counts are reported by the caller) --
  if (opts.games) {
    const stats = { games: 0, plies: 0, illegal: 0, tagLost: 0, ended: 0, capped: 0, draws: 0, engineWins: 0, randomWins: 0 };
    for (let g = 0; g < opts.games; g++) {
      const rnd = mulberry32(900 + g);
      const engineIsWhite = g % 2 === 0;
      let S = E.startState('c');
      const hist = [S];
      let over = false;
      for (let ply = 0; ply < 120 && !over; ply++) {
        const ms = E.legal(S, true);
        if (!ms.length) {
          over = true; stats.ended++;
          if (!E.hasPieces(S, S.turn)) { const winner = S.turn === 'w' ? 'b' : 'w'; ((winner === 'w') === engineIsWhite ? stats.engineWins++ : stats.randomWins++); }
          else stats.draws++;
          break;
        }
        const engineMove = (S.turn === 'w') === engineIsWhite;
        let m;
        if (engineMove) {
          const res = E.think(S, { ms: 4, maxDepth: 3, history: hist });
          m = res.move;
          if (!ms.some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)) stats.illegal++;
        } else {
          const caps = ms.filter((x) => x.cap);
          m = caps.length && rnd() < 0.5 ? caps[(rnd() * caps.length) | 0] : ms[(rnd() * ms.length) | 0];
        }
        S = E.apply(S, m);
        hist.push(S);
        stats.plies++;
        if (S.v !== 'c') stats.tagLost++;
      }
      if (!over) stats.capped++;
      stats.games++;
    }
    out.stats = stats;
    t('every engine move is legal (' + stats.plies + ' plies in ' + stats.games + ' short games against a random mover)', stats.illegal, 0);
    t('the rule-set tag survives engine play', stats.tagLost, 0);
    t('every game either ended or hit the ply cap (none hung or threw)', stats.ended + stats.capped, stats.games);
  }
  // ---- seeded engine-versus-engine showdowns: every one ends, by capture or sacrifice, inside the 62-move bound ----------
  if (opts.showdowns) {
    const st = { games: 0, ended: 0, byCapture: 0, bySacrifice: 0, longest: 0, sideToMoveWins: 0, illegal: 0, bad: 0 };
    for (let g = 0; g < opts.showdowns; g++) {
      const rnd = mulberry32(3000 + g);
      let S = null;
      while (!S) {
        const a = (rnd() * 64) | 0, b2 = (rnd() * 64) | 0;
        if (a === b2) continue;
        const bd = new Array(64).fill(null);
        bd[a] = 'wk'; bd[b2] = 'bk';
        const cand = { b: bd, turn: 'w', cast: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1, v: 'c' };
        if (!E.legal(cand, true).some((m) => m.cap)) S = cand;
      }
      const hist = [S];
      const made = { w: 0, b: 0 };
      let n = 0;
      while (n < 200) {
        const res = E.think(S, { ms: 1e9, maxDepth: opts.showdownDepth || 2, history: hist });
        const ms = E.legal(S, true);
        if (!ms.some((x) => x.from === res.move.from && x.to === res.move.to && x.promo === res.move.promo)) st.illegal++;
        const T = E.apply(S, res.move);
        n++;
        if (!E.hasPieces(T, 'w') || !E.hasPieces(T, 'b')) {
          st.ended++;
          res.move.sac ? st.bySacrifice++ : st.byCapture++;
          if (E.hasPieces(T, 'w')) st.sideToMoveWins++;
          break;
        }
        made[S.turn]++;
        if (!T.lv || !T.lv.w || !T.lv.b || T.lv.w.length !== 1 + made.w || T.lv.b.length !== 1 + made.b) st.bad++;
        S = T; hist.push(S);
      }
      st.games++; st.longest = Math.max(st.longest, n);
    }
    out.showdowns = st;
    t('every engine move in ' + st.games + ' showdowns is legal', st.illegal, 0);
    t('each side\'s list of used squares is carried correctly through every engine showdown move', st.bad, 0);
    t('every engine showdown ended by capture or sacrifice within the bound of 63 landings a side (longest ' + st.longest + ' plies)',
      st.ended === st.games && st.longest <= 127, true);
  }
  return out;
}

// ============================================================================ run
let pass = 0, fail = 0;
const failures = [];
const hd = (title) => console.log('\n== ' + title);
function report(list) {
  for (const r of list) {
    if (r.ok) pass++;
    else { fail++; failures.push(r.name); console.log('FAIL  ' + r.name + '   got ' + r.got + ', want ' + r.want); }
  }
}

hd('Coriantumr engine opponent');
const REAL = loadEngine(ENGINE_TEXT);
const results = battery(REAL, { games: 6, showdowns: 60 });
report(results);
const s = results.stats;
const sd = results.showdowns;
console.log('      ' + sd.games + ' engine showdowns: ' + sd.byCapture + ' ended by capture, ' + sd.bySacrifice + ' by sacrifice, the side to move won ' + sd.sideToMoveWins + ', longest ' + sd.longest + ' plies');
console.log('      ' + results.length + ' checks; ' + s.games + ' short games (' + s.plies + ' plies): ' + s.ended +
  ' ended (' + s.engineWins + ' engine wins, ' + s.randomWins + ' random wins, ' + s.draws + ' draws), ' + s.capped + ' reached the ply cap');

const MUTANTS = [
  ['quiescence filters captures by king safety in the variant',
   'if(S.v !== "c"){ var k=kingSq(T,side); if(k<0 || attacked(T,k,opp)) continue; }',
   'var k=kingSq(T,side); if(k<0 || attacked(T,k,opp)) continue;'],
  ['losing your last piece is not scored as a loss', 'return hasPieces(S, side) ? 0 : -MATE+ply;', 'return 0;'],
  ['an insufficient-material draw applies in the variant', 'if(S.v !== "c" && insufficient(S.b)) return 0;', 'if(insufficient(S.b)) return 0;'],
  ['the king gets the king-safety table in the variant', 'tbl = PST[t === "k" ? "q" : t];', 'tbl = PST[t];'],
  ['the king is worth nothing in the variant', 'var CPC = {p:100, n:320, b:330, r:500, q:800, k:800};', 'var CPC = {p:100, n:320, b:330, r:500, q:800, k:0};'],
  ['the variant uses the standard evaluation', 'if(S.v === "c") return evaluateC(S);', ''],
  ['white is favoured by the variant evaluation', 'else             score -= CPC[t] + tbl[mirror(i)];', 'else             score -= CPC[t] + tbl[mirror(i)] + 7;'],
  ['a side emptied by a sacrifice is not scored as won', 'if(S.v === "c" && !hasPieces(S, S.turn === "w" ? "b" : "w")) return MATE - ply;', ''],
  ['a repeated position is a draw in the variant', 'if(S.v !== "c" && ply>0 && (ai.gameKeys', 'if(ply>0 && (ai.gameKeys'],
  ['the showdown has no evaluation of its own', 'if(uw && ub) return showdownEval(S, uw, ub);', ''],
  ['the showdown evaluation counts the wrong side', 'freeMoves({b:S.b, turn:me, cast:S.cast, ep:-1, v:"c"}, me, mine)', 'freeMoves({b:S.b, turn:them, cast:S.cast, ep:-1, v:"c"}, them, theirs)'],
  ['a bound last piece is not evaluated by its squares left', 'score += (lone === "w" ? 1 : -1) * 4 * left;', ''],
  ['the search ignores the line it is searching', 'for(var q=0;q<ai.path.length;q++) if(ai.path[q] === k) n++;', ''],
  ['the repetition key ignores whose move it is', 'if(S.turn === "b") h ^= Z.side;\n  if(S.ep >= 0) h ^= Z.ep[cOf(S.ep)];', 'if(S.ep >= 0) h ^= Z.ep[cOf(S.ep)];'],
  ['the search ignores the game so far', 'var n = ai.gameCount.get(k) || 0;', 'var n = 0;'],
  ['the root move ignores the repetition rule', 'if(S.v === "c"){ ms = legalC(S, pseudo(S, S.turn, false), ai.rep); if(!ms.length) return null; }', ''],
  ['the search lines ignore the repetition rule', '(S.v === "c") ? legalC(S, pseudo(S, side, false), ai.rep) : legal(S, ai.selfCap)', 'legal(S, ai.selfCap)'],
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
    const failed = battery(loadEngine(ENGINE_TEXT.replace(from, to)), { fast: true }).filter((r) => !r.ok);
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
