"""Move accuracy of the three tiers, measured against Stockfish on the same positions as Stockfish itself at known
strengths and a random mover.

For every position in _context/ai-audit/positions.json and every player:
  * the player picks a move (the tiers are the page's own engine at its own time and depth limits, standard rules);
  * Stockfish scores the position before (best line) and the position after that move (search restricted to it), both at
    the same depth, from the mover's side;
  * centipawn loss = best - after, each score clipped to +-1000; Lichess-style accuracy from the win% before and after.

    python tools/ai-audit/accuracy.py run [WORKERS]    appends raw rows to _context/ai-audit/accuracy-raw-*.jsonl
    python tools/ai-audit/accuracy.py summary          prints the table and writes accuracy-summary.json
"""
import concurrent.futures as cf
import glob
import json
import os
import random
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402

DEPTH = 16
CAP = 1000
TIERS = ["easy", "medium", "hard"]
ANCHORS = [1320, 1600, 1900, 2200, 2500]
ANCHOR_TIME = 0.2


def players():
    return TIERS + ["sf%d" % a for a in ANCHORS] + ["random"]


def work(args):
    wid, idxs = args
    positions = json.load(open(os.path.join(OUT, "positions.json"), encoding="utf-8"))["positions"]
    js = JsEngine()
    ev = open_sf(hash_mb=64)
    pl = open_sf(elo=ANCHORS[0], hash_mb=16)
    rnd = random.Random(99 + wid)
    raw = os.path.join(OUT, "accuracy-raw-%d.jsonl" % wid)
    try:
        for i in idxs:
            p = positions[i]
            board = chess.Board(p["fen"])
            parent = ev.analyse(board, chess.engine.Limit(depth=DEPTH), multipv=3)
            best_cp = cp_of(parent[0], board.turn, CAP)
            top = [x["pv"][0].uci() for x in parent if "pv" in x]
            gap = (best_cp - cp_of(parent[1], board.turn, CAP)) if len(parent) > 1 else CAP     # how much the best move beats the second best
            cache = {}
            rows = []
            for name in players():
                info = {}
                if name in TIERS:
                    r = js.move(p["fen"], [], name)
                    uci = r["uci"]
                    info = {"depth": r["depth"], "nodes": r["nodes"], "ms": r["ms"]}
                elif name.startswith("sf"):
                    pl.configure({"UCI_LimitStrength": True, "UCI_Elo": int(name[2:])})
                    uci = pl.play(board, chess.engine.Limit(time=ANCHOR_TIME)).move.uci()
                else:
                    uci = rnd.choice(list(board.legal_moves)).uci()
                if uci not in cache:
                    cache[uci] = cp_of(ev.analyse(board, chess.engine.Limit(depth=DEPTH),
                                                  root_moves=[chess.Move.from_uci(uci)]), board.turn, CAP)
                after = cache[uci]
                cpl = max(0, best_cp - after)
                rows.append({"pos": i, "phase": p["phase"], "ply": p["ply"], "player": name, "uci": uci, "best_cp": best_cp,
                             "after_cp": after, "cpl": cpl, "gap": gap,
                             "acc": move_accuracy(win_pct(best_cp), win_pct(after)),
                             "agree1": uci == top[0], "in_top3": uci in top, **info})
            with open(raw, "a", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r) + "\n")
    finally:
        js.close()
        ev.quit()
        pl.quit()
    return len(idxs)


def run(workers):
    n = len(json.load(open(os.path.join(OUT, "positions.json"), encoding="utf-8"))["positions"])
    for f in glob.glob(os.path.join(OUT, "accuracy-raw-*.jsonl")):
        os.remove(f)
    jobs = [(w, list(range(w, n, workers))) for w in range(workers)]
    with cf.ProcessPoolExecutor(max_workers=workers) as ex:
        done = sum(ex.map(work, jobs))
    print("positions done:", done)


def boot_ci(vals, f=statistics.fmean, n=1000, seed=5):
    rnd = random.Random(seed)
    k = len(vals)
    ms = sorted(f([vals[rnd.randrange(k)] for _ in range(k)]) for _ in range(n))
    return ms[int(0.025 * n)], ms[int(0.975 * n)]


def acc_of(r):
    return move_accuracy(win_pct(r["best_cp"]), win_pct(r["after_cp"]))      # recomputed here so the formula lives in one place


def summary():
    rows = []
    for f in sorted(glob.glob(os.path.join(OUT, "accuracy-raw-*.jsonl"))):
        with open(f, encoding="utf-8") as fh:
            rows += [json.loads(x) for x in fh if x.strip()]
    by = {}
    for r in rows:
        by.setdefault(r["player"], {})[r["pos"]] = r
    out = {"depth": DEPTH, "cap_cp": CAP, "positions": len({r["pos"] for r in rows}), "players": {}}
    hdr = "%-8s %7s %-13s %7s %7s %6s %6s %6s %6s %7s %7s %6s"
    print(hdr % ("player", "meanCPL", "95% CI", "median", "acc%", "<=10", "<=50", ">=100", ">=300", "best", "top3", "n"))
    for name in players():
        d = by.get(name)
        if not d:
            continue
        rs = [d[k] for k in sorted(d)]
        cpl = [r["cpl"] for r in rs]
        lo, hi = boot_ci(cpl)
        s = {"n": len(rs), "mean_cpl": statistics.fmean(cpl), "ci": [lo, hi], "median_cpl": statistics.median(cpl),
             "accuracy_pct": statistics.fmean(acc_of(r) for r in rs),
             "le10": sum(c <= 10 for c in cpl) / len(cpl), "le50": sum(c <= 50 for c in cpl) / len(cpl),
             "ge100": sum(c >= 100 for c in cpl) / len(cpl), "ge200": sum(c >= 200 for c in cpl) / len(cpl),
             "ge300": sum(c >= 300 for c in cpl) / len(cpl),
             "agree1": sum(r["agree1"] for r in rs) / len(rs), "in_top3": sum(r["in_top3"] for r in rs) / len(rs)}
        for ph in ("opening", "middlegame", "endgame"):
            sub = [r for r in rs if r["phase"] == ph]
            if sub:
                s[ph] = {"n": len(sub), "mean_cpl": statistics.fmean(r["cpl"] for r in sub), "acc": statistics.fmean(acc_of(r) for r in sub),
                         "agree1": sum(r["agree1"] for r in sub) / len(sub)}
        if name in TIERS:
            for ph in ("opening", "middlegame", "endgame", "all"):
                sub = [r for r in rs if ph == "all" or r["phase"] == ph]
                if sub:
                    s.setdefault("search", {})[ph] = {"mean_depth": statistics.fmean(r["depth"] for r in sub),
                                                      "min_depth": min(r["depth"] for r in sub), "max_depth": max(r["depth"] for r in sub),
                                                      "mean_ms": statistics.fmean(r["ms"] for r in sub),
                                                      "nps": sum(r["nodes"] for r in sub) / max(1, sum(r["ms"] for r in sub)) * 1000}
        crit = [r for r in rs if r.get("gap", 0) >= 100]
        if crit:
            s["critical"] = {"n": len(crit), "agree1": sum(r["agree1"] for r in crit) / len(crit),
                              "ok25": sum(r["cpl"] <= 25 for r in crit) / len(crit), "lost200": sum(r["cpl"] >= 200 for r in crit) / len(crit)}
        out["players"][name] = s
        print(hdr % (name, "%.1f" % s["mean_cpl"], "%.1f-%.1f" % (lo, hi), "%.0f" % s["median_cpl"], "%.1f" % s["accuracy_pct"],
                     "%.0f%%" % (100 * s["le10"]), "%.0f%%" % (100 * s["le50"]), "%.0f%%" % (100 * s["ge100"]), "%.0f%%" % (100 * s["ge300"]),
                     "%.0f%%" % (100 * s["agree1"]), "%.0f%%" % (100 * s["in_top3"]), len(rs)))
    print()
    print("critical positions (the best move beats the second best by >= 100 cp): found the best / within 25 cp / lost >= 200 cp")
    for name in players():
        c = out["players"].get(name, {}).get("critical")
        if c:
            print("  %-8s n=%d  %.0f%% / %.0f%% / %.0f%%" % (name, c["n"], 100 * c["agree1"], 100 * c["ok25"], 100 * c["lost200"]))
    print()
    for name in TIERS:
        s = out["players"].get(name)
        if s:
            print("%s by phase: %s" % (name, "  ".join("%s %.0f cpl (%.0f%% best, n=%d)" % (ph, s[ph]["mean_cpl"], 100 * s[ph]["agree1"], s[ph]["n"]) for ph in ("opening", "middlegame", "endgame") if ph in s)))
            print("   search: %s" % "  ".join("%s depth %.1f (%d-%d), %.0f ms, %.0fk nps" % (ph, v["mean_depth"], v["min_depth"], v["max_depth"], v["mean_ms"], v["nps"] / 1000) for ph, v in s["search"].items()))
    # paired differences between tiers
    print()
    for a, b in (("medium", "easy"), ("hard", "medium"), ("hard", "easy")):
        if a in by and b in by:
            ks = sorted(set(by[a]) & set(by[b]))
            diff = [by[b][k]["cpl"] - by[a][k]["cpl"] for k in ks]
            lo, hi = boot_ci(diff)
            print("paired: %s is %.1f cp/move more accurate than %s (95%% CI %.1f to %.1f, n=%d)" % (a, statistics.fmean(diff), b, lo, hi, len(ks)))
            out.setdefault("paired", {})["%s_vs_%s" % (a, b)] = {"mean_cpl_gain": statistics.fmean(diff), "ci": [lo, hi], "n": len(ks)}
    jwrite(os.path.join(OUT, "accuracy-summary.json"), out)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        run(int(sys.argv[2]) if len(sys.argv) > 2 else 6)
    elif len(sys.argv) > 1 and sys.argv[1] == "summary":
        summary()
    else:
        print(__doc__)
