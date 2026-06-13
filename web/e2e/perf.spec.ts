/**
 * M9 gate: "no re-render of unaffected cards on feed update."
 *
 * Method: install a MutationObserver inside every rendered card, then change
 * ONE listing's price through the real /ingest path (same §5 shape the
 * scrapers post). Convex reactivity pushes the update; exactly one card's
 * subtree may mutate.
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

test("feed update re-renders only the affected card", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("deal-card").first()).toBeVisible({ timeout: 15_000 });
  // let the initial reactive churn settle
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const tracker: { mutated: Set<string> } = { mutated: new Set() };
    (window as any).__mutated = tracker;
    document.querySelectorAll<HTMLElement>('[data-testid="deal-card"]').forEach((card) => {
      const id = card.getAttribute("data-id")!;
      new MutationObserver(() => tracker.mutated.add(id)).observe(card, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
  });

  // change ONE car's price through the real ingest path (salvage CX-5
  // fixture identity -> same dedupeKey server-side)
  const newPrice = 9000 + (Date.now() % 400); // always differs from current
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

  // wait for the reactive update to paint the new price somewhere
  await expect(
    page.locator(`[data-testid="deal-card"]`, { hasText: `$${newPrice.toLocaleString()}` })
  ).toBeVisible({ timeout: 15_000 });
  // small grace window for any (incorrect) sympathetic re-renders
  await page.waitForTimeout(1200);

  const mutated: string[] = await page.evaluate(() =>
    Array.from((window as any).__mutated.mutated)
  );
  // the affected card may mutate several times (price + status + rescore),
  // but it must be the ONLY card that mutated at all
  expect(mutated.length, `cards that re-rendered: ${mutated.join(", ")}`).toBeLessThanOrEqual(1);
});
