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
  const need = ['id', 'family', 'fen', 'sideToMove', 'legalMoveCount', 'soleLegalMove',
                'standardLegalMoveCount', 'solutions', 'solutionsUci', 'solutionsSan',
                'decoys', 'rationale', 'difficulty'];
  for (const k of need) if (!(k in p)) bad.push('missing field ' + k);
  if (bad.length) return bad;

  if (p.family !== 'escape' && p.family !== 'tactical') bad.push('family not escape|tactical: ' + p.family);
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

  if (p.solutionsUci.length !== p.solutions.length) bad.push('solutionsUci length ' + p.solutionsUci.length + ' != solutions ' + p.solutions.length);
  if (p.solutionsSan.length !== p.solutions.length) bad.push('solutionsSan length ' + p.solutionsSan.length + ' != solutions ' + p.solutions.length);

  const byKey = new Map(ms.map(function (m) { return [key(m), m]; }));
  const resolved = [];
  p.solutions.forEach(function (s, i) {
    const m = byKey.get(key(s));
    if (!m) { bad.push('solution ' + i + ' (' + key(s) + ') is NOT a legal move'); return; }
    if (m.kind !== 'self') bad.push('solution ' + i + ' (' + uci(m) + ') is not a self-capture, kind=' + m.kind);
    if (p.solutionsUci[i] !== uci(m)) bad.push('solutionsUci[' + i + '] ' + p.solutionsUci[i] + ' != ' + uci(m));
    const realSan = san(S, m, true);
    if (p.solutionsSan[i] !== realSan) bad.push('solutionsSan[' + i + '] ' + p.solutionsSan[i] + ' != ' + realSan);
    resolved.push(m);
  });
  if (resolved.length !== p.solutions.length) return bad;

  /* the family predicate itself must hold — this is the check a lying file fails */
  if (p.family === 'escape') {
    if (!isEscape(S)) {
      bad.push('ESCAPE predicate FAILS: inCheck=' + inCheck(S, S.turn) +
               ' standardLegal=' + std.length + ' tyrannyLegal=' + ms.length);
    }
    /* solutions must be EVERY legal move, not a subset */
    const solSet = new Set(p.solutions.map(key));
    const allSet = new Set(ms.map(key));
    if (solSet.size !== allSet.size) bad.push('escape solutions list ' + solSet.size + ' moves but ' + allSet.size + ' are legal');
    for (const k of allSet) if (!solSet.has(k)) bad.push('escape is missing legal move ' + k + ' from solutions');
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
    /* every decoy must itself be a legal, non-solution move */
    const solKeys = new Set(p.solutions.map(key));
    p.decoys.forEach(function (d, i) {
      const hit = ms.filter(function (m) { return uci(m) === d.uci; })[0];
      if (!hit) bad.push('decoy ' + i + ' ' + d.uci + ' is not a legal move');
      else if (solKeys.has(key(hit))) bad.push('decoy ' + i + ' ' + d.uci + ' IS a solution');
    });
  }
  return bad;
}

/* ============================ the real file ============================ */

const raw = fs.readFileSync(FILE, 'utf8');
let doc;
try { doc = JSON.parse(raw); } catch (e) { console.error('puzzles.json is not valid JSON: ' + e.message); process.exit(1); }

hd('File-level schema');
chk('schema is 2', doc.schema, 2);
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

const tally = {};
for (const p of list) tally[p.family] = (tally[p.family] || 0) + 1;
chk('counts.escape matches the array', (doc.counts || {}).escape || 0, tally.escape || 0);
chk('counts.tactical matches the array', (doc.counts || {}).tactical || 0, tally.tactical || 0);

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
/* Pick an escape with MORE THAN ONE solution for the drop-a-solution mutation.
   Dropping the only solution of a 1-move escape leaves an empty array, which is
   caught by a different rule — so the check that "an escape must list every legal
   move" would never actually be exercised. */
const esc = list.filter(function (p) { return p.family === 'escape' && p.solutions.length > 1; })[0]
         || list.filter(function (p) { return p.family === 'escape'; })[0];
const tac = list.filter(function (p) { return p.family === 'tactical'; })[0];

function mustReject(label, obj) {
  const bad = validate(obj);
  const ok = bad.length > 0;
  ok ? pass++ : (fail++, failures.push('MUTATION NOT CAUGHT: ' + label));
  console.log((ok ? 'PASS  ' : 'FAIL  ') + 'rejects ' + label + (ok ? '   [' + bad[0].slice(0, 62) + ']' : '   *** ACCEPTED A BAD PUZZLE'));
}

if (!esc || !tac) {
  console.log('FAIL  need one escape and one tactical puzzle to run the mutation suite');
  fail++;
} else {
  let m;
  m = clone(esc); m.fen = 'not a fen at all';                       mustReject('an unparseable FEN', m);
  m = clone(esc); m.sideToMove = (esc.sideToMove === 'w' ? 'b' : 'w'); mustReject('sideToMove contradicting the FEN', m);
  m = clone(esc); m.legalMoveCount = esc.legalMoveCount + 7;          mustReject('an inflated legalMoveCount', m);
  m = clone(esc); m.solutions = m.solutions.slice(0, -1) ;
                  m.solutionsUci = m.solutionsUci.slice(0, -1);
                  m.solutionsSan = m.solutionsSan.slice(0, -1);      mustReject('an escape missing one of its legal moves', m);
  m = clone(esc); m.solutions = { from: 0, to: 1, promo: null };     mustReject('solutions as an OBJECT instead of an array', m);
  m = clone(esc); m.solutions[0] = { from: 0, to: 63, promo: null };
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
}

hd(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
}
process.exit(fail ? 1 : 0);
