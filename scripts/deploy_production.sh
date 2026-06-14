#!/usr/bin/env bash
# One-time production deploy for CarHunter: pushes the backend to Convex Cloud,
# seeds it, and prints the env vars + Daytona snapshot steps you still need.
# Run from the repo root on a machine with internet (Convex + Daytona reachable).
#
#   bash scripts/deploy_production.sh
#
# Prereqs: Node 20+, a Convex account (`npx convex login` once), a Daytona
# account + API key, Docker (for the scraper snapshot).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/3  Deploying backend (schema, functions, crons, /ingest) to Convex Cloud"
npx convex deploy

echo
echo "==> 2/3  Seeding settings, the market scans, and partsCosts (~1,226 keys)"
npx convex run seed:run
bash scripts/seed_partscosts.sh

echo
echo "==> 3/3  Manual steps left (need values only you have):"
cat <<'STEPS'

  a) Set deployment env vars (Convex dashboard → Settings → Environment Variables,
     or `npx convex env set NAME value`):
        INGEST_SECRET     = $(openssl rand -hex 24)         # any long random string
        INGEST_URL        = https://<your-deployment>.convex.site/ingest
        DAYTONA_API_KEY   = dtn_...                         # your Daytona key
     optional: MARKETCHECK_KEY, RESEND_KEY, TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM
     (Find <your-deployment> with `npx convex env get CONVEX_CLOUD_URL` or the dashboard.)

  b) Build + register the Daytona scraper snapshot named "carhunter-scraper":
        docker build -t carhunter-scraper -f scrapers/Dockerfile .
        daytona snapshot create carhunter-scraper --image carhunter-scraper
     (or push the image to a registry Daytona can pull and create the snapshot from it)

  c) Deploy the web frontend:
        cd web
        echo "VITE_CONVEX_URL=https://<your-deployment>.convex.cloud" > .env.local
        npm run build
        # deploy ./web/dist to Vercel / Netlify / any static host

Once (a) and (b) are in place, the per-minute cron starts spawning a sandbox
for each due scan every 15 minutes — no further action.
STEPS
