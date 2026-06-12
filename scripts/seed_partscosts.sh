#!/usr/bin/env bash
# Seed the partsCosts table from data/carpart_prices.csv.
# Requires a reachable Convex deployment (CONVEX_SELF_HOSTED_URL/.env.local or convex dev).
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/build_partscosts.mjs

ok=0
fail=0
for f in data/.partscosts_batches/batch_*.json; do
  if npx convex run partsCosts:seedBatch "$(cat "$f")" >/dev/null; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
    echo "FAILED batch: $f" >&2
  fi
done
echo "partsCosts seed: $ok batches ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
npx convex run partsCosts:stats
