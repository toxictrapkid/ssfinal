---
name: carhunter-mcp-health
description: Loop 10 — verify every CarHunter MCP dependency answers before any other loop runs. Use at the start of each working cycle or whenever another loop hits tool errors.
---

# Loop 10 — MCP Health Check

Goal: prove each server is alive with one trivial, read-only call each. Never
mark a server UP without a successful call in THIS session.

1. Read `CARHUNTER_LOOP_STATE.md` (Blockers + last health lines).
2. Load schemas with ToolSearch, then make one cheap call per server:
   - CarHunter: `mcp__MCP__get_pipeline_status`
   - MarketCheck: `mcp__MarketCheck_MCPs__get_server_info`
   - Airtable: `mcp__Airtable__list_bases` (also note whether the CarHunter CRM
     base from `carhunter/airtable/SCHEMA.md` exists yet)
   - Slack: `mcp__Slack__slack_search_channels` for the alert channel
3. One retry per failed server. Two failures = DOWN.
4. Update the "Current System Health" block in `CARHUNTER_LOOP_STATE.md` with
   UP/DOWN + timestamp per server; file a Blocker for each DOWN server.
5. Hand the Evaluator the call-by-call results (tool, args, success/error).

Stop condition: every server has a fresh UP/DOWN verdict recorded in state.
Do not proceed to Loops 2/1 for servers marked DOWN.
