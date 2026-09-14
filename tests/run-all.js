/* Rebuilds index.html, re-extracts the engine, then runs every suite. */
const { execFileSync } = require('child_process');
const path = require('path');
const node = process.execPath;
const root = path.join(__dirname, '..');

execFileSync(node, [path.join(root, 'build.js')], { stdio: 'inherit' });
execFileSync(node, [path.join(__dirname, 'extract.js')], { stdio: 'inherit' });

let failed = 0;
for (const f of ['test.js', 'floor.js', 'castle.js', 'ai-test.js', 'puzzles.js']) {
  console.log('\n########## ' + f + ' ##########');
  try { execFileSync(node, [path.join(__dirname, f)], { stdio: 'inherit' }); }
  catch (e) { failed++; }
}
console.log(failed ? '\n' + failed + ' suite(s) FAILED' : '\nall suites passed');
process.exit(failed ? 1 : 0);
