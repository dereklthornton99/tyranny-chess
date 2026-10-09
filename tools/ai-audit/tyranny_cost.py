"""What does Tyranny's self-capture rule cost the search? The same positions, the same tiers, self-capture off (standard
rules, what Stockfish can judge) and on (the page's default). Self-capture adds moves at every node, so a time-limited
search reaches less depth; this measures how much, and how often the move changes.

    python tools/ai-audit/tyranny_cost.py [N_POSITIONS]     writes _context/ai-audit/tyranny-cost.json
"""
import concurrent.futures as cf
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402


def work(args):
    idxs = args
    positions = json.load(open(os.path.join(OUT, "positions.json"), encoding="utf-8"))["positions"]
    js = JsEngine()
    rows = []
    try:
        for i in idxs:
            fen = positions[i]["fen"]
            for tier in ("medium", "hard"):
                a = js.move(fen, [], tier, self_cap=False)
                b = js.move(fen, [], tier, self_cap=True)
                rows.append({"pos": i, "tier": tier, "std_depth": a["depth"], "tyr_depth": b["depth"], "std_move": a["uci"], "tyr_move": b["uci"]})
    finally:
        js.close()
    return rows


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    w = 4
    with cf.ProcessPoolExecutor(max_workers=w) as ex:
        rows = [r for part in ex.map(work, [list(range(k, n, w)) for k in range(w)]) for r in part]
    out = {}
    for tier in ("medium", "hard"):
        rs = [r for r in rows if r["tier"] == tier]
        out[tier] = {"n": len(rs), "mean_depth_standard": statistics.fmean(r["std_depth"] for r in rs),
                     "mean_depth_tyranny": statistics.fmean(r["tyr_depth"] for r in rs),
                     "same_move": sum(r["std_move"] == r["tyr_move"] for r in rs) / len(rs)}
        o = out[tier]
        print("%-7s n=%d  depth %.2f standard vs %.2f Tyranny (%.2f plies lost); same move in %.0f%% of positions" % (
            tier, o["n"], o["mean_depth_standard"], o["mean_depth_tyranny"], o["mean_depth_standard"] - o["mean_depth_tyranny"], 100 * o["same_move"]))
    jwrite(os.path.join(OUT, "tyranny-cost.json"), out)
