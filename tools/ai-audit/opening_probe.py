"""What does the AI play in the opening, and why?

For each tier, standard rules (selfCap off):
  A. as White: its first move, then its second move after each of Black's 20 possible replies;
  B. as Black: its reply to each of White's 20 first moves, then its reply to Stockfish's best second move;
  C. the mechanism: the exact fixed-depth score of every first move, with the static score after it;
  D. a sample line against Stockfish's best replies, with Stockfish's verdict on each AI move.

    python tools/ai-audit/opening_probe.py            standard rules -> _context/ai-audit/opening-probe.json
    python tools/ai-audit/opening_probe.py --selfcap  Tyranny rules (the page's default) -> opening-probe-tyranny.json
"""
import concurrent.futures as cf
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402

TIERS = ["easy", "medium", "hard"]
SELF_CAP = "--selfcap" in sys.argv     # Tyranny rules, the page's default; without the flag: standard rules


def is_knight(board, uci):
    return board.piece_type_at(chess.parse_square(uci[:2])) == chess.KNIGHT


def probe(level):
    js = JsEngine(self_cap=SELF_CAP)
    sf = open_sf(hash_mb=64)
    out = {"level": level, "self_capture_on": SELF_CAP}
    try:
        # A. engine as White
        r1 = js.move(None, [], level)
        m1 = r1["uci"]
        b0 = chess.Board()
        san1 = b0.san(chess.Move.from_uci(m1))
        first_knight = is_knight(b0, m1)
        b = chess.Board()
        b.push_uci(m1)
        rows = []
        for reply in [m.uci() for m in b.legal_moves]:
            rr = js.move(None, [m1, reply], level)
            bb = b.copy()
            rep_san = bb.san(chess.Move.from_uci(reply))
            bb.push_uci(reply)
            sec = rr["uci"]
            rows.append({"black_reply": rep_san, "second": bb.san(chess.Move.from_uci(sec)),
                         "second_is_knight": is_knight(bb, sec), "depth": rr["depth"]})
        out["white"] = {"first": san1, "first_is_knight": first_knight, "depth": r1["depth"], "second_moves": rows,
                        "second_knight_count": sum(r["second_is_knight"] for r in rows),
                        "both_knights_count": sum(r["second_is_knight"] and first_knight for r in rows),
                        "distinct_second_moves": sorted({r["second"] for r in rows})}
        # B. engine as Black
        brows = []
        for first in [m.uci() for m in chess.Board().legal_moves]:
            b = chess.Board()
            first_san = b.san(chess.Move.from_uci(first))
            b.push_uci(first)
            ra = js.move(None, [first], level)
            reply = ra["uci"]
            reply_san = b.san(chess.Move.from_uci(reply))
            reply_knight = is_knight(b, reply)
            b.push_uci(reply)
            h2 = sf.play(b, chess.engine.Limit(depth=12)).move
            h2_san = b.san(h2)
            b.push(h2)
            rb = js.move(None, [first, reply, h2.uci()], level)
            sec = rb["uci"]
            brows.append({"white_first": first_san, "reply": reply_san, "reply_is_knight": reply_knight,
                          "white_second": h2_san, "second": b.san(chess.Move.from_uci(sec)),
                          "second_is_knight": is_knight(b, sec)})
        out["black"] = {"rows": brows,
                        "reply_knight_count": sum(r["reply_is_knight"] for r in brows),
                        "both_knights_count": sum(r["reply_is_knight"] and r["second_is_knight"] for r in brows),
                        "distinct_replies": sorted({r["reply"] for r in brows})}
        # C. mechanism: exact score of each first move at the depth this tier reaches from the start position
        d = r1["depth"]
        root = js.root(None, [], d)
        b0 = chess.Board()
        out["mechanism"] = {"depth": d, "moves": [
            {"move": b0.san(chess.Move.from_uci(x["uci"])), "score": x["score"], "static_after": x["staticAfter"]} for x in root]}
        # D. a sample line: the AI as White against Stockfish's best replies
        b = chess.Board()
        moves = []
        line = []
        for ply in range(12):
            if ply % 2 == 0:
                r = js.move(None, moves, level)
                mv = chess.Move.from_uci(r["uci"])
                who = "AI"
            else:
                mv = sf.play(b, chess.engine.Limit(depth=12)).move
                who = "SF"
            san = b.san(mv)
            b.push(mv)
            moves.append(mv.uci())
            ev = sf.analyse(b, chess.engine.Limit(depth=14))
            line.append({"ply": ply + 1, "who": who, "move": san, "sf_eval_white": cp_of(ev, chess.WHITE)})
        out["sample_line_as_white"] = line
    finally:
        js.close()
        sf.quit()
    return out


if __name__ == "__main__":
    with cf.ProcessPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(probe, TIERS))
    jwrite(os.path.join(OUT, "opening-probe-tyranny.json" if SELF_CAP else "opening-probe.json"), {"self_capture_on": SELF_CAP, "tiers": results})
    for r in results:
        w, bl = r["white"], r["black"]
        print("== %s (reaches depth %d from the start)" % (r["level"], r["mechanism"]["depth"]))
        print("  as White: first move %s (knight: %s); second move is a knight after %d of 20 Black replies; both knights in %d of 20"
              % (w["first"], w["first_is_knight"], w["second_knight_count"], w["both_knights_count"]))
        print("            second moves played: %s" % ", ".join(w["distinct_second_moves"]))
        print("  as Black: reply to White's 20 first moves is a knight in %d of 20; first two replies both knights in %d of 20"
              % (bl["reply_knight_count"], bl["both_knights_count"]))
        print("            replies played: %s" % ", ".join(bl["distinct_replies"]))
        top = r["mechanism"]["moves"][:6]
        print("  first moves by exact depth-%d score: %s" % (r["mechanism"]["depth"], ", ".join("%s %+d" % (m["move"], m["score"]) for m in top)))
        print("  sample line vs Stockfish best replies: %s" % " ".join("%s(%+d)" % (x["move"], x["sf_eval_white"]) for x in r["sample_line_as_white"]))
