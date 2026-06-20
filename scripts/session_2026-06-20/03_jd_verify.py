#!/usr/bin/env python3
"""
Verify the MarketCheck-based spread against REAL J.D. clean trade-in values.

MarketCheck exposes no J.D. Power / NADA book values, so true J.D. clean
trade-in is sourced from the prior Carbly appraisal runs still stored in the
platform (field carblyJdCleanTrade). This joins those to the freshly-scraped
+ MarketCheck-valued cars by VIN and compares the two spread bases.

J.D. spread = jdCleanTrade - price - 800   (same recon+fees as the MC spread)

INPUT:
  /tmp/feedrun.json     -- platform feed snapshot (carbly JD values)
  /tmp/val{1..4}.json   -- MarketCheck valuations
  /tmp/fresh_scrape.json-- the 134 live-scraped cars (VIN, price, url)
OUTPUT: prints the verification table + summary (median MC-vs-JD gap).
"""
import json
import statistics as st

stale = {r.get("vin"): r for r in json.load(open("/tmp/feedrun.json"))["value"]
         if r.get("vin")}
val = {}
for i in [1, 2, 3, 4]:
    for r in json.load(open(f"/tmp/val{i}.json")):
        val[r["key"]] = r
fresh = json.load(open("/tmp/fresh_scrape.json"))

rows = []
for fr in fresh:
    vin = fr.get("vin")
    if not vin or vin not in stale:
        continue
    jd = stale[vin].get("carblyJdCleanTrade")
    if not jd:
        continue
    v = val.get(vin) or val.get(fr.get("sourceListingId"))
    if not v or v.get("estValue") is None:
        continue
    rows.append({
        "veh": v["vehicle"], "price": fr["price"], "jd": int(jd),
        "mc": v["estValue"], "mc_spread": v["spread"],
        "jd_spread": round(jd - fr["price"] - 800), "url": fr.get("url"),
    })

rows.sort(key=lambda r: r["jd_spread"], reverse=True)
print(f"{'JDspr':>7} {'MCspr':>7} {'price':>6} {'JDtrade':>7} {'MCest':>7} {'MC-JD':>6}  vehicle")
for r in rows:
    print(f'{r["jd_spread"]:>+7} {r["mc_spread"]:>+7} {r["price"]:>6} {r["jd"]:>7} '
          f'{r["mc"]:>7} {r["mc"] - r["jd"]:>+6}  {r["veh"]}')

gaps = [r["mc"] - r["jd"] for r in rows]
hot = sum(1 for r in rows if r["jd_spread"] >= 1500)
print(f"\n{len(rows)} verified | MarketCheck median ${round(st.median(gaps))} ABOVE JD "
      f"clean-trade | {hot}/{len(rows)} still HOT on the JD basis")
