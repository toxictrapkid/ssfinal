# CarHunter

Two layers, one goal: find profitable used-car and used-parts opportunities and put
them in front of the owner with verified numbers.

1. **`carpart_scraper.py`** — autonomous Car-Part.com scraper that collects used
   Engine/Transmission prices for ~115 vehicles (2012–2023) and reports vehicles
   where a Grade-A engine **and** transmission each average ≤ $1,500.
2. **CarHunter agent loop system** — Claude Code sub-agents
   (`.claude/agents/carhunter-operator.md` + `carhunter-evaluator.md`) that scan
   deal feeds, verify valuations, and stage alerts. Docs live in `carhunter/`.

## Scraper usage

```bash
python3 carpart_scraper.py                # full run — resumes automatically if interrupted
python3 carpart_scraper.py --limit 5      # smoke test: only 5 searches
python3 carpart_scraper.py --regen-only   # rebuild filtered CSV from raw data, no network
python3 carpart_scraper.py --headful      # watch the browser work
```

Playwright auto-installs on first live run (skipped when the environment
pre-installs Chromium, e.g. `PLAYWRIGHT_BROWSERS_PATH` is set). `--regen-only`
and the tests need nothing beyond the Python standard library.

### Outputs (gitignored — regenerable)

| File | Contents |
|---|---|
| `carpart_results_raw.csv` | one row per engine/trans **variant** with prices, stats, and an honest `filter_note` (`Grade-A <100k`, `unfiltered fallback`, `no results`, `error …`) |
| `carpart_under_1500.csv` | engine×transmission variant pairs where both average ≤ $1,500 with 3+ listings each, sorted cheapest first |
| `carpart_progress.txt` | completed search keys — delete a line to force a re-scrape of that task |
| `carpart_scraper.log` / `carpart_errors.log` | activity and error logs |

### How prices are filtered

Primary pass keeps only **Grade A** listings **under 100k miles** with prices in
$50–$25,000. If a results page has no such listing, a fallback grabs every price
on the page and the row is labeled `unfiltered fallback` so downstream analysis
can weigh it accordingly. Per-variant stats drop >2-sigma outliers.

### Resume & data integrity

Progress is fsynced after every task; re-running skips completed work. If a task
is ever re-scraped (e.g. after deleting its progress line), the **latest** row
per variant wins when the filtered CSV is built — duplicates never double-count.
Transient failures are retried 3× and, if still failing, recorded as `error`
rows (distinct from a genuine `no results`).

## Tests

```bash
python3 -m unittest discover -s tests -v
```

## CarHunter agent system

- `CARHUNTER_LOOP_STATE.md` — operational memory; every loop reads it first and updates it last
- `carhunter/DESIGN.md` — architecture, handoff contract, testing plan
- `carhunter/automations/SCHEDULE.md` — loop definitions and cadence (not armed until owner go-live)
- `carhunter/safety/COMMAND_ALLOWLIST.md` — what the agents may and may not run
- `carhunter/airtable/SCHEMA.md` — CRM base schema
- `.claude/skills/carhunter-*` — step-by-step procedures the Operator follows per loop

Autonomy is capped at **Level 2**: the agents draft, stage, and alert — the human
owner makes every buying decision. No seller contact, no offers, no money.
