# AI Deal Finder (smart deal finder)

`ai_deal_finder.py` is CarHunter's port of the AI listing-evaluation feature
from [BoPeng/ai-marketplace-monitor](https://github.com/BoPeng/ai-marketplace-monitor):
an LLM rates every candidate listing **1–5** against your buying criteria, and
only listings at or above your `rating` threshold surface as deals.

## How it works

```
listings ──> PREFILTER ──> AI RATING ──> THRESHOLD GATE ──> results + Slack DRAFTS
             price range    1-5 rubric     rating >= N        deal_finder_results.json
             keywords       first [ai.X]   (default 3)
             antikeywords   that succeeds
             sellers        cached
```

1. **Prefilter** (free, no AI): price range, `keywords` / `antikeywords`
   (boolean expressions like `"('needs engine' OR 'blown motor') AND 'clean title'"`
   are supported), and `exclude_sellers`.
2. **AI rating**: the listing plus your `[item.X]` criteria are sent to the
   first working `[ai.X]` backend, which must reply
   `Rating <1-5>: <brief summary>` against this rubric (same as upstream):
   - 1 — No match: missing key details, wrong category/brand, or suspicious activity
   - 2 — Potential match: lacks essential info; needs clarification
   - 3 — Poor match: some mismatches or missing details; acceptable but not ideal
   - 4 — Good match: mostly meets criteria with clear, relevant details
   - 5 — Great deal: fully matches criteria, with excellent condition or price
3. **Gate**: scores below the item's `rating` threshold are dropped.
4. **Output**: qualifying deals go to `deal_finder_results.json` with a Slack
   alert **draft** per deal. Nothing is ever sent automatically — CarHunter is
   Level 2, so drafts must pass the carhunter-evaluator first.

Evaluations are cached (`deal_finder_cache.json`) keyed on the listing, the
criteria, and the model — a listing is never re-billed or re-alerted unless
your criteria change or you pass `--renotify`. If every AI backend fails, the
listing passes through **fail-open** (as upstream) but is loudly marked
`NOT AI-EVALUATED` in results and drafts.

### CarHunter twist: parts-price enrichment

If `carpart_under_1500.csv` (output of `carpart_scraper.py`) is present, the
finder matches each listing's year/make/model and injects the known Grade-A
used engine / transmission replacement costs into the AI prompt, asking it to
weigh repair-and-flip margin — exactly the "mechanic special" play.

## Setup

```bash
cp deal_finder_config.example.toml deal_finder_config.toml
export ANTHROPIC_API_KEY=sk-ant-...   # keys live in env vars, NOT the config
# edit [item.X] sections to describe what you're hunting
```

Supported providers (`[ai.X]` sections, tried in order, first success wins):

| provider    | default model     | api key env var     |
|-------------|-------------------|---------------------|
| `anthropic` | `claude-sonnet-5` | `ANTHROPIC_API_KEY` |
| `openai`    | `gpt-4o`          | `OPENAI_API_KEY`    |
| `deepseek`  | `deepseek-chat`   | `DEEPSEEK_API_KEY`  |
| `ollama`    | `deepseek-r1:14b` | (none — self-hosted)|

Per-item options: `search_phrases`, `description` (the most important one —
tell the AI exactly what a good deal looks like), `keywords`, `antikeywords`,
`min_price`, `max_price`, `exclude_sellers`, `rating` (threshold, default 3),
`prompt` / `extra_prompt` / `rating_prompt` (prompt overrides), `ai`
(restrict/order backends for this item).

## Usage

```bash
# offline demo — no API key, mock AI, shows the whole pipeline
python3 ai_deal_finder.py --demo

# rate listings from a JSON file (list of objects, fields below)
python3 ai_deal_finder.py --listings listings.json

# only one saved search, stricter threshold, fresh eyes on everything
python3 ai_deal_finder.py --listings listings.json --item mechanic_special \
    --min-rating 4 --renotify

# run the offline test suite
python3 -m unittest test_ai_deal_finder -v
```

Listing JSON fields: `title` (required), `price`, `description`, `location`,
`seller`, `condition`, `post_url`, `image`, `marketplace`, `id`, and
optionally `year`/`make`/`model` for exact parts-price matching. `--csv`
accepts the same fields as CSV columns.

## Files

| file                              | purpose                                  |
|-----------------------------------|------------------------------------------|
| `ai_deal_finder.py`               | the deal finder (module + CLI)           |
| `deal_finder_config.example.toml` | config template — copy, don't edit       |
| `deal_finder_config.toml`         | your config (gitignored-style: keep keys out) |
| `deal_finder_cache.json`          | evaluation + already-notified cache      |
| `deal_finder_results.json`        | latest run's rated deals + Slack drafts  |
| `test_ai_deal_finder.py`          | offline tests (38, no network)           |
