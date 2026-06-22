/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as airtable from "../airtable.js";
import type * as alerts from "../alerts.js";
import type * as autoScan from "../autoScan.js";
import type * as comps from "../comps.js";
import type * as crons from "../crons.js";
import type * as debug from "../debug.js";
import type * as enrich from "../enrich.js";
import type * as http from "../http.js";
import type * as laser from "../laser.js";
import type * as lib_alertTransports from "../lib/alertTransports.js";
import type * as lib_dedupe from "../lib/dedupe.js";
import type * as lib_depreciationCurve from "../lib/depreciationCurve.js";
import type * as lib_gapRule from "../lib/gapRule.js";
import type * as lib_kslWebUnlocker from "../lib/kslWebUnlocker.js";
import type * as lib_listingValidator from "../lib/listingValidator.js";
import type * as lib_marketcheck from "../lib/marketcheck.js";
import type * as lib_reconRules from "../lib/reconRules.js";
import type * as lib_scoreMath from "../lib/scoreMath.js";
import type * as lib_valuationStatus from "../lib/valuationStatus.js";
import type * as listings from "../listings.js";
import type * as mcp from "../mcp.js";
import type * as notifications from "../notifications.js";
import type * as partsCosts from "../partsCosts.js";
import type * as pipeline from "../pipeline.js";
import type * as publicApi from "../publicApi.js";
import type * as scoring from "../scoring.js";
import type * as scrapeQueue from "../scrapeQueue.js";
import type * as searches from "../searches.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as slack from "../slack.js";
import type * as valuations from "../valuations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  airtable: typeof airtable;
  alerts: typeof alerts;
  autoScan: typeof autoScan;
  comps: typeof comps;
  crons: typeof crons;
  debug: typeof debug;
  enrich: typeof enrich;
  http: typeof http;
  laser: typeof laser;
  "lib/alertTransports": typeof lib_alertTransports;
  "lib/dedupe": typeof lib_dedupe;
  "lib/depreciationCurve": typeof lib_depreciationCurve;
  "lib/gapRule": typeof lib_gapRule;
  "lib/kslWebUnlocker": typeof lib_kslWebUnlocker;
  "lib/listingValidator": typeof lib_listingValidator;
  "lib/marketcheck": typeof lib_marketcheck;
  "lib/reconRules": typeof lib_reconRules;
  "lib/scoreMath": typeof lib_scoreMath;
  "lib/valuationStatus": typeof lib_valuationStatus;
  listings: typeof listings;
  mcp: typeof mcp;
  notifications: typeof notifications;
  partsCosts: typeof partsCosts;
  pipeline: typeof pipeline;
  publicApi: typeof publicApi;
  scoring: typeof scoring;
  scrapeQueue: typeof scrapeQueue;
  searches: typeof searches;
  seed: typeof seed;
  settings: typeof settings;
  slack: typeof slack;
  valuations: typeof valuations;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
