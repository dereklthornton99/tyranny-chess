"""Place each tier on Stockfish's Elo scale from its accuracy alone: interpolate its mean centipawn loss between the
Stockfish anchors that played the same positions (piecewise-linear in log centipawn loss). This is a rough second opinion
to the matches: Stockfish's weakened play errs at random, the page's engine errs systematically, so equal accuracy is not
equal strength. The 95% range maps the bootstrap interval of the mean through the same curve.

    python tools/ai-audit/ladder.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import OUT  # noqa: E402

ANCH = {"sf1320": 1320, "sf1600": 1600, "sf1900": 1900, "sf2200": 2200, "sf2500": 2500}


def equiv(cpl, pts):
    """pts: [(cpl, elo)] for the anchors. Returns an Elo, or a string when outside the anchored range."""
    pts = sorted(pts)                       # ascending cpl, i.e. descending Elo
    if cpl <= pts[0][0]:
        return ">%d" % pts[0][1]
    if cpl >= pts[-1][0]:
        return "<%d" % pts[-1][1]
    for (c1, e1), (c2, e2) in zip(pts, pts[1:]):
        if c1 <= cpl <= c2:
            f = (math.log(cpl) - math.log(c1)) / (math.log(c2) - math.log(c1))
            return round(e1 + f * (e2 - e1))


def main():
    s = json.load(open(os.path.join(OUT, "accuracy-summary.json"), encoding="utf-8"))["players"]
    # anchors are noisy and not strictly monotone (1900 vs 2200 are close), so enforce monotone by using their order
    pts = [(s[k]["mean_cpl"], e) for k, e in ANCH.items()]
    print("anchors (mean cpl -> nominal Stockfish Elo): " + ", ".join("%.1f -> %d" % p for p in sorted(pts)))
    out = {}
    for t in ("easy", "medium", "hard"):
        m, (lo, hi) = s[t]["mean_cpl"], s[t]["ci"]
        e = equiv(m, pts)
        e_lo, e_hi = equiv(hi, pts), equiv(lo, pts)       # a higher cpl is a lower Elo
        out[t] = {"mean_cpl": m, "elo_equivalent": e, "range": [e_lo, e_hi]}
        print("%-7s mean cpl %.1f (%.1f-%.1f) -> accuracy-equivalent Elo %s (range %s to %s)" % (t, m, lo, hi, e, e_lo, e_hi))
    with open(os.path.join(OUT, "ladder.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
