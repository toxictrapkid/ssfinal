import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { runScrapeInSandbox } from "./lib/daytonaClient";

const CONCURRENCY_CAP = 3; // parallel sandboxes per dispatch tick (ARCHITECTURE §8)

/**
 * Cron entrypoint: find due searches, run each in its own scheduled action so
 * one failure can never block siblings (M6 gate). Caps spawns per tick.
 */
export const dispatchDueSearches = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.searches.listDue, { now: Date.now() });
    // Unconfigured driver: leave searches due and untouched so an external
    // runner (scripts/dispatch_local.py) can claim them — stamping lastRunAt
    // here would starve it (in-container mode, no-additional-access directive).
    if (!process.env.DAYTONA_API_KEY || !process.env.INGEST_URL) {
      if (due.length) {
        console.log(
          JSON.stringify({
            event: "dispatch.driver_unconfigured",
            due: due.length,
            note: "scripts/dispatch_local.py is the runner in this environment",
          })
        );
      }
      return { due: due.length, spawned: 0 };
    }
    const batch = due.slice(0, CONCURRENCY_CAP);
    for (const search of batch) {
      await ctx.scheduler.runAfter(0, internal.daytona.runSearchInSandbox, {
        searchId: search._id,
      });
    }
    if (due.length) {
      console.log(
        JSON.stringify({
          event: "dispatch.tick",
          due: due.length,
          spawned: batch.length,
        })
      );
    }
    return { due: due.length, spawned: batch.length };
  },
});

/**
 * One search -> one sandbox -> scrape -> /ingest -> teardown -> markRun.
 * Errors land on THIS search's row (lastError); siblings are independent
 * scheduled actions. Without DAYTONA_API_KEY (this container — egress proxy
 * blocks app.daytona.io and the user declined further access), the run is
 * marked with a driver-unconfigured error and scripts/dispatch_local.py is
 * the equivalent in-container runner.
 */
export const runSearchInSandbox = internalAction({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const search = await ctx.runQuery(internal.scoring.getSearch, { searchId });
    if (!search || !search.active) return;

    const apiKey = process.env.DAYTONA_API_KEY;
    const ingestUrl = process.env.INGEST_URL; // public /ingest URL of this deployment
    const ingestSecret = process.env.INGEST_SECRET;

    if (!apiKey || !ingestUrl || !ingestSecret) {
      const missing = [
        !apiKey && "DAYTONA_API_KEY",
        !ingestUrl && "INGEST_URL",
        !ingestSecret && "INGEST_SECRET",
      ]
        .filter(Boolean)
        .join(", ");
      await ctx.runMutation(internal.searches.markRun, {
        searchId,
        error: `sandbox driver unconfigured (missing ${missing}); in-container runs use scripts/dispatch_local.py`,
      });
      return;
    }

    const settings = await ctx.runQuery(internal.settings.getInternal, {});
    const config = {
      searchId,
      sources: search.sources,
      makes: search.makes,
      models: search.models,
      yearMin: search.yearMin,
      yearMax: search.yearMax,
      mileageMin: search.mileageMin,
      mileageMax: search.mileageMax,
      priceMin: search.priceMin,
      priceMax: search.priceMax,
      zip: search.zip,
      radiusMiles: search.radiusMiles,
      cleanTitleOnly: search.cleanTitleOnly,
      ingestUrl,
      ingestSecret,
      // FB cookie rides here when that source re-enables (never a password)
      fbSessionCookie: settings?.fbSessionCookie,
    };

    try {
      const result = await runScrapeInSandbox({
        fetchImpl: fetch as never,
        apiKey,
        config,
        searchName: search.name,
      });
      let newDeals: number | undefined;
      try {
        const summary = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "");
        newDeals = summary?.ingest?.inserted;
      } catch {
        // summary parse is best-effort; the scrape itself already ingested
      }
      await ctx.runMutation(internal.searches.markRun, {
        searchId,
        error:
          result.exitCode === 0
            ? undefined
            : `run.py exited ${result.exitCode}: ${result.stderr.slice(0, 300)}`,
        newDeals,
      });
    } catch (error) {
      await ctx.runMutation(internal.searches.markRun, {
        searchId,
        error: String(error).slice(0, 500),
      });
    }
  },
});
