"""KSL Cars scraper — Bright Data Web Unlocker path (PerimeterX bypass).

KSL now runs PerimeterX/HUMAN bot protection, so the plain-`requests` path
(ksl.py) and a headless browser from a datacenter IP both get 403'd. Bright
Data's Web Unlocker solves PerimeterX automatically and renders the page from a
residential exit. We GET the human-facing KSL search page through the Web
Unlocker *API* (api.brightdata.com/request — plain HTTPS:443, Bearer auth, so it
needs no special ports and is immune to proxy IP-allowlists), then extract the
listing objects KSL embeds in its Next.js RSC stream (self.__next_f pushes).

Those RSC objects are KSL's own listing records; we adapt them to the field
shape parse.normalize_ksl (built for the legacy JSON API) expects, so the rest
of the pipeline — dedupe, scoring, alerts — is unchanged. parse.py is untouched.

Env:
    BRIGHTDATA_API_TOKEN   Bright Data API token (Bearer)         [required]
    BRIGHTDATA_ZONE        Web Unlocker zone name (default: web_unlocker1)

Usage:
    BRIGHTDATA_API_TOKEN=... python ksl_unlocker.py --config '{"zip":"84104",...}'
Emits the normalized §5 JSON array on stdout. Logs to stderr. Exit 0 ok / 2 fail.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Any
from urllib.parse import quote

import requests

from parse import normalize_ksl_batch
from ksl import build_search_segments

log = logging.getLogger("carhunter.ksl_unlocker")

BRD_API = "https://api.brightdata.com/request"
API_TOKEN = os.environ.get("BRIGHTDATA_API_TOKEN") or ""
ZONE = os.environ.get("BRIGHTDATA_ZONE", "web_unlocker1")
# KSL's search page server-renders only the default (newest-first) first batch of
# ~24 results; sort and deeper pagination are applied CLIENT-SIDE via the API
# (which PerimeterX blocks for bare POSTs), so URL `/page/N` and `/sort/...`
# segments do not change the rendered set. Coverage therefore comes from (a)
# scanning newest-first frequently to catch new listings as they post, and (b)
# filter granularity (every filter — make/model/year/mileage/price/zip/radius/
# title — is honored by KSL and verified). Default to a single page per scan.
PER_PAGE = 24
DEFAULT_MAX_PAGES = 1
MAX_RETRIES = 3
BACKOFF_SECONDS = (3, 6)

# Match each KSL listing record embedded in the RSC stream. KSL serializes every
# search result as {"id":<n>,"listingType":"CAR",...}; we balance braces from there.
_LISTING_RE = re.compile(r'\{"id":\d+,"listingType":"CAR"')
_PUSH_RE = re.compile(r'self\.__next_f\.push\(\[1,\s*(".*?")\]\)', re.S)


class UnlockerError(RuntimeError):
    """Web Unlocker / KSL fetch failed after retries."""


def build_search_url(config: dict[str, Any], page: int) -> str:
    """Human-facing KSL search URL for the given page (1-based)."""
    segments = build_search_segments(config)
    if page > 1:
        segments = ["page", str(page), *segments]
    encoded = "/".join(quote(s, safe=";+") for s in segments)
    return "https://cars.ksl.com/search/" + encoded


def _fetch_page_html(url: str) -> str:
    """GET a URL through the Web Unlocker API; returns the rendered HTML."""
    if not API_TOKEN:
        raise UnlockerError("BRIGHTDATA_API_TOKEN is not set")
    body = {"zone": ZONE, "url": url, "format": "raw"}
    headers = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(BRD_API, headers=headers, json=body, timeout=180)
            if resp.status_code != 200:
                raise UnlockerError(f"Web Unlocker returned {resp.status_code}: {resp.text[:200]}")
            html = resp.text
            low = html.lower()
            if "perimeterx" in low or "px2sz8xyop" in low or "access to this page has been denied" in low:
                raise UnlockerError("PerimeterX block page returned by Web Unlocker")
            return html
        except (requests.RequestException, UnlockerError) as exc:
            last = exc
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_SECONDS[attempt]
                log.warning("page fetch attempt %d/%d failed (%s); retry in %ds",
                            attempt + 1, MAX_RETRIES, exc, wait)
                time.sleep(wait)
    raise UnlockerError(f"page fetch failed after {MAX_RETRIES} attempts: {last}")


def _decode_rsc_stream(html: str) -> str:
    """Concatenate the self.__next_f string pushes back into the RSC payload."""
    stream_parts: list[str] = []
    for raw in _PUSH_RE.findall(html):
        try:
            stream_parts.append(json.loads(raw))  # unescape the JS string literal
        except (ValueError, TypeError):
            continue
    return "".join(stream_parts)


def _extract_object(s: str, start: int) -> str | None:
    """Return the complete JSON object starting at s[start]=='{' (string-aware)."""
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[start:i + 1]
    return None


def extract_listings(html: str) -> list[dict]:
    """Pull KSL listing records out of the rendered page's RSC stream."""
    stream = _decode_rsc_stream(html)
    out: list[dict] = []
    for m in _LISTING_RE.finditer(stream):
        obj_txt = _extract_object(stream, m.start())
        if not obj_txt:
            continue
        try:
            out.append(json.loads(obj_txt))
        except ValueError:
            continue
    return out


def _rsc_to_api_item(r: dict) -> dict:
    """Adapt a KSL RSC listing record to the field shape parse.normalize_ksl wants.

    parse.py reads top-level city/state/zip, photo[].id|url, displayTime/createTime,
    titleType. The RSC record nests location.{} and uses primaryImage.url /
    displayAt / createdAt, and omits titleType + description on the search page.
    """
    loc = r.get("location") or {}
    img = r.get("primaryImage") or {}
    photo: Any = None
    if isinstance(img, dict) and img.get("url") and not r.get("noImage"):
        photo = [{"url": img["url"]}]
    elif r.get("media"):
        photo = r.get("media")
    return {
        "id": r.get("id"),
        "price": r.get("price"),
        "sellerType": r.get("sellerType"),
        "make": r.get("make"),
        "model": r.get("model"),
        "trim": r.get("trim"),
        "makeYear": r.get("makeYear"),
        "mileage": r.get("mileage"),
        "vin": r.get("vin"),
        "titleType": r.get("titleType"),  # absent on search page -> titleStatus "unknown"
        "city": loc.get("city"),
        "state": loc.get("state"),
        "zip": loc.get("zip"),
        "photo": photo,
        "displayTime": r.get("displayAt"),
        "createTime": r.get("createdAt"),
        "title": r.get("title"),
        "description": None,
    }


def fetch_all_items(config: dict[str, Any], max_pages: int = DEFAULT_MAX_PAGES) -> list[dict]:
    """Scrape pages through the Web Unlocker; return adapted raw items (deduped by id)."""
    seen: set[Any] = set()
    items: list[dict] = []
    for page in range(1, max_pages + 1):
        url = build_search_url(config, page)
        log.info("fetching page %d: %s", page, url)
        html = _fetch_page_html(url)
        records = extract_listings(html)
        log.info("page %d: %d listing records extracted", page, len(records))
        new = 0
        for r in records:
            rid = r.get("id")
            if rid in seen:
                continue
            seen.add(rid)
            items.append(_rsc_to_api_item(r))
            new += 1
        if new == 0:
            log.info("page %d added no new listings; stopping pagination", page)
            break
        if page < max_pages:
            time.sleep(1.5)  # polite pacing between unlocker calls
    return items


def run(config: dict[str, Any], max_pages: int) -> list[dict]:
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
    parser.add_argument("--out", help="write listings JSON here instead of stdout")
    parser.add_argument("--raw-out", help="also write the adapted raw items here (debug)")
    args = parser.parse_args(argv)

    config = json.loads(args.config)
    try:
        if args.raw_out:
            raw = fetch_all_items(config, max_pages=args.max_pages)
            with open(args.raw_out, "w", encoding="utf-8") as fh:
                json.dump(raw, fh, indent=2)
            listings, stats = normalize_ksl_batch(raw, search_zip=config.get("zip", "84104"))
            log.info("normalized: %s", stats)
        else:
            listings = run(config, args.max_pages)
    except UnlockerError as exc:
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
