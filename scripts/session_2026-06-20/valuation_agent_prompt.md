# Valuation agent prompt (used 4x in parallel, one per chunk)

The 134 scraped cars were split into 4 chunk files (`/tmp/chunk{1..4}.json`) and
each handed to a `general-purpose` sub-agent with the instruction below. Each
agent wrote `/tmp/val{N}.json`. This is the exact method, preserved for review.

> You are valuing used cars for a wholesale-arbitrage tool using the MarketCheck
> MCP. Be precise and finish ALL cars in your chunk.
>
> STEP 1 — load the tool: call ToolSearch with query exactly
> `select:mcp__MarketCheck_MCPs__search_active_cars` (max_results 1). If it does
> not load, STOP and reply "MCP unavailable".
>
> STEP 2 — read `/tmp/chunkN.json`: a JSON array of cars, each with keys: key,
> year, make, model, trim, mileage, price, vin, url.
>
> STEP 3 — for EACH car, get a market value:
> - miles_range: if mileage is a number, lo = max(0, mileage-10000),
>   hi = mileage+10000, pass miles_range = "{lo}-{hi}". If mileage is null, omit.
> - Call `mcp__MarketCheck_MCPs__search_active_cars` with: year, make, model,
>   miles_range, car_type="used", stats="price", rows=0. DO NOT pass zip or
>   radius (national search; radius over 100 errors out).
> - Read `data.stats.price.median` and `data.stats.price.count`.
> - If count < 3: if count == 0, retry ONCE with a wider window (mileage +/-20000).
>   Use whichever call gives count >= 3. If still < 3, estValue = null (unreliable).
> - AWD: if the car's trim or model matches (case-insensitive)
>   `\b(awd|4wd|4x4|all wheel|four wheel)\b`, awdFactor = 1.03, else 1.0.
> - estValue = round(median * awdFactor) when a median is available, else null.
> - spread = estValue - price - 800   (recon 400 + fees 400). null when estValue null.
>
> STEP 4 — results array; each item = {key, vehicle, price, mileage, compCount,
> estValue, awd, spread, url}. Sort by spread desc, null/thin last.
>
> STEP 5 — write the array as JSON to `/tmp/valN.json`.
>
> STEP 6 — reply briefly: count valued vs thin, and the top 10 by spread.

## Known limitation flagged in review
The literal AWD regex does NOT catch "xDrive" (BMW), "4MATIC" (Mercedes), or
standard-AWD Subaru models, so those few cars are valued WITHOUT the +3% AWD
bump (slightly understated). This was disclosed in the session output.
