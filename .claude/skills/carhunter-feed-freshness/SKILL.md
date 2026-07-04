---
name: carhunter-feed-freshness
description: Loop 2 — check that CarHunter deal-feed data is fresh (<24h) before discovery runs. Use after carhunter-mcp-health passes, before carhunter-discovery.
---

# Loop 2 — Feed Freshness

Goal: never let Discovery score stale data as if it were live market data.

1. Read `CARHUNTER_LOOP_STATE.md`.
2. Call `mcp__MCP__check_feed_health`. For each feed capture: last-update
   timestamp, record count, error state.
3. Classify: FRESH (<24h), STALE (24–72h), DEAD (>72h or erroring).
4. Cross-check one FRESH feed by pulling 1–2 items via `mcp__MCP__get_deal_feed`
   and confirming their timestamps match the claimed freshness — a feed that
   *says* fresh but serves old listings is STALE.
5. Update the "Feed freshness" health line in state; file Blockers for
   STALE/DEAD feeds; create an employee task if a feed needs re-auth or a
   source-side fix.
6. Hand off to Evaluator: per-feed classification + evidence timestamps.

Stop condition: every feed classified with evidence. Discovery may only use
FRESH feeds; STALE feeds require an explicit owner OK noted in state.
