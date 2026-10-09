"""Why can Easy not mate with king and queen against a lone king? A counterfactual on a modified copy of the engine (a temp
file, never the repo): the evaluation rewards bringing its own king closer to the bare king by 4 points a square, which a
two-ply search must weigh against placement-table swings of 5 to 20 points for the queen. Raise that reward to 30 and see
whether Easy then converts the same positions.

    python tools/ai-audit/endgame_counterfactual.py [N_PER_TYPE] [TIER]      TIER defaults to easy
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402
from endgames import positions  # noqa: E402


def play(js, fen, tier):
    sf = open_sf(hash_mb=16)
    try:
        board = chess.Board(fen)
        moves = []
        while True:
            res, reason = result_of(board)
            if res:
                return reason == "checkmate" and res == "1-0", sum(1 for i in range(len(moves)) if i % 2 == 0)
            if board.turn == chess.WHITE:
                u = js.move(fen, moves, tier)["uci"]
            else:
                u = sf.play(board, chess.engine.Limit(depth=6)).move.uci()
            board.push_uci(u)
            moves.append(u)
    finally:
        sf.quit()


def main(n, tier):
    src = open(os.path.join(ROOT, "tests", "engine.js"), encoding="utf-8").read()
    old = "return cmd*10 + (14-md)*4;"
    assert src.count(old) == 1, "mop-up line not found"
    variants = {"as shipped (4 per square)": src, "king approach worth 30 per square": src.replace(old, "return cmd*10 + (14-md)*30;")}
    with tempfile.TemporaryDirectory() as td:
        for name, text in variants.items():
            p = os.path.join(td, "e%d.js" % len(name))
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            js = JsEngine(engine=p)
            try:
                for kind, seed in (("KQK", 21), ("KRK", 22)):
                    fens = positions(kind, n, seed)
                    res = [play(js, f, tier) for f in fens]
                    mated = [m for ok, m in res if ok]
                    print("%-6s %-36s %s: mated %2d of %d, mean moves to mate %s" % (tier, name, kind, len(mated), n, "%.1f" % (sum(mated) / len(mated)) if mated else "-"), flush=True)
            finally:
                js.close()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 30, sys.argv[2] if len(sys.argv) > 2 else "easy")
