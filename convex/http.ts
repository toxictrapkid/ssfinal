import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const MAX_BATCH = 200;

/**
 * POST /ingest — the only inbound path from scrapers (Daytona sandboxes).
 * Auth: X-Ingest-Secret must equal the INGEST_SECRET deployment env var.
 * Body: { searchId?, listings: NormalizedListing[] } (§5 shape). Two layers:
 * a shallow structural pre-filter here (skips garbage items, counted as
 * preSkipped), then the upsert mutation's validator as the hard contract —
 * an item that passes the pre-filter but fails the validator 422s the whole
 * batch atomically. Acceptable: parse.py is the only producer and emits the
 * exact §5 shape. Secret check is a plain compare (accepted: 48-hex random
 * secret makes timing attacks impractical).
 */
const ingest = httpAction(async (ctx, request) => {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    return json({ error: "INGEST_SECRET is not configured on the deployment" }, 500);
  }
  if (request.headers.get("X-Ingest-Secret") !== expected) {
    return json({ error: "invalid ingest secret" }, 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }
  const listings = body?.listings;
  if (!Array.isArray(listings) || listings.length === 0) {
    return json({ error: "listings must be a non-empty array" }, 400);
  }
  if (listings.length > MAX_BATCH) {
    return json({ error: `batch too large (max ${MAX_BATCH})` }, 413);
  }

  const structurallyValid = listings.filter(
    (l: any) =>
      l &&
      typeof l.sourceListingId === "string" &&
      typeof l.url === "string" &&
      typeof l.title === "string" &&
      typeof l.source === "string" &&
      Number.isFinite(l.price) &&
      l.price > 0
  );
  const preSkipped = listings.length - structurallyValid.length;
  if (structurallyValid.length === 0) {
    return json({ error: "no structurally valid listings in batch", preSkipped }, 400);
  }

  try {
    const result = await ctx.runMutation(internal.listings.upsertFromScrape, {
      searchId: body.searchId ?? undefined,
      listings: structurallyValid,
    });
    return json({ ...result, preSkipped }, 200);
  } catch (error: any) {
    // validator rejections land here — surface them, never swallow
    console.error(JSON.stringify({ event: "ingest.failed", error: String(error?.message ?? error) }));
    return json({ error: "upsert rejected batch", detail: String(error?.message ?? error) }, 422);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const http = httpRouter();
http.route({ path: "/ingest", method: "POST", handler: ingest });
export default http;
