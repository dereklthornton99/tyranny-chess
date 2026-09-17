/*
 * shed.js — pins the outcome of the shed question so the claim cannot come back.
 *
 * The project used to say that in Tyranny "stalemate becomes reachable on
 * purpose, which standard chess cannot do." A sweep on 2026-09-17 looked for a
 * position where that is true against CORRECT play and did not find one:
 *
 *   69,193 positions examined, 56,186 of them with a legal self-capture
 *   91,563 shed verdicts
 *    5,071 DRAWN — every single one by INSUFFICIENT MATERIAL
 *        0 by OPP_STALEMATE, FORCED_STALEMATE or FORCED_INSUFFICIENT
 *        0 SOUND (drawn AND the position was lost without the shed)
 *        0 sound KING sheds
 *
 * So the claim was RETRACTED rather than softened, and this file is the thing
 * that stops it drifting back in. It checks three separate ways:
 *
 *   1. the shipped demo position's actual behaviour, re-derived from its FEN
 *   2. that the classifier DISCRIMINATES — a detector that can only ever return
 *      one verdict would have produced the same run of zeroes above
 *   3. that the retracted wording is absent from the page and the README
 *
 * Honest limit, stated here rather than left for a reader to notice. 80,659 of
 * the verdicts were UNDETERMINED: no forced mate and no forced draw inside a
 * three-ply budget. A sound shed could live in there and this search would not
 * see it. What the sweep supports is "no evidence was found across a large
 * sample under a stated test", not "no such position exists".
 *
 * Two of the four drawing mechanisms, FORCED_STALEMATE and FORCED_INSUFFICIENT,
 * are not exercised below because no position is known that reaches either, and
 * that is part of the finding rather than a gap in it. FORCED_STALEMATE needs
 * the opponent to have NO checking move at all: a check against a side with no
 * legal moves is mate, not stalemate, so a single checking reply anywhere in the
 * opponent's move list breaks the whole mechanism.
 */
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');
const { legal, apply, inCheck, fen, san, sqName } = E;
const SS = require('../tools/shed-sweep.js');

let pass = 0, fail = 0;
const failures = [];
function chk(name, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : (fail++, failures.push(name + ' | got ' + got + ' | want ' + want));
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '   got ' + got + ', want ' + want);
}
function hd(t) { console.log('\n== ' + t); }

const isMate  = T => legal(T, true).length === 0 && inCheck(T, T.turn);
const isStale = T => legal(T, true).length === 0 && !inCheck(T, T.turn);

/* ---------------- 1. the demo position, re-derived from its FEN ---------------- */

hd('The shipped shed demo does not do what the page used to claim');
const DEMO = '7k/5K1n/8/8/8/Q7/8/8 b - - 0 1';
const S = fen(DEMO);
const ms = legal(S, true);
chk('Black has exactly four legal moves', ms.length, 4);

const shed = ms.filter(m => m.kind === 'self')[0];
chk('exactly one of them is a shed, and the king makes it',
  shed && S.b[shed.from][1] === 'k' && sqName(shed.to), 'h7');

const T = apply(S, shed);
const replies = legal(T, true);
const mates = replies.filter(r => isMate(apply(T, r)));
const stales = replies.filter(r => isStale(apply(T, r)));
chk('after the shed White has 26 replies', replies.length, 26);
chk('exactly one of them is mate, and it is Qh3#',
  mates.length === 1 && san(T, mates[0], true), 'Qh3#');
chk('exactly one of them is stalemate, and it is Qf8',
  stales.length === 1 && san(T, stales[0], true), 'Qf8');
chk('so the shed is a swindle: correct play WINS for White, it does not draw',
  SS.classifyShed(T).verdict, 'OPP_WINS');

/* The sharper half, and the part the old caption never admitted. */
const surviving = ms.filter(m => !SS.lostIn3(apply(S, m)));
chk('the shed was not even forced: one ordinary move does not lose inside the same window',
  surviving.length, 1);
chk('and that move is Ng5+, not the shed',
  surviving.length === 1 && san(S, surviving[0], true), 'Ng5+');
chk('the shed itself does lose inside that window', SS.lostIn3(apply(S, shed)), true);

/* ---------------- 2. the classifier has to DISCRIMINATE ---------------- */
/*
 * A run of zeroes means nothing if the detector cannot return anything else.
 * These are the verdicts a real position can reach, each on a position built to
 * reach it.
 */
hd('The classifier returns more than one answer');

// INSUFFICIENT: a king eats its last piece and there is nothing left to mate with
const bare = fen('7k/7n/8/8/8/8/8/K7 b - - 0 1');
const bareShed = legal(bare, true).filter(m => m.kind === 'self')[0];
chk('a bare-king shed is available', !!bareShed, true);
chk('king takes its last knight and the game is dead drawn',
  SS.classifyShed(apply(bare, bareShed)).how, 'INSUFFICIENT');

// OPP_STALEMATE: the side to move after the shed has no move and no check
const staleT = fen('8/8/8/8/8/1q6/2k5/K7 w - - 0 1');
chk('the control position really is stalemate for White',
  legal(staleT, true).length === 0 && !inCheck(staleT, 'w'), true);
chk('and the classifier calls it that', SS.classifyShed(staleT).how, 'OPP_STALEMATE');

// SHEDDER_WINS: a self-capture that is itself mate — the tactical family
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'puzzles', 'puzzles.json'), 'utf8'));
const tac = doc.puzzles.filter(p => p.family === 'tactical')[0];
if (!tac) { console.log('FAIL  no tactical puzzle to test SHEDDER_WINS with'); fail++; }
else {
  const St = fen(tac.fen), sol = tac.solutions[0];
  const mv = legal(St, true).filter(m => m.from === sol.from && m.to === sol.to)[0];
  chk('a tactical solution resolves to a legal move', !!mv, true);
  chk('and a shed that is itself mate is not called a draw',
    SS.classifyShed(apply(St, mv)).verdict, 'SHEDDER_WINS');
}

/* ---------------- 3. the sweep record, and the wording that must stay gone ---------------- */

hd('The sweep result is on record');
const REC = path.join(__dirname, '..', '_context', 'shed-sweep.json');
if (!fs.existsSync(REC)) {
  console.log('FAIL  _context/shed-sweep.json is missing — rerun node tools/shed-sweep.js');
  fail++;
} else {
  const r = JSON.parse(fs.readFileSync(REC, 'utf8'));
  chk('it records how much was searched',
    Number.isInteger(r.searched.positionsExamined) && r.searched.positionsExamined > 1000, true);
  chk('it found zero SOUND sheds', r.soundSheds, 0);
  chk('and zero sound KING sheds', r.soundKingSheds, 0);
  chk('every draw it did find was insufficient material, none by stalemate',
    Object.keys(r.drawMechanisms).join(','), 'INSUFFICIENT');
  console.log('      searched ' + r.searched.positionsExamined + ' positions, ' +
    r.searched.positionsWithASelfCapture + ' with a self-capture, in ' + r.searched.seconds + 's');
  console.log('      verdicts ' + JSON.stringify(r.shedVerdicts));
}

hd('The retracted claim has not come back');
/*
 * This is the pin (M4-T1-AC4). The claim is a sentence, not a flag, so the only
 * thing that can hold it down is the text itself. Tags are stripped first so
 * that re-wrapping a word in <b> cannot smuggle the claim back past a regex.
 */
const strip = s => s.replace(/<[^>]*>/g, '').replace(/&mdash;|&ndash;/g, '-').replace(/\s+/g, ' ');
const page = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'tyranny.html'), 'utf8'));
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8').replace(/\s+/g, ' ');

[['the page', page], ['the README', readme]].forEach(function (pair) {
  chk('"reachable on purpose" is gone from ' + pair[0], /reachable on purpose/i.test(pair[1]), false);
  chk('"becomes reachable" is gone from ' + pair[0], /becomes reachable/i.test(pair[1]), false);
});
/* The control: the words are only meaningful as a pin if the text they guard is
   actually being read. If the page stops mentioning the shed at all, these
   absence checks would pass for the wrong reason. */
chk('control: the page still discusses the shed, so the checks above read real text',
  /shed/i.test(page), true);
chk('control: so does the README', /shed/i.test(readme), true);
chk('the page says plainly that correct play refutes it',
  /swindle/i.test(page), true);

hd(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nfailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
