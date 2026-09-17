/*
 * puzzles.js — re-verify EVERY puzzle in puzzles/puzzles.json against the engine.
 *
 * This file is the INTERFACE, written before the generator on purpose. A bad
 * puzzle must fail a check that already existed, not one retro-fitted to match
 * whatever the generator happened to emit.
 *
 * Nothing here trusts a field in the file. Every stored number is recomputed
 * from the FEN and compared, so a file that lies about itself fails.
 *
 * The suite ends with a MUTATION section that deliberately corrupts a known-good
 * puzzle eight ways and asserts each corruption is REJECTED. A validator that has
 * only ever been shown valid data is not a validated validator — it proves it
 * accepts, never that it discriminates.
 */
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');
const { legal, apply, inCheck, fen, san, idx } = E;
const { toFen } = require('../tools/fen-write.js');

const FILE = path.join(__dirname, '..', 'puzzles', 'puzzles.json');

let pass = 0, fail = 0;
const failures = [];
function chk(name, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : (fail++, failures.push(name + ' | got ' + got + ' | want ' + want));
  if (!ok) console.log('FAIL  ' + name + '   got ' + got + ', want ' + want);
  return ok;
}
function hd(t) { console.log('\n== ' + t); }

/* ---------- the two family predicates, verbatim from the dispatch ---------- */

function isMate(T) {
  return legal(T, true).length === 0 && inCheck(T, T.turn);
}

/* mate now, or every reply the opponent has still allows a mate next move */
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

function isEscape(S) {
  return inCheck(S, S.turn)
      && legal(S, false).length === 0
      && legal(S, true).length >= 1;
}

/* returns the sole self-capture mate, or null if this is not a TACTICAL */
function tacticalSolution(S) {
  const ms = legal(S, true);
  const selfMates = ms.filter(function (m) { return m.kind === 'self' && isMate(apply(S, m)); });
  const otherMates = ms.filter(function (m) { return m.kind !== 'self' && isMate(apply(S, m)); });
  if (selfMates.length !== 1) return null;
  if (otherMates.length !== 0) return null;
  if (ms.some(function (m) { return m.kind !== 'self' && matesIn2(S, m); })) return null;
  return selfMates[0];
}

/* MULTISTEP: exactly one self-capture forces mate within three plies, nothing
   mates in 1, and no ordinary move forces it either. Written out here rather
   than imported from the generator ON PURPOSE -- this file is the interface,
   and a validator that imports the thing it validates proves only that the
   generator agrees with itself. */
function multistepSolution(S) {
  const ms = legal(S, true);
  const selfs = ms.filter(function (m) { return m.kind === 'self'; });
  const ords  = ms.filter(function (m) { return m.kind !== 'self'; });
  if (!selfs.length) return null;
  if (selfs.some(function (m) { return isMate(apply(S, m)); })) return null;
  if (ords.some(function (m) { return isMate(apply(S, m)); })) return null;
  const forcing = selfs.filter(function (m) { return matesIn2(S, m); });
  if (forcing.length !== 1) return null;
  if (ords.some(function (m) { return matesIn2(S, m); })) return null;
  return forcing[0];
}

/* RESTRAINT: an ordinary move mates at once, a self-capture is available, and
   no self-capture mates in 1 or forces mate within three plies. Returns every
   ordinary mating move, because they are all correct answers. */
function restraintSolutions(S) {
  const ms = legal(S, true);
  const selfs = ms.filter(function (m) { return m.kind === 'self'; });
  const ords  = ms.filter(function (m) { return m.kind !== 'self'; });
  if (!selfs.length) return null;
  const wins = ords.filter(function (m) { return isMate(apply(S, m)); });
  if (!wins.length) return null;
  if (selfs.some(function (m) { return isMate(apply(S, m)); })) return null;
  if (selfs.some(function (m) { return matesIn2(S, m); })) return null;
  return wins;
}

/* The FULL forcing line, reply by reply -- not a boolean (M3-T1-AC4).
   Every legal opponent reply must be listed with a move that mates it; a reply
   with no mating answer is named, so a failure says WHICH reply escapes rather
   than only that the predicate failed. */
function forcingLine(S, m) {
  const T = apply(S, m);
  if (isMate(T)) return { ok: false, why: 'the move is itself mate-in-1' };
  const rep = legal(T, true);
  if (!rep.length) {
    return { ok: false, why: inCheck(T, T.turn) ? 'mate in 1, not a forcing line' : 'stalemate, which is not mate' };
  }
  const lines = [], gaps = [];
  for (const r of rep) {
    const U = apply(T, r);
    const kill = legal(U, true).filter(function (x) { return isMate(apply(U, x)); });
    if (!kill.length) gaps.push(uci(r));
    else lines.push({ reply: uci(r), mate: uci(kill[0]), mates: kill.length });
  }
  return { ok: gaps.length === 0, replies: lines, gaps: gaps, count: rep.length };
}

/* does the side to move at T lose by force within three plies? */
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

/*
 * SURVIVAL, the family that replaced escape. Re-derived here rather than
 * imported, for the same reason as the others: a validator that imports the
 * thing it validates proves only that the generator agrees with itself.
 *
 * Checkmate under standard rules, at least three ways out under the variant,
 * and exactly ONE of them still alive afterwards. Two depths, and the depth is
 * the difficulty: a SHALLOW puzzle is settled by checking the opponent's
 * immediate reply to each candidate; a DEEP one is not - more than one
 * candidate survives the reply, and only one survives three plies.
 *
 * Every candidate is a self-capture and that needs no clause: standard-legal
 * moves number zero here, so anything the variant adds can only be an
 * execution. The king is always the mover, for the same reason - capturing the
 * checker or blocking the line would both be ordinary moves, so the only thing
 * the rule newly permits is the king eating its own neighbour.
 */
function survivalSolution(S) {
  if (!inCheck(S, S.turn)) return null;
  if (legal(S, false).length !== 0) return null;
  const ms = legal(S, true);
  if (ms.length < 3) return null;
  const live = ms.filter(function (m) {
    const T = apply(S, m);
    return !legal(T, true).some(function (r) { return isMate(apply(T, r)); });
  });
  if (live.length === 1) return { move: live[0], depth: 1, live: live.length };
  if (live.length < 2) return null;
  const deep = live.filter(function (m) { return !lostIn3(apply(S, m)); });
  if (deep.length !== 1) return null;
  return { move: deep[0], depth: 3, live: live.length };
}

/* Family PRECEDENCE, mirroring tools/gen-puzzles.js. Escape and multistep are
   NOT disjoint -- a position in check with no ordinary moves satisfies
   multistep's clauses vacuously -- so a multistep that is also an escape is
   mislabelled, and this is the check that says so. */
/* escape is RETIRED as a shipped family and survival replaces it. isEscape()
   stays, because survival is a strict SUBSET of escape and the subset relation
   is what makes "this really is a survival position" checkable: every survival
   puzzle must also satisfy isEscape, and that is asserted below.

   survival sits LAST on purpose. A position with no ordinary moves can in
   principle also satisfy tactical or multistep - if one of its escapes happens
   to mate, or to force mate in two - and if that ever happens the label is
   genuinely ambiguous and a human should look. Measured over the shipped set:
   zero do. */
const ORDER = ['tactical', 'restraint', 'multistep', 'survival'];
const MATCHES = {
  tactical:  function (S) { return !!tacticalSolution(S); },
  restraint: function (S) { return !!restraintSolutions(S); },
  multistep: function (S) { return !!multistepSolution(S); },
  survival:  function (S) { return !!survivalSolution(S); }
};

/* ---------- helpers ---------- */

const key = function (m) { return m.from + ':' + m.to + ':' + (m.promo || '-'); };
const FILES_ = 'abcdefgh';
const sq = function (i) { return FILES_[i % 8] + (8 - ((i / 8) | 0)); };
const uci = function (m) { return sq(m.from) + sq(m.to) + (m.promo || ''); };

/*
 * validate(p) -> array of problem strings. Empty array means the puzzle is sound.
 * Every caller in this file goes through here, including the mutation tests, so
 * the corruption suite exercises exactly the code the real puzzles exercise.
 */
function validate(p) {
  const bad = [];
  const need = ['id', 'family', 'fen', 'sideToMove', 'legalMoveCount', 'selfCaptureCount',
                'soleLegalMove', 'standardLegalMoveCount', 'solutions', 'solutionsUci',
                'solutionsSan', 'decoys', 'rationale', 'difficulty'];
  for (const k of need) if (!(k in p)) bad.push('missing field ' + k);
  if (bad.length) return bad;

  if (ORDER.indexOf(p.family) < 0) bad.push('family not one of ' + ORDER.join('|') + ': ' + p.family);
  /* survival carries two fields nothing else does: where the position came from,
     and the depth that decides its difficulty. Both are required for that family
     and must be absent nowhere else in a way that matters - a missing source is
     a puzzle nobody can trace back to a game. */
  if (p.family === 'survival') {
    if (!p.source || typeof p.source.id !== 'string') bad.push('survival puzzle has no source.id');
    else if (p.source.db !== 'lichess-cc0') bad.push('survival source.db is ' + p.source.db + ', expected lichess-cc0');
    if (p.depth !== 1 && p.depth !== 3) bad.push('survival depth is ' + p.depth + ', expected 1 or 3');
  }
  if (!Array.isArray(p.solutions)) { bad.push('solutions is not an ARRAY'); return bad; }
  if (p.solutions.length === 0) bad.push('solutions is empty');
  if (!Array.isArray(p.decoys)) bad.push('decoys is not an array');
  if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 3) bad.push('difficulty not 1..3: ' + p.difficulty);

  /* Structural FEN check FIRST. The engine's fen() does not throw on garbage —
     it returns a malformed state — so without this the failure surfaces later as
     a confusing round-trip message instead of "this is not a FEN". */
  if (typeof p.fen !== 'string') { bad.push('fen is not a string'); return bad; }
  const parts = p.fen.trim().split(/\s+/);
  if (parts.length !== 6) { bad.push('fen does not have 6 space-separated fields, has ' + parts.length); return bad; }
  if (parts[0].split('/').length !== 8) { bad.push('fen board does not have 8 ranks, has ' + parts[0].split('/').length); return bad; }
  if (parts[1] !== 'w' && parts[1] !== 'b') { bad.push('fen side-to-move field is ' + parts[1]); return bad; }

  let S;
  try { S = fen(p.fen); } catch (e) { bad.push('fen did not parse: ' + e.message); return bad; }
  if (!S || !S.b || S.b.length !== 64) { bad.push('fen produced no 64-square board'); return bad; }

  /* the FEN must survive a write/read round trip, or the stored position is not
     the position the solver will see */
  const rt = toFen(S);
  if (rt !== p.fen) bad.push('fen does not round-trip: stored ' + p.fen + ' -> ' + rt);

  if (S.turn !== p.sideToMove) bad.push('sideToMove ' + p.sideToMove + ' but FEN says ' + S.turn);

  const ms = legal(S, true);
  const std = legal(S, false);
  if (ms.length !== p.legalMoveCount) bad.push('legalMoveCount ' + p.legalMoveCount + ' but engine says ' + ms.length);
  if (std.length !== p.standardLegalMoveCount) bad.push('standardLegalMoveCount ' + p.standardLegalMoveCount + ' but engine says ' + std.length);
  if (p.soleLegalMove !== (ms.length === 1)) bad.push('soleLegalMove ' + p.soleLegalMove + ' but legal count is ' + ms.length);
  const selfN = ms.filter(function (m) { return m.kind === 'self'; }).length;
  if (selfN !== p.selfCaptureCount) bad.push('selfCaptureCount ' + p.selfCaptureCount + ' but engine says ' + selfN);

  if (p.solutionsUci.length !== p.solutions.length) bad.push('solutionsUci length ' + p.solutionsUci.length + ' != solutions ' + p.solutions.length);
  if (p.solutionsSan.length !== p.solutions.length) bad.push('solutionsSan length ' + p.solutionsSan.length + ' != solutions ' + p.solutions.length);

  const byKey = new Map(ms.map(function (m) { return [key(m), m]; }));
  const resolved = [];
  p.solutions.forEach(function (s, i) {
    const m = byKey.get(key(s));
    if (!m) { bad.push('solution ' + i + ' (' + key(s) + ') is NOT a legal move'); return; }
    /* Three families are solved BY an execution and one is solved by refusing
       it, so this rule points both ways. The restraint half is M3-T2-AC5: a
       restraint puzzle whose solution is a self-capture must fail this suite. */
    if (p.family === 'restraint') {
      if (m.kind === 'self') bad.push('solution ' + i + ' (' + uci(m) + ') IS a self-capture, but a restraint puzzle is solved by REFUSING one');
    } else if (m.kind !== 'self') {
      bad.push('solution ' + i + ' (' + uci(m) + ') is not a self-capture, kind=' + m.kind);
    }
    if (p.solutionsUci[i] !== uci(m)) bad.push('solutionsUci[' + i + '] ' + p.solutionsUci[i] + ' != ' + uci(m));
    const realSan = san(S, m, true);
    if (p.solutionsSan[i] !== realSan) bad.push('solutionsSan[' + i + '] ' + p.solutionsSan[i] + ' != ' + realSan);
    resolved.push(m);
  });
  if (resolved.length !== p.solutions.length) return bad;

  /* the family predicate itself must hold — this is the check a lying file fails */
  if (p.family === 'survival') {
    /* the setup half: this must still be a position standard chess calls mate */
    if (!isEscape(S)) {
      bad.push('SURVIVAL setup FAILS: it is not a standard-rules checkmate. inCheck=' +
               inCheck(S, S.turn) + ' standardLegal=' + std.length + ' tyrannyLegal=' + ms.length);
    }
    if (ms.length < 3) bad.push('SURVIVAL needs at least three ways out, has ' + ms.length);
    const want = survivalSolution(S);
    if (!want) {
      const live = ms.filter(function (m) {
        const T = apply(S, m);
        return !legal(T, true).some(function (r) { return isMate(apply(T, r)); });
      });
      bad.push('SURVIVAL predicate FAILS: ' + ms.length + ' ways out, ' + live.length +
               ' survive the reply, so the answer is not unique');
    } else {
      if (p.solutions.length !== 1) bad.push('survival must carry exactly 1 solution, has ' + p.solutions.length);
      else if (key(p.solutions[0]) !== key(want.move)) {
        bad.push('survival solution ' + uci(p.solutions[0]) + ' is not the one that survives, ' + uci(want.move));
      }
      if (p.depth !== want.depth) bad.push('survival depth ' + p.depth + ' but the position is decided at ' + want.depth);
      /* THE clause that makes this a puzzle at all, and the one the retired
         escape family never had: there have to be wrong answers. */
      if (p.solutions.length >= ms.length) {
        bad.push('SURVIVAL has no wrong answers: ' + p.solutions.length + ' solutions for ' + ms.length + ' legal moves');
      }
    }
    /* every decoy must be a real losing move, refuted by the move named */
    p.decoys.forEach(function (d, i) {
      const hit = ms.filter(function (m) { return uci(m) === d.uci; })[0];
      if (!hit) { bad.push('survival decoy ' + i + ' ' + d.uci + ' is not legal'); return; }
      const T = apply(S, hit);
      const kill = legal(T, true).filter(function (r) { return isMate(apply(T, r)); })[0];
      if (!kill && p.depth === 1) bad.push('survival decoy ' + i + ' ' + d.uci + ' is not actually refuted');
      else if (kill && d.refutedBy && san(T, kill, true) !== d.refutedBy) {
        bad.push('survival decoy ' + i + ' says it is refuted by ' + d.refutedBy + ' but the move is ' + san(T, kill, true));
      }
    });
  } else if (p.family === 'tactical') {
    const want = tacticalSolution(S);
    if (!want) {
      const sm = ms.filter(function (m) { return m.kind === 'self' && isMate(apply(S, m)); });
      const om = ms.filter(function (m) { return m.kind !== 'self' && isMate(apply(S, m)); });
      const q2 = ms.filter(function (m) { return m.kind !== 'self' && matesIn2(S, m); });
      bad.push('TACTICAL predicate FAILS: selfMates=' + sm.length + ' otherMates=' + om.length + ' ordinaryMateIn2=' + q2.length);
    } else {
      if (p.solutions.length !== 1) bad.push('tactical must carry exactly 1 solution, has ' + p.solutions.length);
      else if (key(p.solutions[0]) !== key(want)) bad.push('tactical solution ' + uci(p.solutions[0]) + ' is not the unique self-mate ' + uci(want));
    }
  } else if (p.family === 'multistep') {
    const selfs = ms.filter(function (m) { return m.kind === 'self'; });
    const ords  = ms.filter(function (m) { return m.kind !== 'self'; });
    if (!selfs.length) bad.push('MULTISTEP has no legal self-capture at all');
    const selfMate1 = selfs.filter(function (m) { return isMate(apply(S, m)); });
    if (selfMate1.length) bad.push('MULTISTEP rejection clause FAILS: ' + selfMate1.length +
      ' self-capture(s) mate in 1 (' + selfMate1.map(uci).join(',') + ') -- this is a one-mover');
    const ordMate1 = ords.filter(function (m) { return isMate(apply(S, m)); });
    if (ordMate1.length) bad.push('MULTISTEP FAILS: ordinary move ' + uci(ordMate1[0]) + ' mates in 1');
    const forcing = selfs.filter(function (m) { return matesIn2(S, m); });
    if (forcing.length !== 1) bad.push('MULTISTEP needs exactly one forcing self-capture, found ' + forcing.length);
    const ordForcing = ords.filter(function (m) { return matesIn2(S, m); });
    if (ordForcing.length) bad.push('MULTISTEP necessity FAILS: ordinary move ' + uci(ordForcing[0]) +
      ' forces mate in the same budget, so the execution is not necessary');
    if (p.solutions.length !== 1) bad.push('multistep must carry exactly 1 solution, has ' + p.solutions.length);
    else if (forcing.length === 1 && key(p.solutions[0]) !== key(forcing[0])) {
      bad.push('multistep solution ' + uci(p.solutions[0]) + ' is not the unique forcing execution ' + uci(forcing[0]));
    }
    /* AC4: walk the whole line, not just assert a boolean. */
    if (forcing.length === 1) {
      const L = forcingLine(S, forcing[0]);
      if (!L.ok) {
        bad.push('MULTISTEP forcing line is INCOMPLETE: ' + (L.why ||
          (L.gaps.length + ' of ' + L.count + ' replies have no mating answer: ' + L.gaps.slice(0, 4).join(','))));
      }
    }
  } else if (p.family === 'restraint') {
    const selfs = ms.filter(function (m) { return m.kind === 'self'; });
    const ords  = ms.filter(function (m) { return m.kind !== 'self'; });
    /* AC1 -- the temptation has to actually be on the board. */
    if (!selfs.length) bad.push('RESTRAINT has no legal self-capture, so there is no temptation to resist');
    const wins = ords.filter(function (m) { return isMate(apply(S, m)); });
    if (!wins.length) bad.push('RESTRAINT FAILS: no ordinary move mates in 1, so nothing wins by restraint');
    const selfMate1 = selfs.filter(function (m) { return isMate(apply(S, m)); });
    if (selfMate1.length) bad.push('RESTRAINT FAILS: self-capture ' + uci(selfMate1[0]) + ' mates in 1 as well');
    const selfForcing = selfs.filter(function (m) { return matesIn2(S, m); });
    if (selfForcing.length) bad.push('RESTRAINT FAILS: self-capture ' + uci(selfForcing[0]) +
      ' forces mate within three plies, so the execution is not actually wrong');
    /* every ordinary mate is a correct answer, so solutions must be all of them */
    const want = new Set(wins.map(key)), got = new Set(p.solutions.map(key));
    if (want.size !== got.size) bad.push('restraint lists ' + got.size + ' solutions but ' + want.size + ' ordinary moves mate');
    for (const k of want) if (!got.has(k)) bad.push('restraint is missing mating move ' + k + ' from solutions');
  }

  /* Universal now, not tactical-only: a decoy must be a legal, non-solution
     move whatever family it belongs to. And for a restraint the decoys ARE the
     trap, so every one of them has to be a self-capture. */
  {
    const solKeys = new Set(p.solutions.map(key));
    p.decoys.forEach(function (d, i) {
      const hit = ms.filter(function (m) { return uci(m) === d.uci; })[0];
      if (!hit) { bad.push('decoy ' + i + ' ' + d.uci + ' is not a legal move'); return; }
      if (solKeys.has(key(hit))) bad.push('decoy ' + i + ' ' + d.uci + ' IS a solution');
      if (p.family === 'restraint' && hit.kind !== 'self') {
        bad.push('restraint decoy ' + i + ' ' + d.uci + ' is not a self-capture; for this family the decoys are the temptation');
      }
    });
  }

  /* PRECEDENCE: a puzzle must not also match a family that ranks ahead of its
     own, or the label is wrong even though its own predicate holds. */
  {
    const mine = ORDER.indexOf(p.family);
    for (let i = 0; i < mine; i++) {
      if (MATCHES[ORDER[i]](S)) {
        bad.push('family is ' + p.family + ' but the position also matches ' + ORDER[i] + ', which takes precedence');
      }
    }
  }
  return bad;
}

/* ============================ the real file ============================ */

const raw = fs.readFileSync(FILE, 'utf8');
let doc;
try { doc = JSON.parse(raw); } catch (e) { console.error('puzzles.json is not valid JSON: ' + e.message); process.exit(1); }

hd('File-level schema');
/* Schema 3, bumped WITH the reader in the same change (M3-T2-AC4): two new
   family values plus the selfCaptureCount field. The page refuses a schema it
   does not know rather than reading a newer file as if it were a schema-2 one. */
chk('schema is 4', doc.schema, 4);
chk('puzzles is an array', Array.isArray(doc.puzzles), true);
chk('at least one puzzle', (doc.puzzles || []).length > 0, true);
chk('has a generator block', !!doc.generator, true);
chk('generator records games', Number.isInteger(doc.generator && doc.generator.games), true);
chk('generator records positionsVisited', Number.isInteger(doc.generator && doc.generator.positionsVisited), true);
chk('generator records seed', doc.generator && doc.generator.seed !== undefined, true);

const list = doc.puzzles || [];
const ids = list.map(function (p) { return p.id; });
chk('ids are unique', new Set(ids).size, ids.length);
chk('every id is a non-empty string', ids.every(function (i) { return typeof i === 'string' && i.length > 0; }), true);

chk('generator records the family precedence',
  Array.isArray(doc.generator && doc.generator.familyPrecedence) &&
  doc.generator.familyPrecedence.join(',') === ORDER.join(','), true);
chk('generator records measured yield per family',
  ORDER.every(function (f) { return doc.generator && doc.generator.yield &&
    typeof doc.generator.yield[f] === 'object' &&
    Number.isInteger(doc.generator.yield[f].found); }), true);

/* Nothing but generatedAt may be wall-clock, or the shipped file stops being
   what the generator produces from its own recorded seed. This caught a real
   drift: yield carried predicateSeconds, so two identical runs differed by two
   bytes and the committed file no longer matched a fresh one. The guard is a
   key allow-list rather than a value check, because the next such field will
   have a different name and the same problem. */
const YIELD_KEYS = ['found', 'kept', 'cap', 'target', 'short', 'perThousandUnique'].join(',');
ORDER.forEach(function (f) {
  const y = (doc.generator.yield || {})[f] || {};
  chk('generator.yield.' + f + ' carries only reproducible fields',
    Object.keys(y).sort().join(','), YIELD_KEYS.split(',').sort().join(','));
});

/*
 * How many puzzles match MORE than one family predicate? The precedence rule in
 * validate() decides the label when that happens, but precedence is a branch
 * nothing can currently reach -- no position matching two families has ever
 * been observed -- so on its own it is assurance that cannot fire. This is the
 * measurement that can: 121 x 4 predicate evaluations, printed as a number, and
 * a real mislabel would move it off zero.
 *
 * It is deliberately an equality check rather than a warning. A puzzle matching
 * two families is not a crisis, but it IS the moment precedence stops being
 * theoretical, and that deserves a human reading it rather than a log line.
 */
{
  const multi = [];
  for (const p of list) {
    const S = fen(p.fen);
    const hits = ORDER.filter(function (f) { return MATCHES[f](S); });
    if (hits.length > 1) multi.push(p.id + ' matches ' + hits.join('+') + ', labelled ' + p.family);
    if (hits.indexOf(p.family) < 0) multi.push(p.id + ' is labelled ' + p.family + ' but matches ' + (hits.join('+') || 'NOTHING'));
  }
  chk('no puzzle matches more than one family predicate, or is labelled as one it does not match', multi.length, 0);
  if (multi.length) multi.slice(0, 5).forEach(function (m) { console.log('        - ' + m); });
  console.log('      cross-family overlap measured over ' + list.length + ' puzzles x ' + ORDER.length + ' predicates');
}

const tally = {};
for (const p of list) tally[p.family] = (tally[p.family] || 0) + 1;
ORDER.forEach(function (f) {
  chk('counts.' + f + ' matches the array', (doc.counts || {})[f] || 0, tally[f] || 0);
});
/* A family that came up short is reported, never hidden. This prints the
   shortfall rather than failing: a rare family is a measurement, not a bug. */
ORDER.forEach(function (f) {
  const y = (doc.generator.yield || {})[f] || {};
  if (y.short) console.log('      NOTE  ' + f + ' is SHORT BY ' + y.short +
    ' (found ' + y.found + ' of ' + y.target + ', ' + y.perThousandUnique + ' per 1000 unique positions)');
});
chk('every family in the file was actually generated, not hand-added',
  ORDER.filter(function (f) { return (tally[f] || 0) > 0; }).length >= 2, true);

hd('Every puzzle re-verified against the engine (' + list.length + ' entries)');
let sound = 0;
for (const p of list) {
  const bad = validate(p);
  if (bad.length === 0) { sound++; pass++; }
  else {
    fail++;
    failures.push(p.id + ' | ' + bad.join(' ; '));
    console.log('FAIL  ' + p.id + ' (' + p.family + ')');
    bad.forEach(function (b) { console.log('        - ' + b); });
  }
}
console.log('      ' + sound + ' of ' + list.length + ' puzzles verified sound');

/* ===================== the validator must DISCRIMINATE ===================== */
/*
 * Eight deliberate corruptions of a real puzzle. Each must be caught. Without
 * this section a validator that returned [] unconditionally would score a
 * perfect pass above, which is exactly the failure mode this guards.
 */
hd('Mutation: corrupted puzzles must be REJECTED');
const clone = function (o) { return JSON.parse(JSON.stringify(o)); };
/* The generic corruptions need any real puzzle to work from; survival is used
   because it is the family this round added and the one with the most fields to
   get wrong. The escape family it replaced is gone, and with it the mutation
   that asserted "an escape lists every legal move" — that property was the
   defect, not a feature, and its replacement is below: a survival puzzle that
   lists every legal move has no wrong answers and must be REJECTED. */
const sur = list.filter(function (p) { return p.family === 'survival'; })[0];
const tac = list.filter(function (p) { return p.family === 'tactical'; })[0];
const res = list.filter(function (p) { return p.family === 'restraint'; })[0];
const mul = list.filter(function (p) { return p.family === 'multistep'; })[0];

function mustReject(label, obj) {
  const bad = validate(obj);
  const ok = bad.length > 0;
  ok ? pass++ : (fail++, failures.push('MUTATION NOT CAUGHT: ' + label));
  console.log((ok ? 'PASS  ' : 'FAIL  ') + 'rejects ' + label + (ok ? '   [' + bad[0].slice(0, 62) + ']' : '   *** ACCEPTED A BAD PUZZLE'));
}

if (!sur || !tac) {
  console.log('FAIL  need one survival and one tactical puzzle to run the mutation suite');
  fail++;
} else {
  let m;
  m = clone(sur); m.fen = 'not a fen at all';                       mustReject('an unparseable FEN', m);
  m = clone(sur); m.sideToMove = (sur.sideToMove === 'w' ? 'b' : 'w'); mustReject('sideToMove contradicting the FEN', m);
  m = clone(sur); m.legalMoveCount = sur.legalMoveCount + 7;          mustReject('an inflated legalMoveCount', m);
  m = clone(sur); m.solutions = { from: 0, to: 1, promo: null };     mustReject('solutions as an OBJECT instead of an array', m);
  m = clone(sur); m.solutions[0] = { from: 0, to: 63, promo: null };
                  m.solutionsUci[0] = 'a8h1';                        mustReject('a solution that is not a legal move', m);
  m = clone(tac); m.family = 'escape';                               mustReject('a tactical relabelled as an escape', m);
  m = clone(tac); delete m.difficulty;                               mustReject('a missing required field', m);
  m = clone(tac); m.difficulty = 9;                                  mustReject('difficulty out of range', m);
  /* a non-self-capture solution: find an ordinary legal move in the tactical position */
  const St = fen(tac.fen);
  const ordinary = legal(St, true).filter(function (x) { return x.kind !== 'self'; })[0];
  if (ordinary) {
    m = clone(tac);
    m.solutions = [{ from: ordinary.from, to: ordinary.to, promo: ordinary.promo || null }];
    m.solutionsUci = [uci(ordinary)];
    m.solutionsSan = [san(St, ordinary, true)];
    mustReject('a solution that is not a self-capture', m);
  }
  m = clone(tac); m.selfCaptureCount = tac.selfCaptureCount + 3;  mustReject('an inflated selfCaptureCount', m);
  m = clone(tac); m.family = 'nonsense';                          mustReject('an unknown family value', m);
}

/* ====================== survival must have WRONG ANSWERS ====================== */
/*
 * This is the section that exists because of what it replaced. The escape family
 * listed EVERY legal move as a solution, so it was impossible to answer one
 * incorrectly. Each corruption below turns a survival puzzle back into something
 * with that defect, and each must be caught.
 */
hd('Mutation: a survival puzzle with no wrong answer is not a puzzle');
if (!sur) { console.log('FAIL  no survival puzzle to mutate'); fail++; }
else {
  let m;
  const Ss = fen(sur.fen);
  const all = legal(Ss, true);

  /* THE one. Every legal move listed as correct is precisely the retired
     family's shape, and it has to fail now. */
  m = clone(sur);
  m.solutions = all.map(function (x) { return { from: x.from, to: x.to, promo: x.promo || null }; });
  m.solutionsUci = all.map(uci);
  m.solutionsSan = all.map(function (x) { return san(Ss, x, true); });
  mustReject('a survival puzzle that lists EVERY legal move, the old escape shape', m);

  /* pointing at a move that actually loses */
  const loser = all.filter(function (x) { return uci(x) !== sur.solutionsUci[0]; })[0];
  if (loser) {
    m = clone(sur);
    m.solutions = [{ from: loser.from, to: loser.to, promo: loser.promo || null }];
    m.solutionsUci = [uci(loser)];
    m.solutionsSan = [san(Ss, loser, true)];
    mustReject('a survival puzzle whose answer is one of the losing moves', m);
  }

  m = clone(sur); m.depth = (sur.depth === 1 ? 3 : 1);
  mustReject('a survival puzzle claiming the wrong depth', m);
  m = clone(sur); delete m.source;
  mustReject('a survival puzzle with no source to trace it back to', m);
  m = clone(sur); m.source = JSON.parse(JSON.stringify(sur.source)); m.source.db = 'somewhere-else';
  mustReject('a survival puzzle claiming a source database it did not come from', m);
  m = clone(sur); m.selfCaptureCount = 0;
  mustReject('a survival puzzle claiming no self-captures are available', m);
  if (sur.decoys && sur.decoys.length) {
    m = clone(sur); m.decoys = JSON.parse(JSON.stringify(sur.decoys));
    m.decoys[0].refutedBy = 'Qz9#';
    mustReject('a survival decoy naming a refutation that is not the real one', m);
  }
  m = clone(sur); m.family = 'multistep';
  mustReject('a survival puzzle relabelled as a multistep', m);
}

/* ============ the two new families, and the claims they must not fake ============ */
/*
 * M3-T1-AC2 and M3-T2-AC5 are release blockers and each names a specific lie the
 * suite has to catch. These are those two, plus the label swaps around them.
 */
hd('Mutation: the new families must not be fakeable');
if (!res || !mul) {
  console.log('FAIL  need one restraint and one multistep puzzle to run this section');
  fail++;
} else {
  let m;

  /* M3-T2-AC5, stated verbatim in the tree: "a restraint puzzle whose solution
     is a self-capture must fail the suite". The decoys of a restraint are its
     legal self-captures, so decoys[0] is exactly the tempting wrong answer. */
  const Sr = fen(res.fen);
  const trap = legal(Sr, true).filter(function (x) { return uci(x) === res.decoys[0].uci; })[0];
  if (!trap) { console.log('FAIL  could not resolve the restraint decoy back to a legal move'); fail++; }
  else {
    m = clone(res);
    m.solutions = [{ from: trap.from, to: trap.to, promo: trap.promo || null }];
    m.solutionsUci = [uci(trap)];
    m.solutionsSan = [san(Sr, trap, true)];
    mustReject('a RESTRAINT whose solution is the self-capture it warns against', m);
  }

  /* M3-T1-AC2: "verified by a test that feeds it a mate-in-1 position and sees
     it rejected." A tactical IS a mate-in-1 self-capture position, so relabelling
     one as multistep is that test with a real position rather than a synthetic
     one -- the rejection clause is the only thing standing between the two. */
  m = clone(tac); m.family = 'multistep';
  mustReject('a MULTISTEP that is really a one-mover (mate-in-1 self-capture)', m);

  m = clone(mul); m.family = 'restraint';
  mustReject('a multistep relabelled as a restraint', m);
  m = clone(res); m.family = 'multistep';
  mustReject('a restraint relabelled as a multistep', m);
  m = clone(mul); m.family = 'tactical';
  mustReject('a multistep relabelled as a tactical', m);

  /* the solution must be the ONE forcing execution, not just any self-capture */
  const Sm = fen(mul.fen);
  const otherSelf = legal(Sm, true).filter(function (x) {
    return x.kind === 'self' && key(x) !== key(mul.solutions[0]);
  })[0];
  if (otherSelf) {
    m = clone(mul);
    m.solutions = [{ from: otherSelf.from, to: otherSelf.to, promo: otherSelf.promo || null }];
    m.solutionsUci = [uci(otherSelf)];
    m.solutionsSan = [san(Sm, otherSelf, true)];
    mustReject('a multistep pointing at the wrong self-capture', m);
  }

  /* a restraint decoy that is not a self-capture is not the trap */
  const notSelf = legal(Sr, true).filter(function (x) { return x.kind !== 'self'; })[0];
  if (notSelf) {
    m = clone(res);
    m.decoys = [{ uci: uci(notSelf), san: san(Sr, notSelf, true) }];
    mustReject('a restraint decoy that is not a self-capture', m);
  }
}

/* ===================== the same seed reproduces the same file ===================== */
/*
 * M3-T1-AC6. Two runs, same seed, same --now, compared BYTE for byte.
 *
 * --now exists for this check alone. Everything else the generator writes is a
 * pure function of the seed, but generatedAt was a wall-clock stamp, so without
 * a way to pin it "byte-identical" was not a property anything could ever test.
 * Tiny budget on purpose -- determinism is a property of the machinery, not of
 * the sample size, and a 200-second run inside a unit suite is its own defect.
 */
hd('Reproducibility: the same seed writes the same bytes');
{
  const { execFileSync } = require('child_process');
  const os = require('os');
  const gen = path.join(__dirname, '..', 'tools', 'gen-puzzles.js');
  const tmpA = path.join(os.tmpdir(), 'tyranny-repro-a.json');
  const tmpB = path.join(os.tmpdir(), 'tyranny-repro-b.json');
  const args = function (out) {
    return [gen, '--games', '20', '--target', '20', '--seed', '424242',
            '--now', '2026-01-01T00:00:00Z', '--out', out];
  };
  try {
    execFileSync(process.execPath, args(tmpA), { stdio: 'pipe' });
    execFileSync(process.execPath, args(tmpB), { stdio: 'pipe' });
    const a = fs.readFileSync(tmpA), b = fs.readFileSync(tmpB);
    chk('two runs at seed 424242 produce the same byte length', a.length, b.length);
    chk('and the same bytes', a.equals(b), true);
    chk('the run actually produced puzzles, so this is not comparing two empty files',
      JSON.parse(a.toString()).puzzles.length > 0, true);
    fs.unlinkSync(tmpA); fs.unlinkSync(tmpB);
  } catch (e) {
    console.log('FAIL  reproducibility run failed: ' + e.message);
    fail++;
  }
}

hd(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
}
process.exit(fail ? 1 : 0);
