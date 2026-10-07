/*
 * coriantumr.js -- the Coriantumr rule set in the engine, held to three independent standards.
 *
 *   1. The GOLDEN FIXTURE (tests/coriantumr-golden.json), produced by tools/coriantumr-ref.py: a second
 *      implementation written from the rules text in another language. It records perft counts and, for 300
 *      sampled positions, a digest of EVERY legal move together with the board it produces, so a wrong
 *      succession choice anywhere in 300 positions changes a hash.
 *   2. HAND DERIVATIONS written out below (perft(3) = 8,902 + 20 x 11 = 9,122) and hand-built positions whose
 *      answer can be checked by eye.
 *   3. MUTATION: the engine source is deliberately broken nineteen ways and every break must be caught by a
 *      named check. A battery that has only ever passed has not been shown able to fail.
 *
 * The battery is a function of an engine, so the unbroken engine and each mutant run exactly the same checks.
 * Fixtures are built from FENs or seeded generators: nothing here depends on a random deal.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENGINE_TEXT = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'coriantumr-golden.json'), 'utf8'));
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';

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

/* Every check, as data: [{name, ok, got, want}]. Run against the real engine and against each mutant. */
function battery(E) {
  const out = [];
  const t = (name, got, want) => out.push({ name, ok: String(got) === String(want), got, want });
  const C = (f) => { const S = E.fen(f); S.v = 'c'; return S; };
  const uci = (m) => E.sqName(m.from) + E.sqName(m.to) + (m.promo || '');
  const sq = (name) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
  const at = (T, name) => T.b[sq(name)];
  const play = (f, u) => {
    const S = C(f), m = E.legal(S, true).find((x) => uci(x) === u);
    return m ? E.apply(S, m) : null;
  };
  const placement = (b) => {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '', empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = b[r * 8 + c];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p[0] === 'w' ? p[1].toUpperCase() : p[1];
      }
      rows.push(row + (empty || ''));
    }
    return rows.join('/');
  };
  const keyOf = (T) => placement(T.b) + ' ' + T.turn + ' ' + (T.ep >= 0 ? E.sqName(T.ep) : '-');
  const digest = (S) => {
    const items = E.legal(S, true).map((m) => uci(m) + '=' + keyOf(E.apply(S, m))).sort();
    return { n: items.length, sha1: crypto.createHash('sha1').update(items.join('\n')).digest('hex') };
  };
  const reachOf = (f, from) => E.legal(C(f), true).filter((m) => m.from === sq(from));
  const dist = (m) => Math.max(Math.abs(E.rOf(m.from) - E.rOf(m.to)), Math.abs(E.cOf(m.from) - E.cOf(m.to)));

  // ---- R4-M1-AC1: the 4-square king and queen, and nobody else changed ----------------------
  t('queen on d4, empty board: 27 moves', reachOf('k7/8/8/8/3Q4/8/8/8 w - - 0 1', 'd4').length, 27);
  t('king on d4, empty board: 27 moves (it moves like the queen)', reachOf('k7/8/8/8/3K4/8/8/8 w - - 0 1', 'd4').length, 27);
  t('queen on a1: 12 moves, because every ray is cut at 4', reachOf('k7/8/8/8/8/8/8/Q7 w - - 0 1', 'a1').length, 12);
  t('king on a1: 12 moves', reachOf('k7/8/8/8/8/8/8/K7 w - - 0 1', 'a1').length, 12);
  t('no king or queen move is ever longer than 4 squares (queen on a1)',
    reachOf('k7/8/8/8/8/8/8/Q7 w - - 0 1', 'a1').every((m) => dist(m) <= 4), true);
  t('the 5th square along a ray is not reachable (queen a1 cannot go to a6)',
    reachOf('k7/8/8/8/8/8/8/Q7 w - - 0 1', 'a1').some((m) => E.sqName(m.to) === 'a6'), false);
  const northOf = (f) => reachOf(f, 'd4').filter((m) => E.cOf(m.to) === 3 && E.rOf(m.to) < E.rOf(m.from)).length;
  t('a friendly pawn blocks the ray and cannot be captured (d5 only)', northOf('k7/8/3P4/8/3Q4/8/8/8 w - - 0 1'), 1);
  t('an enemy pawn blocks the ray and can be captured (d5 and d6)', northOf('k7/8/3p4/8/3Q4/8/8/8 w - - 0 1'), 2);
  t('a rook is unchanged: 14 from d4', reachOf('k7/8/8/8/3R4/8/8/8 w - - 0 1', 'd4').length, 14);
  t('a bishop is unchanged: 13 from d4', reachOf('k7/8/8/8/3B4/8/8/8 w - - 0 1', 'd4').length, 13);
  t('a knight is unchanged: 8 from d4', reachOf('k7/8/8/8/3N4/8/8/8 w - - 0 1', 'd4').length, 8);

  // ---- R4-M1-AC2: no check, no mate, no castling ---------------------------------------------
  const pin = '4r3/8/8/8/8/8/4R3/4K3 w - - 0 1';
  t('CONTROL: in standard chess the pinned rook cannot leave the file',
    E.legal(E.fen(pin), false).some((m) => uci(m) === 'e2d2'), false);
  t('in Coriantumr a pinned piece may move (the king is only a piece)',
    E.legal(C(pin), true).some((m) => uci(m) === 'e2d2'), true);
  const castleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  t('CONTROL: standard chess does offer castling in this position',
    E.legal(E.fen(castleFen), false).some((m) => m.castle), true);
  t('Coriantumr offers no castling move', E.legal(C(castleFen), true).some((m) => m.castle), false);
  t('...but the king may still slide to g1 as an ordinary move',
    E.legal(C(castleFen), true).some((m) => uci(m) === 'e1g1' && !m.castle), true);
  const kingTaken = play('4k3/8/8/8/8/8/8/4RK2 w - - 0 1', 'e1e8');
  t('a king can be captured like any piece', !!kingTaken && E.hasPieces(kingTaken, 'b'), false);
  t('...and a side with no pieces has no moves (it has lost)',
    kingTaken ? E.legal(kingTaken, true).length : -1, 0);
  t('CONTROL: standard chess sees check here', E.inCheck(E.fen('4k3/8/8/8/8/8/8/4RK2 b - - 0 1'), 'b'), true);
  t('Coriantumr never reports check', E.inCheck(C('4k3/8/8/8/8/8/8/4RK2 b - - 0 1'), 'b'), false);

  // ---- R4-M1-AC3: no self-capture, whatever the flag says -----------------------------------
  t('CONTROL: outside the variant the flag changes the move list (39 against 20)',
    E.legal(E.startState(), true).length + '/' + E.legal(E.startState(), false).length, '39/20');
  let leaks = 0, probed = 0;
  const probes = [START_FEN].concat(GOLDEN.children.slice(0, 40).map((r) => r.fen));
  for (const f of probes) {
    const S = C(f);
    const a = E.legal(S, true).map(uci).join(), b = E.legal(S, false).map(uci).join();
    probed++;
    if (a !== b) leaks++;
  }
  t('the self-capture flag changes nothing in ' + probed + ' variant positions', leaks, 0);

  // ---- R4-M1-AC4 and AC5: succession ----------------------------------------------------------
  const queenLives = play('3rk3/8/8/8/3K4/8/1B3B2/Q7 b - - 0 1', 'd8d4');
  t('king captured while the queen lives: the queen is untouched', queenLives && at(queenLives, 'a1'), 'wq');
  t('...and nothing else on that side changes (bishops stay bishops)',
    queenLives && at(queenLives, 'b2') + at(queenLives, 'f2'), 'wbwb');
  t('...and nothing is recorded as crowned', queenLives && queenLives.cr, undefined);
  const qOnly = play('3rk3/8/8/8/3Q4/8/1B3B2/8 b - - 0 1', 'd8d4');
  t('queen is the only royal and falls: a bishop is crowned, the tie on distance goes to the lower FILE (b2)',
    qOnly && at(qOnly, 'b2') + at(qOnly, 'f2'), 'wkwb');
  t('...the crowning is reported as [square, former piece]', qOnly && qOnly.cr && qOnly.cr.join(), sq('b2') + ',wb');
  const tieRank = play('4k3/8/3B4/8/3Q3r/8/3B4/8 b - - 0 1', 'h4d4');
  t('tie on distance AND file: the lower RANK is crowned (d2, not d6)',
    tieRank && at(tieRank, 'd2') + at(tieRank, 'd6'), 'wkwb');
  const noBishop = play('3rk3/8/8/1N6/3Q4/8/5N2/8 b - - 0 1', 'd8d4');
  t('no bishop: the closest knight is crowned (b5, not f2)',
    noBishop && at(noBishop, 'b5') + at(noBishop, 'f2'), 'wkwn');
  const noKnight = play('3rk3/8/8/8/3Q4/8/R6R/8 b - - 0 1', 'd8d4');
  t('no bishop or knight: the closest rook is crowned (a2, not h2)',
    noKnight && at(noKnight, 'a2') + at(noKnight, 'h2'), 'wkwr');
  const pawnsOnly = play('3rk3/8/8/8/3Q4/8/P1P3P1/8 b - - 0 1', 'd8d4');
  t('only pawns behind: the closest pawn is crowned (c2)',
    pawnsOnly && at(pawnsOnly, 'a2') + at(pawnsOnly, 'c2') + at(pawnsOnly, 'g2'), 'wpwkwp');
  const euclid = play('3rk3/6B1/8/8/3Q3B/8/8/8 b - - 0 1', 'd8d4');
  t('distance is squared straight-line, NOT king-steps: h4 (16) beats g7 (18)',
    euclid && at(euclid, 'h4') + at(euclid, 'g7'), 'wkwb');
  const block = play('3rk3/8/5B2/8/B2Q4/8/8/8 b - - 0 1', 'd8d4');
  t('distance is squared straight-line, NOT city-block: f6 (8) beats a4 (9)',
    block && at(block, 'f6') + at(block, 'a4'), 'wkwb');
  const classFirst = play('3rk3/8/8/8/3Q4/3N4/8/B7 b - - 0 1', 'd8d4');
  t('class order beats distance: the far bishop is crowned although a knight stands beside the queen',
    classFirst && at(classFirst, 'a1') + at(classFirst, 'd3'), 'wkwn');
  const kingLives = play('3rk3/8/8/8/3Q4/8/1B3B2/4K3 b - - 0 1', 'd8d4');
  t('a queen captured while the king lives: nothing is crowned',
    kingLives && at(kingLives, 'b2') + at(kingLives, 'f2') + String(kingLives.cr), 'wbwbundefined');

  // ---- R4-M1-AC7: far-rank promotion offers a king only when the side has none ------------------
  const promos = (f, prefix) => E.legal(C(f), true).filter((m) => uci(m).startsWith(prefix)).map((m) => m.promo).sort().join('');
  t('no king piece: a pawn may become Q, R, B, N or K (push)', promos('8/8/8/8/8/8/p7/1Q2q3 b - - 0 1', 'a2a1'), 'bknqr');
  t('no king piece: ...and the same when it captures', promos('8/8/8/8/8/8/p7/1Q2q3 b - - 0 1', 'a2b1'), 'bknqr');
  t('a king piece exists: no king is offered', promos('4k3/8/8/8/8/8/p7/1Q2K3 b - - 0 1', 'a2a1'), 'bnqr');
  const crownedByPromotion = play('8/8/8/8/8/8/p7/1Q2q3 b - - 0 1', 'a2a1k');
  t('promoting to a king puts a king on the board', crownedByPromotion && at(crownedByPromotion, 'a1'), 'bk');

  // ---- R4-M1-AC8: the ending ----------------------------------------------------------------------
  t('no legal move with pieces left: nothing to play, but the side is not eliminated',
    E.legal(C('8/8/8/8/p7/P7/8/8 w - - 0 1'), true).length + '/' + E.hasPieces(C('8/8/8/8/p7/P7/8/8 w - - 0 1'), 'w'), '0/true');

  // ---- R4-M1-AC9: the rule set survives every move; the invariant holds ---------------------------------
  let plies = 0, tagLost = 0, brokenInvariant = 0, longReach = 0, farRoyal = 0, games = 0;
  const royalOk = (S, side) => {
    let any = 0, royal = 0, last = null;
    for (const p of S.b) if (p && p[0] === side) { any++; last = p; if (p[1] === 'k' || p[1] === 'q') royal++; }
    return any === 0 || (royal >= 1 && (any !== 1 || last[1] === 'k' || last[1] === 'q'));
  };
  for (const seed of [11, 22, 33, 44, 55, 66, 77, 88, 99, 110]) {
    const rnd = mulberry32(seed);
    for (let g = 0; g < 8; g++) {
      let S = E.startState('c');
      for (let ply = 0; ply < 160; ply++) {
        const ms = E.legal(S, true);
        if (!ms.length) break;
        for (const m of ms) {
          if (m.piece[1] === 'k' || m.piece[1] === 'q') {
            if (dist(m) > 4) longReach++;
            if (dist(m) >= 2) farRoyal++;
          }
        }
        const caps = ms.filter((m) => m.cap);
        const m = caps.length && rnd() < 0.6 ? caps[(rnd() * caps.length) | 0] : ms[(rnd() * ms.length) | 0];
        S = E.apply(S, m);
        plies++;
        if (S.v !== 'c') tagLost++;
        if (!royalOk(S, 'w') || !royalOk(S, 'b')) brokenInvariant++;
      }
      games++;
    }
  }
  t('seeded random play covers at least 5,000 plies (' + plies + ' in ' + games + ' games)', plies >= 5000, true);
  t('the variant tag survives every move', tagLost, 0);
  t('every non-empty side always holds a king or queen, and a lone survivor is one', brokenInvariant, 0);
  t('no king or queen move is ever longer than 4 squares, in any of those positions', longReach, 0);
  t('CONTROL: the long royal moves (2 to 4 squares) really were exercised', farRoyal > 1000, true);
  let leaked = 0;
  for (const seed of [5, 6, 7]) {
    const rnd = mulberry32(seed);
    for (const tyranny of [false, true]) {
      let S = E.startState();
      for (let ply = 0; ply < 120; ply++) {
        const ms = E.legal(S, tyranny);
        if (!ms.length) break;
        S = E.apply(S, ms[(rnd() * ms.length) | 0]);
        if ('v' in S) leaked++;
      }
    }
  }
  t('a standard or Tyranny game never gains the tag', leaked + '/' + ('v' in E.startState()), '0/false');

  // ---- R4-M2-AC1 and AC2: the independent reference, and the hand derivation ----------------------------------
  t('perft(3) from the start = 8,902 + 20 x (3+3+1+2+2) = 9,122, derived by hand: the king gains reach only after '
    + 'd3, d4 (+3 along d2-c3-b4-a5), e4 (+1), f3, f4 (+2 along f2-g3-h4); queens never reach past 4 at depth 3',
    E.perft(C(START_FEN), 3, true), 8902 + 20 * (3 + 3 + 1 + 2 + 2));
  for (const row of GOLDEN.perft) {
    const S = C(row.fen);
    for (const [d, want] of Object.entries(row.perft)) {
      t('reference perft(' + d + '): ' + row.name.slice(0, 60), E.perft(S, Number(d), true), want);
    }
  }
  let childBad = 0, perft2Bad = 0, perft3Bad = 0, perft3Run = 0;
  for (const row of GOLDEN.children) {
    const S = C(row.fen);
    const d = digest(S);
    if (d.n !== row.moves || d.sha1 !== row.sha1) childBad++;
    if (E.perft(S, 2, true) !== row.perft2) perft2Bad++;
    if (row.perft3 !== null) { perft3Run++; if (E.perft(S, 3, true) !== row.perft3) perft3Bad++; }
  }
  t('every legal move and its resulting board match the reference in ' + GOLDEN.children.length + ' sampled positions',
    childBad, 0);
  t('perft(2) matches the reference in all ' + GOLDEN.children.length + ' sampled positions', perft2Bad, 0);
  t('perft(3) matches the reference in ' + perft3Run + ' of them', perft3Bad, 0);

  // ---- R4-M1-AC10: nothing outside the variant moved ------------------------------------------------------
  t('standard perft(1..4) is unchanged: 20 / 400 / 8,902 / 197,281',
    [1, 2, 3, 4].map((d) => E.perft(E.startState(), d, false)).join(' / '), '20 / 400 / 8902 / 197281');
  t('Tyranny perft(1..3) is unchanged: 39 / 1,519 / 63,034',
    [1, 2, 3].map((d) => E.perft(E.startState(), d, true)).join(' / '), '39 / 1519 / 63034');
  return out;
}

// ======================================================================== run
let pass = 0, fail = 0;
const failures = [];
function hd(title) { console.log('\n== ' + title); }
function report(list) {
  for (const r of list) {
    if (r.ok) pass++;
    else { fail++; failures.push(r.name); console.log('FAIL  ' + r.name + '   got ' + r.got + ', want ' + r.want); }
  }
}

hd('Coriantumr: the engine against the reference, the hand derivations and the rules');
const REAL = loadEngine(ENGINE_TEXT);
const results = battery(REAL);
report(results);
console.log('      ' + results.length + ' checks in the battery; fixture: ' + GOLDEN.perft.length + ' handmade positions, ' +
  GOLDEN.children.length + ' sampled (' + GOLDEN.counts.crowned + ' crowned and ' + GOLDEN.counts.royalCapturable +
  ' royal-capturable found while sampling), seed ' + GOLDEN.seed);

/* Each mutant breaks one rule in the engine SOURCE. The anchor must occur exactly once (so a refactor cannot
   leave a mutant silently testing nothing), the broken engine must still load, and the battery must fail. */
const MUTANTS = [
  ['king and queen reach 5 squares', 'var lim = (C && (t === "q" || t === "k")) ? 4 : 8;', 'var lim = (C && (t === "q" || t === "k")) ? 5 : 8;'],
  ['king and queen reach 3 squares', 'var lim = (C && (t === "q" || t === "k")) ? 4 : 8;', 'var lim = (C && (t === "q" || t === "k")) ? 3 : 8;'],
  ['self-capture leaks into the variant', '  if(C) selfCap = false;\n', ''],
  ['castling is generated in the variant', '  if(!C && S.b[E] === side+"k"', '  if(S.b[E] === side+"k"'],
  ['the king still steps one square', 'if(t === "n" || (t === "k" && !C)){', 'if(t === "n" || t === "k"){'],
  ['succession tries knights before bishops', 'var order = ["b","n","r","p"],', 'var order = ["n","b","r","p"],'],
  ['succession tries pawns before rooks', 'var order = ["b","n","r","p"],', 'var order = ["b","n","p","r"],'],
  ['succession measures from where the capturer started, not the capture square', 'crown(b, m.cap[0], m.to)', 'crown(b, m.cap[0], m.from)'],
  ['a distance tie goes to the higher file', 'f < bf', 'f > bf'],
  ['a file tie goes to the higher rank', 'rk < br', 'rk > br'],
  ['distance is king-steps instead of squared straight-line', 'd = dr*dr + dc*dc', 'd = Math.max(Math.abs(dr), Math.abs(dc))'],
  ['distance is city-block instead of squared straight-line', 'd = dr*dr + dc*dc', 'd = Math.abs(dr) + Math.abs(dc)'],
  ['a living queen does not stop the crowning', 'if(!any || royal) return null;', 'if(!any) return null;'],
  ['only a king capture triggers succession', 'm.cap && (m.cap[1] === "k" || m.cap[1] === "q")){', 'm.cap && m.cap[1] === "k"){'],
  ['apply() drops the rule-set tag', 'T.v = S.v;', ''],
  ['promotion offers a king every time', 'var needKing = C && S.b.indexOf(side + "k") < 0;', 'var needKing = C;'],
  ['promotion never offers a king', 'var needKing = C && S.b.indexOf(side + "k") < 0;', 'var needKing = false;'],
  ['the royal-safety filter applies in the variant', 'if(S.v === "c") return ms;', ''],
  ['check exists in the variant', 'if(S.v === "c") return false;', ''],
];

hd('Mutation: the checks above must be able to fail (' + MUTANTS.length + ' deliberate breaks of the engine source)');
for (const [name, from, to] of MUTANTS) {
  const occurrences = ENGINE_TEXT.split(from).length - 1;
  if (occurrences !== 1) {
    fail++; failures.push('mutant anchor: ' + name);
    console.log('FAIL  mutant "' + name + '": anchor occurs ' + occurrences + ' times, expected exactly 1 (a refactor moved it)');
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
  else { fail++; failures.push('MUTANT SURVIVED: ' + name); console.log('FAIL  MUTANT SURVIVED: ' + name + '   (the battery cannot tell this engine from the real one)'); }
}

hd(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
