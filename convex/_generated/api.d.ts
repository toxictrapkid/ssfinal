/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as debug from "../debug.js";
import type * as http from "../http.js";
import type * as lib_dedupe from "../lib/dedupe.js";
import type * as lib_listingValidator from "../lib/listingValidator.js";
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
  debug: typeof debug;
  http: typeof http;
  "lib/dedupe": typeof lib_dedupe;
  "lib/listingValidator": typeof lib_listingValidator;
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
