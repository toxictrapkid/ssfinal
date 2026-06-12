import { v } from "convex/values";

/**
 * The §5 normalized listing shape as a Convex validator — the hard contract
 * for everything entering through /ingest. Mirrors
 * scrapers/tests/listing.schema.json (§5 keys + zip/postedAt/distanceMiles).
 */
export const normalizedListing = v.object({
  source: v.string(),
  sourceListingId: v.string(),
  url: v.string(),
  title: v.string(),
  price: v.number(),
  mileage: v.union(v.number(), v.null()),
  year: v.union(v.number(), v.null()),
  make: v.union(v.string(), v.null()),
  model: v.union(v.string(), v.null()),
  trim: v.union(v.string(), v.null()),
  vin: v.union(v.string(), v.null()),
  titleStatus: v.string(),
  sellerType: v.string(),
  location: v.union(v.string(), v.null()),
  photoUrl: v.union(v.string(), v.null()),
  photos: v.array(v.string()),
  description: v.union(v.string(), v.null()),
  zip: v.union(v.string(), v.null()),
  postedAt: v.union(v.number(), v.null()),
  distanceMiles: v.union(v.number(), v.null()),
});
