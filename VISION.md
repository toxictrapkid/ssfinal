# VISION.md — What "done" means for CarHunter

CarHunter is shipped when ALL of the following are true, verified end-to-end with zero human action after setup:

1. Open the app → the 7 seeded buy-box searches (spec §2, SLC 84104, 150-mi radius, every 15 min) are already running on schedule.
2. The home feed shows a live, ranked list of **private-party** cars: photo, YMM+trim, miles, asking price, est. value, **est. profit**, deal score (0–100), source badge, distance, days listed, listing link.
3. Any car with `estProfit ≥ $1,500` is flagged HOT and an email/SMS alert fires the moment it lands — once per car unless its price drops.
4. Pursue / Pass / Contacted buttons work; pursued cars appear on the pipeline board (Lead → Contacted → Negotiating → Bought → Flipped → Dead) with suggested target-buy and walk-away numbers.
5. Price drops, relists, and gone/sold are tracked automatically; one row per real car across KSL + Facebook (dedupe per spec §5).
6. The user never opens a scraper, terminal, or database.

**The product is the ranked deal feed. Everything else serves it.**

Non-goals: messaging sellers, moving money, dealer listings, anything outside KSL + FB Marketplace.
