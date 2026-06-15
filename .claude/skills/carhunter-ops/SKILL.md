---
name: carhunter-ops
description: >-
  Deploy, run, and troubleshoot CarHunter — the self-running app that scrapes
  KSL Cars for undervalued private-party vehicles, scores them for wholesale
  profit, and surfaces deals. Use this skill when asked to: get CarHunter live,
  make the KSL scraper work (including Bright Data proxy / bot-bypass), deploy
  the backend (Convex) or frontend (Vercel), set up scheduled scraping
  (Daytona + crons), seed data, populate the feed with live listings, or
  diagnose why scraping / deploys / the live URL are failing. Repo:
  toxictrapkid/ssfinal, branch claude/eager-gates-de2pwu.
---

# CarHunter — Operations Skill

CarHunter finds undervalued **private-party** cars on **KSL Cars**, scores each
against a wholesale buy-box (estimated resale value − asking price − recon −
fees), ranks them, flags deals ≥ $1,500 profit as HOT, and surfaces every
"mechanic special" (broken/needs-engine cars) for manual review. The product is
a reactive ranked deal feed plus a pipeline board. It is built and shipped —
your job is operating and deploying it, not rebuilding it.

Repo: `toxictrapkid/ssfinal`, branch `claude/eager-gates-de2pwu`. Read
`PROGRESS.md` (loop memory + every standing user override), `ARCHITECTURE.md`
(full design), and `README.md` (setup) before making changes.

## Goal / north star (read this first)

The user is a **wholesale car buyer leaving the auctions**. The single biggest
problem in that business is **finding undervalued private-party cars before
anyone else** — that is the one job CarHunter must do perfectly. Everything
else serves the ranked deal feed.

Definition of done (from `VISION.md`) — the app is finished when all of these
are true with zero human action after setup:

1. Open the app → the seeded buy-box scans are **already running on a schedule**
   (every 15 min, around Salt Lake City 84104, 150-mile radius).
2. A live, **ranked feed of private-party cars**: photo, year/make/model+trim,
   miles, asking price, estimated resale value, **estimated profit**, deal
   score (0–100), source, distance, days listed, link.
3. Any car with **estProfit ≥ $1,500** is flagged HOT and an email/SMS alert
   fires the moment it lands — once per car unless its price drops.
4. **Pursue / Pass / Contacted** buttons work; pursued cars move to a pipeline
   board (Lead → Contacted → Negotiating → Bought → Flipped → Dead) with
   suggested target-buy and walk-away numbers.
5. Price drops, relists, and gone/sold are tracked automatically; **one row per
   real car** across sources (dedupe).
6. The user **never opens a scraper, terminal, or database.**

**Current state:** CarHunter is **built and shipped** — all 11 milestones
(architecture → schema → scrapers → ingest → scoring → scheduler → dashboard →
alerts → polish → end-to-end) are complete and were each independently reviewed,
and the full VISION chain was verified end to end (scheduled scan → scrape →
ingest → score → HOT deal in the feed → alert) using fixture data. **The only
gap between "shipped" and "live with real cars today" is getting a real KSL
scrape to flow** — which is blocked from the Claude web sandbox by network
egress (see next section) and, on a real machine, may need the Bright Data
proxy to get past KSL bot protection. **Your job as the operating agent: get
real KSL listings flowing into a deployment, scored and ranked, with a URL the
user can open — without rebuilding anything.**

## The single most important constraint

CarHunter was built inside the Claude Code web sandbox, whose **network egress
is allowlisted**. By default only package registries (npm, PyPI) and GitHub are
reachable. **`cars.ksl.com`, `app.daytona.io`, `*.convex.cloud`/`*.convex.dev`,
`api.brightdata.com`, Vercel, and essentially every other host return HTTP 403
"Host not in allowlist."** This means:

- You **cannot** scrape KSL, deploy to Convex Cloud, reach Daytona, or test
  Bright Data **from inside a default Claude web session.** Verify with
  `curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://cars.ksl.com`.
- The egress policy is **applied when a session starts**, so editing the
  environment's network allowlist mid-session does nothing — a **new session**
  is required. To allow hosts: claude.ai/code → environment selector (on the
  "new task" screen, not inside a session) → gear/settings → Network access →
  Custom → add `app.daytona.io`, `download.daytona.io`, `cars.ksl.com`,
  `img.ksl.com`, and (for Convex Cloud) `*.convex.cloud`, `*.convex.dev`,
  `*.convex.site` → keep "include default package managers" checked.
- **Therefore: all live network operations run on the user's own machine** (or
  a freshly-started, properly-allowlisted environment). When a live action
  can't run from here, say so plainly, verify the block with a curl, and hand
  the user the exact command to run on their machine. Do not claim a URL works
  without curling it yourself.

A self-hosted Convex backend (the `convex-local-backend` binary from Convex's
GitHub releases) was used during the build because Convex Cloud was unreachable;
its data lives in `/tmp/convex-data` and the process dies between sessions —
restart it from the GitHub-release binary if you need a local backend.

## Architecture in one screen

```
crons.ts (every 1 min) ─► searches due? ─► daytona.ts runSearchInSandbox
                                              │  (Daytona sandbox, prod only)
                                              ▼
            scrapers/run.py ─► ksl.py (KSL JSON API, optional Bright Data proxy)
                            ─► parse.py (normalize §5 shape, dealer hard-filter)
                            ─► POST /ingest  (http.ts, X-Ingest-Secret)
                                              ▼
   listings.upsertFromScrape (dedupe by VIN/sha1, priceHistory, status)
                                              ▼
   scoring.scoreListing  ─► comps (MarketCheck cache→curve) ─► recon (partsCosts
                            median + labor, or §4 keyword bumps) ─► profit/score/hot
                                              ▼
   alerts.sendHotAlert (Resend/Twilio, or "log" channel when keyless)
                                              ▼
   web/ (React+Vite+Tailwind) — reactive feed/specials/pipeline/searches/settings
```

Stack (fixed): Convex (DB, crons, server functions, reactive queries, /ingest),
Daytona (scraper sandboxes, prod), Playwright (only for the deferred Facebook
source — KSL is requests-only), React+Vite+Tailwind, TypeScript everywhere
except the Python scrapers.

## Standing user overrides (these supersede the original spec — honor them)

- **KSL-only.** Facebook Marketplace is deferred; `scrapers/facebook.py` is a
  `ScraperDisabled` stub. The schema stays multi-source.
- **Arbitrage scans, not make/model buy-boxes.** The seeded searches are 3
  broad all-makes private-party price-band scans ($500–8k, $8k–16k, $16k–28k),
  not the original 7 YMM buy-boxes (those are seeded-but-deactivated). The
  scoring engine is the arbitrage finder; nothing in scoring is make-specific.
- **Surface everything; never pre-filter a deal.** Title status, mileage, and
  year are ranking signals, never gates. The only hard filter is
  private-party-only (dealers dropped in `parse.py`). Every drivetrain-issue
  car is flagged `mechanicSpecial` and alerts regardless of computed profit.
- **No additional access by default.** Alerts fall back to a logged "log"
  channel without Resend/Twilio keys; valuation falls back to a flagged
  depreciation curve (amber, never HOT) without MarketCheck comps.

## How the KSL scraper actually works

KSLHax (the reference) and CarHunter's `scrapers/ksl.py` use **plain Python
`requests` — no browser, no Selenium, no Playwright, no login.** It POSTs to
KSL's internal JSON API:

- URL: `https://cars.ksl.com/nextjs-api/proxy?`
- Body wraps endpoint `/classifieds/cars/search/searchByUrlParams`, with the
  search broken into URL path segments + `perPage:24, page:N, es_query_group:null`.
- Headers: `User-Agent: cars-node`, `X-App-Source: frontline`, a few
  `X-DDM-EVENT-*` headers, `cookie: ""` (empty — no auth). No Referer is sent
  (the reference computes one but never sends it; match that).
- Returns `data.items` as structured JSON — no HTML parsing.

The only untested-against-live risk: KSL may have changed this endpoint or added
bot protection since ~2023. If a live call 403s, it is almost always a
header/IP issue, fixed by routing through a proxy (below).

### Bright Data proxy / bot-bypass (built in)

`scrapers/ksl.py` routes through any proxy when `KSL_PROXY_URL` is set — use
Bright Data **Web Unlocker** (zone, proxy mode) to bypass KSL blocking:

```bash
export KSL_PROXY_URL="http://brd-customer-<id>-zone-web_unlocker2:<PASSWORD>@brd.superproxy.io:33335"
export KSL_PROXY_INSECURE=1     # Web Unlocker terminates TLS, so skip cert verify
```

Proxy mode needs the zone's **proxy password** (dashboard → zone → Access
parameters), not the account API Bearer key. The API-mode curl
(`api.brightdata.com/request`) uses the same zone via a different access
method; proxy mode is the drop-in for the app. If only the API key is
available, `ksl.py` would need API-mode support added (POST the KSL request
through `api.brightdata.com/request`).

## Deployment paths — pick by goal

### Path A — See it live on the user's machine (fastest)

```bash
git clone https://github.com/toxictrapkid/ssfinal.git && cd ssfinal
git checkout claude/eager-gates-de2pwu
npm install
pip install -r scrapers/requirements.txt
npx convex dev --once            # browser login; provisions a Convex deployment, pushes functions
bash scripts/go_live_local.sh    # seeds + SCRAPES KSL LIVE + ingests today's cars
cd web && npm install && npm run dev   # open http://localhost:5173
```

`scripts/go_live_local.sh` auto-detects the deployment from `.env.local`, seeds
settings + scans + partsCosts, sets `INGEST_SECRET`, writes `web/.env.local`,
and runs a live KSL scrape into the deployment. Add `KSL_PROXY_URL` /
`KSL_PROXY_INSECURE` to its environment first if KSL blocks the direct call.

### Path B — Public URL (Convex Cloud backend + Vercel frontend)

Backend is already on Convex Cloud after Path A's `npx convex dev`. For the
frontend, `vercel.json` is committed at the repo root (verified build):

- Build command: `npm install && cd web && npm install && npm run build`
- Output: `web/dist`
- It builds **from the repo root on purpose** — `web/` imports the `convex`
  package and `../convex/_generated` from one level up, so a web-only root
  directory breaks the build. Do not override Vercel's Root Directory.

Steps: import `toxictrapkid/ssfinal` at vercel.com (or `vercel --prod` from the
repo root), set one env var **`VITE_CONVEX_URL = https://<deployment>.convex.cloud`**
(build-time; Vite inlines it), deploy. The feed is empty until the Convex
deployment has listings — run Path A's scrape (or Path C's schedule) to fill it.
Note: v0 will say "No Dev Script Found" if pointed at an old snapshot — the root
`package.json` now has `dev`/`build` scripts that delegate to `web/`; re-sync.

### Path C — Full production automation (scheduled scraping via Daytona)

`scripts/deploy_production.sh` runs `convex deploy` + seeds, then prints the
remaining manual steps:

1. Set deployment env vars: `INGEST_SECRET`, `INGEST_URL`
   (`https://<deployment>.convex.site/ingest`), `DAYTONA_API_KEY`, optionally
   `MARKETCHECK_KEY`/`RESEND_KEY`/`TWILIO_*`, and `KSL_PROXY_URL`/
   `KSL_PROXY_INSECURE` so the sandbox scrapes through Bright Data.
2. Build + register the Daytona snapshot named **`carhunter-scraper`** from
   `scrapers/Dockerfile`:
   `docker build -t carhunter-scraper -f scrapers/Dockerfile . && daytona snapshot create carhunter-scraper --image carhunter-scraper`
3. Deploy `web/` (Path B).

After that, `crons.ts` dispatches due searches every minute; each of the 3 scans
fires every 15 min, spawns a sandbox, scrapes, ingests, and is torn down — zero
human action. In-container (no Daytona) the equivalent runner is
`python3 scripts/dispatch_local.py --once` (use `--items-file` for fixtures
when KSL is unreachable).

## Environment variables (full list)

| Var | Where | Purpose |
|---|---|---|
| `INGEST_SECRET` | Convex deployment | shared secret for POST /ingest |
| `INGEST_URL` | Convex deployment | public `.convex.site/ingest` URL (Daytona path) |
| `DAYTONA_API_KEY` | Convex deployment | scraper sandboxes |
| `MARKETCHECK_KEY` | Convex deployment | live retail comps (else flagged curve) |
| `RESEND_KEY` | Convex deployment | email alerts (else "log" channel) |
| `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`FROM` | Convex deployment | SMS alerts |
| `KSL_PROXY_URL` | scraper env | route KSL through a proxy (Bright Data) |
| `KSL_PROXY_INSECURE` | scraper env | `1` to skip TLS verify (Web Unlocker) |
| `VITE_CONVEX_URL` | web build (Vercel) | which Convex deployment the UI talks to |

Secrets live in untracked `.env.local` / Convex env / deploy host — never
committed. Treat any pasted deploy key, API key, or proxy password as
sensitive; advise rotation if exposed in chat.

## Verification — how to know it works

- Unit/integration tests (no network): `npm run test:unit` (66 vitest) and
  `python3 -m pytest scrapers/tests/ -q` (61 + 1 skip). `cd web && npm run build`
  must be clean; `cd web && npx playwright test` runs 6 e2e against a live
  backend + dev server.
- **Live KSL isolation test** (the definitive check, run on the user's machine):
  ```bash
  KSL_PROXY_URL="..." KSL_PROXY_INSECURE=1 python3 scrapers/ksl.py \
    --config '{"makes":[],"models":[],"zip":"84104","radiusMiles":150,"priceMin":2000,"priceMax":28000,"cleanTitleOnly":false}'
  ```
  Prints a JSON array of cars → KSL flowing. `407` → proxy auth wrong. `403` +
  KSL text → KSL still blocking (switch zone to Web Unlocker / add country).
  SSL error → drop `KSL_PROXY_INSECURE` or fix the port.
- Feed/data: `npx convex run listings:stats`, `npx convex run listings:feed '{"limit":20}'`,
  `npx convex run partsCosts:lookup '{"year":2017,"make":"GMC","model":"Terrain","part":"Engine"}'`.
- Force the schedule now (don't wait 15 min): `npx convex run debug:clearSearchRuns`
  then `python3 scripts/dispatch_local.py --once` (add `--items-file scrapers/tests/fixtures/ksl_items.json` if KSL unreachable).

## Troubleshooting playbook

- **`cars.ksl.com` / `app.daytona.io` / Convex / Bright Data return 403 "Host
  not in allowlist"** → the Claude web sandbox egress block. Not fixable
  in-session; run on the user's machine or a new allowlisted session.
- **Live KSL 403 (real KSL response, not the allowlist message)** → KSL bot
  protection. Set `KSL_PROXY_URL` to a Bright Data Web Unlocker zone.
- **Proxy `407`** → wrong proxy username/password; use the zone's proxy
  credentials, not the API Bearer key.
- **`go_live_local.sh` "No Convex deployment found"** → repo not linked; run
  `npx convex dev --once` (choose the existing project), or
  `export CONVEX_DEPLOY_KEY='dev:<name>|...'` + `echo 'CONVEX_DEPLOYMENT=dev:<name>' > .env.local`.
- **Vercel build "Cannot find module convex/_generated/api"** → Root Directory
  got set to `web/`; reset to repo root so `../convex` is in the build context
  (the committed `vercel.json` already does this).
- **Vite build "useMemo/useState not exported by …react:convex"** → duplicate
  React; `web/vite.config.ts` has `resolve.dedupe: ["react","react-dom"]` and
  `web/` deliberately does not list `convex` as a dep (resolves from root).
- **v0 "No Dev Script Found"** → re-sync the repo; root `package.json` now has
  `dev`/`build`. v0 is Next-oriented; prefer Vercel's GitHub import for this
  Vite+Convex monorepo.
- **Feed empty but app loads** → the Convex deployment has no listings; run a
  scrape. Expected, not a deploy bug.
- **Convex backend (local self-hosted) unreachable on 127.0.0.1:3210** → it
  died between sessions; restart `convex-local-backend` with the instance
  secret from `.env.local`, data is in `/tmp/convex-data`.

## Key files

- `convex/schema.ts` — §3 schema + partsCosts + scoring-provenance fields.
- `convex/scoring.ts` + `convex/lib/{scoreMath,reconRules,depreciationCurve,marketcheck}.ts`
  — the §4 engine (weights 45/20/15/10/10, hot ≥ $1,500, salvage/rebuilt =
  0.70 × clean comp, AWD +3%, ±$0.06/mi; recon = partsCosts median + $1,300
  engine / $900 trans labor, else §4 keyword bumps).
- `convex/listings.ts` — upsert/dedupe (`lib/dedupe.ts`: VIN else
  sha1(year|make|model|round(mileage,-3)|zip3)), `feed`, `setDecision`.
- `convex/{crons,daytona,http,alerts,comps,partsCosts,searches,seed,pipeline,settings,debug}.ts`.
- `scrapers/{ksl,parse,run,facebook}.py`, `scrapers/Dockerfile`, `scrapers/tests/`.
- `scripts/{go_live_local,deploy_production,seed_partscosts}.sh`,
  `scripts/{dispatch_local,build_car_brands}.py`, `scripts/build_partscosts.mjs`.
- `web/` (React app), `vercel.json`, `data/carpart_prices.csv` (parts prices).

## Operating rules (do not violate)

Private-party only (dealers hard-filtered). Never store a Facebook password
(session cookie from settings only). In production, scrapers run only in Daytona
sandboxes, torn down after each run. The app finds and ranks; it never contacts
sellers or moves money. Never change the spec numbers (margin 1500, fees 400,
weights 45/20/15/10/10, the §5 dedupe key) without recording it. Always verify a
live claim with a curl/run before reporting it works.
