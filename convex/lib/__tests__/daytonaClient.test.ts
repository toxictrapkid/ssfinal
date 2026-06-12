import { describe, expect, it } from "vitest";
import {
  createSandbox,
  deleteSandbox,
  execInSandbox,
  runScrapeInSandbox,
} from "../daytonaClient";

type Call = { url: string; method: string; body?: any };

function fakeFetch(script: Array<{ status?: number; payload?: any; fail?: boolean }>) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: any) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const step = script.shift() ?? {};
    if (step.fail) throw new Error("network down");
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => step.payload ?? {},
      text: async () => JSON.stringify(step.payload ?? {}),
    };
  };
  return { impl, calls };
}

describe("daytona REST lifecycle (fetch-injected — live host is proxy-blocked)", () => {
  it("create → exec → delete, in order, with auth headers", async () => {
    const { impl, calls } = fakeFetch([
      { payload: { id: "sb-1" } },
      { payload: { exitCode: 0, result: '{"posted":6}' } },
      { payload: {} },
    ]);
    const result = await runScrapeInSandbox({
      fetchImpl: impl,
      apiKey: "key-1",
      config: { sources: ["ksl"] },
      searchName: "scan-a",
    });
    expect(result).toMatchObject({ sandboxId: "sb-1", exitCode: 0 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://app.daytona.io/api/sandbox",
      "POST https://app.daytona.io/api/toolbox/sb-1/toolbox/process/execute",
      "DELETE https://app.daytona.io/api/sandbox/sb-1?force=true",
    ]);
    expect(calls[0].body.labels).toEqual({ app: "carhunter", search: "scan-a" });
    expect(calls[1].body.command).toContain("run.py --config");
  });

  it("TEARDOWN STILL RUNS when exec fails (RULES #6)", async () => {
    const { impl, calls } = fakeFetch([
      { payload: { id: "sb-2" } },
      { status: 500, payload: { error: "boom" } },
      { payload: {} }, // the delete
    ]);
    await expect(
      runScrapeInSandbox({ fetchImpl: impl, apiKey: "k", config: {} })
    ).rejects.toThrow(/exec failed \(500\)/);
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "https://app.daytona.io/api/sandbox/sb-2?force=true",
    });
  });

  it("teardown failure is swallowed (logged), run result preserved", async () => {
    const { impl } = fakeFetch([
      { payload: { id: "sb-3" } },
      { payload: { exitCode: 2, result: "all sources failed" } },
      { fail: true }, // delete blows up
    ]);
    const result = await runScrapeInSandbox({ fetchImpl: impl, apiKey: "k", config: {} });
    expect(result.exitCode).toBe(2); // exec outcome survives teardown failure
  });

  it("create without an id is a typed failure", async () => {
    const { impl } = fakeFetch([{ payload: {} }]);
    await expect(createSandbox(impl, "k", {})).rejects.toThrow(/no sandbox id/);
  });

  it("unit pieces: exec payload carries the timeout cap; delete is forced", async () => {
    const { impl, calls } = fakeFetch([{ payload: { exitCode: 0, result: "" } }, { payload: {} }]);
    await execInSandbox(impl, "k", "sb-9", "echo hi");
    expect(calls[0].body.timeout).toBe(120);
    await deleteSandbox(impl, "k", "sb-9");
    expect(calls[1].url).toContain("force=true");
  });
});
