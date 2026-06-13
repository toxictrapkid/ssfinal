# PROGRESS.md — Loop memory (append only)

STATUS: IN_PROGRESS
<!-- The loop stops only when this line reads: STATUS: SHIPPED -->

## Milestones

- [x] M0 — ARCHITECTURE.md written + Reviewer-approved ✅ (cycle 1, 2026-06-12)
- [x] M1 — Convex schema pushed + settings/buy-box seeded ✅ (cycle 2, 2026-06-12)
- [x] M2 — parse.py + fixture tests green ✅ (cycle 3, 2026-06-12)
- [x] M3 — ksl.py emits normalized JSON (FB deferred stub per override) ✅ (cycle 4, 2026-06-12)
- [x] M4 — /ingest + upsert/dedupe/price-history working ✅ (cycle 5, 2026-06-12)
- [x] M5 — scoring engine: §4 formula + MarketCheck MCP comps + 0.70 salvage rule + partsCosts recon ✅ (cycle 6, 2026-06-12)
- [x] M6 — Daytona runner + crons firing on schedule ✅ (cycle 7, 2026-06-12)
- [x] M7 — dashboard (feed, builder, pipeline, settings, drawer) ✅ (cycle 8, 2026-06-12)
- [x] M8 — alerts (Resend/Twilio) with dedupe ✅ (cycle 9, 2026-06-12)
- [x] M9 — polish, mobile pass, README ✅ (cycle 10, 2026-06-13)
- [ ] FINAL — end-to-end gate in VISION.md

## Standing user overrides (in addition to RULES.md #3/#3a/#3b)

- **2026-06-12 — KSL-ONLY SCOPE.** User: "focus on the ksl portion, i dont want to have to give
  access to anything else." Facebook Marketplace scraping is DEFERRED: no FB cookie will be
  provided. Architecture stays multi-source (sources ["ksl","facebook"] supported in schema),
  but every gate that said "both sources" runs against KSL only. facebook.py reuse notes are
  preserved below for when FB is re-enabled. Seeded searches use sources:["ksl"].
- **2026-06-12 — Secrets provided:** DAYTONA_API_KEY in untracked .env.local (never committed).
  No Resend/Twilio/MarketCheck REST keys will be provided — alerts use a transport abstraction
  (in-app logged channel when no key), valuation uses MarketCheck MCP in the harness + comps cache.

- **2026-06-12 — ARBITRAGE SCANS, NOT MAKE/MODEL SEARCHES.** User: "do not search for make and
  models — identify opportunity of arbitrage." Supersedes §2's seven YMM buy-box searches as
  the SEEDED strategy: seeds become broad all-makes FSBO scans (price-banded for pagination
  coverage: $2k–$12k clean, $12k–$28k clean, plus a $2k–$12k mechanic-special/branded-title
  scan with year widened to 2012 to match partsCosts coverage). The scoring engine IS the
  arbitrage finder — estProfit ranks the whole market; nothing in scoring is make-specific.
  The legacy 7 YMM searches are deactivated, not deleted (re-enable any in the Search Builder).
  Honest limit: with no MarketCheck REST key, HOT alerts fire only for comp-cached YMM+buckets
  (operator/MCP-seeded); everything else values via the flagged curve (amber, never hot).

- **2026-06-12 — SURFACE EVERYTHING; NEVER PRE-FILTER A DEAL AWAY.** User (three messages):
  "every mechanic special I will manually review please provide it to me and also any other
  deals dont over think it — we are here to get deals not turn them away" / "I will never see
  a deal if you filter it out before and I never see it" / "build the entire UI and UX as
  needed to make this an easy to use and friendly tool". Implemented as:
  (a) seeds are now 3 price-band-only market scans ($2k–8k / $8k–16k / $16k–28k), all makes,
  all titles, all years, all mileages — title/mileage/year are ranking signals, never gates;
  (b) `mechanicSpecial` flag computed at scoring; specials ALERT regardless of computed
  profit (reason "mechanic_special") with the same once-per-car dedupe, and are never hidden
  by recon math — the human rules, the math informs; (c) the only remaining hard filter is
  private-party-only (user's own RULES #4); (d) M7 builds the complete UI with
  show-everything defaults and a Mechanic Specials view.

## Reference-code reuse map
<!-- Cycle 1 fills this: file → what we take from it -->

### KSLHax-1.2 (PRIMARY — KSL engine)
- `hax.py:requestCars()` → **REUSE** as core of `scrapers/ksl.py`. KSL's internal JSON API:
  POST `https://cars.ksl.com/nextjs-api/proxy?` with body `{endpoint:"/classifieds/cars/search/
  searchByUrlParams", options:{method:"POST", body:[...url segments..., "perPage",24,"page",N,
  "es_query_group",null]}}`. Headers: UA + Content-Type json + Host/Origin cars.ksl.com.
  Returns `data.items` — structured JSON, no HTML parsing.
- `hax.py:main_url` → **REUSE** the search-URL segment grammar: `make/A;B/model/X;Y/mileageTo/N/
  priceTo/N/zip/Z/miles/R/priceFrom/N/titleType/Clean+Title/yearFrom/Y` → searchConfig→segments builder.
- `hax.py:requestAllCars()` → **REFACTOR**: pagination until empty page; add retry/backoff,
  structured logging, max-page cap (original: bare asserts, no retries, print()).
- `data_types/car.py` Car dataclass → **REUSE** as the KSL response field map for `parse.py`:
  price, makeYear, mileage, titleType, vin, sellerType ("Dealership"|"For Sale By Owner") ← dealer
  hard-filter, zip/city/state, photo id, createTime/displayTime (ms epoch → daysListed), trim,
  model, make, id → sourceListingId.
- `assets/new_score_method.py` `__score__(car)` harness → **REUSE** as the seed of `convex/scoring.ts`
  per spec §4 (per-attribute adjustments → weighted formula; None-return → filter-out semantics).
- `hax.py:remove_duplicates/mark_new/mark_old` → **DROP** (file-based state superseded by Convex
  upsert/dedupeKey/priceHistory in `listings.upsertFromScrape`).
- customtkinter GUI, ResourceManager file cache, error_window, PaginationHelper, build.bat → **DROP**
  (replaced by React dashboard, Convex reactive queries, structured logging).

### facebook-marketplace-scraper-1.1.0 (FB DEFERRED; two pieces reused now)
- `web/js/car-brands.js` (1069-line make/model dictionary) → **REUSE NOW** in `scrapers/parse.py`
  for title → make/model extraction (needed for KSL titles too; no FB access required).
- `search.py` mileage parsing ("23K"→23000) + include/exclude term filters → **REUSE NOW** in parse.py.
- `scraper.py` human-like randomized scroll loop, card inner_text parse w/ price-shift logic, CDP
  viewport override → **REUSE LATER** (FB re-enable), persistent-context swapped for cookie injection.
- SQLite listings.db, eel UI, SMTP notify → **DROP** (Convex, React, alerts.ts).

### scrape_marketplace.py (FB DEFERRED — re-enable notes)
- storage_state session reuse (cookie, never password), `abort_requests` image/media blocking,
  marketplace search-URL query-param builder → **REUSE LATER** in facebook.py.

### carpart_scraper.py (repo root, pre-existing)
- Generated `data/carpart_prices.csv` (~6,963 rows, Grade-A <100k used engine/trans prices,
  2012–2023). **KEEP** as data provenance; not app runtime. CSV seeds `partsCosts` at M1.

## Reviewer advisories carried forward (from M0 PASS — address at the noted milestone)
- M2/M3: confirm KSL search API returns `description` (Car dataclass lacks it; recon keywords
  need it; if absent, add per-listing detail fetch before M5).
- FIRST LIVE RUN (M6 sandbox or post-allowlist; was "M3"): validate extended URL segments
  (mileageFrom, yearTo, sellerType/For+Sale+By+Owner) + segment-order insensitivity against
  live KSL — not all are in the reference main_url grammar. If a live 403 appears, suspect
  envelope drift first (Referer already removed for wire fidelity, M3 reviewer A1).
- M2: pin down where distanceMiles is computed (spec §5: location → distance from zip in parse.py).
- M4: relist rule — a "gone" listing that reappears flips back to "active" (VISION #5 tracks relists).
- M4: document the gone/sold conflation (no spec trigger for "sold").

## Current cycle plan
<!-- Overwritten each cycle: milestone, files to touch, gate command, predicted failures -->
CYCLE 10 — M9 EXECUTED (awaiting reviewer): polish + mobile/perf pass + README + optimizer.
Done: drawer focus trap; sr-only open affordance (kills nested-interactive + label-name
mismatch); no-rerender proof (perf.spec.ts MutationObserver); contrast→AA; data-id selectors;
feed cap indicator; README §10 (what-it-is, prereqs, fresh-clone setup, Daytona image build,
self-host notes, usage, scoring formula, tests, layout, constraints w/ carried notes).
GATES MET: Lighthouse mobile perf 99 / a11y 100 / best-practices 96 (contrast, label-name,
tap-targets all PASS); 6 Playwright e2e green incl. no-rerender; README has all §10 items;
fresh-clone smoke (git clone /tmp → npm install → 66 vitest + 61 pytest + web build clean).
Optimizer notes: bundle 300KB / 88.6KB gz (single chunk, fine for MVP); board/alerts queries
do per-row db.get joins (small tables — N rows, not N+1 over an index scan; documented, revisit
w/ pagination if tables grow); DealCard memo compares all painted fields (M7-A4). Feed pagination
(M7-A11) carried as a documented future item (cap indicator shipped).

PREV CYCLE 10 plan — M9 (Architect plan): polish + mobile/perf pass + README §10 + optimizer sweep.
Files: README.md (all §10 items + carried notes: Daytona key env-only, settings exposure,
pipeline archive, alert at-least-once-on-keyed, KSL-only state, in-container dispatcher,
snapshot build prerequisite); web: drawer focus trap (M7-A5), e2e data-id selectors (A8),
feed "showing first N" cap indicator (A11); no-rerender e2e (MutationObserver on unaffected
cards while one listing updates via /ingest); Lighthouse mobile run on the feed (playwright
chromium via CHROME_PATH; if the lighthouse npm pull fails, axe-style manual audit +
document); fresh-clone smoke (clone to /tmp, install, unit+pytest+build against running
backend); optimizer notes (bundle 89KB gz, N+1 audit of board/alerts joins — small tables,
documented).
Gate: Lighthouse mobile usability pass on feed; no re-render of unaffected cards on feed
update (observed, not claimed); README contains all §10 items; fresh-clone steps actually
work in a clean dir.
Predicted failures: lighthouse npm registry/chrome flags friction; MutationObserver test
flaky w/ skeleton → pin to stable card nodes; fresh-clone pip deps need --break-system-packages?

CYCLE 9 — M8 (Architect plan): alert delivery (Resend email / Twilio SMS) on the already-
verified dedupe spine. Files: convex/lib/alertTransports.ts (fetch-injectable Resend +
Twilio clients, retry/backoff, typed results), alerts.ts sendHotAlert (channel selection:
RESEND_KEY+alertEmail → email; TWILIO_SID/TOKEN/FROM+alertPhone → sms; keyless → log row —
no keys exist on this deployment by user directive), vitest envelope tests (auth headers,
endpoints, form encoding) + pure channel-selection tests.
Gate: hot listing triggers exactly one alert (verified M5/M6 — re-verify); same listing
does NOT re-alert unless price drops (live: drop hot Traverse below lastAlertPrice 17900 →
exactly ONE new alert row; rescore again → none); alert row logged (rows carry reason).
Predicted failures: Twilio form-encoding (not JSON — pin in test); double-channel duplicate
rows (one row per delivered channel is correct behavior — document).

CYCLE 8 — M7 (Architect plan): the complete dashboard (user directive: entire UI/UX,
easy + friendly). Backend additions per ARCHITECTURE API surface: searches CRUD,
listings.setDecision (pursue → pipeline row w/ Step-5 targetBuy/walkAway), listings.feed
filters (source/make/minProfit/minScore/maxDaysListed/specials-only/sort), pipeline.ts
(board/moveStage/setNumbers/setNotes), alerts.list. Web app (web/, React+Vite+Tailwind TS,
mobile-first bottom tabs): FeedView (ranked DealCards, HOT ribbon, amber flags, filter bar,
show-everything defaults), SpecialsView (mechanic-special review queue — the user's manual-
review surface), PipelineView (6-stage kanban, pointer-event drag + menu fallback),
SearchBuilderView (rows w/ lastRun/lastError/newDeals + form), SettingsView (margin/fees/
contacts/keys/cookie + alert log), DetailDrawer (photos, price-history sparkline, CompPanel,
ReconMathTable rendering breakdown LINES not reconSource label [M5-G], profit math,
target/walk-away). Loading/empty/error states everywhere; keyboard accessible; dark
dealer-tool theme, green=money red=risk amber=verify.
Gate: `npm run build` clean; Playwright e2e — feed renders ranked cards w/ profit+score,
Pursue moves card to pipeline Lead, drag between stages works (pointer-based DnD chosen for
e2e reliability over HTML5 dnd API).
Predicted failures: vite importing ../convex/_generated outside root (fs.allow + tsconfig);
Playwright browser download blocked by proxy (probe; fall back to system chromium if
present); drag e2e flakiness (pointer DnD + data-testid drop zones).
Files: convex/lib/sandboxDriver.ts (driver interface + DaytonaDriver via REST API using
DAYTONA_API_KEY env + LocalProcessDriver for in-container gate runs), convex/daytona.ts
(runSearchInSandbox action: config → create → exec run.py → teardown in finally → markRun;
concurrency cap 3), convex/crons.ts (per-minute due-search dispatch + daily markStale/comp
refresh). NO-ADDITIONAL-ACCESS directive: app.daytona.io is proxy-blocked, so the gate runs
on LocalProcessDriver (spawns scrapers/run.py locally against the dev backend with
--items-file) — proving dispatch→scrape→ingest→lastRunAt→teardown end-to-end in-container;
DaytonaDriver is code-complete for production. Failure isolation gate: one search with a
bad config (unknown source) fails its own row (lastError) without blocking siblings.
Gate: a due search fires → listings land via /ingest → lastRunAt updates → sandbox/process
torn down; bad-config search isolated. Predicted failures: Convex action runtime cannot
spawn processes ("use node" needed — Node actions support child_process? NO — Convex Node
actions can't spawn child processes reliably... fallback: LocalProcessDriver implemented as
an HTTP shim outside Convex, or gate via direct run.py invocation triggered by a tiny local
dispatcher script that polls listDue). Resolve during EXECUTE.
Files: convex/lib/scoreMath.ts (pure §4 formula + Step-5 numbers, vitest), convex/lib/
reconRules.ts (pure keyword classifier + parts-math, vitest), convex/lib/depreciationCurve.ts
(flagged fallback, vitest), convex/lib/marketcheck.ts (REST driver iff key set — none here),
convex/comps.ts (cache read/upsert + getOrFetchComp action), convex/scoring.ts (replace
placeholder: full §4 pass incl. salvage 0.70×clean override, AWD +3%, ±$0.06/mi vs bucket
midpoint, hot gate excludes curve comps), convex/alerts.ts (M8-shaped placeholder so hot
flow is wired), seed comps via MarketCheck MCP (operator path through comps:upsertComp —
no user access needed).
Gate: vitest known-input tests — estProfit/dealScore exact per §4; hot flips at exactly
estProfit≥1500; salvage/rebuilt = 0.70×clean-title comp; "needs engine" priced from
partsCosts median+1300; generic mechanic-special takes pricier component+its labor; comp +
recon source visible on the listing (live behavioral check on the dev deployment).
Predicted failures: MCP returns sparse comps for fixture YMMs near 84104 (widen radius /
fall back to national sample, flag sampleSize); float drift in score assertions (use exact
fractions); action→mutation patch shape vs schema validators.
Files: convex/lib/dedupe.ts (pure §5 dedupe key: vin else sha1(year|make|model|round(mileage,
-3)|zip3) — self-contained sha1, vitest-tested against sha1sum vectors), convex/listings.ts
(upsertFromScrape internal mutation: insert/price-drop/relist/touch + markStale 48h→gone +
feed/get/setDecision minimal), convex/http.ts (POST /ingest, X-Ingest-Secret vs INGEST_SECRET
env), convex/scoring.ts (M5 placeholder scoreListing — logs + no-op so the data flow is wired),
scrapers/run.py (multi-source orchestrator: sources→scrapers, skip-disabled, batch POST w/
retry; satisfies spec §9 step 4 "wire scrapers to POST"), vitest dev setup.
Relist rule (M0/M2 advisory): a "gone" listing that reappears → status active/price_drop,
firstSeenAt preserved; daysListed anchored to min(postedAt, firstSeenAt) so relist bumps can't
game maxDaysListed. Gone/sold conflation documented: no sold signal from KSL search; "sold" is
a manual decision or future detail-fetch heuristic — feed treats both as out-of-market.
Gate: POST same fixture batch twice → one row per dedupeKey; then lower-price batch → price-
History appended + status "price_drop". Run live against self-hosted backend HTTP (port 3211)
via run.py; pytest + vitest green.
Predicted failures: Convex isolate lacks crypto.subtle in mutations (hence self-contained
sha1); site-proxy port mismatch for HTTP actions (verify 3211); validator strictness on §5
extras.

## Cycle log
<!-- One entry per cycle: date, milestone, PASS/FAIL, one-line summary -->
- 2026-06-13 C10 M9 PASS — polish/README/optimizer verified by independent reviewer. First
  review FAILED (the no-rerender e2e used a MutationObserver — passed even with the DealCard
  memo deleted, proving nothing). FIXED: dev-only per-card React render counter (stripped from
  prod bundle) + test asserts only the affected card re-renders; re-review confirmed it FAILS
  without the memo and PASSES with it. Lighthouse mobile perf 100 / a11y 100 / bp 96; README
  has all §10 items; fresh-clone smoke green (66 vitest + 61 pytest + web build). No logic
  touched. Advisory fixed: README CONVEX_DEPLOYMENT note.
- 2026-06-13 FINAL end-to-end gate (VISION.md) — OBSERVED PASS (pre independent verify):
  clearSearchRuns (schedule fires) → dispatch_local.py one tick (3 due, all ran, cron-
  equivalent) → run.py scrape+normalize → POST /ingest (2 new) → scoring (comps→recon→
  profit/score/hot→alert). Result in listings:feed: 2021 Traverse ask $16,500 vs
  marketcheck_sold comp → est $23,565, profit +$6,265, score 71, HOT=True; 2017 Terrain
  "needs engine" → parts recon, surfaced as mechanic special. Alerts: +2 (hot + mechanic_
  special), channel log. All searches lastRunAt stamped. Zero human action after the schedule
  fired.
- 2026-06-12 C9 M8 PASS — alerts verified by independent reviewer with its OWN fresh hot
  listing through the full 5-step dedupe matrix (1 alert → same-price 0 → raise 0 → drop
  exactly 1 → rescoreAll 0); transports envelope-correct (Resend Bearer/JSON, Twilio
  Basic/form), 4xx fail-fast/5xx retry pinned; multi-channel single-transaction design
  validated; mechanic_special override regression intact; hot-beats-special reason priority
  ruled defensible. Advisories FIXED same cycle: B full html escaping, F stamp current price,
  D alert-row price column, A claim-first note for keyed deployments. NOTED: C partial-
  channel-failure audit (console-only), E orphan-skip in alerts.list. Reviewer left 1 test
  listing (VIN 1GNERGKW8MJ919777) + 2 alert rows — no delete path by design.
- 2026-06-12 C8 M7 PASS — dashboard verified by independent reviewer driving the app itself
  (13 screenshots): build clean, 5/5 e2e, §8 element-by-element table, both overrides counted
  live (all 10 listings incl. negative-profit shown unfiltered; Terrain recon lines + pooled
  comp provenance visible in drawer), Step-5 numbers recomputed by hand, no duplicate pipeline
  rows under triple-click, no XSS, no secrets in bundle. Advisories FIXED same cycle: A1
  Enter-on-button drawer leak, A2 make+source filters wired, A3 SearchForm validation (empty
  ≠ 0, min≤max, interval≥1), A4 memo comparator covers all painted fields, A6 contrast bumps,
  A7 img onerror fallback, A9 sort-copy, A10 Step-5 math moved server-side (listings.get
  .suggested), A12 tsbuildinfo ignored. CARRIED to M9: A5 focus trap, A8 e2e hardening
  (data-id selectors), A11 feed pagination + "showing N of M", A13 README notes (pipeline
  archive, settings exposure, Daytona key env-only). RULING NOTES: View-listing link in
  drawer acceptable; no Daytona key field in Settings ruled correct (public query).
- 2026-06-12 C7 M6 PASS — runner+crons verified by independent reviewer with its own bad-config
  gate run: failure isolation, pool-3 concurrency (timing-observed), idempotent ingest, teardown
  (no lingering processes), cron ticking with driver_unconfigured + starvation fix held over a
  70s window, REST envelope ruled plausible+honestly-labeled, local-dispatcher framing ruled
  RULES#6-compliant. Overrides 1–3 verified implemented as written. Advisories FIXED same
  cycle: A1 dispatch claim (lastDispatchedAt + listDue in-flight filter), A2 error tail from
  stdout, A3 auth-header assertion, A4 fbSessionCookie parity in dispatch_local, A6 doc drift
  (REST not SDK; snapshot = first-deploy README item), A9 bottom band widened to $500.
  NOTED: A5 per-result error capture (fine for --loop), A7 secret-on-argv (single-tenant,
  documented), A10 legacy alert rows without reason (cosmetic).
- 2026-06-12 C6 M5 PASS — scoring engine verified by independent reviewer: every gate number
  recomputed by hand (dealScore cases, salvage CX-5 0.70-on-clean live row, Terrain engine
  recon 400+4671+1300 w/ visible breakdown, curve value), hot boundary 1499/1500, curve-never-
  hot in code, alert dedupe held under rescore, §4 fidelity (no 0.65 in code), arbitrage seeds
  match override. Advisories FIXED same cycle: B tranny-slang transmission keywords (the one
  false-HOT direction), A dead-battery misfire, C transactional alert dedupe re-check in
  recordAlert, D pooled Terrain comp relabeled marketcheck_pooled + provenance section added.
  NOTED: E–H (negation fragility, reconSource semantics for drawer, missing-mileage curve
  path) — G explicitly carried to M7 (drawer renders breakdown lines, not the source label).
- 2026-06-12 C5 M4 PASS — ingest/dedupe/price-history verified by independent reviewer with
  its own crafted fixtures: dedupe (incl. accidental real-world collision + crafted
  within-batch duplicate), price-drop history ordering, SHA-1 re-derived via sha1sum, full
  auth/error matrix (401/400/413/422-with-detail), relist preserving firstSeenAt + daysListed
  anchor, stale sweep via index, scoring placeholder fired 16x without crashes, run.py
  failure-isolation semantics ruled correct. Advisories FIXED same cycle: A1 identity refresh
  on update, A2 price-raise retracts price_drop status, A3 http.ts comment, A5 unknown source
  = failure, A6 batch-level source label dropped, A4 timing-compare note. DEFERRED: A7
  convex-test harness (revisit at M5+), A8/A9 accepted rulings logged.
- 2026-06-12 C1 M0 PASS — ARCHITECTURE.md approved by independent reviewer (verdict PASS, 16
  numbered confirmations, 7 advisory notes logged above). KSL envelope verified against hax.py.
- 2026-06-12 C2 M1 PASS — schema + seeds verified by independent reviewer: 7 §2 searches
  field-exact, settings 1500/400, 1226 partsCosts keys; aggregation independently recomputed
  (2012 Civic Engine 1810/n=499 exact match); seed idempotent; no secrets in git. Traverse-null
  ruled a data limitation handled per recon rule 4. Advisories fixed: NUL byte in
  build_partscosts.mjs, ARCHITECTURE §5 additions (comps.source, by_listing indexes), ±2-year
  lookup fallback documented in API surface. Deferred advisory: sturdier seed idempotency key.
- 2026-06-12 C4 M3 PASS — ksl.py verified by independent reviewer: envelope matched to hax.py
  line-by-line (one divergence found — Referer that the reference never sends on the wire —
  FIXED same cycle + asserted in test); CLI emit gate re-run independently (6 listings, 0
  schema errors, exit-2 typed failure on live path); fixture-passthrough framing ruled "honest
  satisfaction, not a dodge" given the verified egress-proxy block. Advisories fixed: A1
  Referer dropped, A2 live-segment advisory re-tagged to first live run, A3 malformed-JSON
  retry test added, A4 backoff doc corrected (2s·4s), A5 max-pages comment de-weighted.
- 2026-06-12 C3 M2 PASS — parse.py + fixtures verified by independent reviewer (45→49 tests):
  every gate field asserted, dealer filter tested both paths, fixture realism diffed against
  reference dataclass (photo URL format verified to car_item.py docstring), §5 schema pinned
  w/ drop-each-key rejection, robustness probes clean (no silent failures). Advisories FIXED
  same cycle: A1 unknown-sellerType now logged+tested; A3 dealer filter no longer eats "dealer
  serviced" private listings; A5 supplement +23 KSL-region models; A6 "Unknown" make/model
  trigger title fallback; A4 ms-branch test added. CARRIED: A2 (live description-field check →
  M3), A4-relist (displayTime bump reconciliation → M4).

## Data limitations (documented, not failures)
- 2026-06-12 — `data/carpart_prices.csv` has ZERO price observations for 31 of 98 scraped
  models (all Chevrolet SUVs/trucks incl. **Traverse**, GM trucks, Honda CR-V/HR-V, all Mazda
  CX models + Mazda3/6, Ford F-series, Nissan Maxima, Toyota 4Runner — car-part.com returned
  no Grade-A listings for those in the scrape run; see carpart_scraper.py VEHICLES list).
  Consequence: M1's example lookup `2019|Chevrolet|Traverse|Engine` returns null BY DESIGN —
  empty rows are not seeded, and recon for those YMMs uses §4 keyword bumps flagged
  `reconSource:"keyword"` per LOOP_PROMPT recon rule 4. Lookup mechanism proven with
  data-backed buy-box keys: 2019|GMC|Terrain|Engine → $2,639 (n=248); 2018|Ford|Edge|Engine →
  $3,420 (n=163). 1,226 keys seeded (570 Engine, 656 Transmission). Re-scraping car-part.com
  for the missing models is a possible future task for the human.

## Comp-cache provenance (operator/MCP-seeded rows, 2026-06-12)
All six comps rows were seeded from live MarketCheck MCP queries (sold-first), zip 84104,
radius 100 (package cap):
- 2021|Chevrolet|Traverse 60k-80k: past-90-days sold=true, miles 60–80k → n=10, median 22999
- 2019|Mazda|CX-5 80k-100k: sold, miles 80–100k → n=11, median 18557
- 2020|Volkswagen|Tiguan 60k-80k: sold, miles 60–80k → n=10, median 16672
- 2019|Jeep|Wrangler Unlimited 80k-100k: sold, miles 80–100k → n=8, median 22360
- 2016|Chevrolet|Equinox 120k-140k: sold, miles 120–140k → n=4, median 8242
- 2017|GMC|Terrain 80k-100k: source **marketcheck_pooled** — sold returned 0 rows; pooled
  active (n=2, miles 70–120k) + sold (n=2, year_range 2016–2017 same-gen widening) = n=4,
  median 8890. Pooling + widening labeled on the row per M5 reviewer advisory D.
HONESTY NOTE on title filtering: the MCP server prohibits its carfax/title fields as
unreliable, so MCP-seeded comps CANNOT be hard-filtered to clean titles; they are dealer
retail listings (overwhelmingly clean-titled in practice). The REST driver path (when a key
exists) does send title_status=clean and is test-pinned. Documented trade-off of the
no-additional-access directive.

## Failures log
<!-- Verifier FAILs with reasons; what was tried -->

## BLOCKED
<!-- Things only the human can resolve (FB cookie expired, missing API key, spec ambiguity) -->
- 2026-06-12 (non-halting, optional unblock): this build container's egress proxy blocks
  cars.ksl.com ("Host not in allowlist" — proxy message, NOT KSL bot protection). Live KSL
  calls therefore run only inside Daytona sandboxes (M6) or after the human adds cars.ksl.com
  + img.ksl.com to the Claude Code environment's network allowlist. M3 gate satisfied via
  fixture-passthrough through the identical request/normalize/emit code path. M0-advisory A2
  (does the live search payload include `description`?) also moves to the first live run.
- 2026-06-12 (non-halting, affects M6 live gate): app.daytona.io is ALSO blocked by the
  egress proxy (probed: "Host not in allowlist"). M6 will be built against the Daytona SDK
  behind a sandbox-driver interface and gated with a scripted fake driver, same pattern the
  M3 reviewer ruled on.
- 2026-06-12 USER DIRECTIVE (supersedes the allowlist suggestions above): "i dont want to
  have to give access to anything else." No further access will be requested — no allowlist
  changes, no additional keys. All remaining gates must be satisfiable fully in-container:
  M5 valuation uses the MarketCheck MCP already connected to the harness (no user action),
  M6 gates on the driver abstraction with the real Daytona SDK path code-complete for when
  the app runs outside this container, M8 alerts gate on the keyless "log" channel.
