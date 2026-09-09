const E=require('./engine.js');
const {legal,pseudo,apply,fen,san,inCheck,sqName}=E;
let pass=0,fail=0;
const chk=(n,g,w)=>{const ok=String(g)===String(w);ok?pass++:fail++;
  console.log((ok?'PASS':'FAIL').padEnd(5)+n.padEnd(54)+'got '+g+'  want '+w);};
const hd=t=>console.log('\n== '+t);
const cast=(S,on)=>legal(S,on).filter(m=>m.castle).map(m=>san(S,m,on)).sort().join(',');
// castles available to WHITE specifically, regardless of whose turn it is
const wCast=(S,on)=>pseudo(S,'w',on).filter(m=>m.castle).map(m=>m.castle).sort().join(',');

hd('Traditional castling is completely unchanged');
const C=fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
chk('self-capture ON  -> both castles',cast(C,true),'O-O,O-O-O');
chk('self-capture OFF -> identical',cast(C,false),'O-O,O-O-O');
chk('castling move is king e1->g1',legal(C,true).filter(m=>m.castle==='K').map(m=>sqName(m.from)+sqName(m.to))[0],'e1g1');
chk('...and e1->c1 queenside',legal(C,true).filter(m=>m.castle==='Q').map(m=>sqName(m.from)+sqName(m.to))[0],'e1c1');
chk('king CANNOT move onto its own rook h1',legal(C,true).filter(m=>m.piece==='wk'&&sqName(m.to)==='h1').length,0);
chk('king reaches only its 5 adjacent squares',legal(C,true).filter(m=>m.piece==='wk'&&!m.castle).map(m=>sqName(m.to)).sort().join(' '),'d1 d2 e2 f1 f2');
console.log('     king non-castle moves:',legal(C,true).filter(m=>m.piece==='wk'&&!m.castle).map(m=>sqName(m.to)).join(' '));

hd('Standard restrictions all still apply');
chk('blocked by a piece between',cast(fen('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1'),true),'O-O-O');
chk('cannot castle OUT of check',cast(fen('r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1'),true),'');
chk('cannot castle THROUGH check',cast(fen('r3k2r/8/8/8/5r2/8/8/R3K2R w KQkq - 0 1'),true),'O-O-O');
chk('cannot castle INTO check',cast(fen('r3k2r/8/8/8/6r1/8/8/R3K2R w KQkq - 0 1'),true),'O-O-O');
chk('rights gone -> no castle',cast(fen('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1'),true),'');

hd('What the variant DOES change');
// 1. self-capturing your own rook forfeits that right
const R=fen('r3k2r/8/8/8/8/8/5N2/R3K2R w KQkq - 0 1');
const nxr=legal(R,true).filter(m=>m.piece==='wn'&&sqName(m.to)==='h1')[0];
chk('Nf2 may execute its own Rh1',nxr?1:0,1);
chk('...White O-O right is cleared',nxr?apply(R,nxr).cast.K:'?',false);
chk('...White O-O-O right survives',nxr?apply(R,nxr).cast.Q:'?',true);
chk('...and White can no longer generate O-O',nxr?wCast(apply(R,nxr),true):'?','Q');

// 2. THE CLAIM UNDER TEST: can you "clear a castling square by eating your own piece"?
const B=fen('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1');
// Ng3 takes the f1 bishop: king and h1 rook both untouched, so castling rights
// survive and ONLY the occupancy question is being tested.
const B2=fen('r3k2r/8/8/8/8/6N1/8/R3KB1R w KQkq - 0 1');
const nxb=legal(B2,true).filter(m=>m.piece==='wn'&&sqName(m.to)==='f1')[0];
chk('a knight may execute the f1 bishop',nxb?1:0,1);
chk('...rights are untouched (K and Q)',nxb?(apply(B2,nxb).cast.K&&apply(B2,nxb).cast.Q):'?',true);
chk('...but f1 is STILL occupied, by the knight',nxb?apply(B2,nxb).b[61]:'?','wn');
chk('...so White STILL cannot castle kingside',nxb?wCast(apply(B2,nxb),true):'?','Q');

// 3. The REAL mechanism: the blocker gains new squares to vacate to.
const V=fen('r3k2r/8/8/8/8/8/4PPP1/R3KB1R w KQkq - 0 1');   // Bf1 hemmed in by own e2/g2 pawns
chk('OFF: the f1 bishop is completely stuck',legal(V,false).filter(m=>m.piece==='wb').length,0);
chk('OFF: so O-O is impossible',cast(V,false),'O-O-O');
const out=legal(V,true).filter(m=>m.piece==='wb');
chk('ON: bishop can leave by eating e2/g2',out.map(m=>san(V,m,true)).sort().join(','),'B⊗e2,B⊗g2');
const vac=out.filter(m=>sqName(m.to)==='g2')[0];
chk('ON: after B⊗g2, O-O is live',cast(apply(V,vac),true).indexOf('O-O')>=0,true);

hd('Exhaustive: self-capture never adds a BLOCKING escape from check');
// Sweep every position 4 plies deep; whenever a side is in check, every legal
// self-capture escape must be a KING move (never an interposition).
let checks=0, selfEscapes=0, nonKing=0;
(function walk(S,d){ if(!d) return;
  const ms=legal(S,true);
  if(inCheck(S,S.turn)){ checks++;
    for(const m of ms) if(m.kind==='self'){ selfEscapes++; if(m.piece[1]!=='k') nonKing++; } }
  for(const m of ms) walk(apply(S,m),d-1);
})(fen('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2'),4);
console.log('     positions in check:',checks,' self-capture escapes:',selfEscapes);
chk('every self-capture escape is a king move',nonKing,0);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
