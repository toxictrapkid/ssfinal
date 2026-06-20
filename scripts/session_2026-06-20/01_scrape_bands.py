#!/usr/bin/env python3
"""
Live KSL band-sweep scrape via the Bright Data Web Unlocker.

Pulls private-party cars matching: price < $12,000, model-year >= 2016,
mileage < 99,000, around zip 84104 / 150-mile radius.

WHY BANDS: KSL's search page server-renders only the newest ~24 results per
filter (deeper pagination/sort is client-side and not honored by a raw fetch),
so full coverage comes from many NARROW price + mileage bands, deduped by
VIN/listing-id. This consolidates the three passes run live in the session.

REQUIRES: BRIGHTDATA_API_TOKEN (and optional BRIGHTDATA_ZONE, default
web_unlocker1) in the environment. Uses the repo's scrapers/ksl_unlocker.py.

OUTPUT: /tmp/fresh_scrape.json  (normalized listings, deduped, filtered)
"""
import os
import sys
import json
import time

sys.path.insert(0, "scrapers")
import ksl_unlocker as ku  # noqa: E402

BASE = dict(zip="84104", radiusMiles=150, yearMin=2016)


def scan(uniq, cfg, label):
    """Run one band; merge new uniques (keyed by VIN else listing id)."""
    try:
        listings = ku.run(cfg, 1)
    except Exception as e:  # network / PerimeterX / parse — log, keep going
        print("ERR", label, str(e)[:120], file=sys.stderr)
        return
    added = 0
    for l in listings:
        k = l.get("vin") or l.get("sourceListingId")
        if k and k not in uniq:
            uniq[k] = l
            added += 1
    print(f"{label:<26} -> {len(listings):2d} (+{added}, tot {len(uniq)})", file=sys.stderr)
    time.sleep(0.8)  # polite pacing between Web Unlocker calls


def main():
    if not os.environ.get("BRIGHTDATA_API_TOKEN"):
        sys.exit("set BRIGHTDATA_API_TOKEN (Bright Data Web Unlocker token)")
    uniq = {}

    # Pass 1 — $1k price bands across $500-$12,000, full mileage window.
    bands = [(500, 2000), (2000, 3000), (3000, 4000), (4000, 5000), (5000, 6000),
             (6000, 7000), (7000, 8000), (8000, 9000), (9000, 10000),
             (10000, 11000), (11000, 12000)]
    for pmin, pmax in bands:
        scan(uniq, dict(BASE, priceMin=pmin, priceMax=pmax, mileageMin=0, mileageMax=99000),
             f"${pmin}-{pmax}")

    # Pass 2 — $500 bands x hi/lo mileage split over the saturated $6k-$12k region.
    p = 6000
    while p < 12000:
        for mmin, mmax in [(0, 60000), (60000, 99000)]:
            scan(uniq, dict(BASE, priceMin=p, priceMax=p + 500, mileageMin=mmin, mileageMax=mmax),
                 f"${p}-{p + 500} {mmin // 1000}-{mmax // 1000}k")
        p += 500

    # Pass 3 — finer mileage split on the still-capped high bands.
    p = 7500
    while p < 12000:
        for mmin, mmax in [(60000, 75000), (75000, 90000), (90000, 99000)]:
            scan(uniq, dict(BASE, priceMin=p, priceMax=p + 500, mileageMin=mmin, mileageMax=mmax),
                 f"${p}-{p + 500} {mmin // 1000}-{mmax // 1000}k")
        p += 500

    def ok(l):
        pr, y, m = l.get("price"), l.get("year"), l.get("mileage")
        return (pr is not None and pr < 12000) and (y and y >= 2016) and (m is None or m < 99000)

    rows = [l for l in uniq.values() if ok(l)]
    rows.sort(key=lambda l: l.get("price") or 0)
    json.dump(rows, open("/tmp/fresh_scrape.json", "w"), indent=2)
    print(f"TOTAL unique matches: {len(rows)}")


if __name__ == "__main__":
    main()
