/**
 * M9 gate: "no re-render of unaffected cards on feed update."
 *
 * Method: DealCard increments window.__renderCounts[id] on every actual React
 * render (dev-only, see DealCard.tsx). We snapshot per-card render counts,
 * change ONE listing's price through the real /ingest path (the same §5 shape
 * the scrapers post), wait for Convex reactivity to repaint it, then assert
 * that ONLY the affected card's render count increased.
 *
 * Why render counts, not a MutationObserver: an unaffected card that
 * re-renders to identical output produces no DOM mutation, so an observer
 * can't catch a missing memo — this counts the render itself, so deleting the
 * DealCard memo makes this test fail (every card's count would rise).
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function ingestSecret(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // ESM — no __dirname
  const env = readFileSync(join(here, "../../.env.local"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("INGEST_SECRET="));
  if (!line) throw new Error("INGEST_SECRET not found in ../.env.local");
  return line.split("=", 2)[1].trim().replace(/^['"]|['"]$/g, "");
}

type Counts = Record<string, number>;

test("feed update re-renders only the affected card", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("deal-card").first()).toBeVisible({ timeout: 15_000 });
  // let the initial reactive churn settle so the baseline is stable
  await page.waitForTimeout(2000);

  const before: Counts = await page.evaluate(
    () => ({ ...((window as any).__renderCounts ?? {}) })
  );
  expect(Object.keys(before).length, "render instrumentation present").toBeGreaterThan(0);

  // change ONE car's price through the real ingest path (salvage CX-5 fixture
  // identity -> same dedupeKey server-side, so this UPDATES one existing row)
  const newPrice = 9000 + (Date.now() % 500); // always differs from current
  const response = await request.post("http://127.0.0.1:3211/ingest", {
    headers: { "X-Ingest-Secret": ingestSecret() },
    data: {
      listings: [
        {
          source: "ksl",
          sourceListingId: "9210003",
          url: "https://cars.ksl.com/listing/9210003",
          title: "2019 Mazda CX-5 Touring",
          price: newPrice,
          mileage: 88990,
          year: 2019,
          make: "Mazda",
          model: "CX-5",
          trim: "Touring",
          vin: null,
          titleStatus: "salvage",
          sellerType: "private",
          location: "West Valley City, UT",
          photoUrl: "https://img.ksl.com/mx/mplace-cars.ksl.com/9210003-1717100002-100004.jpeg",
          photos: ["https://img.ksl.com/mx/mplace-cars.ksl.com/9210003-1717100002-100004.jpeg"],
          description: "2019 CX-5 Touring, hail damage salvage, runs and drives perfect. Price firm.",
          zip: "84119",
          postedAt: 1749000000000,
          distanceMiles: 5.0,
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();

  // wait for the reactive update to paint the new price
  const affectedCard = page.locator(`[data-testid="deal-card"]`, {
    hasText: `$${newPrice.toLocaleString()}`,
  });
  await expect(affectedCard).toBeVisible({ timeout: 15_000 });
  const affectedId = await affectedCard.getAttribute("data-id");
  expect(affectedId).toBeTruthy();
  // grace window for any (incorrect) sympathetic re-renders to register
  await page.waitForTimeout(1500);

  const after: Counts = await page.evaluate(
    () => ({ ...((window as any).__renderCounts ?? {}) })
  );

  // which cards rendered MORE than their baseline?
  const rerendered = Object.keys(after).filter(
    (id) => (after[id] ?? 0) > (before[id] ?? 0)
  );
  expect(
    rerendered,
    `only the affected card should re-render; got: ${rerendered.join(", ")}`
  ).toEqual([affectedId]);
});
