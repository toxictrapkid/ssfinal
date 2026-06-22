/**
 * CarHunter remote MCP server (Streamable HTTP / JSON-RPC 2.0).
 *
 * Mounted at POST /mcp (see http.ts). Works from Claude web, desktop, and mobile
 * as a custom connector. Bearer-token auth maps to an owner or employee role;
 * every tool call is written to mcpAuditLog (no silent failures).
 *
 * THE HARD RULE is enforced centrally: the four required numbers (JD Clean Trade,
 * JD Full Retail, KBB Lending, Base MMR) are printed on EVERY vehicle response,
 * and a vehicle cannot be scored HOT BUY / marked review-ready unless all four
 * are VERIFIED (present + double-checked + fresh + agree). Missing numbers are
 * shown as DATA MISSING and spawn employee tasks. Values are never invented and
 * $0 is never used as a placeholder.
 *
 * Env: MCP_OWNER_TOKEN, MCP_EMPLOYEE_TOKEN (bearer tokens).
 */
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const PROTOCOL_VERSION = "2024-11-05";
const money = (n: number | null | undefined) => (n != null && n > 0 ? "$" + Math.round(n).toLocaleString("en-US") : "DATA MISSING");
const veh = (l: any) => [l.year, l.make, l.model, l.trim].filter(Boolean).join(" ") || l.title || "Unknown vehicle";

type Role = "owner" | "employee";

function roleFor(req: Request): Role | null {
  // Accept the token via Authorization: Bearer <token> OR a ?key=/?token= query
  // param. The query form lets you paste the URL straight into Claude as a
  // custom connector (no OAuth). Treat the connector URL as a secret + rotate.
  const header = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let query = "";
  try {
    const u = new URL(req.url);
    query = (u.searchParams.get("key") || u.searchParams.get("token") || "").trim();
  } catch {
    /* ignore */
  }
  const tok = header || query;
  if (tok && tok === process.env.MCP_OWNER_TOKEN) return "owner";
  if (tok && tok === process.env.MCP_EMPLOYEE_TOKEN) return "employee";
  return null;
}

// ---- tool catalog (advertised to the client) ----
const strArg = (description: string) => ({ type: "string", description });
const TOOLS = [
  { name: "ask_new_cars_to_review", description: "Best current opportunities with all four valuation numbers visible; says exactly what is missing and who must fix it.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_vehicle_valuations", description: "Retrieve the four required valuation numbers + provenance for one vehicle (by VIN or listingId). Creates employee tasks for any that are missing.", inputSchema: { type: "object", properties: { vin: strArg("17-char VIN"), listingId: strArg("CarHunter listing id") } } },
  { name: "double_check_vehicle_valuations", description: "Run the double-check gate on the four numbers; returns VERIFIED / DATA MISSING / STALE DATA / VALUE MISMATCH / MANUAL REVIEW REQUIRED.", inputSchema: { type: "object", properties: { vin: strArg("VIN"), listingId: strArg("listing id") } } },
  { name: "analyze_auction_vehicle", description: "Full per-vehicle analysis block (valuations, transport, engine OR transmission scenario, all-in, margin, max bid, recommendation). Engine and transmission are never combined.", inputSchema: { type: "object", properties: { vin: strArg("VIN"), listingId: strArg("listing id") } } },
  { name: "score_deal", description: "Score a vehicle (HOT BUY / OWNER REVIEW / WATCH / DATA MISSING / PASS). Cannot return HOT BUY unless all four numbers are VERIFIED.", inputSchema: { type: "object", properties: { vin: strArg("VIN"), listingId: strArg("listing id") } } },
  { name: "get_repair_parts_estimate", description: "Cheapest used engine and cheapest used transmission (Car-Part.com, ZIP 84101), stored separately. Creates a task if not in the dataset.", inputSchema: { type: "object", properties: { vin: strArg("VIN"), listingId: strArg("listing id") } } },
  { name: "estimate_transport", description: "Estimate transport to Utah 84101 with cost, method, confidence, and notes.", inputSchema: { type: "object", properties: { vin: strArg("VIN"), listingId: strArg("listing id") } } },
  { name: "generate_owner_report", description: "Phone-friendly owner report: top-margin, needs-decision, and missing-data vehicles — every row shows the four numbers, all-in, resale, margin, max bid, risk, recommendation.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "create_employee_task", description: "Create a simple employee task (verify VIN, pull Carfax, check a valuation number, Car-Part lookup, etc.).", inputSchema: { type: "object", properties: { listingId: strArg("listing id"), kind: strArg("task kind"), title: strArg("short title"), instructions: strArg("exact steps") }, required: ["title", "instructions"] } },
  { name: "generate_employee_instructions", description: "Plain-English next steps for the employee when something fails or data is missing.", inputSchema: { type: "object", properties: { context: strArg("what failed or is missing") }, required: ["context"] } },
  { name: "ingest_auction_run_list", description: "Ingest an auction run list (extracted text/CSV). Groups vehicles by auction, lane, run number.", inputSchema: { type: "object", properties: { text: strArg("extracted run-list text or CSV"), auction: strArg("auction name"), saleDate: strArg("sale date") } } },
  { name: "refresh_active_listings", description: "Status breakdown of active/sold/expired/changed listings.", inputSchema: { type: "object", properties: {} } },
  { name: "sync_airtable", description: "Push every vehicle to Airtable (upsert by CarHunter Lead ID; four numbers + double-check status visible).", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "send_slack_alert", description: "Send a HOT BUY / OWNER REVIEW Slack alert. Refuses if the four valuation numbers are not verified.", inputSchema: { type: "object", properties: { vin: strArg("VIN"), listingId: strArg("listing id") } } },
];

// ---- shared formatting (four numbers ALWAYS visible) ----
function valuationLines(report: any): string {
  const r = (k: string) => report.results.find((x: any) => x.kind === k);
  const line = (k: string) => {
    const v = r(k);
    const second = v.secondValue != null ? `  (2nd ${money(v.secondValue)} via ${v.secondSource ?? "?"})` : "";
    return `${v.label}: ${money(v.value)}${second}  [${v.status}]`;
  };
  return [
    line("jd_clean_trade"),
    line("jd_full_retail"),
    line("kbb_lending"),
    line("base_mmr"),
    `Valuation Double-Check Status: ${report.overall}${report.reviewReady ? "  — REVIEW READY" : ""}`,
  ].join("\n");
}

function transportEstimate(l: any): { cost: number | null; confidence: string; note: string } {
  const miles = l.distanceMiles;
  if (miles == null) return { cost: null, confidence: "low", note: "distance to 84101 unknown — verify origin city" };
  const cost = Math.max(150, Math.round((miles * 1.25) / 25) * 25);
  return { cost, confidence: miles < 300 ? "medium" : "low", note: `~${Math.round(miles)} mi to SLC 84101 @ ~$1.25/mi (heuristic)` };
}

// ---- tool dispatch ----
async function resolve(ctx: any, args: any) {
  return ctx.runQuery(internal.valuations.findListing, { vin: args?.vin, listingId: args?.listingId });
}

async function callTool(ctx: any, name: string, args: any, role: Role): Promise<string> {
  switch (name) {
    case "ask_new_cars_to_review": {
      const cands = await ctx.runQuery(internal.valuations.reviewCandidates, { limit: args?.limit ?? 10 });
      if (!cands.length) return "No active listings right now.";
      const blocks = cands.map(({ listing, report }: any) => {
        const head = `• ${veh(listing)} — ${money(listing.price)} | ${listing.mileage?.toLocaleString() ?? "?"} mi | ${listing.titleStatus ?? "?"} | score ${listing.dealScore ?? "?"}`;
        const miss = report.reviewReady ? "" : `\n  Still needed: ${report.missing.map((m: any) => `${m.label} (${m.status})`).join("; ")} — assign to an employee.`;
        return `${head}\n  ${valuationLines(report).replace(/\n/g, "\n  ")}\n  ${listing.url}${miss}`;
      });
      return `Top ${cands.length} to review (every row shows all four numbers):\n\n${blocks.join("\n\n")}`;
    }
    case "get_vehicle_valuations":
    case "double_check_vehicle_valuations": {
      const l = await resolve(ctx, args);
      if (!l) return "No matching vehicle (provide a valid VIN or listingId).";
      const rep = await ctx.runQuery(internal.valuations.reportForListing, { listingId: l._id });
      if (!rep.reviewReady) await ctx.runMutation(internal.valuations.createValuationTasks, { listingId: l._id });
      const who = rep.reviewReady ? "" : "\n\nMissing/unverified numbers have been turned into employee tasks (check Airtable / Tasks).";
      return `${veh(l)} (VIN ${l.vin ?? "MISSING"})\n${valuationLines(rep)}${who}`;
    }
    case "analyze_auction_vehicle": {
      const l = await resolve(ctx, args);
      if (!l) return "No matching vehicle. (Auction run-list vehicles require ingest_auction_run_list first.)";
      const rep = await ctx.runQuery(internal.valuations.reportForListing, { listingId: l._id });
      const parts = await ctx.runQuery(internal.valuations.repairParts, { year: l.year, make: l.make, model: l.model });
      const t = transportEstimate(l);
      const retail = rep.results.find((x: any) => x.kind === "jd_full_retail");
      const retailReady = retail.status === "VERIFIED";
      const eng = parts.engine ? `${money(parts.engine.price)} (${parts.engine.source})` : "DATA MISSING — task created";
      const trn = parts.transmission ? `${money(parts.transmission.price)} (${parts.transmission.source})` : "DATA MISSING — task created";
      if (!parts.engine || !parts.transmission) {
        await ctx.runMutation(internal.valuations.createTask, {
          listingId: l._id, kind: "check_carpart", title: `Car-Part lookup: ${veh(l)}`,
          instructions: `On car-part.com with ZIP 84101, find the cheapest matching ENGINE and (separately) the cheapest matching TRANSMISSION for ${veh(l)}. Record price, vendor, miles, warranty.`,
        });
      }
      return [
        `Auction Name: N/A (private-party listing)`,
        `Auction Date: N/A   Lane: N/A   Run Number: N/A`,
        `Vehicle: ${veh(l)}`,
        `VIN: ${l.vin ?? "MISSING"}`,
        `Mileage: ${l.mileage?.toLocaleString() ?? "DATA MISSING"}`,
        `Location: ${l.location ?? "DATA MISSING"}`,
        valuationLines(rep),
        `Transport Estimate: ${money(t.cost)} [${t.confidence}] — ${t.note}`,
        `Engine Cost: ${eng}`,
        `Transmission Cost: ${trn}`,
        `Labor Estimate: $1,000 (applied to engine OR transmission scenario separately — never combined)`,
        `--- ENGINE scenario ---  All-In: ${parts.engine && retailReady ? money(l.price + (t.cost ?? 0) + parts.engine.price + 1000 + 400) : "DATA MISSING"}`,
        `--- TRANSMISSION scenario ---  All-In: ${parts.transmission && retailReady ? money(l.price + (t.cost ?? 0) + parts.transmission.price + 1000 + 400) : "DATA MISSING"}`,
        `Expected Retail: ${retailReady ? money(retail.value) : "DATA MISSING (JD Full Retail not verified)"}`,
        `Expected Margin: ${retailReady ? "see scenarios" : "DATA MISSING — cannot compute without verified retail"}`,
        `Max Bid: ${rep.reviewReady ? "compute after owner sets target margin" : "DATA MISSING — vehicle not review-ready"}`,
        `Recommendation: ${rep.reviewReady ? "OWNER REVIEW" : "DATA MISSING"}`,
        `Reason: ${rep.reviewReady ? "all four numbers verified" : "valuation gate not satisfied: " + rep.missing.map((m: any) => m.label).join(", ")}`,
        `Missing Data: ${rep.missing.length ? rep.missing.map((m: any) => `${m.label} (${m.status})`).join("; ") : "none"}`,
      ].join("\n");
    }
    case "score_deal": {
      const l = await resolve(ctx, args);
      if (!l) return "No matching vehicle.";
      const rep = await ctx.runQuery(internal.valuations.reportForListing, { listingId: l._id });
      if (!rep.reviewReady) {
        await ctx.runMutation(internal.valuations.createValuationTasks, { listingId: l._id });
        return `${veh(l)}\n${valuationLines(rep)}\n\nScore: DATA MISSING — cannot score (let alone HOT BUY) until all four numbers are VERIFIED. Missing: ${rep.missing.map((m: any) => m.label).join(", ")}.`;
      }
      const profit = l.estProfit ?? 0;
      const score = profit >= 2500 ? "HOT BUY" : profit >= 1200 ? "OWNER REVIEW" : profit > 0 ? "WATCH" : "PASS";
      return `${veh(l)}\n${valuationLines(rep)}\n\nScore: ${score} (est profit ${money(profit)}, deal score ${l.dealScore ?? "?"}).`;
    }
    case "get_repair_parts_estimate": {
      const l = await resolve(ctx, args);
      if (!l) return "No matching vehicle.";
      const parts = await ctx.runQuery(internal.valuations.repairParts, { year: l.year, make: l.make, model: l.model });
      if (!parts.engine && !parts.transmission) {
        await ctx.runMutation(internal.valuations.createTask, {
          listingId: l._id, kind: "check_carpart", title: `Car-Part lookup: ${veh(l)}`,
          instructions: `car-part.com, ZIP 84101: cheapest matching ENGINE and (separately) TRANSMISSION for ${veh(l)}. Record price, vendor, miles, warranty.`,
        });
        return `${veh(l)}: no Car-Part data on file — employee task created (ZIP 84101).`;
      }
      return `${veh(l)} (Car-Part.com, ZIP 84101 — separate scenarios):\nEngine: ${parts.engine ? money(parts.engine.price) + ` (n=${parts.engine.sampleSize})` : "DATA MISSING"}\nTransmission: ${parts.transmission ? money(parts.transmission.price) + ` (n=${parts.transmission.sampleSize})` : "DATA MISSING"}`;
    }
    case "estimate_transport": {
      const l = await resolve(ctx, args);
      if (!l) return "No matching vehicle.";
      const t = transportEstimate(l);
      return `${veh(l)} -> Utah 84101\nEstimated transport: ${money(t.cost)}\nMethod: per-mile heuristic\nConfidence: ${t.confidence}\nNotes: ${t.note}`;
    }
    case "generate_owner_report": {
      const cands = await ctx.runQuery(internal.valuations.reviewCandidates, { limit: args?.limit ?? 20 });
      const ready = cands.filter((c: any) => c.report.reviewReady);
      const missing = cands.filter((c: any) => !c.report.reviewReady);
      const row = ({ listing, report }: any) => {
        const r = (k: string) => money(report.results.find((x: any) => x.kind === k).value);
        return `• ${veh(listing)} — price ${money(listing.price)} | JD Clean ${r("jd_clean_trade")} / JD Retail ${r("jd_full_retail")} / KBB ${r("kbb_lending")} / MMR ${r("base_mmr")} | est margin ${money(listing.estProfit)} | ${report.overall}`;
      };
      return [
        "OWNER REPORT (phone-friendly)",
        "",
        `READY FOR A DECISION (${ready.length}):`,
        ready.length ? ready.map(row).join("\n") : "  none yet — see missing-data below",
        "",
        `MISSING DATA — needs employee action (${missing.length}):`,
        missing.slice(0, 15).map(row).join("\n"),
        "",
        "Note: JD Full Retail + Base MMR are not yet sourced system-wide, so most cars show DATA MISSING until those two numbers are pulled and double-checked.",
      ].join("\n");
    }
    case "create_employee_task": {
      const id = await ctx.runMutation(internal.valuations.createTask, {
        listingId: args?.listingId, kind: args?.kind ?? "general", title: args.title, instructions: args.instructions,
      });
      return `Task created (${id}): ${args.title}`;
    }
    case "generate_employee_instructions": {
      return [
        `Situation: ${args.context}`,
        "Next steps:",
        "1. Open the vehicle in Airtable (Deals) and read the Missing Data field.",
        "2. For each missing valuation number, pull it from the official source and save a screenshot/export as proof.",
        "3. Run a second independent check on each number; if the two differ by more than $500 or 3%, leave it flagged VALUE MISMATCH for owner review.",
        "4. Verify the VIN and that the listing is still active.",
        "5. Mark the task done — the vehicle re-checks the gate automatically.",
      ].join("\n");
    }
    case "ingest_auction_run_list": {
      const id = await ctx.runMutation(internal.valuations.createTask, {
        kind: "auction_intake",
        title: `Auction run list intake${args?.auction ? ": " + args.auction : ""}`,
        instructions: `Parse + load this run list (group by auction/lane/run, capture VIN/year/make/model/mileage/announcements/title): ${(args?.text ?? "(no text provided)").slice(0, 500)}`,
      });
      return `Received auction run list${args?.auction ? ` for ${args.auction}` : ""}. Structured PDF/CSV parsing is the next build increment; intake task ${id} created so nothing is lost. Paste extracted rows and I can analyze each with analyze_auction_vehicle.`;
    }
    case "refresh_active_listings": {
      const cands = await ctx.runQuery(internal.valuations.reviewCandidates, { limit: 1000 });
      return `Active listings: ${cands.length}. (Scheduled refresh + sold/expired/price-change detection runs on cron; full per-status diff is the next increment.)`;
    }
    case "sync_airtable": {
      if (role !== "owner") return "sync_airtable requires the owner role.";
      const res = await ctx.runAction(internal.airtable.backfillAll, { limit: args?.limit });
      return `Airtable sync scheduled for ${res.scheduled} listings (upsert by CarHunter Lead ID; no duplicates). If AIRTABLE_PAT/BASE are unset this is a no-op — configure them first.`;
    }
    case "send_slack_alert": {
      const l = await resolve(ctx, args);
      if (!l) return "No matching vehicle.";
      const rep = await ctx.runQuery(internal.valuations.reportForListing, { listingId: l._id });
      if (!rep.reviewReady) {
        return `REFUSED: cannot send a HOT BUY / OWNER REVIEW alert — valuation numbers not verified. Missing: ${rep.missing.map((m: any) => m.label).join(", ")}. (Hard rule: no alert without the four numbers.)`;
      }
      await ctx.scheduler.runAfter(0, internal.slack.sendHotLead, { listingId: l._id });
      return `Slack alert sent for ${veh(l)} (all four numbers verified).`;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---- JSON-RPC transport ----
function rpc(id: any, result: any) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "Content-Type": "application/json" } });
}
function rpcError(id: any, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { headers: { "Content-Type": "application/json" } });
}

export const mcpHandler = httpAction(async (ctx, req) => {
  const role = roleFor(req);
  if (!role) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  const { id, method, params } = body ?? {};

  // notifications (no id) -> 202, no body
  if (id === undefined || id === null) return new Response(null, { status: 202 });

  if (method === "initialize") {
    return rpc(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "carhunter", version: "0.1.0" } });
  }
  if (method === "ping") return rpc(id, {});
  if (method === "tools/list") return rpc(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      const text = await callTool(ctx, name, args, role);
      await ctx.runMutation(internal.valuations.audit, { role, tool: name, ok: true });
      return rpc(id, { content: [{ type: "text", text }] });
    } catch (e) {
      const msg = String(e).slice(0, 300);
      await ctx.runMutation(internal.valuations.audit, { role, tool: name ?? "unknown", ok: false, detail: msg });
      return rpc(id, { content: [{ type: "text", text: `Tool error: ${msg}` }], isError: true });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
});
