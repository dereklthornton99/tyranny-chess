/*
 * coriantumr.js -- the Coriantumr rule set in the engine, held to three independent standards.
 *
 *   1. The GOLDEN FIXTURE (tests/coriantumr-golden.json), produced by tools/coriantumr-ref.py: a second
 *      implementation written from the rules text in another language. It records perft counts and, for 300
 *      sampled positions, a digest of EVERY legal move together with the board it produces, so a wrong
 *      succession choice anywhere in 300 positions changes a hash.
 *   2. HAND DERIVATIONS written out below (perft(3) = 8,902 + 20 x 11 = 9,122) and hand-built positions whose
 *      answer can be checked by eye.
 *   3. MUTATION: the engine source is deliberately broken many ways (see MUTANTS) and every break must be caught by a
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
  const keyOf = (T) => placement(T.b) + ' ' + T.turn + ' ' + (T.ep >= 0 ? E.sqName(T.ep) : '-') +
    (T.sd ? ' T' + T.sd.map((q) => E.sqName(q)).sort().join(',') : '');
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
  let plies = 0, tagLost = 0, brokenInvariant = 0, longReach = 0, farRoyal = 0, games = 0, sdMismatch = 0;
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
        let nw = 0, nb = 0;
        for (const p of S.b) if (p) { if (p[0] === 'w') nw++; else nb++; }
        if (!!S.sd !== (nw === 1 && nb === 1)) sdMismatch++;
      }
      games++;
    }
  }
  t('seeded random play covers at least 5,000 plies (' + plies + ' in ' + games + ' games)', plies >= 5000, true);
  t('the variant tag survives every move', tagLost, 0);
  t('a showdown is on exactly when two pieces, one per side, remain (all those positions)', sdMismatch, 0);
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
        if ('v' in S || 'sd' in S) leaked++;
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

  // ---- R4-M6: the owner's ending rules, 2026-10-07 ----------------------------------------------------------
  const withSd = (f, names) => { const S = C(f); if (names) S.sd = names.map(sq); return S; };
  const only = (S) => E.legal(S, true);
  const sacOf = (f) => { const ms = only(C(f)); return ms.length === 1 && ms[0].sac ? ms[0] : null; };
  const afterSac = (f) => { const m = sacOf(f); return m ? E.apply(C(f), m) : null; };
  const toNames = (S) => only(S).map((m) => E.sqName(m.to));

  // sacrifice: a side with no ordinary move gives up its royal piece, and succession then applies
  const boxK = 'KP6/PP6/8/8/8/8/8/7k w - - 0 1';
  const boxMoves = only(C(boxK));
  t('a boxed-in king has exactly one legal move, the sacrifice (kind self, flagged sac)',
    boxMoves.length + '/' + (boxMoves[0] && boxMoves[0].sac === true) + '/' + (boxMoves[0] && boxMoves[0].kind), '1/true/self');
  const sacK = afterSac(boxK);
  t('the sacrifice removes the king and passes the turn', !!sacK && at(sacK, 'a8') === null && sacK.turn === 'b', true);
  t('succession runs from the sacrificed square: pawns a7 and b8 tie on distance, the lower file (a7) is crowned',
    sacK && at(sacK, 'a7') + at(sacK, 'b7') + at(sacK, 'b8'), 'wkwpwp');
  t('...reported as [square, former piece]', sacK && sacK.cr && sacK.cr.join(), sq('a7') + ',wp');
  const sacQ = afterSac('QP6/PP6/8/8/8/8/8/7k w - - 0 1');
  t('a queen that is the only royal sacrifices itself and a pawn is crowned (a7)', !!sacQ && at(sacQ, 'a8') === null && at(sacQ, 'a7') === 'wk', true);
  const sacKQ = afterSac('KQP5/PPP5/8/8/8/8/8/7k w - - 0 1');
  t('king and queen both boxed in: the KING sacrifices, the queen stays a queen, nobody is crowned',
    sacKQ && at(sacKQ, 'a8') + '/' + at(sacKQ, 'b8') + '/' + String(sacKQ.cr), 'null/wq/undefined');
  const sacQQ = afterSac('QQP5/PPP5/8/8/8/8/8/7k w - - 0 1');
  t('two queens and no king, all boxed in: the queen on the lowest file (a8) sacrifices, the other stays a queen',
    sacQQ && at(sacQQ, 'a8') + '/' + at(sacQQ, 'b8') + '/' + String(sacQQ.cr), 'null/wq/undefined');
  const sacQF = afterSac('QP6/QP6/PP6/8/8/8/8/7k w - - 0 1');
  t('two boxed-in queens on the same file and no king: the lower RANK (a7) sacrifices, the queen on a8 stays',
    sacQF && at(sacQF, 'a7') + '/' + at(sacQF, 'a8') + '/' + String(sacQF.cr), 'null/wq/undefined');
  t('the sacrifice is never offered while an ordinary move exists (a free queen on a1)',
    only(C('KP6/PP6/8/8/8/8/8/Q6k w - - 0 1')).some((m) => m.sac), false);
  t('...nor for a king in the open', only(C('k7/8/8/8/3K4/8/8/8 w - - 0 1')).some((m) => m.sac), false);

  // the clarifications of 2026-10-07: one king, kings offered at promotion whatever else is on the board, queens stay queens
  const manyQueens = play('R3k3/8/8/8/8/8/3qq3/4K3 w - - 0 1', 'a8e8');
  t('several queens live and the king is captured: nobody changes, both queens stay queens',
    manyQueens && at(manyQueens, 'd2') + at(manyQueens, 'e2') + String(manyQueens.cr), 'bqbqundefined');
  t('a pawn is offered KING when its side has two queens and no king', promos('8/8/8/8/8/8/p7/1Q1qq3 b - - 0 1', 'a2a1'), 'bknqr');
  const twoKings = E.legal(C('4k3/8/8/8/8/8/p7/1Q2K3 b - - 0 1'), true).filter((m) => m.promo === 'k').length;
  t('a side that already has a king is never offered a second one', twoKings, 0);

  // showdown: the capture that leaves two pieces begins it
  const sdStart = play('6k1/8/8/4q3/3K4/8/8/8 w - - 0 1', 'd4e5');
  t('the showdown begins when a capture leaves exactly two pieces: both squares are touched',
    sdStart && sdStart.sd && sdStart.sd.slice().sort((a, b) => a - b).join(), [sq('e5'), sq('g8')].sort((a, b) => a - b).join());
  const moveTo = (S, from, to) => E.legal(S, true).find((m) => E.sqName(m.from) === from && E.sqName(m.to) === to);
  const sdMid = sdStart && moveTo(sdStart, 'g8', 'g7') ? E.apply(sdStart, moveTo(sdStart, 'g8', 'g7')) : null;
  t('the touched set grows by the square landed on', sdMid && sdMid.sd.length + ':' + sdMid.sd.includes(sq('g7')), '3:true');
  const sdLater = sdMid && moveTo(sdMid, 'e5', 'e4') ? E.apply(sdMid, moveTo(sdMid, 'e5', 'e4')) : null;
  const laterNames = sdLater ? toNames(sdLater) : [];
  t('CONTROL: Black has moves in that position', laterNames.length > 0, true);
  t('a touched square cannot be landed on again: not g8 (Black left it) and not e5 (White left it)',
    laterNames.includes('g8') + '/' + laterNames.includes('e5'), 'false/false');
  t('...and the position carries all four touched squares', sdLater && sdLater.sd.length, 4);
  t('a position loaded from a FEN with two pieces counts both squares as touched',
    E.touched(C('6k1/8/8/8/3K4/8/8/8 w - - 0 1')).length, 2);
  t('with three pieces there is no showdown', E.touched(C('6k1/8/8/4q3/3K4/8/8/8 w - - 0 1')), null);

  const passOver = withSd('8/7k/8/8/8/8/8/K7 w - - 0 1', ['a1', 'h7', 'b2']);
  const poNames = toNames(passOver);
  t('a touched square (b2) cannot be landed on', poNames.includes('b2'), false);
  t('...but a slide may pass over it (c3 is reachable)', poNames.includes('c3'), true);
  t('...and an untouched neighbour is a legal landing (a2)', poNames.includes('a2'), true);
  t('a capture is exempt from the touched rule (the king takes the queen on f6)',
    E.legal(C('8/8/5q2/8/3K4/8/8/8 w - - 0 1'), true).some((m) => E.sqName(m.to) === 'f6' && m.cap), true);
  const stuckRow = GOLDEN.showdown.find((r) => /sacrifices itself/.test(r.name));
  const stuckS = withSd(stuckRow.fen, stuckRow.touched);
  const stuckMoves = only(stuckS);
  t('a piece with no untouched landing square and no capture has exactly one move, the sacrifice',
    stuckMoves.length + '/' + (stuckMoves[0] && stuckMoves[0].sac), '1/true');
  const stuckAfter = E.apply(stuckS, stuckMoves[0]);
  t('...which leaves its side with no pieces, so it has lost', E.hasPieces(stuckAfter, 'w') + '/' + E.hasPieces(stuckAfter, 'b'), 'false/true');

  // the independent reference on showdown and sacrifice positions that carry a touched set
  for (const row of GOLDEN.showdown) {
    const S = withSd(row.fen, row.touched);
    const d = digest(S);
    t('showdown reference, every move and board: ' + row.name.slice(0, 55), d.n + '/' + d.sha1, row.moves + '/' + row.sha1);
    for (const [dd, want] of Object.entries(row.perft)) {
      t('showdown reference perft(' + dd + '): ' + row.name.slice(0, 50), E.perft(S, Number(dd), true), want);
    }
  }

  // seeded random showdowns: the touched set is always there, never repeats a square, and the game ends within 62 moves
  let sdGames = 0, sdBad = 0, sdMax = 0, sdEnded = 0;
  for (let g = 0; g < 200; g++) {
    const rnd = mulberry32(700 + g);
    let S = null;
    while (!S) {
      const a = (rnd() * 64) | 0, b2 = (rnd() * 64) | 0;
      if (a === b2) continue;
      const bd = new Array(64).fill(null);
      bd[a] = 'wk'; bd[b2] = 'bk';
      const cand = { b: bd, turn: 'w', cast: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1, v: 'c' };
      if (!E.legal(cand, true).some((m) => m.cap)) S = cand;
    }
    let n = 0;
    while (n < 100) {
      const ms = E.legal(S, true);
      if (!ms.length) break;
      const T = E.apply(S, ms[(rnd() * ms.length) | 0]);
      n++;
      if (!E.hasPieces(T, 'w') || !E.hasPieces(T, 'b')) { sdEnded++; break; }
      if (!T.sd || new Set(T.sd).size !== T.sd.length || T.sd.length !== 2 + n) sdBad++;
      S = T;
    }
    sdGames++; sdMax = Math.max(sdMax, n);
  }
  t('200 seeded random showdowns: the touched set is never missing, never repeats a square, grows by one per move', sdBad, 0);
  t('...and every one ended by capture or sacrifice within the 62-move bound (longest ' + sdMax + ' plies)',
    sdEnded === sdGames && sdMax <= 63, true);

  // ---- R4-M6-AC11: repetition is refused, not drawn ---------------------------------------------------------
  // A position may occur twice; the move that would make it occur a third time is not allowed.
  const repStr = (T) => placement(T.b) + ' ' + T.turn + ' ' + (T.ep >= 0 ? E.sqName(T.ep) : '-');
  const repOf = (seen) => ({ keyOf: repStr, seen: (k) => (k in seen ? seen[k] : (seen['*'] || 0)) });
  const gameMoves = (S, seen) => E.legalGame(S, true, repOf(seen));
  const digestOfList = (S, list) => {
    const items = list.map((m) => uci(m) + '=' + keyOf(E.apply(S, m))).sort();
    return { n: items.length, sha1: crypto.createHash('sha1').update(items.join('\n')).digest('hex') };
  };
  for (const row of GOLDEN.repeat) {
    const S = C(row.fen), list = gameMoves(S, row.seen), d = digestOfList(S, list);
    t('repetition reference, every move and board: ' + row.name.slice(0, 60), d.n + '/' + d.sha1, row.moves + '/' + row.sha1);
    t('repetition reference, the allowed moves: ' + row.name.slice(0, 55), list.map(uci).sort().join(), row.allowed.join());
  }
  const shuffleFen = '8/7k/8/8/8/8/P7/1K6 w - - 0 1';
  const refRow = GOLDEN.repeat[0], refMoves = gameMoves(C(refRow.fen), refRow.seen).map(uci);
  t('a position seen twice already: the move that would make it a third occurrence is refused (b1b2)', refMoves.includes('b1b2'), false);
  t('...a position seen once is allowed to occur a second time (b1a1)', refMoves.includes('b1a1'), true);
  const boxedRow = GOLDEN.repeat[1], boxedList = gameMoves(C(boxedRow.fen), boxedRow.seen);
  t('when every ordinary move would be a third occurrence the royal sacrifices: one move, flagged sac',
    boxedList.length + '/' + (boxedList[0] && boxedList[0].sac), '1/true');
  const irrRow = GOLDEN.repeat[2], irrMoves = gameMoves(C(irrRow.fen), irrRow.seen).map(uci).sort().join();
  t('a pawn move or a capture is never refused, however often the position has been seen',
    irrMoves, ['a2a3', 'a2a4', 'a2b3', 'c2b3'].join());
  const noneRow = GOLDEN.repeat[3];
  t('CONTROL: with nothing seen, the game-aware list is exactly legal()',
    gameMoves(C(noneRow.fen), {}).map(uci).sort().join(), E.legal(C(noneRow.fen), true).map(uci).sort().join());
  t('outside the variant the game-aware list is legal() unchanged: repetition there is still a draw',
    E.legalGame(E.startState(), true, repOf({ '*': 2 })).length, E.legal(E.startState(), true).length);

  // a real shuffle, counted the way a game counts it: Kb1-b2, Kh7-h8, Kb2-b1, Kh8-h7, twice over
  let SH = C(shuffleFen);
  const counts = {};
  const seenNow = (T) => { counts[repStr(T)] = (counts[repStr(T)] || 0) + 1; };
  seenNow(SH);
  const step = (u) => { const m = gameMoves(SH, counts).find((x) => uci(x) === u); if (m) { SH = E.apply(SH, m); seenNow(SH); } return !!m; };
  const lap1 = ['b1b2', 'h7h8', 'b2b1', 'h8h7'].map(step);
  t('first lap: every move is allowed, and the start position now stands at two occurrences',
    lap1.join() + '/' + counts[repStr(C(shuffleFen))], 'true,true,true,true/2');
  const lap2 = ['b1b2', 'h7h8', 'b2b1'].map(step);
  t('second lap: the retreats and the repeats are still allowed up to the last move', lap2.join(), 'true,true,true');
  t('...and then Kh8-h7, which would be the third occurrence of the start position, is refused',
    gameMoves(SH, counts).some((m) => uci(m) === 'h8h7'), false);
  t('...although it is an ordinary legal move, so only the repetition rule removed it',
    E.legal(SH, true).some((m) => uci(m) === 'h8h7'), true);
  t('...and Black still has other moves, so nobody is forced to sacrifice', gameMoves(SH, counts).some((m) => !m.sac), true);

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
  ' royal-capturable found while sampling), ' + GOLDEN.showdown.length + ' showdown positions, seed ' + GOLDEN.seed);

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
  ['a distance tie goes to the higher file', 'd === bd && (f < bf', 'd === bd && (f > bf'],
  ['a file tie goes to the higher rank', 'rk < br)))){ best = i; bd = d;', 'rk > br)))){ best = i; bd = d;'],
  ['distance is king-steps instead of squared straight-line', 'd = dr*dr + dc*dc', 'd = Math.max(Math.abs(dr), Math.abs(dc))'],
  ['distance is city-block instead of squared straight-line', 'd = dr*dr + dc*dc', 'd = Math.abs(dr) + Math.abs(dc)'],
  ['a living queen does not stop the crowning', 'if(!any || royal) return null;', 'if(!any) return null;'],
  ['only a king capture triggers succession', 'm.cap && (m.cap[1] === "k" || m.cap[1] === "q")){', 'm.cap && m.cap[1] === "k"){'],
  ['apply() drops the rule-set tag', 'T.v = S.v;', ''],
  ['promotion offers a king every time', 'var needKing = C && S.b.indexOf(side + "k") < 0;', 'var needKing = C;'],
  ['promotion never offers a king', 'var needKing = C && S.b.indexOf(side + "k") < 0;', 'var needKing = false;'],
  ['the royal-safety filter applies in the variant', 'if(S.v === "c") return legalC(S, ms);', ''],
  ['check exists in the variant', 'if(S.v === "c") return false;', ''],
  ['the showdown never begins', 'if(n === 2 && ws >= 0 && bs >= 0) T.sd = td ? td.concat([m.to]) : [ws, bs];', ''],
  ['the touched set never grows', 'T.sd = td ? td.concat([m.to]) : [ws, bs];', 'T.sd = td ? td : [ws, bs];'],
  ['the starting squares are not touched', 'T.sd = td ? td.concat([m.to]) : [ws, bs];', 'T.sd = td ? td.concat([m.to]) : [];'],
  ['a showdown starts with three pieces', 'if(n === 2 && ws >= 0 && bs >= 0) T.sd', 'if(n <= 3 && ws >= 0 && bs >= 0) T.sd'],
  ['a FEN position with two pieces has no touched squares', 'return (n === 2 && ws >= 0 && bs >= 0) ? [ws, bs] : null;', 'return null;'],
  ['a capture onto a touched square is forbidden', 'if(ms[i].cap || td.indexOf(ms[i].to) < 0) out.push(ms[i]);', 'if(td.indexOf(ms[i].to) < 0) out.push(ms[i]);'],
  ['touched squares may be landed on again', 'if(ms[i].cap || td.indexOf(ms[i].to) < 0) out.push(ms[i]);', 'out.push(ms[i]);'],
  ['the sacrifice is never offered', 'return r < 0 ? [] : [mk(r, r, S.b[r], S.b[r], "self", {sac:true})];', 'return [];'],
  ['the queen sacrifices before the king', 'if(k >= 0) return k;', 'if(false) return k;'],
  ['the queen on the higher file sacrifices', 'var f = cOf(i), rk = 8 - rOf(i); if(f < bf', 'var f = cOf(i), rk = 8 - rOf(i); if(f > bf'],
  ['the queen on the higher rank sacrifices', '(f === bf && rk < br)){ best = i; bf = f; br = rk; }', '(f === bf && rk > br)){ best = i; bf = f; br = rk; }'],
  ['a sacrifice leaves the piece on the board', 'if(!m.sac) b[m.to] =', 'b[m.to] ='],
  ['repetition is refused already on the second occurrence', 'rep.seen(rep.keyOf(apply(S, mv))) < 2', 'rep.seen(rep.keyOf(apply(S, mv))) < 1'],
  ['repetition is refused only on the fourth occurrence', 'rep.seen(rep.keyOf(apply(S, mv))) < 2', 'rep.seen(rep.keyOf(apply(S, mv))) < 3'],
  ['a capture or pawn move can be refused as a repeat', 'if(mv.cap || mv.piece[1] === "p" || rep.seen(', 'if(rep.seen('],
  ['a pawn move can be refused as a repeat', 'if(mv.cap || mv.piece[1] === "p" || rep.seen(', 'if(mv.cap || rep.seen('],
  ['the refusal is ignored outside the touched-square filter', 'if(rep && out.length){', 'if(false){'],
  ['outside the variant the game-aware list changes', 'if(S.v !== "c") return legal(S, selfCap);', 'if(S.v !== "c") return legalC(S, pseudo(S, S.turn, selfCap), rep);'],
  ['a sacrifice skips succession', 'if(S.v === "c" && m.cap && (m.cap[1] === "k" || m.cap[1] === "q")){', 'if(S.v === "c" && m.cap && !m.sac && (m.cap[1] === "k" || m.cap[1] === "q")){'],
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
