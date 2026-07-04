# CarHunter System Design

## Purpose

Continuously find, value, and stage used-car buying opportunities for the owner.
Humans decide; agents gather, verify, and present.

## Components

```
carpart_scraper.py ──► carpart_results_raw.csv ──► carpart_under_1500.csv
        (parts-price ground truth for "mechanic special" margin math)

Deal feeds (mcp__MCP__*)  ─┐
MarketCheck (VIN/comps)   ─┼─► Operator agent ─► Evaluator agent ─► Airtable CRM
Auction run lists         ─┘        (stages)         (clears)        Slack alerts
                                                                     Employee tasks
```

- **Operator** (`.claude/agents/carhunter-operator.md`): does the work — scans,
  ingests, enriches, scores, drafts. Never self-approves.
- **Evaluator** (`.claude/agents/carhunter-evaluator.md`): adversarial gate —
  re-verifies numbers, recomputes margins, blocks unsafe actions. Only it can
  mark items owner-ready or approve an alert for sending.
- **State** (`CARHUNTER_LOOP_STATE.md`): the single operational memory. Every
  loop reads it first, updates it last. Newest state overwrites old.

## The four valuation numbers (non-negotiable)

Every candidate must carry **JD Clean Trade, JD Full Retail, KBB Lending, Base
MMR** — each with a value, source, checked-time, checked-by, and double-check
status. Missing → `DATA MISSING` + a lookup task. `$0` placeholders are treated
as fraud by the Evaluator. Two checks differing by >$500 or >3% → 
`VALUE MISMATCH - OWNER REVIEW REQUIRED` (never averaged away).

## Deal stages

`WATCH → DATA MISSING → EMPLOYEE VERIFY → OWNER REVIEW → BUY CANDIDATE → HOT BUY`
Only the Evaluator moves an item rightward of DATA MISSING. Only the owner acts
on HOT BUY.

## Autonomy: Level 2

Agents may draft, create tasks, and alert humans. They may not contact sellers,
negotiate, pay, buy, or edit production settings. See
`carhunter/safety/COMMAND_ALLOWLIST.md`.

## Testing Plan

Smoke test before any go-live, in order:

1. `python3 -m unittest discover -s tests` — pure-logic suite must pass.
2. `python3 carpart_scraper.py --regen-only` — offline CSV pipeline works.
3. `python3 carpart_scraper.py --limit 2` — live: two searches complete, raw CSV
   gains rows with honest filter notes, progress file gains two keys.
4. Loop 10 (MCP health): every `mcp__MCP__*`, MarketCheck, Airtable, and Slack
   tool answers a trivial call. Record pass/fail per server in state.
5. Loop 2 (feed freshness): `check_feed_health` timestamps are < 24h old.
6. Dry-run Loop 1 (discovery) with alerts as **drafts only**; Evaluator reviews
   the full handoff; owner eyeballs one end-to-end packet.
7. Owner authorizes go-live in writing; update state; arm SCHEDULE.md loops.

## Failure recovery

Tool fails → retry once → log to state Blockers → hand off, don't fake.
Scraper task fails all retries → recorded as `error` row (never fake
"no results"), retried on next run only if its progress line is removed.
