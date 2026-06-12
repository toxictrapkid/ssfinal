/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as comps from "../comps.js";
import type * as crons from "../crons.js";
import type * as daytona from "../daytona.js";
import type * as debug from "../debug.js";
import type * as http from "../http.js";
import type * as lib_daytonaClient from "../lib/daytonaClient.js";
import type * as lib_dedupe from "../lib/dedupe.js";
import type * as lib_depreciationCurve from "../lib/depreciationCurve.js";
import type * as lib_listingValidator from "../lib/listingValidator.js";
import type * as lib_marketcheck from "../lib/marketcheck.js";
import type * as lib_reconRules from "../lib/reconRules.js";
import type * as lib_scoreMath from "../lib/scoreMath.js";
import type * as listings from "../listings.js";
import type * as partsCosts from "../partsCosts.js";
import type * as scoring from "../scoring.js";
import type * as searches from "../searches.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  comps: typeof comps;
  crons: typeof crons;
  daytona: typeof daytona;
  debug: typeof debug;
  http: typeof http;
  "lib/daytonaClient": typeof lib_daytonaClient;
  "lib/dedupe": typeof lib_dedupe;
  "lib/depreciationCurve": typeof lib_depreciationCurve;
  "lib/listingValidator": typeof lib_listingValidator;
  "lib/marketcheck": typeof lib_marketcheck;
  "lib/reconRules": typeof lib_reconRules;
  "lib/scoreMath": typeof lib_scoreMath;
  listings: typeof listings;
  partsCosts: typeof partsCosts;
  scoring: typeof scoring;
  searches: typeof searches;
  seed: typeof seed;
  settings: typeof settings;
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
