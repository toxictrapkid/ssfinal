# CarHunter Loop Schedule

> Status: **DEFINED, NOT ARMED.** No recurring triggers exist yet. Arming
> requires explicit owner go-live after the smoke test in
> `carhunter/DESIGN.md` §Testing Plan passes.

Each loop = Operator runs the matching skill in `.claude/skills/`, hands off to
Evaluator, Evaluator updates `CARHUNTER_LOOP_STATE.md`. A loop is DONE only when
the Evaluator's verdict says its stop condition is met.

| # | Loop | Skill | Cadence (when armed) | Stop condition |
|---|---|---|---|---|
| 10 | MCP Health | `carhunter-mcp-health` | daily, first loop of the day | every server answered a trivial call; state health lines updated |
| 2 | Feed Freshness | `carhunter-feed-freshness` | every 6h | feed timestamps < 24h old or a Blocker filed |
| 1 | Discovery | `carhunter-discovery` | every 6h, after Loop 2 | new listings ingested + deduped; candidates staged with 4-number status; Evaluator verdicts recorded |
| 5 | Auction Run Lists | (skill TBD before arming) | on upload | every row scored or marked DATA MISSING |

Ordering per cycle: **10 → 2 → 1**. If 10 fails for a server, skip loops that
depend on that server and file a Blocker instead of half-running.

## Arming (owner action)

When the owner says go: create the triggers (e.g. Claude Code Remote
`create_trigger` with the cadences above), then record trigger IDs here and set
"Status: ARMED". Until then, loops run only when a human starts a session.
