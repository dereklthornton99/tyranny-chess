/*
 * lichess-multistep.js — find positions in the Lichess CC0 puzzle database that
 * are genuine multi-move Tyranny puzzles, and MEASURE the yield (R3-M2-AC1).
 *
 *   # scan one shard of the first R rows (run K of these in parallel):
 *   zstd -dc lichess_db_puzzle.csv.zst | node tools/lichess-multistep.js \
 *        --rows R --shard I/K --out shard-I.json
 *
 *   # combine the K shard files into the committed seed:
 *   node tools/lichess-multistep.js --merge shard-0.json ... shard-K-1.json \
 *        --db lichess_db_puzzle.csv.zst --cap 40 --out puzzles/multistep-seed.json
 *
 *   node tools/lichess-multistep.js --self-test
 *
 * THIS TOOL WRITES A SEED, NOT PUZZLES. The output is a list of positions with
 * where each came from. tools/gen-puzzles.js is the only writer of puzzles.json:
 * it reads the seed, re-derives the solution, the line, the decoys and the
 * difficulty from each FEN with its own predicate, and throws if a position no
 * longer qualifies. The same pattern the survival family uses.
 *
 * WHY THE DATABASE IS A POSITION SOURCE AND NOTHING MORE. Lichess solutions are
 * standard-chess solutions, and in this game 51.4% of standard mate-in-1s are
 * refuted outright by a self-capture (measured in lichess-seed.js). tac-0003 is
 * the cleanest demonstration: Stockfish and python-chess both call Qe6
 * checkmate, and in Tyranny Black answers by executing his own pawn onto a
 * square nothing covers. So no imported move is ever trusted as an answer. What
 * the database is good for is what a random playout cannot give: positions out
 * of games people actually played.
 *
 * WHAT `source.rating` IS AND IS NOT. It is the Lichess rating of the STANDARD
 * puzzle the row describes. The position stored here can sit anywhere along
 * that puzzle's line (`source.ply` says where), and its answer is a different
 * one -- a self-capture, which the standard puzzle never contains. So the
 * rating is provenance and a loose prior, not the difficulty of this puzzle.
 * `difficulty` comes from the generator's own stated rule, like every family.
 *
 * WHY EVERY POSITION ALONG THE LINE, NOT JUST THE LAST ONE. lichess-seed.js
 * replays each row to the FINAL position, where the loser has just been mated:
 * right for survival, which is about being the mated side. A multistep puzzle
 * wants the other seat -- the attacker, a move or two earlier. The whole line is
 * sharp, so every position along it is a candidate and the predicate decides.
 *
 * WHY NO MATE-THEME PREFILTER. It would be the obvious speedup, and it is lossy:
 * of the first 13 keepers measured, 10 came from rows carrying no mate theme at
 * all ("advantage", "crushing", "quietMove"). A self-capture opens forced mates
 * that standard chess does not have, so the rows worth scanning are not the rows
 * Lichess labelled as mates.
 *
 * WHY --min-replies DEFAULTS TO 2. Of the 27 multistep puzzles the random
 * playout produced, 17 leave the opponent exactly ONE legal reply. With one
 * reply, "every reply loses" is vacuous: the solver finds the key move and then
 * calculates a single forced line. With two or more the solver has to see that
 * EVERY reply loses, which is a wider calculation. That is a design choice about
 * what makes the puzzle demand more, recorded in the seed so it can be changed;
 * it has NOT been measured that players find the wider ones harder.
 *
 * ONE POSITION PER ROW. Consecutive positions along one game line are the same
 * puzzle in practice, so after a row yields a keeper its later positions are
 * not tested.
 *
 * SHARDING. Row i belongs to shard i % K and the row bound is global, so the
 * union of K shards over the first R rows is exactly what one process would
 * find, and --merge refuses to run unless every shard 0..K-1 is present and
 * agrees on R, K and every setting. A missing shard would otherwise silently
 * halve the coverage and look like a low yield.
 *
 * PROVENANCE LIMIT, stated so nobody has to discover it. The seed's `dbFile`
 * hash is of the file named by --db at MERGE time. The shards read a pipe and
 * cannot check that it is the same file, so merging with the wrong --db would
 * write a false provenance line and nothing here would notice. (It is correct
 * for the committed seed: the file was re-hashed after the scan and matched.) A
 * fingerprint of the rows each shard actually read, compared across shards at
 * merge, would close it. That has not been built.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const E = require('./../tests/engine.js');
const { legal, apply, fen } = E;
const { parseRow, findMove } = require('./lichess-seed.js');
const { toFen } = require('./fen-write.js');
/* The ONE definition of "multistep" the producers share. tests/puzzles.js keeps
   its own independent copy on purpose -- it is the check, not a producer. */
const { tryMultistep } = require('./gen-puzzles.js');

const uciOf = m => E.sqName(m.from) + E.sqName(m.to) + (m.promo || '');

/* Every position along a real game's line. The start FEN is included: it is the
   position before the opponent's blunder, and it is as real as the rest. */
function positionsAlong(row) {
  let S;
  try { S = fen(row.fen); } catch (e) { return []; }
  if (!S || !S.b || S.b.length !== 64) return [];
  const out = [S];
  for (const u of row.moves) {
    const m = findMove(S, u, false);          // standard rules: it is a real game
    if (!m) return out;                       // keep what replayed, drop the rest
    S = apply(S, m);
    out.push(S);
  }
  return out;
}

/* A scanner is fed lines one at a time so the CLI (readline) and the self-test
   (an array) run the SAME code. feed() returns false once the global row bound
   is reached, which is the caller's cue to stop reading. */
function makeScanner(o) {
  const st = { rows: 0, positions: 0, multistep: 0, tooNarrow: 0, kept: 0 };
  const hits = [];
  const seen = new Set();
  let idx = -1, header = true;
  return {
    st: st, hits: hits,
    rowsSeen: function () { return idx + 1; },
    feed: function (line) {
      if (header) { header = false; return true; }          // PuzzleId,FEN,Moves,...
      idx++;
      if (idx >= o.rows) { idx--; return false; }            // global bound, not per shard
      if (idx % o.shardK !== o.shardI) return true;          // another shard's row
      st.rows++;
      const row = parseRow(line);
      if (!row || row.rating < o.minRating) return true;
      const S0 = positionsAlong(row);
      for (let ply = 0; ply < S0.length; ply++) {
        const S = S0[ply];
        st.positions++;
        const r = tryMultistep(S);
        if (!r) continue;
        st.multistep++;
        const replies = legal(apply(S, r.sole), true).length;
        if (replies < o.minReplies) { st.tooNarrow++; continue; }
        const f = toFen(S);
        if (seen.has(f)) continue;
        seen.add(f);
        st.kept++;
        hits.push({
          row: idx, ply: ply, fen: f, solutionUci: uciOf(r.sole), replies: replies,
          source: { db: 'lichess-cc0', id: row.id, rating: row.rating,
                    popularity: row.popularity, themes: row.themes, url: row.url, ply: ply }
        });
        break;                                               // one position per row
      }
      return true;
    }
  };
}

/* Combine shard results. Pure, so the self-test can exercise it without files.
   Refuses on any disagreement -- see the SHARDING note above. */
const SETTINGS = ['rows', 'shardK', 'minReplies', 'minRating'];
function mergeResults(results, cap) {
  if (!results.length) throw new Error('merge: no shard results given');
  const first = results[0];
  SETTINGS.forEach(function (k) {
    results.forEach(function (r) {
      if (r[k] !== first[k]) throw new Error('merge: shard ' + r.shardI + ' has ' + k + '=' + r[k] +
        ' but shard ' + first.shardI + ' has ' + first[k] + '; they did not scan the same thing');
    });
  });
  const have = results.map(function (r) { return r.shardI; }).sort(function (a, b) { return a - b; });
  for (let i = 0; i < first.shardK; i++) {
    if (have[i] !== i || have.length !== first.shardK) {
      throw new Error('merge: expected shards 0..' + (first.shardK - 1) + ' exactly once, got [' +
        have.join(',') + ']. A missing shard silently shrinks the coverage.');
    }
  }
  const all = [];
  const stats = { rows: 0, positions: 0, multistep: 0, tooNarrow: 0, kept: 0 };
  results.forEach(function (r) {
    Object.keys(stats).forEach(function (k) { stats[k] += r.stats[k]; });
    r.candidates.forEach(function (c) { all.push(c); });
  });
  all.sort(function (a, b) { return a.row - b.row || a.ply - b.ply; });
  const seen = new Set(), unique = [];
  all.forEach(function (c) { if (!seen.has(c.fen)) { seen.add(c.fen); unique.push(c); } });
  const kept = unique.slice(0, cap);
  return {
    rowsScanned: Math.max.apply(null, results.map(function (r) { return r.rowsSeen; })),
    shards: first.shardK, minReplies: first.minReplies, minRating: first.minRating,
    stats: stats,
    selection: { rule: 'first N in scan order, one position per source row',
                 cap: cap, candidates: unique.length, kept: kept.length },
    puzzles: kept.map(function (c) {
      return { fen: c.fen, solutionUci: c.solutionUci, source: c.source };
    })
  };
}

/* ------------------------------ cli ------------------------------ */

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

function scanCli() {
  const sh = arg('--shard', '0/1').split('/').map(Number);
  const o = { rows: parseInt(arg('--rows', '0'), 10) || Infinity,
              shardI: sh[0], shardK: sh[1],
              minReplies: parseInt(arg('--min-replies', '2'), 10),
              minRating: parseInt(arg('--min-rating', '0'), 10) };
  if (!(o.shardK >= 1) || !(o.shardI >= 0 && o.shardI < o.shardK)) {
    console.error('bad --shard ' + arg('--shard') + ', want I/K with 0 <= I < K'); process.exit(2);
  }
  const out = arg('--out', path.join(__dirname, '..', '_context', 'multistep-shard-' + o.shardI + '.json'));
  const sc = makeScanner(o);
  const t0 = Date.now();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let stopped = false;
  rl.on('line', function (line) {
    if (stopped) return;
    if (!sc.feed(line)) { stopped = true; rl.close(); }
  });
  rl.on('close', function () {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    fs.writeFileSync(out, JSON.stringify({
      tool: 'tools/lichess-multistep.js', shardI: o.shardI, shardK: o.shardK,
      rows: o.rows === Infinity ? null : o.rows, rowsSeen: sc.rowsSeen(),
      minReplies: o.minReplies, minRating: o.minRating,
      stats: sc.st, candidates: sc.hits
    }, null, 2) + '\n', 'utf8');
    console.log('shard ' + o.shardI + '/' + o.shardK + ': ' + sc.st.rows + ' rows, ' + sc.st.positions +
                ' positions, ' + sc.st.multistep + ' multistep, ' + sc.st.kept + ' kept, ' + secs + 's');
    process.stdin.destroy();
  });
}

function mergeCli() {
  const i = process.argv.indexOf('--merge');
  const files = [];
  for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith('--'); j++) files.push(process.argv[j]);
  const cap = parseInt(arg('--cap', '40'), 10);
  const dbPath = arg('--db', null);
  const out = arg('--out', path.join(__dirname, '..', 'puzzles', 'multistep-seed.json'));
  const results = files.map(function (f) { return JSON.parse(fs.readFileSync(f, 'utf8')); });
  const m = mergeResults(results, cap);
  /* The database is republished monthly and its rows are not stable, so the seed
     records WHICH file it was cut from. The PuzzleId on every entry is the
     stable key; the hash is how a reader knows whether re-running reproduces it. */
  let db = null;
  if (dbPath) {
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(dbPath));
    db = { file: path.basename(dbPath), bytes: fs.statSync(dbPath).size, sha256: h.digest('hex') };
  }
  const seed = {
    tool: 'tools/lichess-multistep.js', db: 'lichess-cc0', dbFile: db,
    scan: { rowsScanned: m.rowsScanned, shards: m.shards,
            minReplies: m.minReplies, minRating: m.minRating, perRow: 1 },
    stats: m.stats, selection: m.selection, puzzles: m.puzzles
  };
  fs.writeFileSync(out, JSON.stringify(seed, null, 2) + '\n', 'utf8');
  /* Plain counts, no pass marks and no invented thresholds -- R3-M2-AC1 asks for
     the yield measured, not graded. */
  const s = m.stats;
  console.log('rows scanned                       : ' + m.rowsScanned + ' (of the file\'s rows, a prefix)');
  console.log('positions tested along those lines : ' + s.positions);
  console.log('  passing the multistep predicate  : ' + s.multistep);
  console.log('  rejected, < ' + m.minReplies + ' opponent replies   : ' + s.tooNarrow);
  console.log('  kept (one per row)               : ' + s.kept);
  console.log('after dedupe and cap ' + cap + '            : ' + m.selection.kept +
              ' of ' + m.selection.candidates + ' candidates');
  console.log('wrote ' + out);
}

/* --------------------------------- self-test --------------------------------- */
function selfTest() {
  let pass = 0, fail = 0;
  function chk(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '   got ' + JSON.stringify(got) +
                (ok ? '' : ', want ' + JSON.stringify(want)));
    ok ? pass++ : fail++;
  }
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'puzzles', 'puzzles.json'), 'utf8'));
  const muls = doc.puzzles.filter(function (p) { return p.family === 'multistep' && p.line; });
  const wide = muls.filter(function (p) { return p.line.steps[1].of >= 2; });
  chk('found the shipped multistep set', muls.length > 0, true);

  /* A synthetic CSV whose every row IS one shipped multistep position, with no
     moves, so position 0 is the candidate. The expected outcomes come from the
     committed data's own reply counts, which this file did not write. */
  const HDR = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate';
  const rows = muls.map(function (p, i) {
    return 'r' + String(i).padStart(3, '0') + ',' + p.fen + ',,' + (1000 + i) +
           ',50,90,100,advantage,https://lichess.org/x' + i + ',,';
  });
  const lines = [HDR].concat(rows);
  const O = { rows: Infinity, shardI: 0, shardK: 1, minReplies: 1, minRating: 0 };
  function run(o) { const s = makeScanner(o); for (const l of lines) if (!s.feed(l)) break; return s; }

  const all = run(O);
  chk('min-replies 1 keeps every shipped multistep position', all.hits.length, muls.length);
  const two = run(Object.assign({}, O, { minReplies: 2 }));
  chk('min-replies 2 keeps exactly the ones the data says give the opponent a choice',
      two.hits.length, wide.length);
  chk('...and counts the rest as too narrow', two.st.tooNarrow, muls.length - wide.length);
  chk('each kept position names the answer the shipped record names',
      all.hits.every(function (h, i) { return h.solutionUci === muls[i].solutionsUci[0]; }), true);

  /* Sharding is a partition: disjoint, and its union is the unsharded result. */
  const K = 3, parts = [0, 1, 2].map(function (i) { return run(Object.assign({}, O, { shardI: i, shardK: K })); });
  const rowsUnion = [].concat.apply([], parts.map(function (s) { return s.hits.map(function (h) { return h.row; }); }))
                      .sort(function (a, b) { return a - b; });
  chk('three shards together find exactly the unsharded rows',
      rowsUnion, all.hits.map(function (h) { return h.row; }));
  chk('and no row is claimed by two shards', new Set(rowsUnion).size, rowsUnion.length);

  /* The row bound is global, so it cuts the same rows however it is sharded. */
  const cut = run(Object.assign({}, O, { rows: 5 }));
  chk('--rows bounds the scan', cut.hits.length, 5);
  chk('and reports how many rows it saw', cut.rowsSeen(), 5);

  /* It must REJECT, or it is not discriminating. */
  const tacRow = 't0,' + doc.puzzles.filter(function (p) { return p.family === 'tactical'; })[0].fen +
                 ',,1500,50,90,100,mate,https://lichess.org/t,,';
  const s1 = makeScanner(O); s1.feed(HDR); s1.feed(tacRow);
  chk('a tactical position is rejected', s1.hits.length, 0);
  const s2 = makeScanner(O); s2.feed(HDR);
  s2.feed('o0,rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,,1500,50,90,100,opening,https://lichess.org/o,,');
  chk('the opening position is rejected', s2.hits.length, 0);

  /* One position per row: a row that replays INTO a second candidate keeps one. */
  const p17 = wide[0];
  const dup = 'd0,' + p17.fen + ',,1500,50,90,100,x,https://lichess.org/d,,';
  const s3 = makeScanner(O); s3.feed(HDR); s3.feed(dup); s3.feed(dup);
  chk('the same position from two rows is stored once', s3.hits.length, 1);

  /* Merge: sorted, deduped, capped, and strict about missing shards. */
  function asResult(s, i, k) {
    return { shardI: i, shardK: k, rows: Infinity, rowsSeen: s.rowsSeen(), minReplies: 1, minRating: 0,
             stats: s.st, candidates: s.hits };
  }
  const merged = mergeResults(parts.map(function (s, i) { return asResult(s, i, K); }), 1000);
  chk('merge reassembles the unsharded set in scan order',
      merged.puzzles.map(function (p) { return p.fen; }), all.hits.map(function (h) { return h.fen; }));
  chk('merge honours the cap',
      mergeResults(parts.map(function (s, i) { return asResult(s, i, K); }), 4).puzzles.length, 4);
  chk('merge sums the row counts', merged.stats.rows, muls.length);
  let threw = null;
  try { mergeResults([asResult(parts[0], 0, K), asResult(parts[1], 1, K)], 10); } catch (e) { threw = e.message; }
  chk('merge REFUSES when a shard is missing', /missing shard|exactly once/.test(String(threw)), true);
  threw = null;
  try { mergeResults([asResult(parts[0], 0, K), asResult(parts[0], 0, K), asResult(parts[2], 2, K)], 10); } catch (e) { threw = e.message; }
  chk('merge REFUSES when a shard is given twice', /exactly once/.test(String(threw)), true);
  threw = null;
  const odd = asResult(parts[1], 1, K); odd.minReplies = 2;
  try { mergeResults([asResult(parts[0], 0, K), odd, asResult(parts[2], 2, K)], 10); } catch (e) { threw = e.message; }
  chk('merge REFUSES when shards scanned different settings', /did not scan the same thing/.test(String(threw)), true);

  /* positionsAlong must walk a real row and stop cleanly on an illegal move. */
  const row = parseRow('0000D,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,' +
                       'd3d6 f8d8 d6d8 f6d8,1529,74,96,37506,advantage endgame short,' +
                       'https://lichess.org/F8M8OS71#53,,');
  chk('a real row parses', !!row && row.moves.length, 4);
  chk('and yields start + one position per move', positionsAlong(row).length, 5);
  const bogus = parseRow('x,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,' +
                         'a1a2 b1b2,1500,1,1,1,mate,https://x,,');
  chk('an illegal move truncates rather than throwing', positionsAlong(bogus).length, 1);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else if (process.argv.includes('--merge')) mergeCli();
  else scanCli();
}
module.exports = { makeScanner, mergeResults, positionsAlong };
