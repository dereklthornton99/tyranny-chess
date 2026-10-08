/*
 * coriantumr-showdown.js -- the two-piece showdown, held to an exact solver that shares no code with the engine.
 *
 * Runs tools/coriantumr-showdown.js twice and reads what it prints:
 *   1. --small --max 4 : every start on 3x3 and 4x4 boards, solved completely. The numbers are pinned: a change to the
 *      solver or to the rule it encodes shows up here as a different count, on purpose.
 *   2. --check-engine  : 250 late showdowns on the real 8x8 board (18 or fewer untouched squares left, a mix of
 *      positions the side to move wins and loses). The engine's search, given enough depth to see the end, must name
 *      the same winner as the solver in every one. The solver is written from the rule's sentence; the engine's
 *      legality, touched-set bookkeeping, sacrifice and terminal handling are all in play, so a wrong rule on either
 *      side fails here.
 * Nothing is random: positions come from seeded games.
 */
const { spawnSync } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function t(name, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : (fail++, failures.push(name));
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   got ' + got + ', want ' + want));
}
function run(args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'coriantumr-showdown.js')].concat(args), { encoding: 'utf8', timeout: 240000 });
  const rows = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  return { status: r.status, rows, err: r.stderr };
}

console.log('\n== Showdown: exact solutions on small boards');
const small = run(['--small', '--max', '4']);
t('the small-board solver ran', small.status, 0);
const by = Object.fromEntries(small.rows.map((r) => [r.board, r]));
t('3x3: 16 starts, the side to move wins 0 and loses 16, none unsolved', by['3x3'] && [by['3x3'].starts, by['3x3'].sideToMoveWins, by['3x3'].sideToMoveLoses, by['3x3'].unsolved].join('/'), '16/0/16/0');
t('4x4: 88 starts, the side to move wins 48 and loses 40, none unsolved', by['4x4'] && [by['4x4'].starts, by['4x4'].sideToMoveWins, by['4x4'].sideToMoveLoses, by['4x4'].unsolved].join('/'), '88/48/40/0');
t('no draw exists: every start has a winner (wins + losses = starts)', small.rows.every((r) => r.sideToMoveWins + r.sideToMoveLoses === r.starts), true);

console.log('\n== Showdown: the reading that was rejected');
const own = run(['--small', '--max', '4', '--reading', 'own']);
const ob = Object.fromEntries(own.rows.map((r) => [r.board, r]));
t('own-squares reading, 3x3: the side to move loses all 16 starts', ob['3x3'] && ob['3x3'].sideToMoveWins + '/' + ob['3x3'].sideToMoveLoses, '0/16');
t('own-squares reading, 4x4: the side to move loses all 88 starts, so the second player always wins', ob['4x4'] && ob['4x4'].sideToMoveWins + '/' + ob['4x4'].sideToMoveLoses, '0/88');

console.log('\n== Showdown: the engine against the exact solver on the 8x8 board');
const eng = run(['--check-engine', '250', '--free', '18']);
const r = eng.rows[0] || {};
t('the engine check ran and exited cleanly', eng.status, 0);
t('250 late showdowns were compared', r.positions, 250);
t('the engine and the solver name the same winner in every one', r.agree + '/' + r.differ, '250/0');
t('none was left undecided or unsolved', (r.undecided || 0) + (r.unsolved || 0), 0);
t('the touched set the engine carries equals one the tool tracked independently, in every position', r.touchedDrift, 0);
t('CONTROL: the positions include showdowns that began by a capture and ones that began with two pieces', r.beganByCapture > 0 && r.beganByCapture < r.positions, true);
t('CONTROL: the positions are a real mix, the side to move wins some and loses some',
  r.moverWins > 20 && r.moverLoses > 20, true);

console.log('\n== ' + pass + ' passed, ' + fail + ' failed');
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
