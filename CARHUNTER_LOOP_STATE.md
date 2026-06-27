# CarHunter Loop State

> Operational memory. EVERY loop reads this at start and updates it at end.
> Keep it short. Facts only. No history dumps — newest state overwrites old.
> Autonomy: **Level 2** (draft + create tasks + alert humans). Do not act above Level 2.

## Last Run
date/time: 2026-06-24 — system bootstrapped (no loops executed yet)
loop: bootstrap / install
result: Loop system files created. Automations DEFINED but NOT yet activated. Awaiting owner go-live.

## Current System Health
MCP:              UNKNOWN — run Loop 10 (mcp-health) to verify
Scraper:          carpart_scraper.py present; last run UNKNOWN
Feed freshness:   UNKNOWN — run Loop 2
Airtable:         UNKNOWN — base not yet confirmed/created (see carhunter/airtable/SCHEMA.md)
Slack:            UNKNOWN — alert channel not yet confirmed
Valuation:        idle
Auction reports:  none pending

## Active Opportunities
HOT BUY:          0
BUY CANDIDATE:    0
OWNER REVIEW:     0
EMPLOYEE VERIFY:  0
DATA MISSING:     0
WATCH:            0

## Active Searches
(saved searches / source scans currently armed — filled by Loop 1)
- none configured yet

## Auction Run Lists Pending Review
(uploaded run lists not yet fully scored — filled by Loop 5)
- none

## Queues
listings waiting on EMPLOYEE: 0
listings waiting on OWNER:     0

## Blockers
- blocker: Live MCP connectivity not yet verified in this session (servers flapping at bootstrap).
- owner action needed: Confirm Slack alert channel + approve Airtable base creation, then authorize go-live (see carhunter/automations/SCHEDULE.md).
- employee action needed: none yet

## Sync / Alert Health
Airtable sync: never run
Slack alerts:  never sent
Last alert:    none

## Next Run
next loop: Loop 10 (MCP Health) → then Loop 2 (Feed Freshness) → then Loop 1 (Discovery)
next action: Owner authorizes go-live; operator runs the smoke test in carhunter/DESIGN.md §Testing Plan.
risk: Do not send Slack HOT BUY alerts until valuations are VERIFIED. Do not auto-contact sellers. Do not move past Level 2 without owner approval.
