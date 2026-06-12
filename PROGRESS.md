# PROGRESS.md — Loop memory (append only)

STATUS: IN_PROGRESS
<!-- The loop stops only when this line reads: STATUS: SHIPPED -->

## Milestones

- [x] M0 — ARCHITECTURE.md written + Reviewer-approved ✅ (cycle 1, 2026-06-12)
- [x] M1 — Convex schema pushed + settings/buy-box seeded ✅ (cycle 2, 2026-06-12)
- [x] M2 — parse.py + fixture tests green ✅ (cycle 3, 2026-06-12)
- [ ] M3 — facebook.py + ksl.py emit normalized JSON
- [ ] M4 — /ingest + upsert/dedupe/price-history working
- [ ] M5 — scoring engine: §4 formula + MarketCheck MCP comps + 0.70 salvage rule + partsCosts recon
- [ ] M6 — Daytona runner + crons firing on schedule
- [ ] M7 — dashboard (feed, builder, pipeline, settings, drawer)
- [ ] M8 — alerts (Resend/Twilio) with dedupe
- [ ] M9 — polish, mobile pass, README
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
- M3: validate extended URL segments (mileageFrom, yearTo, sellerType/For+Sale+By+Owner) against
  live KSL — not all are in the reference main_url grammar.
- M2: pin down where distanceMiles is computed (spec §5: location → distance from zip in parse.py).
- M4: relist rule — a "gone" listing that reappears flips back to "active" (VISION #5 tracks relists).
- M4: document the gone/sold conflation (no spec trigger for "sold").

## Current cycle plan
<!-- Overwritten each cycle: milestone, files to touch, gate command, predicted failures -->
CYCLE 4 — M3 (Architect plan): ksl.py runs locally + facebook.py deferred stub.
Files: scrapers/ksl.py (reference hax.py requestCars envelope + URL-segment builder, refactored
w/ retry/backoff + structured logs), scrapers/facebook.py (ScraperDisabled stub), scrapers/
tests/test_ksl.py (segment builder units + emit-shape gate via fixture passthrough mode).
ksl.py CLI: --config '<json>', --max-pages, --items-file (offline source for tests), emits
normalized JSON array on stdout. Gate: run locally emitting ≥1 listing that validates against
listing.schema.json (jsonschema test). Try LIVE KSL API first (reference headers); if the
container egress proxy blocks cars.ksl.com, fixture-passthrough satisfies "runs locally" and
live validation moves to the Daytona sandbox (M6) — reviewer rules on honesty of that framing.
Predicted failures: KSL bot protection on the proxy endpoint (403 page seen on /), envelope
drift since KSLHax-1.2 (check response shape), description field absent in search payload
(M0 advisory A2 — if so, log + plan per-listing detail fetch before M5).

## Cycle log
<!-- One entry per cycle: date, milestone, PASS/FAIL, one-line summary -->
- 2026-06-12 C1 M0 PASS — ARCHITECTURE.md approved by independent reviewer (verdict PASS, 16
  numbered confirmations, 7 advisory notes logged above). KSL envelope verified against hax.py.
- 2026-06-12 C2 M1 PASS — schema + seeds verified by independent reviewer: 7 §2 searches
  field-exact, settings 1500/400, 1226 partsCosts keys; aggregation independently recomputed
  (2012 Civic Engine 1810/n=499 exact match); seed idempotent; no secrets in git. Traverse-null
  ruled a data limitation handled per recon rule 4. Advisories fixed: NUL byte in
  build_partscosts.mjs, ARCHITECTURE §5 additions (comps.source, by_listing indexes), ±2-year
  lookup fallback documented in API surface. Deferred advisory: sturdier seed idempotency key.
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
