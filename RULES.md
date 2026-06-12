# RULES.md — What the agent is never allowed to do

1. **Never substitute the stack.** Convex, Daytona, Playwright, React+Vite+Tailwind. TypeScript everywhere except Python scrapers. No SQLite, no Supabase, no Next.js, no "better" alternatives.
2. **Never start from zero where reference code exists.** Reuse: FB scrape/parse/UI from `facebook-marketplace-scraper-1.1.0`; cookie + search-URL logic from `scrape_marketplace.py`; KSL parsing + `assets/new_score_method.py` from `KSLHax-1.2`.
3. **Never change the spec's numbers without a BLOCKED entry:** margin threshold 1500, fees 400, score weights 45/20/15/10/10, recon keyword bumps (§4), dedupe key formula (§5), buy-box defaults (§2). **Standing user override:** salvage/rebuilt title `estValue` = 0.70 × clean-title comp value (replaces §4's ×0.65) — comps must come from clean-title vehicles only.
3a. **Never value a car without trying the MarketCheck MCP first** (`predict_price_with_comparables` / `search_active_cars` / `search_past_90_days`). The depreciation curve is a flagged fallback, never silently used, and curve-valued cars never trigger HOT alerts.
3b. **Never use generic keyword bumps for engine/transmission failures when the YMM exists in `partsCosts`.** Mechanic specials price recon from real used-part medians + labor (engine +$1,300, trans +$900); unnamed failures assume the pricier component. Recon math must be visible in the detail drawer.
4. **Never let dealer listings into the feed.** Private-party only — hard filter in `parse.py`.
5. **Never store a Facebook password.** Session cookie from Convex settings only.
6. **Never run scrapers on the app server.** Daytona sandboxes only, torn down after each run.
7. **Never message sellers, send money, or act on a deal.** The app finds and ranks; the human decides and contacts.
8. **Never mark a milestone ✅ without the independent subagent verifier's PASS.**
9. **Never work on two milestones in one cycle, and never skip ahead in the §9 build order.**
10. **Never retry the same failure more than 3 times** — write BLOCKED to PROGRESS.md and stop the cycle.
11. **Never delete or rewrite PROGRESS.md history.** Append only.
