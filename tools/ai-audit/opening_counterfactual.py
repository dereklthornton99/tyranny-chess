"""Why two knights? Two experiments on modified copies of the engine (written to a temp folder, never into the repo).

  A. No knight-development bonus: the placement-table value of a knight on c3 and f3 is set to its home-square value
     (-40), so Nb1-c3 and Ng1-f3 stop gaining 50 points. If the opening stops being knight-first, the bonus is the cause.
  B. Ties broken the other way: the root move list is reversed before the first search. If the first move changes
     between the two knights, root ties are being settled by move-generation order, not by judgement.

For each variant and tier, under Tyranny rules (the page's default): the first move as White, then the second move after
each of twelve common Black replies.

    python tools/ai-audit/opening_counterfactual.py     writes _context/ai-audit/opening-counterfactual.json
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import *  # noqa: E402

REPLIES = ["e5", "d5", "Nf6", "c5", "e6", "c6", "d6", "g6", "Nc6", "b6", "f5", "a6"]
TIERS = ["easy", "medium", "hard"]


def variants(src):
    marker = "\nmodule.exports="
    i = src.rindex(marker)
    a = src[:i] + "\nPST.n[42] = PST.n[57]; PST.n[45] = PST.n[62];   // AUDIT: knight on c3/f3 worth no more than at home\n" + src[i:]
    old = "  orderMoves(ms, 0);\n  for(var d=1; d<=maxD; d++){"
    assert src.count(old) == 1, "root loop not found"
    b = src.replace(old, "  orderMoves(ms, 0); ms.reverse();   // AUDIT: root ties go the other way\n  for(var d=1; d<=maxD; d++){")
    return {"baseline": src, "A_no_knight_bonus": a, "B_ties_reversed": b}


def probe(path, level):
    js = JsEngine(self_cap=True, engine=path)
    try:
        b = chess.Board()
        m1 = js.move(None, [], level)["uci"]
        first = b.san(chess.Move.from_uci(m1))
        b.push_uci(m1)
        seconds = {}
        for rep in REPLIES:
            bb = b.copy()
            mv = bb.parse_san(rep)
            bb.push(mv)
            u = js.move(None, [m1, mv.uci()], level)["uci"]
            seconds[rep] = bb.san(chess.Move.from_uci(u))
        return {"first": first, "second": seconds}
    finally:
        js.close()


if __name__ == "__main__":
    src = open(os.path.join(ROOT, "tests", "engine.js"), encoding="utf-8").read()
    out = {}
    with tempfile.TemporaryDirectory() as td:
        for name, text in variants(src).items():
            p = os.path.join(td, name + ".js")
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            out[name] = {}
            for t in TIERS:
                r = probe(p, t)
                out[name][t] = r
                knights = sum(1 for s in r["second"].values() if s.startswith("N"))
                print("%-18s %-6s first %-4s second-move knight after %2d of 12 replies   %s" % (
                    name, t, r["first"], knights, " ".join("%s:%s" % (k, v) for k, v in r["second"].items())), flush=True)
    jwrite(os.path.join(OUT, "opening-counterfactual.json"), out)
