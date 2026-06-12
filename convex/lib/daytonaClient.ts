/**
 * Daytona sandbox driver — REST client for the production path (ARCHITECTURE
 * §8). One sandbox per search run, always torn down in `finally` (RULES #6).
 *
 * IN-CONTAINER NOTE (no-additional-access directive): app.daytona.io is
 * blocked by this build environment's egress proxy, so this driver cannot be
 * exercised live here. The full lifecycle is pinned by vitest with an
 * injected fetch (create → exec → delete ordering, teardown-on-failure), and
 * scripts/dispatch_local.py provides the equivalent sandbox lifecycle for
 * in-container operation. First live Daytona run = first deploy outside this
 * container with DAYTONA_API_KEY set.
 */

export interface SandboxRunResult {
  sandboxId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface FetchLike {
  (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;
}

const BASE = "https://app.daytona.io/api";
const EXEC_TIMEOUT_SECONDS = 120; // hard cap per scrape run (ARCHITECTURE §8)

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function expectOk(response: { ok: boolean; status: number; text(): Promise<string> }, what: string) {
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`daytona ${what} failed (${response.status}): ${body}`);
  }
}

export async function createSandbox(
  fetchImpl: FetchLike,
  apiKey: string,
  options: { snapshot?: string; labels?: Record<string, string> }
): Promise<string> {
  const response = await fetchImpl(`${BASE}/sandbox`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      snapshot: options.snapshot ?? "carhunter-scraper",
      labels: options.labels ?? {},
    }),
  });
  await expectOk(response, "create");
  const body = await response.json();
  const id = body?.id;
  if (!id) throw new Error("daytona create returned no sandbox id");
  return id;
}

export async function execInSandbox(
  fetchImpl: FetchLike,
  apiKey: string,
  sandboxId: string,
  command: string
): Promise<{ exitCode: number; result: string }> {
  const response = await fetchImpl(
    `${BASE}/toolbox/${sandboxId}/toolbox/process/execute`,
    {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ command, timeout: EXEC_TIMEOUT_SECONDS }),
    }
  );
  await expectOk(response, "exec");
  const body = await response.json();
  return { exitCode: body?.exitCode ?? -1, result: String(body?.result ?? "") };
}

export async function deleteSandbox(
  fetchImpl: FetchLike,
  apiKey: string,
  sandboxId: string
): Promise<void> {
  const response = await fetchImpl(`${BASE}/sandbox/${sandboxId}?force=true`, {
    method: "DELETE",
    headers: headers(apiKey),
  });
  await expectOk(response, "delete");
}

/**
 * Full lifecycle: create → exec run.py → teardown (ALWAYS, even on failure).
 * Returns the exec result; throws on create/exec errors AFTER teardown.
 */
export async function runScrapeInSandbox(args: {
  fetchImpl: FetchLike;
  apiKey: string;
  config: Record<string, unknown>;
  snapshot?: string;
  searchName?: string;
}): Promise<SandboxRunResult> {
  const sandboxId = await createSandbox(args.fetchImpl, args.apiKey, {
    snapshot: args.snapshot,
    labels: { app: "carhunter", search: args.searchName ?? "unnamed" },
  });
  try {
    const configJson = JSON.stringify(args.config).replace(/'/g, "'\\''");
    const { exitCode, result } = await execInSandbox(
      args.fetchImpl,
      args.apiKey,
      sandboxId,
      `cd /scrapers && python3 run.py --config '${configJson}'`
    );
    return { sandboxId, exitCode, stdout: result, stderr: "" };
  } finally {
    try {
      await deleteSandbox(args.fetchImpl, args.apiKey, sandboxId);
    } catch (error) {
      // teardown failure is logged, never masks the run result (RULES #6 —
      // an undead sandbox is an ops alert, not a scrape failure)
      console.error(
        JSON.stringify({ event: "daytona.teardown_failed", sandboxId, error: String(error) })
      );
    }
  }
}
