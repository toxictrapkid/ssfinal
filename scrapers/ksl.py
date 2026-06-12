"""KSL Cars scraper — JSON API client.

Reused from reference KSLHax-1.2/hax.py (RULES #2): same proxy endpoint, same
request envelope, same URL-segment grammar, same paginate-until-empty loop.
Refactored for production: retry/backoff on every network call, structured
stderr logging, typed errors instead of bare asserts, config-driven segments.
Behavior of the reused parts is unchanged.

Usage (sandbox entrypoint run.py drives this; CLI for local runs/tests):
    python ksl.py --config '{"makes":["Chevrolet"],"models":["Traverse"],...}'
    python ksl.py --config '{}' --items-file tests/fixtures/ksl_items.json

Emits the normalized §5 JSON array on stdout. Logs go to stderr only.
Exit codes: 0 = ok, 2 = network/API failure after retries.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from typing import Any

import requests

from parse import normalize_ksl_batch

log = logging.getLogger("carhunter.ksl")

PROXY_URL = "https://cars.ksl.com/nextjs-api/proxy?"
API_ENDPOINT = "/classifieds/cars/search/searchByUrlParams"
PER_PAGE = 24  # reference value — KSL's own page size
MAX_RETRIES = 3
BACKOFF_SECONDS = (2, 4)  # waits between the 3 attempts
DEFAULT_MAX_PAGES = 5  # matches requestAllCars' signature default (GUI passes its own)


class KslApiError(RuntimeError):
    """KSL API failure that survived all retries."""


def build_search_segments(config: dict[str, Any]) -> list[str]:
    """Convex search config -> KSL URL path segments.

    Grammar from the reference main_url (hax.py): alternating name/value path
    segments; multi-values joined with ";". hax.py unquote_plus()es the URL
    before splitting, so segment values use plain spaces ("Clean Title").
    sellerType FSBO is always applied — private-party only (RULES #4) — with
    parse.py's dealer filter as the second line of defense.
    """
    segments: list[str] = []

    def add(name: str, value: Any) -> None:
        if value is None or value == "" or value == []:
            return
        if isinstance(value, list):
            value = ";".join(str(v) for v in value)
        segments.extend([name, str(value)])

    add("make", config.get("makes"))
    add("model", config.get("models"))
    add("yearFrom", config.get("yearMin"))
    add("yearTo", config.get("yearMax"))
    add("mileageFrom", config.get("mileageMin"))
    add("mileageTo", config.get("mileageMax"))
    add("priceFrom", config.get("priceMin"))
    add("priceTo", config.get("priceMax"))
    add("zip", config.get("zip"))
    add("miles", config.get("radiusMiles"))
    if config.get("cleanTitleOnly"):
        add("titleType", "Clean Title")
    add("sellerType", "For Sale By Owner")
    return segments


def _request_page(
    session: requests.Session, segments: list[str], page: int
) -> list[dict]:
    """One page of raw items, with retry/backoff. Reference envelope verbatim."""
    body: list[Any] = [*segments, "perPage", PER_PAGE, "page", page, "es_query_group", None]
    payload = {
        "endpoint": API_ENDPOINT,
        "options": {
            "method": "POST",
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "cars-node",
                "X-App-Source": "frontline",
                "X-DDM-EVENT-USER-AGENT": {},
                "X-DDM-EVENT-ACCEPT-LANGUAGE": "en-US",
                "X-MEMBER-ID": None,
                "cookie": "",
            },
            "body": body,
        },
    }
    # Exactly the headers the reference sends on the wire. hax.py builds an
    # adjusted_headers dict with a Referer but then posts with the ORIGINAL
    # headers (hax.py:65), so no Referer goes out — we match that behavior
    # (M3 reviewer finding #6).
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Content-Type": "application/json",
        "Host": "cars.ksl.com",
        "Origin": "https://cars.ksl.com",
    }

    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            response = session.post(
                PROXY_URL, headers=headers, json=payload, timeout=30
            )
            if response.status_code != 200:
                raise KslApiError(
                    f"KSL API returned {response.status_code}: {response.text[:200]}"
                )
            data = response.json()
            items = (data.get("data") or {}).get("items")
            if items is None:
                raise KslApiError(f"KSL API response missing data.items: {str(data)[:200]}")
            return items
        except (requests.RequestException, ValueError, KslApiError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_SECONDS[attempt]
                log.warning(
                    "KSL page %d attempt %d/%d failed (%s); retrying in %ds",
                    page, attempt + 1, MAX_RETRIES, exc, wait,
                )
                time.sleep(wait)
    raise KslApiError(f"KSL page {page} failed after {MAX_RETRIES} attempts: {last_error}")


def fetch_all_items(
    config: dict[str, Any],
    max_pages: int = DEFAULT_MAX_PAGES,
    session: requests.Session | None = None,
) -> list[dict]:
    """All raw items for a search config (paginate until empty page — reference
    requestAllCars loop, plus the page cap)."""
    segments = build_search_segments(config)
    log.info("KSL search segments: %s", "/".join(segments))
    own_session = session is None
    session = session or requests.Session()
    items: list[dict] = []
    try:
        for page in range(1, max_pages + 1):
            page_items = _request_page(session, segments, page)
            log.info("KSL page %d: %d items", page, len(page_items))
            if not page_items:
                break
            items.extend(page_items)
    finally:
        if own_session:
            session.close()
    return items


def run(config: dict[str, Any], max_pages: int, items_file: str | None) -> list[dict]:
    """Fetch (or load) raw items, normalize, return §5 listings."""
    if items_file:
        log.info("offline mode: loading raw items from %s", items_file)
        with open(items_file, encoding="utf-8") as fh:
            raw_items = json.load(fh)
    else:
        raw_items = fetch_all_items(config, max_pages=max_pages)

    listings, stats = normalize_ksl_batch(raw_items, search_zip=config.get("zip", "84104"))
    log.info("normalized: %s", stats)
    return listings


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="search config JSON")
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES)
    parser.add_argument(
        "--items-file", help="load raw API items from a JSON file instead of the network"
    )
    parser.add_argument("--out", help="write listings JSON here instead of stdout")
    args = parser.parse_args(argv)

    config = json.loads(args.config)
    try:
        listings = run(config, args.max_pages, args.items_file)
    except KslApiError as exc:
        log.error("scrape failed: %s", exc)
        return 2

    output = json.dumps(listings, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(output)
    else:
        print(output)
    log.info("emitted %d listings", len(listings))
    return 0


if __name__ == "__main__":
    sys.exit(main())
