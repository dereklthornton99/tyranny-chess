#!/bin/bash
# Runs tyranny_ladder.js as 6 shards in parallel and totals the three pairings.
cd "$(dirname "$0")/../.." || exit 1
N=6
for k in $(seq 0 $((N-1))); do node tools/ai-audit/tyranny_ladder.js $k $N > "${TMPDIR:-/tmp}/tyr-ladder-$k.json" & done
wait
python - <<'PYEOF'
import json, os
tmp = os.environ.get("TMPDIR", "/tmp")
tot = {}
for k in range(6):
    r = json.loads(open(os.path.join(tmp, "tyr-ladder-%d.json" % k), encoding="utf-8").read().strip().splitlines()[-1])
    for pair, d in r["results"].items():
        t = tot.setdefault(pair, {"w": 0, "d": 0, "l": 0})
        for x in "wdl": t[x] += d[x]
for pair, d in tot.items():
    n = d["w"] + d["d"] + d["l"]
    print("Tyranny rules, %-14s %2d games: +%d =%d -%d  score %.2f" % (pair, n, d["w"], d["d"], d["l"], (d["w"] + 0.5 * d["d"]) / n))
PYEOF
