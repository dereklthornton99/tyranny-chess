const E=require('./engine.js');
const {startState,legal,apply,fen,inCheck,san,think,search,evaluate,zkey,MATE,ai,sqName}=E;
let pass=0,fail=0;
const chk=(n,g,w)=>{const ok=String(g)===String(w);ok?pass++:fail++;
  console.log((ok?'PASS':'FAIL').padEnd(5)+n.padEnd(50)+'got '+g+'  want '+w);};
const hd=t=>console.log('\n== '+t);
const S=startState();

hd('Terminal scoring');
ai.gameKeys=new Set(); ai.path=[]; ai.killers=[]; ai.hist={}; ai.depthDone=1; ai.deadline=Infinity; ai.aborted=false; ai.selfCap=true;
const stale=fen('7k/5K2/6Q1/8/8/8/8/8 b - - 0 1');
chk('stalemate scores 0',search(stale,3,-Infinity,Infinity,1),0);
const mated=fen('7k/5K1Q/8/8/8/8/8/8 b - - 0 1');   // Qh7 protected? f7 doesn't cover h7 -> not mate. use a real one:
const mated2=fen('7k/8/6KQ/8/8/8/8/8 b - - 0 1');   // Kh8, White Kg6 Qh6?? h6 attacks h8 -> check; g8 Kg6, g7 K+Q, h7 Q  => mate
chk('mated position scores -MATE+ply',search(mated2,3,-Infinity,Infinity,1)<=-MATE+50,true);
chk('start eval is symmetric',Math.abs(evaluate(S))<=10,true);

hd('Opening move');
let r=think(S,{ms:400,maxDepth:4,history:[S]});
chk('returns a legal move',legal(S,true).some(m=>m.from===r.move.from&&m.to===r.move.to),true);
chk('move 1 is not a self-capture',r.move.kind,'empty');
console.log('     played',san(S,r.move,true),'depth',r.depth,'nodes',r.nodes,'ms',r.ms);

hd('Mate finding');
const post=fen('8/5K1k/8/8/8/Q7/8/8 w - - 0 1');   // after the shed: Qh3# exists, Qf8 stalemates
r=think(post,{ms:1000,maxDepth:6,history:[post]});
chk('after the shed, White finds mate-in-1',san(post,r.move,true),'Qh3#');
chk('...scored as mate',r.score>=MATE-2,true);
const m2=fen('7k/8/5K2/8/8/8/8/Q7 w - - 0 1');
r=think(m2,{ms:2500,maxDepth:6,history:[m2]});
chk('finds a mate-in-2',r.score>=MATE-3,true);
console.log('     played',san(m2,r.move,true),'depth',r.depth,'nodes',r.nodes,'ms',r.ms);

hd('The shed against a competent opponent');
const demo=fen('7k/5K1n/8/8/8/Q7/8/8 b - - 0 1');
r=think(demo,{ms:1000,maxDepth:6,history:[demo]});
console.log('     Black plays',san(demo,r.move,true),'score',r.score,'depth',r.depth);
chk('Black does NOT shed (it loses to Qh3#)',r.move.kind!=='self',true);
// and White, given the shed, must not stalemate
const afterShed=apply(demo,legal(demo,true).find(m=>m.kind==='self'));
r=think(afterShed,{ms:600,maxDepth:5,history:[demo,afterShed]});
chk('White refuses the stalemate bait',san(afterShed,r.move,true)!=='Qf8',true);

hd('Time budget');
r=think(S,{ms:1800,maxDepth:9,history:[S]});
chk('Hard move under 3000ms',r.ms<3000,true);
console.log('     depth',r.depth,'nodes',r.nodes,'ms',r.ms,'nps',Math.round(r.nodes/r.ms*1000));
r=think(S,{ms:600,maxDepth:6,history:[S]});
console.log('     Medium: depth',r.depth,'nodes',r.nodes,'ms',r.ms);

hd('Repetition avoidance');
// K+Q vs K: engine must make progress, never repeat.  Play 12 White moves vs random-ish Black.
let P=fen('4k3/8/8/8/8/8/8/4K2Q w - - 0 1'), h=[P], keys=new Set([zkey(P)]), rep=false, mateFound=false;
for(let i=0;i<30;i++){
  const rr=think(P,{ms:250,maxDepth:6,history:h}); if(!rr) break;
  P=apply(P,rr.move); h.push(P);
  if(keys.has(zkey(P))) rep=true; keys.add(zkey(P));
  const L=legal(P,true); if(L.length===0){ mateFound=inCheck(P,P.turn); break; }
  // Black: pick the move that maximises distance from mate (simple: use think too)
  const br=think(P,{ms:120,maxDepth:4,history:h}); P=apply(P,br.move); h.push(P);
  if(keys.has(zkey(P))) rep=true; keys.add(zkey(P));
}
chk('never repeated a position',rep,false);
chk('KQ v K: delivered mate within 30 moves',mateFound,true);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
