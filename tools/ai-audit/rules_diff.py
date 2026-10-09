"""Does the page's engine know the rules of chess? Differential test against python-chess, standard rules.

  1. Legal moves: the set the page's engine generates must equal python-chess's, in every position sampled from complete
     random games (castling, en passant, promotions, pins, checks, mates and stalemates all turn up) and from games the
     audit already played.
  2. Check, and dead material: the page's own verdicts (inCheck, insufficient) against python-chess's is_check and
     is_insufficient_material, over those positions and over random few-piece positions.

    python tools/ai-audit/rules_diff.py [N_RANDOM_GAMES]    writes _context/ai-audit/rules-diff.json
"""
import glob
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402


def few_piece_positions(n, seed):
    rnd = random.Random(seed)
    types = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]
    out = []
    while len(out) < n:
        b = chess.Board(None)
        sq = rnd.sample(range(64), 8)
        b.set_piece_at(sq[0], chess.Piece(chess.KING, chess.WHITE))
        b.set_piece_at(sq[1], chess.Piece(chess.KING, chess.BLACK))
        for i in range(rnd.randint(0, 4)):
            t = rnd.choice(types[1:] if rnd.random() < 0.8 else types)
            b.set_piece_at(sq[2 + i], chess.Piece(t, rnd.choice([chess.WHITE, chess.BLACK])))
        b.turn = rnd.choice([chess.WHITE, chess.BLACK])
        if b.is_valid():
            out.append(b.fen())
    return out


def main(n_games):
    rnd = random.Random(2026)
    js = JsEngine()
    fens, terminals = [], 0
    for g in range(n_games):
        b = chess.Board()
        while not b.is_game_over(claim_draw=False) and len(b.move_stack) < 400:
            if len(b.move_stack) % 3 == 0:
                fens.append(b.fen())
            b.push(rnd.choice(list(b.legal_moves)))
        fens.append(b.fen())
        terminals += 1
    for f in glob.glob(os.path.join(OUT, "games-*.jsonl")):          # positions from the games the audit played
        with open(f, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    g = json.loads(line)
                    b = chess.Board()
                    for i, u in enumerate(g["moves"]):
                        b.push_uci(u)
                        if i % 4 == 0:
                            fens.append(b.fen())
    few = few_piece_positions(4000, 77)
    stats = {"positions": len(fens), "few_piece_positions": len(few), "legal_mismatch": 0, "check_mismatch": 0,
             "insufficient_mismatch_random_games": 0, "insufficient_mismatch_few_piece": 0, "examples": {}}

    def note(kind, **kw):
        stats["examples"].setdefault(kind, [])
        if len(stats["examples"][kind]) < 4:
            stats["examples"][kind].append(kw)

    for fen in fens:
        b = chess.Board(fen)
        ours = sorted(js.legal(fen, []))
        theirs = sorted(m.uci() for m in b.legal_moves)
        if ours != theirs:
            stats["legal_mismatch"] += 1
            note("legal", fen=fen, only_page=sorted(set(ours) - set(theirs)), only_python_chess=sorted(set(theirs) - set(ours)))
        st = js.call(op="status", start=fen, moves=[])
        if st["inCheck"] != b.is_check():
            stats["check_mismatch"] += 1
            note("check", fen=fen, page=st["inCheck"], python_chess=b.is_check())
        if st["insufficient"] != b.is_insufficient_material():
            stats["insufficient_mismatch_random_games"] += 1
            note("insufficient", fen=fen, page=st["insufficient"], python_chess=b.is_insufficient_material())
    for fen in few:
        b = chess.Board(fen)
        st = js.call(op="status", start=fen, moves=[])
        if st["insufficient"] != b.is_insufficient_material():
            stats["insufficient_mismatch_few_piece"] += 1
            note("insufficient_few", fen=fen, page=st["insufficient"], python_chess=b.is_insufficient_material())
    js.close()
    jwrite(os.path.join(OUT, "rules-diff.json"), stats)
    print(json.dumps({k: v for k, v in stats.items() if k != "examples"}))
    for k, v in stats["examples"].items():
        for e in v[:3]:
            print(" ", k, e)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 300)
