import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * The single settings row, PUBLIC-SAFE projection.
 *
 * `settings.get` is an anonymous public query (the deployment URL ships in the
 * frontend bundle as VITE_CONVEX_URL and there is no user auth), so it must
 * NEVER return raw secrets. The FB session cookie and MarketCheck key are
 * client-writable convenience fields but are secret to READ — a leaked cookie
 * is a full account takeover, a leaked key is paid-quota theft. We return only
 * non-secret operating fields plus presence booleans; the raw secret values are
 * reachable only through `getInternal` (server-side / internal functions).
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("settings").first();
    if (!row) return null;
    return {
      _id: row._id,
      _creationTime: row._creationTime,
      marginThreshold: row.marginThreshold,
      feesFlat: row.feesFlat,
      alertEmail: row.alertEmail ?? null,
      alertPhone: row.alertPhone ?? null,
      // presence only — never the secret material itself
      hasFbSessionCookie: !!row.fbSessionCookie,
      hasMarketcheckKey: !!row.marketcheckKey,
    };
  },
});

/** Full row incl. secrets — server-side only (scoring, comps, alerts, dispatch). */
export const getInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("settings").first();
  },
});

export const update = mutation({
  args: {
    marginThreshold: v.optional(v.number()),
    feesFlat: v.optional(v.number()),
    alertEmail: v.optional(v.string()),
    alertPhone: v.optional(v.string()),
    fbSessionCookie: v.optional(v.string()),
    marketcheckKey: v.optional(v.string()),
    // NOTE: daytonaApiKey is intentionally NOT accepted here. The Daytona key is
    // env-var-only by design (README "Operating notes") — it must never land on
    // the settings row, which is client-writable and (pre-sanitization) was
    // client-readable. Keeping it out of this mutation enforces that invariant.
  },
  handler: async (ctx, patch) => {
    const row = await ctx.db.query("settings").first();
    if (!row) throw new Error("settings not seeded — run seed:run first");
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined)
    );
    await ctx.db.patch(row._id, defined);
  },
});
