import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every minute: dispatch due searches into sandboxes (spec §6). Each search
// runs as its own scheduled action — failure isolation by construction.
crons.interval(
  "dispatch due searches",
  { minutes: 1 },
  internal.daytona.dispatchDueSearches,
  {}
);

// Daily: mark listings unseen for 48h as gone (spec §6), then rescore the
// survivors so freshness decay and any refreshed comps re-rank the feed.
crons.daily(
  "stale sweep + rescore",
  { hourUTC: 9, minuteUTC: 0 }, // 3am MT — before the morning lot check
  internal.listings.markStale,
  {}
);
crons.daily(
  "daily rescore",
  { hourUTC: 9, minuteUTC: 10 },
  internal.scoring.rescoreAll,
  {}
);

export default crons;
