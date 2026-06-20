"""Find KSL 'needs engine'-type mechanic specials in the live feed.

Pulls active listings from the Convex deployment (anonymous public query, no
admin key), fetches each listing's seller DESCRIPTION through the Bright Data Web
Unlocker (scrapers/ksl_detail.py), classifies the drivetrain issue, and prints
the cheap / below-book / low-miles matches — the wholesale plays.

Requires BRIGHTDATA_API_TOKEN (Web Unlocker). Reads the deployment URL from
CONVEX_URL env or .env.local, or --convex-url.

Usage:
    BRIGHTDATA_API_TOKEN=... python3 scripts/find_mechanic_specials.py
    BRIGHTDATA_API_TOKEN=... python3 scripts/find_mechanic_specials.py --max-price 12000 --limit 120
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import pathlib

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scrapers"))
from ksl_detail import fetch_detail  # noqa: E402


def convex_url() -> str:
    if os.environ.get("CONVEX_URL"):
        return os.environ["CONVEX_URL"].rstrip("/")
    env = pathlib.Path(__file__).resolve().parent.parent / ".env.local"
    if env.exists():
        m = re.search(r"^CONVEX_URL=(\S+)", env.read_text(), re.M)
        if m:
            return m.group(1).rstrip("/")
    raise SystemExit("set CONVEX_URL or --convex-url")


def convex_query(base: str, path: str, args: dict) -> list[dict]:
    r = requests.post(f"{base}/api/query", json={"path": path, "args": args, "format": "json"}, timeout=60)
    r.raise_for_status()
    data = r.json()
    if data.get("status") != "success":
        raise SystemExit(f"convex query {path} failed: {data}")
    return data["value"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--convex-url", default=None)
    ap.add_argument("--max-price", type=int, default=None, help="only inspect listings <= this asking price")
    ap.add_argument("--limit", type=int, default=300, help="max listings to inspect (cheapest first)")
    ap.add_argument("--out", default="needs_engine.json")
    args = ap.parse_args()

    if not os.environ.get("BRIGHTDATA_API_TOKEN"):
        raise SystemExit("BRIGHTDATA_API_TOKEN is not set (required for the Web Unlocker)")

    base = (args.convex_url or convex_url()).rstrip("/")
    rows = convex_query(base, "listings:feed", {"limit": 300, "includeGone": False})
    if args.max_price is not None:
        rows = [r for r in rows if r.get("price", 0) <= args.max_price]
    # cheapest first — mechanic specials cluster at the low end
    rows.sort(key=lambda r: r.get("price", 1e9))
    rows = rows[: args.limit]
    print(f"inspecting {len(rows)} active listings for drivetrain-issue descriptions...", file=sys.stderr)

    matches = []
    for i, r in enumerate(rows, 1):
        sid = r.get("sourceListingId") or (r.get("url", "").rstrip("/").split("/")[-1])
        det = fetch_detail(sid)
        if det.get("matched"):
            spread = (r.get("estValue") or 0) - r.get("price", 0)
            matches.append({**r, "issue": det["issue"], "description": det["description"], "belowBook": spread})
            print(f"  [{i}/{len(rows)}] MATCH {det['issue']}: {r.get('year')} {r.get('make')} {r.get('model')} "
                  f"${r.get('price')} / {r.get('mileage')}mi", file=sys.stderr)
        elif det.get("error"):
            print(f"  [{i}/{len(rows)}] err {sid}: {det['error']}", file=sys.stderr)

    matches.sort(key=lambda m: m["belowBook"], reverse=True)
    pathlib.Path(args.out).write_text(json.dumps(matches, indent=2))

    print(f"\n=== {len(matches)} mechanic specials (description names a drivetrain issue) ===")
    print("issue | $price | miles | book | belowBook | score | vehicle | url")
    for m in matches:
        print(f"{m['issue']:>6} | ${m['price']} | {m.get('mileage')}mi | ${m.get('estValue')} | "
              f"${m['belowBook']} | {m.get('dealScore')} | {m.get('year')} {m.get('make')} {m.get('model')} "
              f"{m.get('trim') or ''} | {m.get('url')}")
        snippet = (m.get("description") or "").strip().replace("\n", " ")
        print(f"        → {snippet[:160]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
