# CarHunter Command Allowlist

> Referenced by the Operator agent. This is the authoritative list of what may be
> run without asking. It mirrors `.claude/settings.json` — if the two disagree,
> settings.json (enforced by the harness) wins; fix this file to match.

## Autonomy level: 2

Draft + create tasks + alert humans. Nothing above: no seller contact, no offers,
no payments, no buying, no production-setting edits.

## Allowed (no approval needed)

**Shell (read-only or well-scoped):**
- `git status` / `git diff` / `git log` / `git show` / `git branch`
- `ls`, `find`
- `python3 carpart_scraper.py` (incl. `--limit`, `--regen-only`, `--headful`)
- `python3 -m unittest …` (tests), `python3 -m py_compile …`
- `git add` / `git commit` / `git fetch` / `git pull` / `git push -u origin <branch>`

**MCP (read/stage):**
- All `mcp__MCP__*` read tools (deal feed, hot deals, listings, pipeline status,
  feed health, missing data, explain deal, analyze auction vehicle)
- `mcp__MCP__create_employee_task`, `mcp__MCP__send_slack_alert` — only for
  Evaluator-CLEARED items
- `mcp__MarketCheck_MCPs__*` VIN decode / history / comps / searches (cross-check only)
- Airtable reads + `create_records_for_table` (new records only)
- Slack drafts (`slack_send_message_draft`), channel search/read

## Requires explicit approval (ask first)

- `mcp__MCP__sync_airtable`
- Airtable updates to existing records, table/base/field creation or changes
- Sending (not drafting) Slack messages; scheduling Slack messages

## Forbidden — never run, never work around

- `rm -rf` / `rm -fr`, `git reset --hard`, `git clean`
- `git push --force` (any variant), pushes to `main`/`master`
- `curl`, `wget`, `env`, `printenv` (exfiltration risk)
- `npm publish`, any `convex deploy`
- Reading any `.env` file
- Airtable record/page deletion
- Anything that contacts a seller, sends money, or commits to a purchase

## If a needed command isn't listed

Stop. Log the need in `CARHUNTER_LOOP_STATE.md` under Blockers and flag the owner.
Do not improvise an alternative that dodges the list.
