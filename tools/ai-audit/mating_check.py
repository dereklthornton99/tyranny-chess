"""Can a tier setting finish king and queen, or king and rook, against a lone king? The same 30 + 30 random positions the audit
used, Stockfish defending at depth 6, python-chess refereeing with the fifty-move rule. A setting is a tier name (easy, medium,
hard: what the page ships) or a custom 'd:DEPTH:MS[:TEMP[:MOP]]' as match.py takes.

    python tools/ai-audit/mating_check.py easy medium
    python tools/ai-audit/mating_check.py d:1:150:20:30 d:3:600:12:30
"""
import concurrent.futures as cf
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402
from endgames import positions  # noqa: E402
from match import parse_level  # noqa: E402


def one(args):
    setting, fen, idx = args
    js = JsEngine()
    sf = open_sf(hash_mb=16)
    try:
        board = chess.Board(fen)
        moves = []
        mine = 0
        lv = parse_level(setting)
        while True:
            res, reason = result_of(board)
            if res:
                return reason == "checkmate" and res == "1-0", mine, reason
            if board.turn == chess.WHITE:
                u = js.move(fen, moves, lv, seed=7919 * (idx + 1) + len(moves))["uci"]
                mine += 1
            else:
                u = sf.play(board, chess.engine.Limit(depth=6)).move.uci()
            board.push_uci(u)
            moves.append(u)
    finally:
        js.close()
        sf.quit()


def main(settings, n=30):
    jobs = {}
    for kind, seed in (("KQK", 21), ("KRK", 22)):
        jobs[kind] = positions(kind, n, seed)
    with cf.ProcessPoolExecutor(max_workers=6) as ex:
        for setting in settings:
            row = []
            for kind in ("KQK", "KRK"):
                res = list(ex.map(one, [(setting, f, i) for i, f in enumerate(jobs[kind])]))
                mated = [m for ok, m, _ in res if ok]
                why = {}
                for ok, _, r in res:
                    if not ok:
                        why[r] = why.get(r, 0) + 1
                row.append("%s: mated %d of %d, mean moves %s %s" % (kind, len(mated), n, ("%.1f" % (sum(mated) / len(mated))) if mated else "-", why or ""))
            print("%-22s %s" % (setting, " | ".join(row)), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or ["easy", "medium", "hard"])
