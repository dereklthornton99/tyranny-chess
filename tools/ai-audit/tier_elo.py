"""One Elo per tier from all of its games against Stockfish anchors, by maximum likelihood.

Each game is a score s in {0, 0.5, 1} against an anchor of nominal Elo A; the tier's rating R maximises
sum s*ln(E) + (1-s)*ln(1-E) with E = 1 / (1 + 10 ** ((A - R) / 400)). A lopsided result (score 0.95) carries little
information and the likelihood says so, where a per-anchor Elo difference would not. The 95% range is where the
log-likelihood is within 1.92 of its peak; treating a draw as half a win makes that range slightly conservative.
Anchors are Stockfish's UCI_Elo values, which its own source ties to CCRL Blitz ratings, so this is Stockfish's scale,
not Lichess, chess.com or FIDE.

    python tools/ai-audit/tier_elo.py                  every game on file; writes _context/ai-audit/tier-elo.json
    python tools/ai-audit/tier_elo.py PREFIX           only games whose match name starts with PREFIX (e.g. final-, so the tiers
                                                       as retuned are not mixed with the audit's games of the old tiers);
                                                       writes tier-elo-PREFIX.json
"""
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_lib import OUT, jwrite  # noqa: E402


def loglik(R, games):
    ll = 0.0
    for a, s in games:
        e = 1 / (1 + 10 ** ((a - R) / 400))
        e = min(max(e, 1e-9), 1 - 1e-9)
        ll += s * math.log(e) + (1 - s) * math.log(1 - e)
    return ll


def fit(games):
    grid = [r for r in range(600, 3400, 2)]
    lls = [loglik(r, games) for r in grid]
    best = max(lls)
    r_hat = grid[lls.index(best)]
    inside = [r for r, l in zip(grid, lls) if l >= best - 1.92]
    return r_hat, min(inside), max(inside)


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else ""
    games = []
    for f in sorted(glob.glob(os.path.join(OUT, "games-*.jsonl"))):
        with open(f, encoding="utf-8") as fh:
            games += [g for g in (json.loads(x) for x in fh if x.strip()) if g["name"].startswith(prefix)]
    out = {}
    for tier in ("easy", "medium", "hard"):
        gs = [(int(g["opp"][2:]), g["js_score"]) for g in games if g["tier"] == tier and g["opp"].startswith("sf")]
        if not gs:
            continue
        r, lo, hi = fit(gs)
        by = {}
        for a, s in gs:
            d = by.setdefault(a, [0, 0, 0])
            d[0 if s == 1 else (1 if s == 0.5 else 2)] += 1
        out[tier] = {"elo": r, "range": [lo, hi], "games": len(gs), "by_anchor": {str(a): {"w": d[0], "d": d[1], "l": d[2]} for a, d in sorted(by.items())}}
        print("%-7s %4d on Stockfish's scale (95%% range %d to %d) from %d games: %s" % (
            tier, r, lo, hi, len(gs), "; ".join("vs %d: +%d =%d -%d" % (a, d[0], d[1], d[2]) for a, d in sorted(by.items()))))
    jwrite(os.path.join(OUT, "tier-elo-%s.json" % prefix.rstrip("-") if prefix else "tier-elo.json"), out)


if __name__ == "__main__":
    main()
