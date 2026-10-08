/*
 * coriantumr-showdown.js -- the last-piece rule in a showdown, held to an exact solver that shares no code with the engine.
 *
 * Runs tools/coriantumr-showdown.js and reads what it prints:
 *   1. --small --max 4 : every start on 3x3 and 4x4 boards, solved completely, for the owner's side-specific reading and
 *      for my earlier shared-set reading. The numbers are pinned: a change to the solver or to the rule it encodes shows
 *      up here as a different count, on purpose.
 *   2. --check-engine  : (a) the lists of used squares the engine carries through 2,000+ positions of engine-played
 *      showdowns equal lists the tool tracked itself, and (b) on 250 late showdowns CONSTRUCTED on the real 8x8 board
 *      (each piece keeps only a few unused squares, a mix of positions the side to move wins and loses) the engine's
 *      search reports exactly the number of plies the solver does. The solver is written from the rule's sentences;
 *      the engine's legality, list bookkeeping, sacrifice and terminal handling are all in play, so a wrong rule on
 *      either side fails here.
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
const tally = (row) => row && [row.starts, row.sideToMoveWins, row.sideToMoveLoses, row.unsolved].join('/');

console.log('\n== Last pieces: exact solutions on small boards, the owner\'s side-specific reading');
const own = run(['--small', '--max', '4', '--reading', 'own']);
const ob = Object.fromEntries(own.rows.map((r) => [r.board, r]));
t('the small-board solver ran', own.status, 0);
t('3x3: 16 starts, the side to move wins 0 and loses 16, none unsolved', tally(ob['3x3']), '16/0/16/0');
t('4x4: 88 starts, the side to move wins 0 and loses 88, none unsolved (decided by who moves first)', tally(ob['4x4']), '88/0/88/0');
t('no draw exists: every start has a winner (wins + losses = starts)', own.rows.every((r) => r.sideToMoveWins + r.sideToMoveLoses === r.starts), true);

console.log('\n== The earlier shared-set reading, kept only for comparison');
const shared = run(['--small', '--max', '4', '--reading', 'shared']);
const sb = Object.fromEntries(shared.rows.map((r) => [r.board, r]));
t('shared reading, 3x3: the side to move loses all 16 starts', tally(sb['3x3']), '16/0/16/0');
t('shared reading, 4x4: the side to move wins 48 and loses 40, so it is not decided by who moves first', tally(sb['4x4']), '88/48/40/0');

console.log('\n== The engine against the exact solver on the 8x8 board');
const eng = run(['--check-engine', '250']);
const r = eng.rows[0] || {};
t('the engine check ran and exited cleanly', eng.status, 0);
t('250 constructed late showdowns were compared', r.positions, 250);
t('the engine reports exactly the number of plies the solver does in every one', r.agree + '/' + r.differ, '250/0');
t('none was too big for the solver', r.unsolved, 0);
t('the lists the engine carries equal the ones the tool tracked itself, over 2,000 or more real-game positions',
  r.listDrift + '/' + (r.bookkept >= 2000), '0/true');
t('CONTROL: the positions include showdowns that began by a capture', r.beganByCapture > 0, true);
t('CONTROL: the positions are a real mix, the side to move wins some and loses some', r.moverWins > 20 && r.moverLoses > 20, true);

console.log('\n== ' + pass + ' passed, ' + fail + ' failed');
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
