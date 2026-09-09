const E=require('./engine.js');
const {startState,legal,apply,fen,inCheck}=E;
let pass=0,fail=0;
const chk=(n,g,w)=>{const ok=String(g)===String(w);ok?pass++:fail++;
  console.log((ok?'PASS':'FAIL').padEnd(5)+n.padEnd(52)+'got '+g+'  want '+w);};
const nonK=(b,c)=>b.filter(p=>p&&p[0]===c&&p[1]!=='k').length;

console.log('== The K+1 floor');
// Black K+N, White king far away. Only the KING can remove the last piece.
const A=fen('6nk/8/8/8/8/8/8/K7 b - - 0 1');
const kxn=legal(A,true).filter(m=>m.piece==='bk'&&m.kind==='self');
chk('king CAN capture its last piece',kxn.length,1);
chk('...leaving a bare king',kxn.length?nonK(apply(A,kxn[0]).b,'b'):-1,0);

// Exhaustive: across a 4-ply sweep, no NON-king self-capture ever produces a bare king.
let selfMoves=0, bareByNonKing=0, bareByKing=0;
(function walk(s,d){ if(!d) return;
  for(const m of legal(s,true)){
    const T=apply(s,m);
    if(m.kind==='self'){ selfMoves++;
      if(nonK(T.b,m.piece[0])===0){ m.piece[1]==='k'?bareByKing++:bareByNonKing++; }
    }
    walk(T,d-1);
  }
})(fen('3bnk2/8/8/8/8/8/8/K7 b - - 0 1'),4);
console.log('     (examined '+selfMoves+' self-captures across the sweep)');
chk('bare king via a NON-king self-capture',bareByNonKing,0);
chk('bare king via a KING self-capture',bareByKing>0,true);

console.log('\n== Stalemate as a deliberate goal');
// Black Kh8 alone vs White Kf7+Qg6 is stalemate. Give Black a knight it can
// reach and the stalemate evaporates -- the extra piece is the liability.
const S1=fen('7k/5K2/6Q1/8/8/8/8/8 b - - 0 1');
chk('bare black king here IS stalemate',legal(S1,true).length,0);
chk('...and not check (so: draw)',inCheck(S1,'b'),false);
const S2=fen('6nk/5K2/6Q1/8/8/8/8/8 b - - 0 1');
chk('same cage + a knight = NOT stalemate',legal(S2,true).length>0,true);
chk('knight is what saves White the draw-loss',legal(S2,true).every(m=>m.piece==='bn'),true);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
