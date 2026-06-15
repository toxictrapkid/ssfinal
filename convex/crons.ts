import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 2 minutes: scan KSL for new listings, enrich each by VIN with Carbly
// (JD clean trade-in + KBB lending, mileage-adjusted), and keep the ones that
// are >= $1,000 under either book (HOT when under both). Runs entirely
// server-side in Convex — 24/7, no sandbox/Daytona/local machine.
crons.interval("auto deal scan", { minutes: 2 }, internal.autoScan.runScan, {});

// Daily: mark listings unseen for 48h as gone (spec §6) so the feed stays live.
crons.daily(
  "stale sweep",
  { hourUTC: 9, minuteUTC: 0 }, // 3am MT — before the morning lot check
  internal.listings.markStale,
  {}
);

export default crons;
