var FILES = "abcdefgh";
function idx(r,c){ return r*8+c; }
function onB(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
function rOf(s){ return (s/8)|0; }
function cOf(s){ return s%8; }
function sqName(s){ return FILES[cOf(s)] + (8 - rOf(s)); }

var KN   = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
var DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
var ORTH = [[-1,0],[1,0],[0,-1],[0,1]];
var ALL8 = DIAG.concat(ORTH);
var VALUE = {p:1,n:3,b:3,r:5,q:9,k:0};
/* Pieces are drawn, not typed. See the .pc CSS for why: the pawn codepoint is
   an emoji on iOS, and an emoji font ignores fill, stroke and sizing.
   Geometry is a 45x45 box with the piece standing on y=39.5. */
var _BASE   = '<path d="M13 34.9h19l3 4.6H10z"/>';
var _COLLAR = '<path d="M15.4 30.6h14.2l1.8 3.7H13.6z"/>';
var PIECE_SVG = {
  p: '<circle cx="22.5" cy="12.6" r="4.7"/>'
   + '<path d="M18.6 17.7h7.8c-.3 1.1-.9 2-1.7 2.7 2.8 2.7 4.4 6.3 4.6 10.3H15.7c.2-4 1.8-7.6 4.6-10.3-.8-.7-1.4-1.6-1.7-2.7z"/>'
   + _COLLAR + _BASE,
  r: '<path d="M11.5 8h5.2v3.1h4.2V8h3.2v3.1h4.2V8h5.2v6.6l-2.9 2.6v10.9l2.9 2.6H11.5l2.9-2.6V17.2l-2.9-2.6z"/>'
   + _COLLAR + _BASE,
  b: '<circle cx="22.5" cy="7.7" r="2.3"/>'
   + '<path d="M22.5 10.7c-4.7 3.4-7.3 7.7-7.3 11.8 0 3.6 2.1 6.6 5.2 8.3h4.2c3.1-1.7 5.2-4.7 5.2-8.3 0-4.1-2.6-8.4-7.3-11.8z"/>'
   + '<path class="cut" d="M25.9 15.8l-4.3 5.3" stroke-width="1.7"/>'
   + _COLLAR + _BASE,
  n: '<path d="M28.1 7c2.5 1.5 4.4 3.6 5.5 6.3 1.2 2.9 1.7 6.4 1.7 10.4v6.9H15.3v-4.3c0-2.7.7-5.2 2.1-7.4l-5.5 2.8c-2 1-4.4.2-5.4-1.8s-.2-4.4 1.8-5.4l9.6-4.9c2.4-1.2 4.3-3.1 5.3-5.6z"/>'
   + '<circle class="eye" cx="27.4" cy="15" r="1.4"/>'
   + _COLLAR + _BASE,
  q: '<circle cx="22.5" cy="6.4" r="2.1"/><circle cx="12.6" cy="9.4" r="2"/><circle cx="32.4" cy="9.4" r="2"/>'
   + '<circle cx="7.3" cy="14.7" r="2"/><circle cx="37.7" cy="14.7" r="2"/>'
   + '<path d="M8.7 16.6l2.7 13.9h22.2l2.7-13.9-5.6 4.8-3.2-9.9-4.6 8.7-4.6-8.7-3.2 9.9z"/>'
   + _COLLAR + _BASE,
  k: '<path class="cut" d="M22.5 4.6v7.4M19.3 7.9h6.4" stroke-width="2.2"/>'
   + '<path d="M22.5 13.6c-1.6-2.3-4.7-3.1-7.1-1.8-2.5 1.3-3.5 4.4-2.3 6.9.6 1.3 1.7 2.3 2.9 2.8-1.5 2.7-2.4 5.8-2.6 9.1h17.2c-.2-3.3-1.1-6.4-2.6-9.1 1.2-.5 2.3-1.5 2.9-2.8 1.2-2.5.2-5.6-2.3-6.9-2.4-1.3-5.5-.5-7.1 1.8z"/>'
   + _COLLAR + _BASE
};
function pieceSVG(piece, extra){
  return '<svg class="pc ' + piece[0] + (extra ? " " + extra : "") +
         '" viewBox="0 0 45 45" aria-hidden="true">' + PIECE_SVG[piece[1]] + '</svg>';
}

function startState(v){
  var b = new Array(64).fill(null);
  var back = ["r","n","b","q","k","b","n","r"];
  for(var c=0;c<8;c++){
    b[idx(0,c)] = "b"+back[c];
    b[idx(1,c)] = "bp";
    b[idx(6,c)] = "wp";
    b[idx(7,c)] = "w"+back[c];
  }
  var S0 = { b:b, turn:"w", cast:{K:true,Q:true,k:true,q:true}, ep:-1, half:0, full:1 };
  if(v) S0.v = v;                  // rule-set tag: absent (not false) for Tyranny and standard play
  return S0;
}

function mk(from,to,piece,cap,kind,extra){
  var m = {from:from,to:to,piece:piece,cap:cap,kind:kind,promo:null,ep:false,dbl:false,castle:null};
  if(extra) for(var k in extra) m[k] = extra[k];
  return m;
}
function pushPawn(out,from,to,piece,cap,kind,isPromo,withKing){
  if(isPromo){
    var opts = withKing ? ["q","r","b","n","k"] : ["q","r","b","n"];
    for(var i=0;i<opts.length;i++) out.push(mk(from,to,piece,cap,kind,{promo:opts[i]}));
  } else {
    out.push(mk(from,to,piece,cap,kind));
  }
}

/* Is `sq` attacked by colour `by`?  Unchanged by the variant: a slider still
   stops at the first piece on a ray, and a piece still defends squares its own
   men occupy.  Self-capture adds no new attack geometry. */
function attacked(S, sq, by){
  var r=rOf(sq), c=cOf(sq), i, nr, nc, p;
  var pd = (by === "w") ? 1 : -1;              // a white pawn sits one rank BELOW what it attacks
  for(i=-1;i<=1;i+=2){
    nr=r+pd; nc=c+i;
    if(onB(nr,nc) && S.b[idx(nr,nc)] === by+"p") return true;
  }
  for(i=0;i<KN.length;i++){
    nr=r+KN[i][0]; nc=c+KN[i][1];
    if(onB(nr,nc) && S.b[idx(nr,nc)] === by+"n") return true;
  }
  for(i=0;i<ALL8.length;i++){
    nr=r+ALL8[i][0]; nc=c+ALL8[i][1];
    if(onB(nr,nc) && S.b[idx(nr,nc)] === by+"k") return true;
  }
  var sets = [[DIAG,"bq"],[ORTH,"rq"]];
  for(var s=0;s<2;s++){
    var dirs = sets[s][0], types = sets[s][1];
    for(i=0;i<dirs.length;i++){
      nr = r+dirs[i][0]; nc = c+dirs[i][1];
      while(onB(nr,nc)){
        p = S.b[idx(nr,nc)];
        if(p){
          if(p[0] === by && types.indexOf(p[1]) >= 0) return true;
          break;
        }
        nr += dirs[i][0]; nc += dirs[i][1];
      }
    }
  }
  return false;
}

/* Pseudo-legal generation.  THE VARIANT LIVES IN canTake(): a friendly
   occupant is a legal target unless it is our own king. */
function pseudo(S, side, selfCap){
  var out = [], opp = (side === "w") ? "b" : "w";
  /* Coriantumr (S.v === "c"): king and queen both slide up to 4 squares in all eight directions, nobody may
     capture a friendly piece whatever the caller's selfCap says, castling does not exist, and a pawn reaching
     the far rank may also become a KING when its side has none. Every other piece, and every state without
     the tag, is generated exactly as before. */
  var C = (S.v === "c");
  if(C) selfCap = false;
  var needKing = C && S.b.indexOf(side + "k") < 0;

  function canTake(to){
    var tp = S.b[to];
    if(!tp) return "empty";
    if(tp[0] !== side) return "enemy";
    if(tp[1] === "k") return "no";            // <-- the one hard exclusion
    return selfCap ? "self" : "no";
  }

  for(var s=0; s<64; s++){
    var p = S.b[s];
    if(!p || p[0] !== side) continue;
    var t = p[1], r = rOf(s), c = cOf(s), i, nr, nc, to, kind;

    if(t === "n" || (t === "k" && !C)){
      var offs = (t === "n") ? KN : ALL8;
      for(i=0;i<offs.length;i++){
        nr = r+offs[i][0]; nc = c+offs[i][1];
        if(!onB(nr,nc)) continue;
        to = idx(nr,nc); kind = canTake(to);
        if(kind === "no") continue;
        out.push(mk(s,to,p,S.b[to],kind));
      }
    } else if(t === "b" || t === "r" || t === "q" || t === "k"){
      var dirs = (t === "b") ? DIAG : (t === "r") ? ORTH : ALL8;
      var lim = (C && (t === "q" || t === "k")) ? 4 : 8;   // 8 never binds: no ray is longer than 7
      for(i=0;i<dirs.length;i++){
        nr = r+dirs[i][0]; nc = c+dirs[i][1];
        var steps = 1;
        while(onB(nr,nc) && steps <= lim){
          steps++;
          to = idx(nr,nc);
          if(!S.b[to]){ out.push(mk(s,to,p,null,"empty")); nr += dirs[i][0]; nc += dirs[i][1]; continue; }
          kind = canTake(to);
          if(kind !== "no") out.push(mk(s,to,p,S.b[to],kind));
          break;                                 // blocked either way — never passes through
        }
      }
    } else {                                     // pawn
      var dir   = (side === "w") ? -1 : 1;
      var start = (side === "w") ?  6 : 1;
      var last  = (side === "w") ?  0 : 7;
      nr = r + dir;
      if(onB(nr,c) && !S.b[idx(nr,c)]){
        pushPawn(out, s, idx(nr,c), p, null, "empty", nr === last, needKing);
        if(r === start){
          var nr2 = r + 2*dir;
          if(!S.b[idx(nr2,c)]) out.push(mk(s, idx(nr2,c), p, null, "empty", {dbl:true}));
        }
      }
      for(i=-1;i<=1;i+=2){
        nc = c + i;
        if(!onB(nr,nc)) continue;
        to = idx(nr,nc);
        if(S.b[to]){
          kind = canTake(to);
          if(kind !== "no") pushPawn(out, s, to, p, S.b[to], kind, nr === last, needKing);
        } else if(to === S.ep){
          out.push(mk(s, to, p, opp+"p", "enemy", {ep:true}));
        }
      }
    }
  }

  // castling — generation itself is untouched by the variant
  var E = (side === "w") ? 60 : 4;
  if(!C && S.b[E] === side+"k" && !attacked(S,E,opp)){
    var rights = (side === "w")
      ? [["K",[61,62],63,62],["Q",[59,58,57],56,58]]
      : [["k",[5,6],7,6],     ["q",[3,2,1],0,2]];
    for(var q=0;q<2;q++){
      var right = rights[q][0], empties = rights[q][1], rookSq = rights[q][2], kTo = rights[q][3];
      if(!S.cast[right]) continue;
      if(S.b[rookSq] !== side+"r") continue;
      var blocked = false;
      for(i=0;i<empties.length;i++) if(S.b[empties[i]]) blocked = true;
      if(blocked) continue;
      var mid = (E + kTo) / 2;
      if(attacked(S,mid,opp) || attacked(S,kTo,opp)) continue;
      out.push(mk(E, kTo, side+"k", null, "empty", {castle:right}));
    }
  }
  return out;
}

/* Coriantumr succession, stateless. Called after a king or queen has just been captured: if the side that lost
   it still has pieces but no king and no queen, its closest bishop (else knight, rook, pawn) becomes a king.
   Closest = smallest squared straight-line distance to the capture square; ties go to the lower file, then
   the lower rank. Mutates the board copy it is given. Returns [square, former piece code] or null. */
function crown(b, side, at){
  var i, p, royal = 0, any = 0;
  for(i=0;i<64;i++){ p = b[i]; if(p && p[0] === side){ any++; if(p[1] === "k" || p[1] === "q") royal++; } }
  if(!any || royal) return null;
  var order = ["b","n","r","p"], ar = rOf(at), ac = cOf(at);
  for(var o=0;o<order.length;o++){
    var best = -1, bd = 1e9, bf = 9, br = 9;
    for(i=0;i<64;i++){
      p = b[i]; if(!p || p[0] !== side || p[1] !== order[o]) continue;
      var dr = rOf(i) - ar, dc = cOf(i) - ac, d = dr*dr + dc*dc, f = cOf(i), rk = 8 - rOf(i);
      if(d < bd || (d === bd && (f < bf || (f === bf && rk < br)))){ best = i; bd = d; bf = f; br = rk; }
    }
    if(best >= 0){ var was = b[best]; b[best] = side + "k"; return [best, was]; }
  }
  return null;
}
function hasPieces(S, side){
  for(var i=0;i<64;i++){ var p = S.b[i]; if(p && p[0] === side) return true; }
  return false;
}

/* The last-piece rule (the owner's side-specific ruling, 2026-10-07). A side down to exactly one piece may not land on
   a square that piece has stood on since it became the last piece; the square it stands on counts. Captures are
   exempt, a slide may pass over a used square, and the opponent's squares stay available. When both sides are down
   to one piece (the showdown) both lists begin afresh at that moment. The lists ride on the board state as
   S.lv = {w: [...], b: [...]} (only a side with exactly one piece has an entry), so they survive apply(), Undo and
   the engine's search. A position loaded from a FEN treats a lone side's square as its first used square. */
function usedSquares(S, side){
  if(S.lv && S.lv[side]) return S.lv[side];
  var n = 0, at = -1;
  for(var i=0;i<64;i++){ var p = S.b[i]; if(p && p[0] === side){ n++; at = i; } }
  return n === 1 ? [at] : null;
}
/* The royal piece that sacrifices itself when its side cannot move: the king, else the queen on the lowest file
   and then the lowest rank (the same tie order the succession rule uses). -1 when the side has none. */
function sacOf(S, side){
  var k = S.b.indexOf(side + "k");
  if(k >= 0) return k;
  var best = -1, bf = 9, br = 9;
  for(var i=0;i<64;i++){
    if(S.b[i] === side + "q"){ var f = cOf(i), rk = 8 - rOf(i); if(f < bf || (f === bf && rk < br)){ best = i; bf = f; br = rk; } }
  }
  return best;
}
/* Coriantumr legality: every pseudo-legal move is legal, minus a last piece's landings on squares it has already
   stood on. If that leaves nothing, the royal piece must sacrifice itself: it is the one legal move, it removes the
   piece and succession then applies exactly as if the piece had been captured. */
function legalC(S, ms, rep){
  var td = usedSquares(S, S.turn), out = ms, i;
  if(td){
    out = [];
    for(i=0;i<ms.length;i++){ if(ms[i].cap || td.indexOf(ms[i].to) < 0) out.push(ms[i]); }
  }
  /* Repetition is REFUSED, not drawn. Where chess would call a draw because a position has occurred a third time,
     the move that would create that third occurrence is simply not allowed; the second occurrence is. Only a move
     that is neither a capture nor a pawn move can recreate an earlier position, so only those are looked up.
     rep = {keyOf(T) -> a key naming a position, seen(key) -> how many times it has occurred in the game so far}. */
  if(rep && out.length){
    var kept = [];
    for(i=0;i<out.length;i++){
      var mv = out[i];
      if(mv.cap || mv.piece[1] === "p" || rep.seen(rep.keyOf(apply(S, mv))) < 2) kept.push(mv);
    }
    out = kept;
  }
  if(out.length) return out;
  var r = sacOf(S, S.turn);
  return r < 0 ? [] : [mk(r, r, S.b[r], S.b[r], "self", {sac:true})];
}

function apply(S, m){
  var b = S.b.slice();
  var side = m.piece[0], opp = (side === "w") ? "b" : "w";
  b[m.from] = null;
  if(m.ep) b[idx(rOf(m.from), cOf(m.to))] = null;
  if(!m.sac) b[m.to] = m.promo ? side + m.promo : m.piece;     // a sacrifice removes the piece and lands nowhere
  if(m.castle){
    var rf = {K:63,Q:56,k:7,q:0}[m.castle];
    var rt = {K:61,Q:59,k:5,q:3}[m.castle];
    b[rt] = b[rf]; b[rf] = null;
  }
  var cast = {K:S.cast.K, Q:S.cast.Q, k:S.cast.k, q:S.cast.q};
  if(m.piece === "wk"){ cast.K = false; cast.Q = false; }
  if(m.piece === "bk"){ cast.k = false; cast.q = false; }
  // Rook-square rights are cleared for BOTH from and to, and deliberately NOT
  // gated on the captured piece's colour — self-capturing your own rook must
  // forfeit that castling right exactly as an enemy capture would.
  function clr(sq){
    if(sq === 56) cast.Q = false;
    if(sq === 63) cast.K = false;
    if(sq === 0)  cast.q = false;
    if(sq === 7)  cast.k = false;
  }
  clr(m.from); clr(m.to);
  var ep = -1;
  if(m.dbl) ep = idx((rOf(m.from) + rOf(m.to)) / 2, cOf(m.from));
  var half = (m.piece[1] === "p" || m.cap) ? 0 : S.half + 1;
  var T = { b:b, turn:opp, cast:cast, ep:ep, half:half, full: (side === "b") ? S.full+1 : S.full };
  if(S.v){
    T.v = S.v;                                  // the rule set must survive every move, or play silently reverts
    if(S.v === "c" && m.cap && (m.cap[1] === "k" || m.cap[1] === "q")){
      var cr = crown(b, m.cap[0], m.to);        // a royal just fell: does that side still have one?
      if(cr) T.cr = cr;                         // [square, former piece code], read by the page for its message
    }
    if(S.v === "c"){                            // the last-piece lists: only a side with exactly one piece has one
      var cnt = {w:0, b:0}, at = {w:-1, b:-1}, was = {w:0, b:0};
      for(var q=0;q<64;q++){
        var pp = b[q], po = S.b[q];
        if(pp){ cnt[pp[0]]++; at[pp[0]] = q; }
        if(po) was[po[0]]++;
      }
      var fresh = (cnt.w === 1 && cnt.b === 1 && !(was.w === 1 && was.b === 1));     // the showdown has just begun
      var lv = null;
      ["w","b"].forEach(function(sd){
        if(cnt[sd] !== 1) return;
        var prev = usedSquares(S, sd);          // the list before this move: carried, or derived from a FEN
        (lv || (lv = {}))[sd] = (fresh || was[sd] !== 1 || !prev) ? [at[sd]] : (m.piece[0] === sd ? (prev.indexOf(m.to) >= 0 ? prev : prev.concat([m.to])) : prev);
      });
      if(lv) T.lv = lv;
    }
  }
  return T;
}

function kingSq(S, side){ return S.b.indexOf(side + "k"); }
function inCheck(S, side){
  if(S.v === "c") return false;                 // no check in Coriantumr: a king is just a piece
  var k = kingSq(S, side);
  return k >= 0 && attacked(S, k, side === "w" ? "b" : "w");
}
function legal(S, selfCap){
  var side = S.turn, opp = (side === "w") ? "b" : "w", out = [];
  var ms = pseudo(S, side, selfCap);
  if(S.v === "c") return legalC(S, ms);         // leaving your king capturable is legal; the showdown and the sacrifice live in legalC
  for(var i=0;i<ms.length;i++){
    var T = apply(S, ms[i]);
    var k = kingSq(T, side);
    if(k >= 0 && !attacked(T, k, opp)) out.push(ms[i]);
  }
  return out;
}

/* The moves a player may actually make in a game: legal() plus, in Coriantumr, the refusal of a third repetition.
   Outside the variant it is legal() unchanged, because there repetition is still a draw. */
function legalGame(S, selfCap, rep){
  if(S.v !== "c") return legal(S, selfCap);
  return legalC(S, pseudo(S, S.turn, selfCap), rep);
}

function san(S, m, selfCap){
  var base;
  if(m.castle){
    base = (m.castle === "K" || m.castle === "k") ? "O-O" : "O-O-O";
  } else {
    var t = m.piece[1];
    var sep = m.cap ? (m.kind === "self" ? "⊗" : "x") : "";
    if(t === "p"){
      base = (m.cap ? FILES[cOf(m.from)] : "") + sep + sqName(m.to) + (m.promo ? "=" + m.promo.toUpperCase() : "");
    } else {
      var dis = "", rivals = legal(S, selfCap).filter(function(x){
        return x.piece === m.piece && x.to === m.to && x.from !== m.from && !x.castle;
      });
      if(rivals.length){
        var sameFile = rivals.some(function(x){ return cOf(x.from) === cOf(m.from); });
        var sameRank = rivals.some(function(x){ return rOf(x.from) === rOf(m.from); });
        if(!sameFile)      dis = FILES[cOf(m.from)];
        else if(!sameRank) dis = String(8 - rOf(m.from));
        else               dis = sqName(m.from);
      }
      base = t.toUpperCase() + dis + sep + sqName(m.to);
    }
  }
  var T = apply(S, m), them = T.turn;
  if(inCheck(T, them)) base += (legal(T, selfCap).length === 0) ? "#" : "+";
  return base;
}

function insufficient(b){
  var nonK = b.filter(function(p){ return p && p[1] !== "k"; });
  if(nonK.length === 0) return true;
  if(nonK.length === 1 && (nonK[0][1] === "b" || nonK[0][1] === "n")) return true;
  if(nonK.length === 2 && nonK[0][1] === "b" && nonK[1][1] === "b" && nonK[0][0] !== nonK[1][0]){
    var cols = [];
    for(var i=0;i<64;i++) if(b[i] && b[i][1] === "b") cols.push((rOf(i) + cOf(i)) % 2);
    if(cols.length === 2 && cols[0] === cols[1]) return true;
  }
  return false;
}
function posKey(S){
  return S.b.map(function(p){ return p || "."; }).join("") + "|" + S.turn + "|" +
         (S.cast.K?"K":"") + (S.cast.Q?"Q":"") + (S.cast.k?"k":"") + (S.cast.q?"q":"") + "|" + S.ep + (S.v ? "|" + S.v : "") +
         (S.lv ? "|" + ["w","b"].map(function(sd){ return S.lv[sd] ? sd + S.lv[sd].slice().sort(function(a,b){ return a-b; }).join(",") : ""; }).join("/") : "");
}
function perft(S, d, selfCap){
  var ms = legal(S, selfCap);
  if(d <= 1) return ms.length;
  var n = 0;
  for(var i=0;i<ms.length;i++) n += perft(apply(S, ms[i]), d-1, selfCap);
  return n;
}

/* ============================================================
   AI — negamax alpha-beta, iterative deepening, quiescence on enemy
   captures, check extension, killer + history move ordering.
   The SEARCH needs nothing variant-specific: self-captures are ordinary
   entries in the move list.  What the variant needs is correct TERMINAL
   scoring — stalemate 0, mate -MATE+ply, dead material 0, any repetition
   0 — which is what lets the engine reach for a stalemate swindle when it
   is lost and refuse to fall for one when it is winning.
   ============================================================ */
var CP = {p:100, n:320, b:330, r:500, q:900, k:0};
var MATE = 100000;
/* Coriantumr values. A 4-square queen keeps the full queen's reach from the centre (27 squares from d4) but
   loses it near an edge (12 from a1 against 21), and the king is now the same piece, so both get one value.
   800 is a first estimate, NOT measured; it is only a sanity-checked starting point. */
var CPC = {p:100, n:320, b:330, r:500, q:800, k:800};
/* Piece-square tables (Michniewski's simplified evaluation), White's view,
   index 0 = a8 … 63 = h1, i.e. our board indexing directly. */
var PST = {
  p:[ 0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0 ],
  n:[ -50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50 ],
  b:[ -20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20 ],
  r:[ 0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0 ],
  q:[ -20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20 ],
  k:[ -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20 ],
  ke:[ -50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
       -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50 ]
};
function mirror(i){ return (7 - rOf(i)) * 8 + cOf(i); }

/* Zobrist keys from a seeded xorshift so every run is reproducible. */
var Z = (function(){
  var s = 0x9E3779B9 | 0;
  function rnd(){ s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; }
  var pieces = {}, codes = "pnbrqk", c, t, i;
  for(c=0;c<2;c++) for(t=0;t<6;t++){ var arr=[]; for(i=0;i<64;i++) arr.push(rnd()); pieces["wb"[c]+codes[t]]=arr; }
  var cast=[rnd(),rnd(),rnd(),rnd()], ep=[]; for(i=0;i<8;i++) ep.push(rnd());
  return {pieces:pieces, side:rnd(), cast:cast, ep:ep};
})();
function zkey(S){
  var h = 0;
  for(var i=0;i<64;i++){ var p=S.b[i]; if(p) h ^= Z.pieces[p][i]; }
  if(S.turn === "b") h ^= Z.side;
  if(S.cast.K) h ^= Z.cast[0]; if(S.cast.Q) h ^= Z.cast[1];
  if(S.cast.k) h ^= Z.cast[2]; if(S.cast.q) h ^= Z.cast[3];
  if(S.ep >= 0) h ^= Z.ep[cOf(S.ep)];
  return h;
}

/* Names a position for the repetition rule: where the pieces are, who is to move, and the en-passant square.
   Castling rights are left out on purpose; the variant has no castling, so they can never matter. */
function repKey(S){
  var h = 0;
  for(var i=0;i<64;i++){ var p = S.b[i]; if(p) h ^= Z.pieces[p][i]; }
  if(S.turn === "b") h ^= Z.side;
  if(S.ep >= 0) h ^= Z.ep[cOf(S.ep)];
  return h;
}

function mopUp(ourK, theirK){                 // drive a bare king to the corner, bring ours close
  var tr=rOf(theirK), tc=cOf(theirK);
  var cmd = Math.max(3-tr, tr-4) + Math.max(3-tc, tc-4);
  var md  = Math.abs(rOf(ourK)-tr) + Math.abs(cOf(ourK)-tc);
  return cmd*10 + (14-md)*4;
}
/* Static evaluation from the side-to-move's perspective (negamax). */
function evaluate(S){
  if(S.v === "c") return evaluateC(S);
  var b=S.b, score=0, wNP=0, bNP=0, wK=-1, bK=-1, i, p, t;
  for(i=0;i<64;i++){
    p=b[i]; if(!p) continue; t=p[1];
    if(t==="k"){ if(p[0]==="w") wK=i; else bK=i; continue; }
    if(t!=="p"){ if(p[0]==="w") wNP+=CP[t]; else bNP+=CP[t]; }
  }
  var end = wNP<=1300 && bNP<=1300;
  for(i=0;i<64;i++){
    p=b[i]; if(!p) continue; t=p[1];
    var tbl = (t==="k") ? (end ? PST.ke : PST.k) : PST[t];
    if(p[0]==="w") score += CP[t] + tbl[i];
    else           score -= CP[t] + tbl[mirror(i)];
  }
  if(bNP===0 && wNP>=500 && wK>=0 && bK>=0) score += mopUp(wK,bK);
  if(wNP===0 && bNP>=500 && wK>=0 && bK>=0) score -= mopUp(bK,wK);
  return S.turn==="w" ? score : -score;
}

/* Coriantumr static evaluation: material plus placement, from the side to move. The king is an active
   queen-like piece, so it uses the queen's table and there is no king-safety or bare-king term. */
function evaluateC(S){
  var uw = usedSquares(S, "w"), ub = usedSquares(S, "b");
  if(uw && ub) return showdownEval(S, uw, ub);          // both sides down to one piece: it is all about free squares
  var score = 0, i, p, t, tbl;
  for(i=0;i<64;i++){
    p = S.b[i]; if(!p) continue; t = p[1];
    tbl = PST[t === "k" ? "q" : t];
    if(p[0] === "w") score += CPC[t] + tbl[i];
    else             score -= CPC[t] + tbl[mirror(i)];
  }
  var lone = uw ? "w" : (ub ? "b" : null);
  if(lone){                                             // a last piece against more: only so many squares left to land on
    var left = freeMoves({b:S.b, turn:lone, cast:S.cast, ep:-1, v:"c"}, lone, lone === "w" ? uw : ub);
    score += (lone === "w" ? 1 : -1) * 4 * left;
  }
  return S.turn === "w" ? score : -score;
}

/* In the showdown material is equal and a capture ends the game, so what matters is how many unused squares each
   piece can still land on. From the side to move; the search sees the captures. */
function freeMoves(S, side, td){
  var ms = pseudo(S, side, false), n = 0;
  for(var i=0;i<ms.length;i++) if(!ms[i].cap && td.indexOf(ms[i].to) < 0) n++;
  return n;
}
function showdownEval(S, uw, ub){
  var me = S.turn, them = (me === "w") ? "b" : "w";
  var mine = (me === "w") ? uw : ub, theirs = (me === "w") ? ub : uw;
  return 10 * (freeMoves({b:S.b, turn:me, cast:S.cast, ep:-1, v:"c"}, me, mine) -
               freeMoves({b:S.b, turn:them, cast:S.cast, ep:-1, v:"c"}, them, theirs));
}

var ai = {nodes:0, deadline:0, aborted:false, selfCap:true, killers:[], hist:{}, gameKeys:null, path:[], depthDone:0, cp:CP};
var now = (typeof performance !== "undefined" && performance.now) ? function(){ return performance.now(); } : function(){ return Date.now(); };

function sameMove(a,b){ return a.from===b.from && a.to===b.to && a.promo===b.promo; }
function moveScore(m, ply){
  if(m.cap && m.kind==="enemy") return 100000 + ai.cp[m.cap[1]]*10 - ai.cp[m.piece[1]];   // MVV-LVA
  if(m.promo) return 90000 + ai.cp[m.promo];
  var k = ai.killers[ply];
  if(k){ if(k[0] && sameMove(k[0],m)) return 80000; if(k[1] && sameMove(k[1],m)) return 79000; }
  var h = ai.hist[m.from*64+m.to] || 0;
  return (m.kind==="self") ? h - 50000 : h;   // self-captures go last, but are never skipped
}
function orderMoves(ms, ply){
  for(var i=0;i<ms.length;i++) ms[i]._s = moveScore(ms[i], ply);
  ms.sort(function(a,b){ return b._s - a._s; });
  return ms;
}
function timeUp(){
  if((ai.nodes & 1023)===0 && ai.depthDone>=1 && now()>ai.deadline) ai.aborted=true;
  return ai.aborted;
}
function qsearch(S, alpha, beta, ply){
  ai.nodes++;
  if(timeUp()) return 0;
  var stand = evaluate(S);
  if(stand>=beta) return beta;
  if(stand>alpha) alpha=stand;
  if(ply>=40) return alpha;
  var side=S.turn, opp=(side==="w")?"b":"w";
  var ms = pseudo(S, side, false).filter(function(m){ return m.cap && m.kind==="enemy"; });
  ms.sort(function(a,b){ return (ai.cp[b.cap[1]]*10-ai.cp[b.piece[1]]) - (ai.cp[a.cap[1]]*10-ai.cp[a.piece[1]]); });
  for(var i=0;i<ms.length;i++){
    var T=apply(S,ms[i]);
    if(S.v !== "c"){ var k=kingSq(T,side); if(k<0 || attacked(T,k,opp)) continue; }
    var v=-qsearch(T,-beta,-alpha,ply+1);
    if(ai.aborted) return 0;
    if(v>=beta) return beta;
    if(v>alpha) alpha=v;
  }
  return alpha;
}
function search(S, depth, alpha, beta, ply){
  ai.nodes++;
  if(timeUp()) return 0;
  var key = zkey(S);
  /* Coriantumr has no draws. A side whose opponent has no pieces left has won (a sacrifice can empty the other
     side while it is still this side's turn), and a repeated position is not a draw. */
  if(S.v === "c" && !hasPieces(S, S.turn === "w" ? "b" : "w")) return MATE - ply;
  if(S.v !== "c" && ply>0 && (ai.gameKeys.has(key) || ai.path.indexOf(key)>=0)) return 0;   // any repetition = draw
  if(S.v !== "c" && insufficient(S.b)) return 0;      // a lone king can still capture a lone king here
  var side=S.turn, chk=inCheck(S,side);
  if(chk) depth++;                                                            // check extension
  if(depth<=0) return qsearch(S,alpha,beta,ply);
  var ms = (S.v === "c") ? legalC(S, pseudo(S, side, false), ai.rep) : legal(S, ai.selfCap);
  if(ms.length===0){
    if(S.v === "c") return hasPieces(S, side) ? 0 : -MATE+ply;              // no legal move: draw; no pieces: lost
    return chk ? -MATE+ply : 0;                                              // mate / stalemate
  }
  orderMoves(ms, ply);
  ai.path.push(S.v === "c" ? repKey(S) : key);       // in the variant the path holds repetition keys
  var best=-Infinity;
  for(var i=0;i<ms.length;i++){
    var m=ms[i];
    var v=-search(apply(S,m), depth-1, -beta, -alpha, ply+1);
    if(ai.aborted){ ai.path.pop(); return 0; }
    if(v>best) best=v;
    if(v>alpha){
      alpha=v;
      if(alpha>=beta){
        if(!m.cap){
          var kl=ai.killers[ply]||(ai.killers[ply]=[null,null]);
          if(!kl[0]||!sameMove(kl[0],m)){ kl[1]=kl[0]; kl[0]=m; }
          ai.hist[m.from*64+m.to]=(ai.hist[m.from*64+m.to]||0)+depth*depth;
        }
        break;
      }
    }
  }
  ai.path.pop();
  return best;
}
/* Root: iterative deepening under a time budget; an interrupted iteration is
   discarded and the last completed one is used. */
function think(S, opts){
  opts = opts || {};
  var useSelf = opts.selfCap !== false;
  var ms = legal(S, useSelf);
  if(!ms.length) return null;
  ai.nodes=0; ai.aborted=false; ai.selfCap=useSelf; ai.cp = (S.v === "c") ? CPC : CP;
  ai.killers=[]; ai.hist={}; ai.path=[]; ai.depthDone=0;
  ai.gameKeys = new Set((opts.history||[]).map(zkey));
  ai.gameCount = new Map();
  (opts.history||[]).forEach(function(h){ var k = repKey(h); ai.gameCount.set(k, (ai.gameCount.get(k) || 0) + 1); });
  ai.rep = { keyOf: repKey, seen: function(k){
    var n = ai.gameCount.get(k) || 0;
    for(var q=0;q<ai.path.length;q++) if(ai.path[q] === k) n++;
    return n;
  } };
  if(S.v === "c"){ ms = legalC(S, pseudo(S, S.turn, false), ai.rep); if(!ms.length) return null; }   // the repetition rule binds the root move as well
  var t0=now(); ai.deadline = t0 + (opts.ms||600);
  var maxD = opts.maxDepth || 8;
  var best=ms[0], bestScore=0;
  orderMoves(ms, 0);
  for(var d=1; d<=maxD; d++){
    var alpha=-Infinity, beta=Infinity, iterBest=null, iterScore=-Infinity;
    for(var i=0;i<ms.length;i++){
      var m=ms[i];
      var v=-search(apply(S,m), d-1, -beta, -alpha, 1);
      if(ai.aborted) break;
      m._r=v;
      if(v>iterScore){ iterScore=v; iterBest=m; }
      if(v>alpha) alpha=v;
    }
    if(ai.aborted) break;
    best=iterBest; bestScore=iterScore; ai.depthDone=d;
    ms.sort(function(a,b){ return (b._r||0)-(a._r||0); });            // previous iteration orders the next
    if(Math.abs(bestScore) >= MATE-200) break;                          // a forced mate is final
  }
  return {move:best, score:bestScore, depth:ai.depthDone, nodes:ai.nodes, ms:Math.round(now()-t0)};
}


function fen(str){                             // minimal FEN -> state, for test positions
  var parts = str.split(" ");
  var b = new Array(64).fill(null), r = 0, c = 0;
  for(var i=0;i<parts[0].length;i++){
    var ch = parts[0][i];
    if(ch === "/"){ r++; c = 0; }
    else if(/[1-8]/.test(ch)) c += +ch;
    else { b[idx(r,c)] = (ch === ch.toUpperCase() ? "w" : "b") + ch.toLowerCase(); c++; }
  }
  var cs = parts[2] || "-";
  return {
    b:b, turn:parts[1] || "w",
    cast:{ K:cs.indexOf("K")>=0, Q:cs.indexOf("Q")>=0, k:cs.indexOf("k")>=0, q:cs.indexOf("q")>=0 },
    ep: (parts[3] && parts[3] !== "-") ? idx(8 - (+parts[3][1]), FILES.indexOf(parts[3][0])) : -1,
    half: +(parts[4] || 0), full: +(parts[5] || 1)
  };
}


module.exports={startState,legal,pseudo,apply,inCheck,perft,fen,idx,rOf,cOf,sqName,san,FILES,attacked,insufficient,think,search,qsearch,evaluate,zkey,MATE,ai,crown,hasPieces,CPC,evaluateC,usedSquares,sacOf,legalGame,legalC,repKey};
