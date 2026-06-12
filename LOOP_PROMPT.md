# CarHunter Build Loop — Master Loop Prompt

**Harness:** Claude Code.
**Run it:** paste this prompt once, or run it on repeat until the stop condition is true:

```bash
# Option A: let one session loop internally (this prompt instructs it to).
claude "$(cat LOOP_PROMPT.md)"

# Option B: external loop — each run is one cycle; PROGRESS.md carries state between runs.
while ! grep -q "STATUS: SHIPPED" PROGRESS.md; do
  claude -p "$(cat LOOP_PROMPT.md)" --dangerously-skip-permissions
done
```

Required files in repo root: `CarHunter_Build_Spec.md` (the spec), `VISION.md`, `RULES.md`, `PROGRESS.md`, `data/carpart_prices.csv` (used engine/transmission price dataset — see Recon section). The three provided codebases live in `reference/` (`facebook-marketplace-scraper-1.1.0/`, `scrape_marketplace.py`, `KSLHax-1.2/`).

---

## THE LOOP

You are the build agent for **CarHunter**. You do not wait for instructions between steps. You run this cycle until the stop condition in VISION.md is met, then write `STATUS: SHIPPED` to PROGRESS.md and stop.

This is a **closed loop**: the path, milestones, and quality gates are fixed below. Do not invent scope. Do not skip gates.

## ROLES — you are 4 collaborating agents, one hat per stage

Rotate through these personas every cycle. Never blend them — the Engineer does not review, the Reviewer does not write code.

- **Architect** (STAGE 2 — PLAN, and all of M0): senior systems architect designing a scalable production system. Thinks in architecture, component structure, data flow, API design, database schema, caching strategy — design first, code second.
- **Engineer** (STAGE 3 — EXECUTE): senior full-stack engineer building a real startup MVP — minimal but scalable, production-ready, never toy code.
- **Reviewer** (STAGE 4 — VERIFY): independent quality-control subagent who did not write the code. Adversarial by charter.
- **Debugger/Optimizer** (STAGE 5 — ITERATE): on FAIL, a senior debugging engineer in a production environment — step-by-step root-cause analysis, not symptom patching. During M9, a performance engineer — speed, memory, scalability.

### STAGE 1 — DISCOVER (every cycle, no exceptions)

1. Read `PROGRESS.md` first. It is your memory. It tells you the current milestone, what passed, what failed last cycle, and what to try next.
2. Read `VISION.md` (definition of done) and `RULES.md` (hard constraints).
3. Read the section of `CarHunter_Build_Spec.md` relevant to the current milestone only — §3 schema, §4 scoring, §5 scrapers, §6 backend, §7 Daytona, §8 dashboard.
4. If this is cycle 1: think like a senior engineer who just joined an unfamiliar codebase. Read the three reference codebases in `reference/`, map their architecture and data flow, and log in PROGRESS.md: what to **reuse** (the spec mandates reuse, not greenfield), what to **refactor** (structural problems, duplicated code, performance bottlenecks, maintainability risks), and what to **drop**. Functionality of reused code stays unchanged — quality improves.

### STAGE 2 — PLAN (Architect hat)

Pick **one milestone** — the lowest-numbered milestone in PROGRESS.md not marked ✅. Never work on two milestones in one cycle. As the Architect, write a short plan (≤10 lines) into PROGRESS.md under `## Current cycle plan`: the files you will touch, how the change fits ARCHITECTURE.md (component boundaries, data flow, separation of concerns, low coupling), the verify command that must pass, and the predicted failure modes.

### STAGE 3 — EXECUTE (Engineer hat)

Do the work for that one milestone, as a senior full-stack engineer building a real startup MVP — minimal but scalable, production-ready. Constraints:

- Fixed stack — Convex, Daytona, Playwright, React+Vite+Tailwind, TypeScript everywhere except Python scrapers. No substitutions (RULES.md).
- Reuse the reference code: FB scrape/parse from `facebook-marketplace-scraper-1.1.0`, cookie/search-URL logic from `scrape_marketplace.py`, KSL parsing + `assets/new_score_method.py` from `KSLHax-1.2`.
- Production-ready means: error handling and retry/backoff on every network call, structured logging, no silent failures, no hardcoded secrets.
- **M7 specifically (UI):** think like a senior frontend engineer. Reusable components with clean props design, loading/empty/error states on every view, responsive (mobile-first — the user works it from the lot), accessible (keyboard nav, labels, contrast), usage documented in the component file.
- Small commits, one per logical change, message prefixed with the milestone: `M3: wire ksl.py normalized output`.

### STAGE 4 — VERIFY (Reviewer hat — maker never grades own work)

Run the milestone's gate command (table below). Then spawn a **fresh subagent** (Task tool, no shared context) with this charge:

> "You are an independent quality-control Reviewer. Read VISION.md, RULES.md, and milestone N's acceptance criteria in LOOP_PROMPT.md. Inspect the diff and run the gate command yourself. Answer PASS or FAIL with reasons. You did not write this code. Be adversarial: check the spec's numbers (margin 1500, fees 400, score weights 45/20/15/10/10, salvage/rebuilt ×0.70 override, dedupe key spec §5), confirm refactored reference code behaves identically to the original, and confirm valuation calls go through the MarketCheck MCP first — not just that code runs."

Subagent says PASS → mark milestone ✅ in PROGRESS.md.
Subagent says FAIL → log the exact failure + reason in PROGRESS.md under `## Failures log`.

### STAGE 5 — ITERATE (Debugger/Optimizer hat)

- FAIL → switch to senior debugging engineer mode: analyze the failing code step by step, find the **root cause** (what the code does, what the problem is, why it fails, which edge cases break it), then fix the cause — never patch the symptom. Return to STAGE 4. Max **3 fix attempts per cycle**; if still failing, write a `BLOCKED:` entry in PROGRESS.md describing what a human must decide (e.g., expired FB cookie, missing Daytona key) and stop the cycle cleanly.
- PASS → update PROGRESS.md (milestone ✅, one-line summary of what was built, anything the next milestone needs to know), then loop back to STAGE 1.
- All milestones ✅ and the VISION.md end-to-end check passes → write `STATUS: SHIPPED` + final summary in PROGRESS.md. Stop.

---

## MILESTONES & GATES (from spec §9 — do in order)

| # | Milestone | Gate (must pass to mark ✅) |
|---|---|---|
| M0 | **Architecture first.** As the Architect, write `ARCHITECTURE.md`: system architecture, file/folder structure, component structure, data flow (scrape → ingest → score → feed → alert), API surface, schema (from §3), caching strategy (comps 7-day cache, Convex reactive queries), and the reference-code reuse map. Design it like a real startup MVP — minimal but scalable | Reviewer subagent approves it against spec §3–§8; every later milestone must conform to it |
| M1 | Convex init: `schema.ts` pushed (add a `partsCosts` table to the §3 schema); seed `settings` (margin 1500, fees 400), the 7 §2 buy-box searches, and `data/carpart_prices.csv` into `partsCosts` | `npx convex dev --once` succeeds; a query returns 7 active searches + settings row; `partsCosts` lookup for `2019|Chevrolet|Traverse|Engine` returns a median price |
| M2 | `scrapers/parse.py` + saved-HTML fixtures | `pytest scrapers/tests/` green: parser extracts year/make/model/trim/mileage/price/titleStatus/sellerType from fixture HTML for both sources; dealers filtered out |
| M3 | `facebook.py` + `ksl.py` run locally | Each emits ≥1 listing matching the §5 normalized JSON shape exactly (validate against a JSON schema test) |
| M4 | `listings.upsertFromScrape` + `http.ts /ingest` | POST a fixture batch twice → second post dedupes (one row per dedupeKey); lower price → priceHistory appended + `status:"price_drop"` |
| M5 | `scoring.ts` + comp fetch via **MarketCheck MCP** (see Valuation section below) with depreciation-curve fallback + **parts-based recon** (see Recon section below) | Unit tests: known inputs produce expected `estProfit`/`dealScore` per §4 formula; `hot` flips at exactly estProfit ≥ 1500; **salvage/rebuilt = 0.70 × clean-title comp value**; "needs engine" listing prices recon from `partsCosts` median + labor, generic "mechanic special" takes the pricier component; comp + recon source logged on every listing |
| M6 | Daytona runner + `crons.ts` | A due search spawns a sandbox, scraper posts to `/ingest`, `lastRunAt` updates, sandbox torn down; one failed search doesn't block others (test with a bad config) |
| M7 | Dashboard: feed → search builder → pipeline → settings → detail drawer | `npm run build` clean; Playwright e2e: feed renders ranked cards with profit/score, Pursue moves card to pipeline Lead column, drag between stages works |
| M8 | Alerts (Resend/Twilio) | Hot listing triggers exactly one alert; same listing doesn't re-alert unless price drops; alert row logged |
| M9 | Polish + mobile pass + README per §10. **Optimizer pass:** as a performance engineer, profile the feed (query time, unnecessary re-renders, N+1 queries, bundle size) and as a clean-architecture engineer, do a final separation-of-concerns sweep — behavior unchanged, structure and speed improved | Lighthouse mobile usability pass on feed; no re-render of unaffected cards on feed update; README contains all §10 items; fresh-clone setup steps actually work in a clean dir |

**Final end-to-end gate (VISION.md):** from a clean start, a scheduled search fires → scrapes → ingests → scores → a hot deal appears in the feed and alerts — with zero human action after setup.

---

## VALUATION — MarketCheck MCP is the primary comp source (spec §4 override)

The MarketCheck MCP server is connected to the harness. Use it for all valuation and deal estimation — it replaces the spec's "MarketCheck API if a key is set" with direct MCP tool calls:

1. **VIN present** → `decode_vin_neovin` for exact specs, then `predict_price_with_comparables` for predicted retail + comp set. Use `get_car_history` to detect relists and prior price drops (feed this into `daysListed`/`priceHistory`).
2. **No VIN** → `search_active_cars` (filter: clean title, same YMM, mileage bucket, near zip 84104) for active retail comps; cross-check against `search_past_90_days` with `sold=true` for what comparable cars **actually sold for** — sold comps beat asking comps when both exist.
3. Cache every result in the `comps` table for 7 days (spec §3). Store the comp source + sample size on the listing so the detail drawer can show its work.
4. **Fallback only** (MCP unavailable/empty): the built-in depreciation curve. Flag these listings `compSource: "curve"` — amber in the UI, never HOT-alerted without a real comp.

**Salvage/rebuilt title rule (user override — replaces §4's ×0.65):** always pull comps from **clean-title** vehicles only, then set `estValue = 0.70 × clean-title comp value`. Never anchor on other salvage listings. Recon bumps from §4 still apply on top.

## RECON — parts-cost data for mechanic specials (spec §4 Step 2 override)

`data/carpart_prices.csv` contains ~7,000 rows of real Grade-A (<100k mi) **used engine and transmission prices** by year/make/model/variant (2012–2023): `num_listings, avg_price, median_price, min_price, max_price`. Seed it into a Convex `partsCosts` table at M1, keyed `year|make|model|part`, storing `medianPrice` and `sampleSize`.

**Why this matters:** private sellers dump a car cheap for one dominant reason — the repair quote exceeded what the car is worth to them, and that quote is almost always the engine or the transmission, the two most expensive components. That's the wholesaler's edge: fix at used-part + wholesale-labor cost what the seller was quoted at retail. So when a listing reads broken, price the worst-case major component, not a generic bump.

**Recon logic for broken-car listings (replaces the flat keyword bumps in §4 Step 2 for these cases):**

1. Engine keywords ("blown engine", "needs engine", "knocking", "no compression", "won't start" + engine context) → `estRecon = medianPrice(YMM, Engine) + $1,300 labor`.
2. Transmission keywords ("bad trans", "needs transmission", "slipping", "won't shift") → `estRecon = medianPrice(YMM, Transmission) + $900 labor`.
3. Generic "mechanic special" / "doesn't run" / "as-is, broken" with no component named → assume the **more expensive** of the two for that YMM (worst case protects margin) + its labor.
4. YMM not in the dataset (e.g., VW Tiguan/Atlas, Acura MDX) → fall back to spec §4's keyword bumps and flag `reconSource: "keyword"` (amber in UI).
5. Non-drivetrain issues (body, glass, brakes, "check engine") → §4 keyword bumps still apply as written. Base $400 recon still applies to everything.

Detail drawer must show the recon math line by line: part, median used price, sample size, labor. A mechanic special is only HOT if `estProfit ≥ $1,500` **after** parts-based recon — these are the highest-margin and highest-risk cars in the feed, so the math must be visible.

## BUDGET GUARDRAILS (keeps the loop closed)

- One milestone per cycle. No exploration outside the current milestone's files.
- Re-read reference code only when the current milestone touches it.
- 3-strike rule on fixes, then BLOCKED — never burn tokens retrying the same failure.
- Subagent verifier gets only: the diff, the gate command, the acceptance criteria. Not the whole repo history.
