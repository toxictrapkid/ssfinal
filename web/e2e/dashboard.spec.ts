/**
 * M7 gate (LOOP_PROMPT): feed renders ranked cards with profit/score,
 * Pursue moves the card to the pipeline Lead column, drag between stages
 * works. Runs against the live local Convex backend (real data).
 */
import { expect, test } from "@playwright/test";

test.describe("deal feed", () => {
  test("renders ranked cards with profit and score", async ({ page }) => {
    await page.goto("/");
    const cards = page.getByTestId("deal-card");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(1);

    // every card shows a score chip and a profit line
    const first = cards.first();
    await expect(first.getByTestId("score-chip")).toBeVisible();
    await expect(first.getByTestId("card-profit")).toBeVisible();

    // ranked: data-score values are non-increasing (default sort = score)
    const scores = await cards.evaluateAll((nodes) =>
      nodes
        .map((n) => n.getAttribute("data-score"))
        .filter((s): s is string => s !== null && s !== "")
        .map(Number)
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  test("mechanic specials view surfaces flagged cars", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-specials").click();
    await expect(page.getByTestId("special-badge").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("pipeline", () => {
  test("Pursue moves the card to the Lead column", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("deal-card").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const title = await card.getAttribute("data-title");
    expect(title).toBeTruthy();

    await card.getByTestId("pursue-btn").click();
    await page.getByTestId("tab-pipeline").click();

    const lead = page.getByTestId("column-lead");
    await expect(
      lead.locator(`[data-testid="pipeline-card"][data-title="${title}"]`)
    ).toBeVisible({ timeout: 15_000 });
  });

  test("drag between stages works", async ({ page }) => {
    await page.goto("/");
    // make sure something is in the pipeline
    const feedCard = page.getByTestId("deal-card").first();
    await expect(feedCard).toBeVisible({ timeout: 15_000 });
    const title = await feedCard.getAttribute("data-title");
    await feedCard.getByTestId("pursue-btn").click();

    await page.getByTestId("tab-pipeline").click();
    const card = page
      .getByTestId("column-lead")
      .locator(`[data-testid="pipeline-card"][data-title="${title}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // pointer-based drag: down on the card, move to the Contacted column in
    // steps (the board listens to pointermove), release. Contacted is the
    // adjacent column — keep the whole gesture inside the mobile viewport.
    // NOTE: no scrollIntoView — scrolling the kanban would shift the source
    // card off-viewport; Contacted is partially visible at 414px and the
    // x-clamp below keeps the whole gesture inside the viewport
    const target = page.getByTestId("column-contacted");
    const cardBox = (await card.boundingBox())!;
    const targetBox = (await target.boundingBox())!;
    // press on the price line — the title row is a button, and the card
    // ignores pointer-downs on interactive elements by design
    await page.mouse.move(cardBox.x + Math.min(80, cardBox.width / 2), cardBox.y + 44);
    await page.mouse.down();
    await page.mouse.move(
      Math.min(targetBox.x + targetBox.width / 2, 400),
      targetBox.y + 60,
      { steps: 12 }
    );
    await page.mouse.up();

    await expect(
      page
        .getByTestId("column-contacted")
        .locator(`[data-testid="pipeline-card"][data-title="${title}"]`)
    ).toBeVisible({ timeout: 15_000 });

    // persisted server-side, not just local state
    await page.reload();
    await page.getByTestId("tab-pipeline").click();
    await expect(
      page
        .getByTestId("column-contacted")
        .locator(`[data-testid="pipeline-card"][data-title="${title}"]`)
    ).toBeVisible({ timeout: 15_000 });

    // put it back to Lead via the keyboard-accessible stage menu
    await page
      .getByTestId("column-contacted")
      .locator(`[data-testid="pipeline-card"][data-title="${title}"]`)
      .getByTestId("stage-select")
      .selectOption("lead");
    await expect(
      page
        .getByTestId("column-lead")
        .locator(`[data-testid="pipeline-card"][data-title="${title}"]`)
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("detail drawer", () => {
  test("shows the recon math line by line", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-specials").click();
    const card = page.getByTestId("deal-card").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    const drawer = page.getByTestId("detail-drawer");
    await expect(drawer).toBeVisible();
    const recon = drawer.getByTestId("recon-table");
    await expect(recon).toBeVisible();
    // parts-based recon shows the used part median + labor lines
    await expect(recon).toContainText(/Base recon/);
    await expect(recon).toContainText(/Used engine|Used transmission|flat §4 bump/);
    await expect(recon).toContainText(/Total recon/);
  });
});
