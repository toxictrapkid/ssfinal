# CarHunter Airtable Schema

> Proposed base: **CarHunter CRM**. Not yet created — creation requires owner
> approval (`mcp__Airtable__create_base` is on the ask-list). Once live, record
> the real base ID here.

Base ID: _not created yet_

## Table: Deals

| Field | Type | Notes |
|---|---|---|
| CarHunter ID | single line text | primary; stable across syncs |
| VIN | single line text | 17 chars; validate before write |
| Year / Make / Model / Trim | number + text | |
| Mileage | number | flag ≥ 150k |
| Title Status | single select | Clean / Rebuilt / Salvage / Lien / Unknown |
| Source | single select | Feed / Auction / Manual |
| Listing URL | url | |
| Asking Price | currency | |
| JD Clean Trade | currency | never $0 — leave blank + status |
| JD Clean Trade Status | single select | VERIFIED / NEEDS SECOND CHECK / DATA MISSING / VALUE MISMATCH |
| JD Full Retail | currency | + same Status field pattern |
| JD Full Retail Status | single select | (as above) |
| KBB Lending | currency | |
| KBB Lending Status | single select | (as above) |
| Base MMR | currency | |
| Base MMR Status | single select | (as above) |
| Value Source Notes | long text | source + checked-time + checked-by per number |
| Est All-In Cost | currency | price + transport + parts + labor + recon |
| Est Profit | currency | Evaluator-recomputed, not Operator-claimed |
| Max Bid | currency | |
| Stage | single select | WATCH / DATA MISSING / EMPLOYEE VERIFY / OWNER REVIEW / BUY CANDIDATE / HOT BUY / PASSED / PURCHASED |
| Evaluator Verdict | single select | CLEARED / BLOCKED / OWNER REVIEW |
| Alert Sent At | date | spam-gate dedupe key |
| Created / Updated | created & last-modified time | |

## Table: Tasks

| Field | Type | Notes |
|---|---|---|
| Task ID | autonumber | |
| Deal | link to Deals | |
| Type | single select | VALUE LOOKUP / PHOTO VERIFY / VIN HISTORY / INSPECTION / OTHER |
| Assignee | single select | Employee / Owner |
| Status | single select | OPEN / IN PROGRESS / DONE / BLOCKED |
| Detail | long text | exactly what to check and where to record it |
| Due | date | |

## Rules

- Agents may **create** records freely; **updating** existing records is on the
  ask-list; **deleting** is denied outright.
- A Deal may not enter OWNER REVIEW or later unless all four *Status fields are
  VERIFIED. This mirrors the Evaluator's four-number gate.
