"""Can each tier convert a won ending? King and queen against king, and king and rook against king, from random legal
positions with the tier to move. Stockfish defends at full strength (depth 6). python-chess referees with the page's
endings, so the fifty-move rule (100 half-moves) and threefold repetition end a failed conversion as a draw.

With best play a queen mates in at most 10 moves and a rook in at most 16.

    python tools/ai-audit/endgames.py run [N_PER_TYPE] [WORKERS]
    python tools/ai-audit/endgames.py summary
"""
import concurrent.futures as cf
import glob
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402

TIERS = ["easy", "medium", "hard"]


def positions(kind, n, seed):
    rnd = random.Random(seed)
    piece = chess.QUEEN if kind == "KQK" else chess.ROOK
    out = []
    while len(out) < n:
        sqs = rnd.sample(range(64), 3)
        b = chess.Board(None)
        b.set_piece_at(sqs[0], chess.Piece(chess.KING, chess.WHITE))
        b.set_piece_at(sqs[1], chess.Piece(piece, chess.WHITE))
        b.set_piece_at(sqs[2], chess.Piece(chess.KING, chess.BLACK))
        b.turn = chess.WHITE
        if not b.is_valid() or b.is_check() or b.is_game_over():
            continue
        if any(b.is_capture(m) for m in b.legal_moves):      # skip positions where the queen or rook can simply be taken at once
            pass
        out.append(b.fen())
    return out


def work(args):
    tier, kind, fen, idx = args
    js = JsEngine()
    sf = open_sf(hash_mb=16)
    try:
        board = chess.Board(fen)
        moves = []
        js_moves = 0
        res = reason = None
        while True:
            res, reason = result_of(board)
            if res:
                break
            if board.turn == chess.WHITE:
                r = js.move(fen, moves, tier)
                u = r["uci"]
                if u is None or chess.Move.from_uci(u) not in board.legal_moves:
                    res, reason = "0-1", "illegal move"
                    break
                js_moves += 1
            else:
                u = sf.play(board, chess.engine.Limit(depth=6)).move.uci()
            board.push_uci(u)
            moves.append(u)
        return {"tier": tier, "kind": kind, "idx": idx, "fen": fen, "result": res, "reason": reason, "js_moves": js_moves,
                "mated": reason == "checkmate" and res == "1-0"}
    finally:
        js.close()
        sf.quit()


def run(n, workers):
    jobs = []
    for kind, seed in (("KQK", 21), ("KRK", 22)):
        fens = positions(kind, n, seed)
        for t in TIERS:
            for i, f in enumerate(fens):
                jobs.append((t, kind, f, i))
    path = os.path.join(OUT, "endgames-raw.jsonl")
    if os.path.exists(path):
        os.remove(path)
    with cf.ProcessPoolExecutor(max_workers=workers) as ex, open(path, "a", encoding="utf-8") as f:
        for r in ex.map(work, jobs, chunksize=2):
            f.write(json.dumps(r) + "\n")
            f.flush()
    print("games:", len(jobs))


def summary():
    rows = [json.loads(x) for x in open(os.path.join(OUT, "endgames-raw.jsonl"), encoding="utf-8") if x.strip()]
    out = {}
    print("%-7s %-5s %6s %12s %14s  %s" % ("tier", "type", "games", "mated", "mean moves", "when it failed"))
    for kind in ("KQK", "KRK"):
        for t in TIERS:
            rs = [r for r in rows if r["tier"] == t and r["kind"] == kind]
            if not rs:
                continue
            m = [r for r in rs if r["mated"]]
            fails = {}
            for r in rs:
                if not r["mated"]:
                    fails[r["reason"]] = fails.get(r["reason"], 0) + 1
            sc = score_ci(len(m), 0, len(rs) - len(m))
            row = {"games": len(rs), "mated": len(m), "rate": len(m) / len(rs), "ci": [sc[1], sc[2]],
                   "mean_moves_to_mate": (sum(r["js_moves"] for r in m) / len(m)) if m else None,
                   "max_moves_to_mate": max((r["js_moves"] for r in m), default=None), "failures": fails}
            out["%s-%s" % (t, kind)] = row
            print("%-7s %-5s %6d %5d (%3.0f%%) %14s  %s" % (t, kind, len(rs), len(m), 100 * row["rate"],
                  "%.1f (max %d)" % (row["mean_moves_to_mate"], row["max_moves_to_mate"]) if m else "-", fails))
    jwrite(os.path.join(OUT, "endgames-summary.json"), out)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        run(int(sys.argv[2]) if len(sys.argv) > 2 else 30, int(sys.argv[3]) if len(sys.argv) > 3 else 6)
    elif len(sys.argv) > 1 and sys.argv[1] == "summary":
        summary()
    else:
        print(__doc__)
