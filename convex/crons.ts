import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 1 minute: scrape KSL buy-box candidates into the scrape queue (Bright Data
// Web Unlocker). Rotating grid cell + newest-first fast-lane for fresh coverage.
crons.interval("ksl scrape", { minutes: 1 }, internal.autoScan.scrapeTick, {});

// Every 1 minute: drain the queue into the feed. When the Laser bridge owns
// appraisal (LASER_BRIDGE=true) this is a no-op (the bridge posts values via
// laser.appraise); otherwise it values via MarketCheck comps / depreciation
// curve. New Contact-Now deals fire alerts (SMS via Mobile Text Alerts + Slack).
crons.interval("queue enrich", { minutes: 1 }, internal.autoScan.enrichTick, {});

// Daily: mark listings unseen for 48h as gone (spec §6) so the feed stays live.
crons.daily(
  "stale sweep",
  { hourUTC: 9, minuteUTC: 0 }, // 3am MT — before the morning lot check
  internal.listings.markStale,
  {}
);

export default crons;
