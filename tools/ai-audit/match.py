"""Games between one tier of the page's engine and Stockfish limited to a stated Elo, or between two tiers.

python-chess referees every game, so a move the page's engine could not legally play is caught and counted, and the
endings are the page's: mate, stalemate, insufficient material, fifty-move rule, threefold repetition.

    python tools/ai-audit/match.py run --tier hard --elo 1700 --games 40 --workers 4 --name hard-1700 [--movetime 0.25] [--natural K]
    python tools/ai-audit/match.py run --tier medium --opp-tier easy --games 40 --workers 4 --name medium-v-easy
    python tools/ai-audit/match.py summary [name ...]

Games alternate colours and walk through a fixed list of balanced four-ply openings, because the page's engine is
deterministic: the same position always gets the same move, so without varied openings every game would repeat.
--natural K adds K games from the ordinary start position (Stockfish's own randomness varies them).
"""
import argparse
import concurrent.futures as cf
import glob
import json
import math
import os
import sys
import time
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402

OPENINGS = os.path.join(OUT, "openings.json")


def parse_level(s):
    """'easy', 'medium' or 'hard' as the page defines them, or 'd:DEPTH:MS[:TEMP[:MOP]]' for a custom setting such as d:3:600 or
    d:1:150:80:30 (depth 1, 150 ms, sampling temperature 80 cp, bare-king approach weight 30)."""
    if isinstance(s, str) and s.startswith("d:"):
        parts = s.split(":")
        lv = {"depth": int(parts[1]), "ms": int(parts[2])}
        if len(parts) > 3 and parts[3]:
            lv["temp"] = float(parts[3])
        if len(parts) > 4 and parts[4]:
            lv["mop"] = float(parts[4])
        return lv
    return s


def load_openings():
    if not os.path.exists(OPENINGS):
        jwrite(OPENINGS, {"how": "balanced 4-ply openings, Stockfish top-5 within 60 cp, final |eval| <= 80 cp",
                          "openings": make_openings(60, plies=4, seed=11)})
    return json.load(open(OPENINGS, encoding="utf-8"))["openings"]


def play_game(js, opp_js, sf, level, opp_level, js_white, opening, movetime, max_plies=400, seed_base=0):
    board = chess.Board()
    moves = []
    for u in opening:
        board.push_uci(u)
        moves.append(u)
    depths, mss, illegal = [], [], None
    game = object()
    while True:
        res, reason = result_of(board)
        if res:
            break
        if len(board.move_stack) >= max_plies:
            res, reason = "1/2-1/2", "move cap"
            break
        js_turn = (board.turn == chess.WHITE) == js_white
        if js_turn or opp_js is not None:
            eng, lv = (js, parse_level(level)) if js_turn else (opp_js, parse_level(opp_level))
            r = eng.move(None, moves, lv, seed=seed_base * 1000 + len(moves))
            uci = r["uci"]
            if uci is None or chess.Move.from_uci(uci) not in board.legal_moves:
                illegal = {"side": "js" if js_turn else "opp", "uci": uci, "fen": board.fen()}
                res = ("0-1" if board.turn == chess.WHITE else "1-0")
                reason = "illegal move by the page's engine"
                break
            if js_turn:
                depths.append(r["depth"])
                mss.append(r["ms"])
        else:
            uci = sf.play(board, chess.engine.Limit(time=movetime), game=game).move.uci()
        board.push_uci(uci)
        moves.append(uci)
    js_pts = {"1-0": 1.0 if js_white else 0.0, "0-1": 0.0 if js_white else 1.0, "1/2-1/2": 0.5}[res]
    return {"result": res, "js_score": js_pts, "reason": reason, "plies": len(board.move_stack), "moves": moves,
            "mean_depth": (sum(depths) / len(depths)) if depths else None, "mean_ms": (sum(mss) / len(mss)) if mss else None,
            "illegal": illegal}


def worker(a):
    k, jobs, args = a
    js = JsEngine()
    opp_js = JsEngine() if args["opp_tier"] else None
    sf = None if args["opp_tier"] else open_sf(elo=args["elo"], hash_mb=32)
    path = os.path.join(OUT, "games-%s-w%d.jsonl" % (args["name"], k))
    try:
        for g in jobs:
            t0 = time.time()
            r = play_game(js, opp_js, sf, args["tier"], args["opp_tier"], g["js_white"], g["opening"], args["movetime"],
                          seed_base=(zlib.crc32(args["name"].encode()) % 9973) * 1000 + g["game"] + 1)
            r.update({"name": args["name"], "game": g["game"], "tier": args["tier"], "opp": args["opp_tier"] or ("sf%d" % args["elo"]),
                      "js_white": g["js_white"], "opening_idx": g["opening_idx"], "secs": round(time.time() - t0, 1)})
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(r) + "\n")
    finally:
        js.close()
        if opp_js:
            opp_js.close()
        if sf:
            sf.quit()
    return len(jobs)


def run(args):
    openings = load_openings()
    jobs = []
    for g in range(args["games"]):
        i = (g // 2) % len(openings)
        jobs.append({"game": g, "js_white": g % 2 == 0, "opening": openings[i], "opening_idx": i})
    for g in range(args["natural"]):
        jobs.append({"game": args["games"] + g, "js_white": g % 2 == 0, "opening": [], "opening_idx": -1})
    for f in glob.glob(os.path.join(OUT, "games-%s-w*.jsonl" % args["name"])):
        os.remove(f)
    w = args["workers"]
    parts = [(k, jobs[k::w], args) for k in range(w)]
    t0 = time.time()
    with cf.ProcessPoolExecutor(max_workers=w) as ex:
        n = sum(ex.map(worker, parts))
    print("%s: %d games in %.0f s" % (args["name"], n, time.time() - t0))


def elo_est(w, d, l):
    sc = score_ci(w, d, l)
    if not sc:
        return None
    s, lo, hi = sc
    return elo_from_score(s), elo_from_score(lo), elo_from_score(hi), s


def summary(names):
    files = sorted(glob.glob(os.path.join(OUT, "games-*.jsonl")))
    games = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            games += [json.loads(x) for x in fh if x.strip()]
    by = {}
    for g in games:
        by.setdefault(g["name"], []).append(g)
    out = {}
    for name in sorted(by):
        if names and name not in names:
            continue
        gs = by[name]
        w = sum(g["js_score"] == 1.0 for g in gs)
        d = sum(g["js_score"] == 0.5 for g in gs)
        l = sum(g["js_score"] == 0.0 for g in gs)
        e = elo_est(w, d, l)
        reasons = {}
        for g in gs:
            reasons[g["reason"]] = reasons.get(g["reason"], 0) + 1
        ill = sum(1 for g in gs if g.get("illegal"))
        white = [g["js_score"] for g in gs if g["js_white"]]
        black = [g["js_score"] for g in gs if not g["js_white"]]
        row = {"tier": gs[0]["tier"], "opp": gs[0]["opp"], "games": len(gs), "w": w, "d": d, "l": l, "score": e[3] if e else None,
               "elo_diff": e[0] if e else None, "elo_diff_ci": [e[1], e[2]] if e else None,
               "mean_plies": sum(g["plies"] for g in gs) / len(gs), "reasons": reasons, "illegal_moves": ill,
               "as_white": sum(white) / len(white) if white else None, "as_black": sum(black) / len(black) if black else None,
               "mean_depth": sum(g["mean_depth"] for g in gs if g["mean_depth"]) / max(1, sum(1 for g in gs if g["mean_depth"]))}
        out[name] = row
        print("%-18s %s v %-7s %3d games  +%d =%d -%d  score %.3f  Elo diff %+.0f (%+.0f to %+.0f)  plies %.0f  depth %.1f  white %.2f black %.2f  illegal %d  %s" % (
            name, row["tier"], row["opp"], row["games"], w, d, l, row["score"], row["elo_diff"], row["elo_diff_ci"][0], row["elo_diff_ci"][1],
            row["mean_plies"], row["mean_depth"], row["as_white"] if row["as_white"] is not None else -1, row["as_black"] if row["as_black"] is not None else -1, ill, reasons))
    if out and not names:
        jwrite(os.path.join(OUT, "match-summary.json"), out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "summary"])
    ap.add_argument("names", nargs="*")
    ap.add_argument("--tier", default="medium")
    ap.add_argument("--elo", type=int, default=1700)
    ap.add_argument("--opp-tier", dest="opp_tier", default=None)
    ap.add_argument("--games", type=int, default=40)
    ap.add_argument("--natural", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--movetime", type=float, default=0.25)
    ap.add_argument("--name", default=None)
    a = ap.parse_args()
    if a.cmd == "run":
        nm = a.name or ("%s-%s" % (a.tier, a.opp_tier if a.opp_tier else a.elo))
        run({"tier": a.tier, "elo": a.elo, "opp_tier": a.opp_tier, "games": a.games, "natural": a.natural, "workers": a.workers,
             "movetime": a.movetime, "name": nm})
    else:
        summary(a.names)
