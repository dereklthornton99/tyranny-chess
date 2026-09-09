// Pulls the rules engine + AI out of index.html so the suites can run under Node.
const fs=require('fs'), path=require('path');
const file=path.join(__dirname,'..','index.html');
const src=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const a=src.indexOf('var FILES = "abcdefgh";');
const b=src.indexOf('   GAME / UI');
if(a<0||b<0){ console.error('markers not found in index.html'); process.exit(1); }
let engine=src.slice(a, src.lastIndexOf('/* ====', b));
const f0=src.indexOf('function fen(str){'), f1=src.indexOf('function runTests(){');
engine+='\n'+src.slice(f0,f1);
fs.writeFileSync(path.join(__dirname,'engine.js'),
  engine+'\nmodule.exports={startState,legal,pseudo,apply,inCheck,perft,fen,idx,rOf,cOf,sqName,san,FILES,attacked,insufficient,think,search,qsearch,evaluate,zkey,MATE,ai};\n');
console.log('engine.js written');
