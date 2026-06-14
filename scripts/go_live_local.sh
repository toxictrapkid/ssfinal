#!/usr/bin/env bash
# Scrape KSL LIVE from your own machine and push today's real listings into your
# Convex deployment, so the dashboard fills with cars scraped right now.
#
# Run order (from the repo root):
#   1. npm install  &&  pip install -r scrapers/requirements.txt
#   2. terminal A:  npx convex dev          # logs in, provisions, pushes, WATCHES — leave running
#   3. terminal B:  bash scripts/go_live_local.sh
#   4. terminal B:  cd web && npm install && npm run dev   # open http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> locating your Convex deployment"
URL=""
if [ -f .env.local ]; then
  URL=$(grep -E '^(VITE_CONVEX_URL|CONVEX_URL|CONVEX_CLOUD_URL)=' .env.local | head -1 | cut -d= -f2- | tr -d "\"'")
  if [ -z "$URL" ]; then
    DEP=$(grep -E '^CONVEX_DEPLOYMENT=' .env.local | head -1 | cut -d= -f2- | tr -d "\"'")
    DEP="${DEP#dev:}"; DEP="${DEP#prod:}"
    [ -n "$DEP" ] && URL="https://${DEP}.convex.cloud"
  fi
fi
[ -n "$URL" ] || { echo "!! No Convex deployment found. Run 'npx convex dev' first (terminal A)."; exit 1; }
INGEST_URL="${URL/.cloud/.site}/ingest"
echo "    deployment: $URL"
echo "    ingest:     $INGEST_URL"

echo "==> seeding settings, market scans, and ~1,226 used-part price keys (idempotent)"
npx convex run seed:run >/dev/null
bash scripts/seed_partscosts.sh >/dev/null
echo "    seeded."

echo "==> setting the /ingest shared secret on the deployment"
SECRET=$(openssl rand -hex 24)
npx convex env set INGEST_SECRET "$SECRET" >/dev/null
echo "    set."

echo "==> pointing the web app at this deployment"
echo "VITE_CONVEX_URL=$URL" > web/.env.local
echo "    wrote web/.env.local"

echo "==> SCRAPING KSL LIVE (this hits cars.ksl.com right now) ..."
python3 scrapers/run.py --config "{\"sources\":[\"ksl\"],\"makes\":[],\"models\":[],\"zip\":\"84104\",\"radiusMiles\":150,\"priceMin\":2000,\"priceMax\":28000,\"cleanTitleOnly\":false,\"ingestUrl\":\"$INGEST_URL\",\"ingestSecret\":\"$SECRET\"}"

echo
echo "==> done. Open the dashboard:   cd web && npm install && npm run dev   -> http://localhost:5173"
echo "    (Listings appear scored/ranked. HOT flags need a MarketCheck key — without it,"
echo "     values use the fallback curve, shown amber, and never auto-alert.)"
