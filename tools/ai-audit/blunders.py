"""What kind of mistakes cost the tiers the most? For every move by Medium or Hard that lost 200 cp or more on the
accuracy positions, follow Stockfish's best line after the move and measure how much material the AI loses within four
plies (a tactic its own search should have seen, since Medium reaches about 4.5 plies and Hard about 5) against a loss
that only shows later (a positional error).

    python tools/ai-audit/blunders.py      writes _context/ai-audit/blunders.json
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402

VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def material(board, color):
    return sum(VAL[p.piece_type] for p in board.piece_map().values() if p.color == color)


def main():
    positions = json.load(open(os.path.join(OUT, "positions.json"), encoding="utf-8"))["positions"]
    rows = []
    for f in glob.glob(os.path.join(OUT, "accuracy-raw-*.jsonl")):
        with open(f, encoding="utf-8") as fh:
            rows += [json.loads(x) for x in fh if x.strip()]
    sf = open_sf(hash_mb=64)
    out = {}
    try:
        for tier in ("medium", "hard", "easy"):
            bad = sorted([r for r in rows if r["player"] == tier and r["cpl"] >= 200], key=lambda r: -r["cpl"])
            res = []
            for r in bad:
                board = chess.Board(positions[r["pos"]]["fen"])
                mover = board.turn
                best = sf.analyse(board, chess.engine.Limit(depth=14))
                best_san = board.san(best["pv"][0])
                mv = chess.Move.from_uci(r["uci"])
                san = board.san(mv)
                b2 = board.copy()
                b2.push(mv)
                before = material(b2, mover) - material(b2, not mover)
                info = sf.analyse(b2, chess.engine.Limit(depth=14))
                line = []
                bb = b2.copy()
                for m in info.get("pv", [])[:4]:
                    line.append(bb.san(m))
                    bb.push(m)
                after = material(bb, mover) - material(bb, not mover)
                res.append({"pos": r["pos"], "phase": r["phase"], "ai_move": san, "stockfish_move": best_san, "cpl": r["cpl"],
                            "material_swing_in_4_plies": after - before, "line": " ".join(line), "fen": board.fen()})
            tactical = sum(1 for x in res if x["material_swing_in_4_plies"] <= -2)
            out[tier] = {"blunders_200": len(res), "lose_material_within_4_plies": tactical, "rows": res}
            print("== %s: %d moves lost >= 200 cp; %d of them lose material (>= 2 pawns' worth) within 4 plies of Stockfish's reply line" % (tier, len(res), tactical))
            for x in res[:12]:
                print("   %-10s ply-phase %-10s AI %-7s (SF %-7s) lost %4d cp, material %+d in 4 plies: %s" % ("", x["phase"], x["ai_move"], x["stockfish_move"], x["cpl"], x["material_swing_in_4_plies"], x["line"]))
    finally:
        sf.quit()
    jwrite(os.path.join(OUT, "blunders.json"), out)


if __name__ == "__main__":
    main()
