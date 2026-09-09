const {execFileSync}=require('child_process');
execFileSync(process.execPath,[__dirname+'/extract.js'],{stdio:'inherit'});
let bad=0;
for(const f of ['test.js','floor.js','castle.js','ai-test.js']){
  console.log('\n########## '+f+' ##########');
  try{ execFileSync(process.execPath,[__dirname+'/'+f],{stdio:'inherit'}); }
  catch(e){ bad++; }
}
console.log(bad? '\n'+bad+' suite(s) failed' : '\nall suites passed');
process.exit(bad?1:0);
