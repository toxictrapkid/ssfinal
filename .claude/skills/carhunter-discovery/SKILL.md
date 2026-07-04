---
name: carhunter-discovery
description: Loop 1 — scan deal feeds for new buying opportunities, dedupe, enrich with the four valuation numbers, score, and stage candidates for Evaluator review. Use after feed freshness passes.
---

# Loop 1 — Discovery

Goal: turn fresh feed data into staged, fully-numbered candidates. Stage — never
approve; the Evaluator clears, the owner decides.

1. Read `CARHUNTER_LOOP_STATE.md` (active searches, queues, last-run cursor).
2. Pull candidates: `mcp__MCP__find_hot_deals`, `mcp__MCP__get_deal_feed`, and
   `mcp__MCP__find_mechanic_specials` (cross-reference parts costs against
   `carpart_under_1500.csv` when judging repair margin).
3. Dedupe by VIN (fallback: source listing ID). Skip anything already in the
   pipeline unless its price dropped ≥ $500.
4. For each new candidate, assemble the four numbers — JD Clean Trade, JD Full
   Retail, KBB Lending, Base MMR — each with value + source + checked-time.
   Cross-check with `mcp__MarketCheck_MCPs__predict_price_with_comparables` and
   decode the VIN. Missing number → mark `DATA MISSING`, create a lookup task
   via `mcp__MCP__create_employee_task`. **Never $0, never invented.**
5. Score: est. all-in cost (price + transport + parts + labor + recon), est.
   profit, max bid. Use `mcp__MCP__explain_deal` for the rationale line.
6. Stage results: new Airtable records (create only), DRAFT Slack alerts for
   anything that looks HOT BUY — drafts only, sending needs Evaluator clearance.
7. Update state (Active Opportunities counts, queues, cursor) and hand the
   Evaluator the full output contract from the Operator agent definition.

Stop condition: every new listing either staged with complete numbers, marked
DATA MISSING with a task, or logged as skipped-duplicate — and the Evaluator has
returned a verdict per staged item.
