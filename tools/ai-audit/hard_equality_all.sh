#!/bin/bash
# Runs hard_equality.js as 6 shards in parallel and totals them. Exit status 0 only if every shard found no mismatch.
cd "$(dirname "$0")/../.." || exit 1
N=6
for k in $(seq 0 $((N-1))); do node tools/ai-audit/hard_equality.js $k $N > "${TMPDIR:-/tmp}/hard-eq-$k.json" & done
wait
python - <<'PYEOF'
import json, os, sys
tmp = os.environ.get("TMPDIR", "/tmp")
tot = bad = 0
ex = []
for k in range(6):
    p = os.path.join(tmp, "hard-eq-%d.json" % k)
    r = json.loads(open(p, encoding="utf-8").read().strip().splitlines()[-1])
    tot += r["checked"]; bad += r["mismatches"]; ex += r["examples"]
print("Hard equality: %d searches compared, %d mismatches" % (tot, bad))
for e in ex[:5]: print("  ", e)
sys.exit(1 if bad else 0)
PYEOF
