"""Scraper orchestrator — the sandbox entrypoint (ARCHITECTURE §7/§8).

Takes one search config JSON, runs each enabled source's scraper, and POSTs
normalized listings to Convex /ingest in batches. Per-source failure isolation:
a disabled or crashing source is logged and skipped; the run fails (exit 2)
only when every enabled source failed.

    python run.py --config '{"sources":["ksl"],"zip":"84104",...,
                             "ingestUrl":"https://.../ingest",
                             "ingestSecret":"..."}'
    python run.py --config '...' --items-file fixtures.json   # offline KSL source
    python run.py --config '...' --dry-run                    # no POST, print summary

Emits one JSON summary line on stdout; logs on stderr.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from typing import Any, Callable

import requests

import facebook
import ksl
from facebook import ScraperDisabled

log = logging.getLogger("carhunter.run")

BATCH_SIZE = 50
POST_RETRIES = 3
POST_BACKOFF_SECONDS = (2, 4)

SCRAPERS: dict[str, Callable[..., list[dict]]] = {
    "ksl": ksl.run,
    "facebook": facebook.run,
}


def post_batch(
    session: requests.Session,
    ingest_url: str,
    ingest_secret: str,
    search_id: str | None,
    batch: list[dict],
) -> dict:
    """POST one batch with retry/backoff; returns the ingest summary.

    No batch-level source label — each listing carries its own `source`
    (mixed-source batches are legal once FB re-enables)."""
    payload: dict[str, Any] = {"listings": batch}
    if search_id:
        payload["searchId"] = search_id

    last_error: Exception | None = None
    for attempt in range(POST_RETRIES):
        try:
            response = session.post(
                ingest_url,
                json=payload,
                headers={"X-Ingest-Secret": ingest_secret},
                timeout=30,
            )
            if response.status_code == 200:
                return response.json()
            # 4xx (bad secret/shape) won't heal with retries — fail fast
            if 400 <= response.status_code < 500:
                raise RuntimeError(
                    f"ingest rejected batch ({response.status_code}): {response.text[:200]}"
                )
            raise RuntimeError(
                f"ingest {response.status_code}: {response.text[:200]}"
            )
        except RuntimeError as exc:
            if "rejected batch" in str(exc):
                raise
            last_error = exc
        except requests.RequestException as exc:
            last_error = exc
        if attempt < POST_RETRIES - 1:
            wait = POST_BACKOFF_SECONDS[attempt]
            log.warning("ingest POST attempt %d failed (%s); retrying in %ds",
                        attempt + 1, last_error, wait)
            time.sleep(wait)
    raise RuntimeError(f"ingest POST failed after {POST_RETRIES} attempts: {last_error}")


def run_source(source: str, config: dict, args: argparse.Namespace) -> list[dict]:
    scraper = SCRAPERS.get(source)
    if scraper is None:
        # an unknown source is a config bug, not a deliberate deferral —
        # count it as a failure (M4 reviewer advisory A5)
        raise RuntimeError(f"{source}: unknown source (known: {sorted(SCRAPERS)})")
    if source == "ksl":
        return scraper(config, max_pages=args.max_pages, items_file=args.items_file)
    return scraper(config)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--max-pages", type=int, default=ksl.DEFAULT_MAX_PAGES)
    parser.add_argument("--items-file", help="offline raw-items source for the ksl scraper")
    parser.add_argument("--dry-run", action="store_true", help="scrape + normalize, no POST")
    args = parser.parse_args(argv)

    config = json.loads(args.config)
    sources: list[str] = config.get("sources") or ["ksl"]
    ingest_url = config.get("ingestUrl")
    ingest_secret = config.get("ingestSecret")
    if not args.dry_run and (not ingest_url or not ingest_secret):
        log.error("config must include ingestUrl + ingestSecret (or use --dry-run)")
        return 2

    summary: dict[str, Any] = {"sources": {}, "posted": 0, "ingest": None}
    failures = 0
    disabled = 0
    all_listings: list[dict] = []

    for source in sources:
        try:
            listings = run_source(source, config, args)
            all_listings.extend(listings)
            summary["sources"][source] = {"ok": True, "listings": len(listings)}
            log.info("%s: %d listings", source, len(listings))
        except ScraperDisabled as exc:
            disabled += 1
            summary["sources"][source] = {"ok": False, "disabled": True, "reason": str(exc)}
            log.warning("skipping disabled source: %s", exc)
        except Exception as exc:
            failures += 1
            summary["sources"][source] = {"ok": False, "error": str(exc)}
            log.exception("source %s failed", source)

    enabled_attempts = len(sources) - disabled
    if enabled_attempts > 0 and failures == enabled_attempts:
        log.error("every enabled source failed")
        print(json.dumps(summary))
        return 2

    if args.dry_run:
        summary["dryRun"] = True
        print(json.dumps(summary))
        return 0

    totals = {"inserted": 0, "updated": 0, "priceDrops": 0, "relists": 0,
              "skipped": 0, "preSkipped": 0}
    with requests.Session() as session:
        for start in range(0, len(all_listings), BATCH_SIZE):
            batch = all_listings[start : start + BATCH_SIZE]
            result = post_batch(
                session, ingest_url, ingest_secret, config.get("searchId"), batch,
            )
            summary["posted"] += len(batch)
            for key in totals:
                totals[key] += int(result.get(key, 0))
    summary["ingest"] = totals

    print(json.dumps(summary))
    log.info("run complete: %s", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
