"""Build the position set the accuracy audit uses: realistic amateur-game positions, the same ones for every player.

Stockfish (limited to about 1700) plays both sides from a balanced random opening, so the positions look like
ordinary games with ordinary mistakes. Three plies are sampled from each game. A position is kept if it is not over,
has at least three legal moves, and Stockfish rates it within +-700 cp (so a move still matters).

    python tools/ai-audit/positions.py [N_GAMES] [WORKERS]   writes _context/ai-audit/positions.json
"""
import concurrent.futures as cf
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402


def one_game(args):
    seed, opening = args
    rnd = random.Random(seed)
    sf = open_sf(elo=1700)
    ev = open_sf()
    out = []
    try:
        b = chess.Board()
        for u in opening:
            b.push_uci(u)
        targets = sorted(rnd.sample(range(8, 101), 3))
        while len(b.move_stack) <= targets[-1] and not b.is_game_over(claim_draw=True):
            if len(b.move_stack) in targets and b.legal_moves.count() >= 3:
                e = ev.analyse(b, chess.engine.Limit(depth=12))
                if abs(cp_of(e, chess.WHITE, cap=5000)) <= 700:
                    out.append({"fen": b.fen(), "ply": len(b.move_stack), "phase": phase_of(b, len(b.move_stack)),
                                "game": seed})
            mv = sf.play(b, chess.engine.Limit(time=0.03)).move
            b.push(mv)
    finally:
        sf.quit()
        ev.quit()
    return out


if __name__ == "__main__":
    n_games = int(sys.argv[1]) if len(sys.argv) > 1 else 260
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    openings = make_openings(min(n_games, 80), plies=4, seed=7)      # 80 distinct balanced openings, reused: the games differ anyway
    print("openings:", len(openings), flush=True)
    jobs = [(1000 + i, openings[i % len(openings)]) for i in range(n_games)]
    positions, seen = [], set()
    with cf.ProcessPoolExecutor(max_workers=workers) as ex:
        for res in ex.map(one_game, jobs):
            for p in res:
                key = p["fen"].rsplit(" ", 2)[0]
                if key not in seen:
                    seen.add(key)
                    positions.append(p)
    counts = {}
    for p in positions:
        counts[p["phase"]] = counts.get(p["phase"], 0) + 1
    jwrite(os.path.join(OUT, "positions.json"), {"stockfish": "UCI_Elo 1700 self-play, 30 ms a move; kept if |eval| <= 700 cp at depth 12",
                                                 "count": len(positions), "by_phase": counts, "positions": positions})
    print("positions:", len(positions), counts)
