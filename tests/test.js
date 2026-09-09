const E = require('./engine.js');
const {startState,legal,pseudo,apply,inCheck,perft,fen,idx,rOf,cOf} = E;
let pass=0, fail=0;
const chk=(n,g,w)=>{const ok=String(g)===String(w);ok?pass++:fail++;
  console.log((ok?'PASS':'FAIL').padEnd(5)+n.padEnd(46)+'got '+g+'  want '+w);};
const hd=t=>console.log('\n== '+t);

const S=startState();
hd('Opening position');
chk('standard depth 1',legal(S,false).length,20);
chk('variant depth 1',legal(S,true).length,39);
chk('of those, self-captures',legal(S,true).filter(m=>m.kind==='self').length,19);

hd('King exclusion');
chk('nothing targets own king',legal(S,true).filter(m=>m.cap&&m.cap[0]===m.piece[0]&&m.cap[1]==='k').length,0);
chk('own king still blocks a ray',legal(S,true).filter(m=>m.piece==='wq'&&m.to===61).length,0);

hd('Pawn geometry');
const P=fen('4k3/8/8/8/8/3P4/3PK3/8 w - - 0 1');
chk('no forward self-capture',legal(P,true).filter(m=>m.piece==='wp'&&m.from===idx(6,3)&&m.to===idx(5,3)).length,0);
const P2=fen('4k3/8/8/8/8/2P5/3PK3/8 w - - 0 1');
chk('diagonal self-capture works',legal(P2,true).filter(m=>m.piece==='wp'&&m.kind==='self'&&m.to===idx(5,2)).length,1);
chk('self-capture promotes',legal(fen('2N5/1P6/8/8/8/8/K7/7k w - - 0 1'),true).filter(m=>m.piece==='wp'&&m.kind==='self'&&m.promo==='q').length,1);

hd('Castling rights');
const C=fen('r3k2r/8/8/8/8/8/5N2/R3K2R w KQkq - 0 1');
const tr=legal(C,true).filter(m=>m.piece==='wn'&&m.to===63)[0];
chk('Nf2 can take own Rh1',tr?1:0,1);
chk('...forfeits O-O',tr?apply(C,tr).cast.K:'n/a',false);
chk('...keeps O-O-O',tr?apply(C,tr).cast.Q:'n/a',true);

hd('Check legality');
const F=fen('6kn/8/8/8/8/8/8/K6R b - - 0 1');
chk('Kxh8 generated pseudo-legally',pseudo(F,'b',true).filter(m=>m.piece==='bk'&&m.to===7).length,1);
chk('...filtered as self-check',legal(F,true).filter(m=>m.piece==='bk'&&m.to===7).length,0);

hd('THE escape position  R6k/6pp/8/8/8/8/8/6K1 b');
const X=fen('R6k/6pp/8/8/8/8/8/6K1 b - - 0 1');
chk('Black in check',inCheck(X,'b'),true);
chk('standard rules: CHECKMATE',legal(X,false).length,0);
chk('variant: escapes exist',legal(X,true).length,2);
chk('...both king self-captures',legal(X,true).every(m=>m.piece==='bk'&&m.kind==='self'),true);

hd('En passant is never self-directed');
// Black has just played d7-d5; White's e5 pawn may take en passant on d6.
const EP=fen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
const eps=legal(EP,true).filter(m=>m.ep);
chk('ep capture is available',eps.length,1);
chk('...and its victim is an ENEMY pawn',eps[0].cap,'bp');
// Exhaustive: sweep 4 plies from that position and assert no ep move ever
// targets a friendly pawn, with self-capture fully enabled.
let epSeen=0, epBad=0;
(function walk(s,d){ if(!d) return;
  for(const m of legal(s,true)){ if(m.ep){epSeen++; if(m.cap[0]===m.piece[0]) epBad++;} walk(apply(s,m),d-1); }
})(EP,4);
chk('ep moves seen in 4-ply sweep',epSeen>0,true);
chk('none of them self-directed',epBad,0);

hd('Perft — standard chess vs published values');
const known=[20,400,8902,197281];
for(let d=1;d<=4;d++) chk('standard perft('+d+')',perft(S,d,false),known[d-1]);

hd('Perft — variant, measured');
const t0=Date.now(); const v=[];
for(let d=1;d<=3;d++) v.push(perft(S,d,true));
console.log('     variant perft(1) = '+v[0].toLocaleString()+'   (hand-derived: 39)');
console.log('     variant perft(2) = '+v[1].toLocaleString());
console.log('     variant perft(3) = '+v[2].toLocaleString());
chk('perft(1) == hand derivation',v[0],39);
chk('variant >= standard at every depth',v.every((x,i)=>x>=known[i]),true);
console.log('     ('+(Date.now()-t0)+' ms)');

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
