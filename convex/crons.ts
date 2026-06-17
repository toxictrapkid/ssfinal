import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 2 minutes: scrape KSL buy-box candidates and STORE them in the queue
// (no Carbly) — never blocked by the Carbly daily cap, so no listing is lost.
crons.interval("ksl scrape", { minutes: 2 }, internal.autoScan.scrapeTick, {});

// Every 2 minutes: drain the queue through Carbly (JD clean trade-in + KBB
// lending), keep deals >= $1,000 under either book (HOT under both), file
// qualifiers to "KSL leads", text Contact-Now. Backs off 3h after Carbly's
// daily cap and auto-resumes draining the backlog once the window resets.
crons.interval("carbly enrich", { minutes: 2 }, internal.autoScan.enrichTick, {});

// Daily: mark listings unseen for 48h as gone (spec §6) so the feed stays live.
crons.daily(
  "stale sweep",
  { hourUTC: 9, minuteUTC: 0 }, // 3am MT — before the morning lot check
  internal.listings.markStale,
  {}
);

export default crons;
