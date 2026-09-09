/*
 * Pulls the rules engine and the AI out of src/tyranny.html so the suites can
 * require() them under Node. Tests run against the SOURCE, never the built page.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tyranny.html'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('var FILES = "abcdefgh";');
const b = src.indexOf('   GAME / UI');
if (a < 0 || b < 0) { console.error('extract: engine markers not found in src/tyranny.html'); process.exit(1); }

let engine = src.slice(a, src.lastIndexOf('/* ====', b));
const f0 = src.indexOf('function fen(str){');
const f1 = src.indexOf('function runTests(){');
engine += '\n' + src.slice(f0, f1);

fs.writeFileSync(path.join(__dirname, 'engine.js'),
  engine + '\nmodule.exports={startState,legal,pseudo,apply,inCheck,perft,fen,idx,rOf,cOf,sqName,san,FILES,attacked,insufficient,think,search,qsearch,evaluate,zkey,MATE,ai};\n');
console.log('engine.js written');
