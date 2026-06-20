#!/usr/bin/env python3
"""
Merge the 4 per-chunk valuation files and rank by appraisal spread.

Appraisal spread (matches convex/lib/scoreMath.ts estProfitOf):
    spread = estValue - price - estRecon - estFees
with estRecon = $400 (base; no drivetrain description available here) and
estFees = $400, i.e. spread = estValue - price - 800.

estValue is the MarketCheck national used-dealer median in a +/-10k-mile
window, x1.03 if AWD — computed per car by 04_value (the parallel agents),
written to /tmp/val{1..4}.json.

INPUT:  /tmp/val1.json .. /tmp/val4.json  (+ /tmp/fresh_scrape.json for loc/title)
OUTPUT: platform_RANKED_by_spread.csv
"""
import json
import csv

rows = []
for f in [1, 2, 3, 4]:
    rows += json.load(open(f"/tmp/val{f}.json"))

scr = {(r.get("vin") or r.get("sourceListingId")): r
       for r in json.load(open("/tmp/fresh_scrape.json"))}
for r in rows:
    s = scr.get(r["key"], {})
    r["location"] = s.get("location")
    r["titleStatus"] = s.get("titleStatus")  # 'unknown' from search pages

valued = [r for r in rows if r.get("spread") is not None]
thin = [r for r in rows if r.get("spread") is None]
valued.sort(key=lambda r: r["spread"], reverse=True)
ranked = valued + thin

cols = ["rank", "spread", "price", "estValue", "compCount", "mileage",
        "vehicle", "location", "key", "url"]
with open("platform_RANKED_by_spread.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(cols)
    for i, r in enumerate(ranked, 1):
        w.writerow([i, r.get("spread"), r.get("price"), r.get("estValue"),
                    r.get("compCount"), r.get("mileage"), r.get("vehicle"),
                    r.get("location"), r.get("key"), r.get("url")])

hot = sum(1 for r in valued if r["spread"] >= 1500)
print(f"TOTAL {len(rows)} | valued {len(valued)} | thin {len(thin)} | "
      f"positive {sum(1 for r in valued if r['spread'] > 0)} | HOT(>=1500) {hot}")
