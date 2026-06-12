"""Facebook Marketplace scraper — DEFERRED.

Standing user override (2026-06-12, PROGRESS.md): KSL-only scope; no FB
credentials will be provided. This stub keeps the multi-source contract so
run.py can skip the source cleanly without failing a whole run.

Re-enable plan (reference reuse map in PROGRESS.md):
  - session cookie from Convex settings.fbSessionCookie (never a password — RULES #5)
  - scroll/parse loop from reference facebook-marketplace-scraper-1.1.0/scraper.py
  - cookie injection + abort_requests image blocking + search-URL builder from
    reference scrape_marketplace.py
  - normalize via parse.py into the same §5 shape ksl.py emits
"""
from __future__ import annotations

import logging
import sys

log = logging.getLogger("carhunter.facebook")


class ScraperDisabled(RuntimeError):
    """Raised when a deferred/disabled scraper is invoked."""


def run(config: dict, max_pages: int = 0, items_file: str | None = None) -> list[dict]:
    raise ScraperDisabled(
        "facebook: deferred by standing user override 2026-06-12 (KSL-only scope)"
    )


def main() -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    log.error("facebook scraper is deferred by user override 2026-06-12; nothing to do")
    return 3


if __name__ == "__main__":
    sys.exit(main())
