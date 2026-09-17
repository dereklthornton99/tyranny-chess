/*
 * lichess-seed.js — derive Tyranny puzzles from real games, via the Lichess
 * CC0 puzzle database.
 *
 *   zstd -dc lichess_db_puzzle.csv.zst | node tools/lichess-seed.js [--max N] [--out path]
 *   node tools/lichess-seed.js --self-test
 *
 * WHY A STANDARD PUZZLE SET CANNOT SIMPLY BE IMPORTED, measured before any of
 * this was written: of 900 standard mate-in-1 positions sampled from real play,
 * 463 — 51.4% — are REFUTED by a self-capture under the variant rule. The
 * defending king eats its own shield and walks out. Importing a standard set
 * wholesale would ship puzzles whose stated answer is wrong in this game.
 *
 * That same 51.4% is the seed. A position where standard chess says checkmate
 * and Tyranny says otherwise IS a puzzle about this variant — and unlike a
 * random playout, it comes out of a game somebody actually played.
 *
 * WHAT A ROW LOOKS LIKE. The database ships as
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,...
 * and the FEN is the position BEFORE the losing side's move: Moves[0] is played
 * by the opponent, and the solver answers with the rest. So the mating position
 * is reached by replaying the WHOLE line, and the side to move there is the one
 * that was just checkmated — which is the side this puzzle belongs to.
 *
 * LICENCE. The Lichess puzzle database is released under Creative Commons CC0,
 * which requires no attribution. Every generated puzzle carries its source id,
 * rating and game URL anyway: the rating is a real difficulty prior that no
 * predicate here can compute, and a position a reader can trace back to a game
 * is worth more than one that appeared from nowhere.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const E = require('./../tests/engine.js');
const { legal, apply, inCheck, fen, san, sqName } = E;
const { toFen } = require('./fen-write.js');

const FILES_ = 'abcdefgh';
const sqIdx = s => (8 - Number(s[1])) * 8 + FILES_.indexOf(s[0]);
const uciOf = m => sqName(m.from) + sqName(m.to) + (m.promo || '');

function isMate(T) { return legal(T, true).length === 0 && inCheck(T, T.turn); }

/* Resolve a UCI string against the engine's own move list, so a move the engine
   does not generate fails loudly here instead of being silently applied. */
function findMove(S, uci, selfCap) {
  const from = sqIdx(uci.slice(0, 2)), to = sqIdx(uci.slice(2, 4));
  const promo = uci.length > 4 ? uci[4].toLowerCase() : null;
  const hits = legal(S, selfCap).filter(function (m) {
    return m.from === from && m.to === to && ((m.promo || null) === promo);
  });
  return hits.length === 1 ? hits[0] : null;
}

/*
 * SURVIVAL — the replacement for the escape family.
 *
 * The family it replaces could not be hard. Every escape puzzle listed EVERY
 * legal move as a correct answer, all 34 of them, so it had zero wrong answers
 * by construction: "you are mated under normal rules, now play literally
 * anything." That is a prompt, not a puzzle.
 *
 * This one keeps the setup and adds the thing that was missing — a way to be
 * wrong. You are checkmated under standard rules, the variant offers you
 * several executions, and exactly ONE of them is still alive after the
 * opponent's reply. The rest are legal, look no different, and lose.
 *
 * Every candidate is a self-capture by construction and that is not an extra
 * clause: standard-legal moves number zero here, so anything the variant adds
 * can only be an execution.
 *
 * Depth-free like every other predicate in this project: legal(), apply() and
 * inCheck(), enumerated exhaustively. No search, no scoring, no think().
 */
/* does the side to move at T get mated by force within three plies? */
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

function trySurvival(S, minEscapes, allowDeep) {
  if (!inCheck(S, S.turn)) return null;
  if (legal(S, false).length !== 0) return null;          // must be mate in standard chess
  const ms = legal(S, true);
  if (ms.length < (minEscapes || 3)) return null;         // needs real alternatives to reject

  /* SHALLOW: survives the opponent's immediate reply. */
  const live = ms.filter(function (m) {
    const T = apply(S, m);
    return !legal(T, true).some(function (r) { return isMate(apply(T, r)); });
  });
  if (live.length === 1) return { sole: live[0], ms: ms, depth: 1, live: live };

  /*
   * DEEP. The one-ply test left more than one candidate standing, so looking
   * one move ahead does not settle it — you have to see that a move which
   * survives the reply still collapses on the move after. Strictly harder than
   * the shallow tier, and a different kind of hard: not "check each candidate"
   * but "check each candidate twice, and distrust the ones that look fine."
   *
   * Only positions the shallow test could not decide reach this, which is also
   * what keeps it affordable: the expensive search never runs on a position
   * already settled cheaply.
   */
  if (live.length < 2) return null;                        // 0 survivors: lost whatever you play
  /* OPT-IN. Measured 2026-09-17: enabling this made a 400,000-row slice run
     more than 21x slower - 35s became over 12 minutes - because lostIn3 has to
     run on every candidate that survived the cheap test. Off by default so the
     ordinary regeneration stays affordable. */
  if (!allowDeep) return null;
  const deep = live.filter(function (m) { return !lostIn3(apply(S, m)); });
  if (deep.length !== 1) return null;
  return { sole: deep[0], ms: ms, depth: 3, live: live };
}

/* Every losing candidate, with the move that refutes it. Stored so a player who
   picks wrong can be shown WHY, and re-derived by tests/puzzles.js from the FEN
   rather than trusted. */
function refutations(S, ms, sole) {
  const out = [];
  for (const m of ms) {
    if (m.from === sole.from && m.to === sole.to && (m.promo || null) === (sole.promo || null)) continue;
    const T = apply(S, m);
    const kill = legal(T, true).filter(function (r) { return isMate(apply(T, r)); })[0];
    if (kill) out.push({ uci: uciOf(m), san: san(S, m, true), refutedBy: san(T, kill, true) });
  }
  return out;
}

/* Difficulty is the size of the set you have to reject, same stated rule the
   other families use. Never a 1: this family rejects every position where the
   choice is smaller than three. */
/* Depth is the difficulty, and it is the honest measure here. Every position
   this family produces turned out to offer exactly three ways out, so counting
   candidates says nothing. What separates them is whether looking one move
   ahead settles it: a shallow puzzle is decided by checking three replies, a
   deep one looks decided after that check and is not. */
function survivalDifficulty(ms, depth) { return depth === 3 ? 3 : (ms.length > 3 ? 3 : 2); }

/*
 * Replay a database row to the position AFTER the full solution line, which is
 * where the mate stands. Returns null on anything that does not replay cleanly
 * — a move the engine will not generate is a disagreement worth dropping the
 * row over, not worth guessing at.
 */
function replay(row) {
  let S;
  try { S = fen(row.fen); } catch (e) { return null; }
  if (!S || !S.b || S.b.length !== 64) return null;
  for (const u of row.moves) {
    const m = findMove(S, u, false);                      // standard rules: it is a real game
    if (!m) return null;
    S = apply(S, m);
  }
  return S;
}

function parseRow(line) {
  const f = line.split(',');
  if (f.length < 8) return null;
  return { id: f[0], fen: f[1], moves: f[2].split(' ').filter(Boolean),
           rating: Number(f[3]) || 0, popularity: Number(f[5]) || 0,
           plays: Number(f[6]) || 0, themes: f[7], url: f[8] || '' };
}

const MATE_THEME = /\bmateIn[123]\b/;

/* ------------------------------ self-test ------------------------------ */

function selfTest() {
  let pass = 0, fail = 0;
  const chk = (n, g, w) => { const ok = String(g) === String(w); ok ? pass++ : fail++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + n + '   got ' + g + ', want ' + w); };

  /* A real row, copied verbatim from the database header sample. It is not a
     mate puzzle; it is here to prove the replay machinery agrees with the
     engine on an ordinary line, castling rights and all. */
  const row = parseRow('0000D,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,' +
    'd3d6 f8d8 d6d8 f6d8,1468,75,96,37410,advantage endgame short,https://lichess.org/F8M8OS71#53,,');
  chk('a row parses into 4 moves', row.moves.length, 4);
  const after = replay(row);
  chk('the whole line replays against the engine', !!after, true);
  chk('and lands with White to move', after && after.turn, 'w');

  /* UCI resolution, including the two encodings that are easy to get wrong. */
  const start = fen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  chk('e2e4 resolves', !!findMove(start, 'e2e4', false), true);
  const cast = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  chk('castling is king-moves-two, e1g1', !!findMove(cast, 'e1g1', false), true);
  const promo = fen('8/4P3/8/8/8/8/8/K6k w - - 0 1');
  chk('a promotion carries its piece, e7e8q', !!findMove(promo, 'e7e8q', false), true);
  chk('and e7e8 without one does NOT resolve', findMove(promo, 'e7e8', false), null);

  /* The predicate itself has to REJECT, or it is not discriminating. */
  const notCheck = fen('7k/8/8/8/8/8/8/K7 w - - 0 1');
  chk('rejects a position that is not even check', trySurvival(notCheck, 3), null);
  const esc = fen('5k1Q/p1pppp1p/3Nn3/1r6/7N/4P3/P4PPP/R1B1KB1R b KQ - 0 11');
  chk('rejects a one-move escape (the old family) at minEscapes 3',
    trySurvival(esc, 3), null);
  chk('  ...and that position really is a standard-rules mate with 1 way out',
    legal(esc, false).length + '/' + legal(esc, true).length, '0/1');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

/* ------------------------------ cli ------------------------------ */

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();

  const out = arg('--out', path.join(__dirname, '..', '_context', 'lichess-seed.json'));
  const max = parseInt(arg('--max', '400'), 10);
  const minEsc = parseInt(arg('--min-escapes', '3'), 10);
  const minRating = parseInt(arg('--min-rating', '0'), 10);
  const deep = process.argv.includes('--deep');

  const hits = [];
  const stats = { rows: 0, mateThemed: 0, replayed: 0, replayFailed: 0,
                  standardMate: 0, tooFewEscapes: 0, notUnique: 0,
                  keptShallow: 0, keptDeep: 0, kept: 0 };
  const t0 = Date.now();
  let header = true;

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', function (line) {
    if (header) { header = false; return; }              // PuzzleId,FEN,Moves,...
    stats.rows++;
    const row = parseRow(line);
    if (!row || !MATE_THEME.test(row.themes)) return;
    if (row.rating < minRating) return;
    stats.mateThemed++;

    const S = replay(row);
    if (!S) { stats.replayFailed++; return; }
    stats.replayed++;

    /* The side to move here is the side that was just checkmated in a real
       game. Under standard rules it has nothing; the variant is what gives it
       anything at all. */
    if (!inCheck(S, S.turn) || legal(S, false).length !== 0) return;
    stats.standardMate++;

    const ms = legal(S, true);
    if (ms.length < minEsc) { stats.tooFewEscapes++; return; }

    const r = trySurvival(S, minEsc, deep);
    if (!r) { stats.notUnique++; return; }

    stats.kept++;
    if (r.depth === 3) stats.keptDeep++; else stats.keptShallow++;
    hits.push({
      fen: toFen(S), sideToMove: S.turn,
      legalMoveCount: ms.length,
      solutionUci: uciOf(r.sole), solutionSan: san(S, r.sole, true),
      losingMoves: refutations(S, ms, r.sole),
      depth: r.depth,
      survivesReply: r.live.length,
      difficulty: survivalDifficulty(ms, r.depth),
      source: { db: 'lichess-cc0', id: row.id, rating: row.rating,
                popularity: row.popularity, plays: row.plays,
                themes: row.themes, url: row.url }
    });
    if (hits.length >= max) rl.close();
  });

  rl.on('close', function () {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({
      generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      source: 'Lichess puzzle database, CC0',
      predicate: 'survival: standard checkmate, >=' + minEsc +
                 ' legal self-capture escapes, exactly one survives the reply',
      stats: Object.assign({ seconds: +((Date.now() - t0) / 1000).toFixed(1) }, stats),
      puzzles: hits
    }, null, 2) + '\n', 'utf8');
    console.error('rows ' + stats.rows + ' | mate-themed ' + stats.mateThemed +
      ' | replayed ' + stats.replayed + ' (' + stats.replayFailed + ' failed)' +
      ' | standard mate ' + stats.standardMate);
    console.error('  too few escapes ' + stats.tooFewEscapes +
      ' | no unique survivor ' + stats.notUnique +
      ' | KEPT ' + stats.kept + ' (' + stats.keptShallow + ' shallow, ' + stats.keptDeep + ' deep)' +
      ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    console.error('wrote ' + out);
  });
}

module.exports = { trySurvival, refutations, replay, parseRow, findMove, survivalDifficulty, isMate };
