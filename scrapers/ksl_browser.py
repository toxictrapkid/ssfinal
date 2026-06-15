"""KSL Cars scraper — browser path (PerimeterX bypass).

KSL deployed PerimeterX/HUMAN bot protection after the KSLHax era, so the plain
`requests` path (ksl.py) now gets a 403 PerimeterX challenge. This module runs a
real Chromium via Playwright so PerimeterX's JS sensor executes and sets the
_px3 cookie, then issues KSL's own JSON API call *from inside the page context*
(same origin, cookies attached). The raw items go through the same
parse.normalize_ksl_batch as the requests path, so output is identical §5 shape.

Anti-detection: realistic UA/viewport/locale, AutomationControlled disabled, and
an init script that strips the usual headless tells (navigator.webdriver,
chrome runtime, plugins, languages). Optionally routes through a residential
proxy (KSL_PROXY_URL) for a positive IP trust score — recommended, since a
datacenter IP carries a negative PerimeterX trust score.

Usage:
    python ksl_browser.py --config '{"zip":"84104","radiusMiles":150,...}'
Emits the normalized §5 JSON array on stdout. Logs to stderr. Exit 0 ok / 2 fail.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Any
from urllib.parse import quote

from parse import normalize_ksl_batch
from ksl import API_ENDPOINT, PER_PAGE, build_search_segments

log = logging.getLogger("carhunter.ksl_browser")

PROXY_URL = os.environ.get("KSL_PROXY_URL") or None
DEFAULT_MAX_PAGES = 5
NAV_TIMEOUT_MS = 60_000

# Stealth init script: remove the standard automation fingerprints PerimeterX checks.
STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
window.chrome = { runtime: {} };
const origQuery = window.navigator.permissions && window.navigator.permissions.query;
if (origQuery) {
  window.navigator.permissions.query = (p) => (
    p && p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : origQuery(p)
  );
}
"""

# In-page fetch: KSL's own envelope (matches ksl.py), same-origin so _px3 rides along.
JS_FETCH = """
async ([endpoint, body]) => {
  const payload = {
    endpoint: endpoint,
    options: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "cars-node",
        "X-App-Source": "frontline",
        "X-DDM-EVENT-USER-AGENT": {},
        "X-DDM-EVENT-ACCEPT-LANGUAGE": "en-US",
        "X-MEMBER-ID": null,
        "cookie": ""
      },
      body: body
    }
  };
  const res = await fetch("https://cars.ksl.com/nextjs-api/proxy?", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}
"""

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def build_search_url(config: dict[str, Any]) -> str:
    """Human-facing KSL search URL (segments are URL-encoded for the address bar)."""
    segments = build_search_segments(config)
    encoded = "/".join(quote(s, safe=";+") for s in segments)
    return "https://cars.ksl.com/search/" + encoded


def _looks_blocked(html: str) -> bool:
    markers = ("Access to this page has been denied", "perimeterx", "px-captcha", "Please verify you are a human")
    low = html.lower()
    return any(m.lower() in low for m in markers)


async def _scrape(config: dict[str, Any], max_pages: int) -> list[dict]:
    from playwright.async_api import async_playwright

    search_url = build_search_url(config)
    log.info("KSL search URL: %s", search_url)

    launch_args = [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
    ]
    proxy = None
    if PROXY_URL:
        # Parse user:pass@host:port (scheme optional) into Playwright proxy dict.
        raw = PROXY_URL
        for pre in ("https://", "http://"):
            if raw.startswith(pre):
                raw = raw[len(pre):]
                break
        creds, _, hostport = raw.rpartition("@")
        username, _, password = creds.partition(":")
        proxy = {"server": f"https://{hostport}", "username": username, "password": password}
        log.info("routing browser through proxy server=%s user=%s", proxy["server"], username)

    raw_items: list[dict] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=launch_args, proxy=proxy)
        context = await browser.new_context(
            user_agent=UA,
            locale="en-US",
            timezone_id="America/Denver",
            viewport={"width": 1366, "height": 850},
            ignore_https_errors=True,
        )
        await context.add_init_script(STEALTH_JS)
        page = await context.new_page()
        page.set_default_navigation_timeout(NAV_TIMEOUT_MS)
        try:
            await page.goto(search_url, wait_until="domcontentloaded")
            # Give PerimeterX's sensor time to run and the SPA to settle.
            try:
                await page.wait_for_load_state("networkidle", timeout=30_000)
            except Exception:
                pass
            html = await page.content()
            if _looks_blocked(html):
                log.warning("PerimeterX challenge/block detected on first load; waiting for resolve")
                await page.wait_for_timeout(8_000)
                html = await page.content()
                if _looks_blocked(html):
                    raise RuntimeError("PerimeterX still blocking after browser load")

            segments = build_search_segments(config)
            for page_num in range(1, max_pages + 1):
                body = [*segments, "perPage", PER_PAGE, "page", page_num, "es_query_group", None]
                result = await page.evaluate(JS_FETCH, [API_ENDPOINT, body])
                status = result.get("status")
                data = result.get("data") or {}
                items = (data.get("data") or {}).get("items") if isinstance(data, dict) else None
                if status != 200:
                    raise RuntimeError(f"KSL API page {page_num} returned status {status}")
                if not items:
                    log.info("KSL page %d: empty, stopping", page_num)
                    break
                log.info("KSL page %d: %d items", page_num, len(items))
                raw_items.extend(items)
                await page.wait_for_timeout(1200)  # polite, human-ish pacing
        finally:
            await context.close()
            await browser.close()
    return raw_items


def run(config: dict[str, Any], max_pages: int) -> list[dict]:
    raw_items = asyncio.run(_scrape(config, max_pages))
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
    args = parser.parse_args(argv)

    config = json.loads(args.config)
    try:
        listings = run(config, args.max_pages)
    except Exception as exc:  # noqa: BLE001 - top-level CLI guard
        log.error("browser scrape failed: %s", exc)
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
