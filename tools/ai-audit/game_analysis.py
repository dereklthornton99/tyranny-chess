"""What happened in the games? Endings by matchup, and for every drawn game how good the page's engine's position was at its
best moment, as Stockfish sees it (depth 12, sampled every 4 plies from ply 8). A draw from a position Stockfish calls
clearly winning (+300 cp or more) is a conversion failure.

    python tools/ai-audit/game_analysis.py        writes _context/ai-audit/game-analysis.json
"""
import concurrent.futures as cf
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402


def peak(args):
    gid, moves, js_white = args
    sf = open_sf(hash_mb=32)
    try:
        b = chess.Board()
        best = -99999
        best_ply = None
        samples = []
        for i, u in enumerate(moves):
            b.push_uci(u)
            if i >= 8 and i % 4 == 0 and not b.is_game_over():
                cp = cp_of(sf.analyse(b, chess.engine.Limit(depth=12)), chess.WHITE if js_white else chess.BLACK, 3000)
                samples.append((i + 1, cp))
                if cp > best:
                    best, best_ply = cp, i + 1
        return {"id": gid, "peak_cp": best, "peak_ply": best_ply, "final_cp": samples[-1][1] if samples else None}
    finally:
        sf.quit()


def main():
    games = []
    for f in sorted(glob.glob(os.path.join(OUT, "games-*.jsonl"))):
        with open(f, encoding="utf-8") as fh:
            games += [json.loads(x) for x in fh if x.strip()]
    draws = [g for g in games if g["result"] == "1/2-1/2"]
    jobs = [("%s#%d" % (g["name"], g["game"]), g["moves"], g["js_white"]) for g in draws]
    peaks = {}
    if jobs:
        with cf.ProcessPoolExecutor(max_workers=6) as ex:
            for r in ex.map(peak, jobs):
                peaks[r["id"]] = r
    by = {}
    for g in games:
        d = by.setdefault(g["name"], {"games": 0, "mate_wins": 0, "mate_losses": 0, "draws": {}, "had_winning_draw": 0, "draw_peaks": []})
        d["games"] += 1
        if g["result"] != "1/2-1/2":
            d["mate_wins" if g["js_score"] == 1.0 else "mate_losses"] += 1
        else:
            d["draws"][g["reason"]] = d["draws"].get(g["reason"], 0) + 1
            p = peaks["%s#%d" % (g["name"], g["game"])]
            d["draw_peaks"].append(p["peak_cp"])
            if p["peak_cp"] >= 300:
                d["had_winning_draw"] += 1
    for name, d in sorted(by.items()):
        print("%-18s %3d games, %2d won, %2d lost, draws %s; drawn from a position worth +300 cp or more at some point: %d of %d" % (
            name, d["games"], d["mate_wins"], d["mate_losses"], d["draws"] or "none", d["had_winning_draw"], sum(d["draws"].values())))
    jwrite(os.path.join(OUT, "game-analysis.json"), by)


if __name__ == "__main__":
    main()
