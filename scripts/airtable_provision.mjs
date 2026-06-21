#!/usr/bin/env node
/**
 * One-time Airtable provisioning for the CarHunter CRM (MVP: 6 tables).
 *
 * Creates the base + Deals, Tasks, Owner Approvals, Auctions, Auction Run
 * Vehicles, and Tool Issues, with correct field types and select options, then
 * adds the cross-table link fields. Prints the env block to paste into Convex.
 *
 * Requirements:
 *   - A Personal Access Token with scopes: schema.bases:write, data.records:write
 *     (and access to the target workspace).
 *   - The workspace id (looks like "wspXXXXXXXXXXXXXX") — find it in the Airtable
 *     URL when viewing the workspace, or via the Meta API.
 *
 * Usage:
 *   AIRTABLE_PAT=pat_xxx AIRTABLE_WORKSPACE_ID=wsp_xxx node scripts/airtable_provision.mjs
 *
 * Re-running creates a SECOND base — run once. Node 18+ (global fetch).
 */

const PAT = process.env.AIRTABLE_PAT;
const WORKSPACE = process.env.AIRTABLE_WORKSPACE_ID;
const BASE_NAME = process.env.AIRTABLE_BASE_NAME || "CarHunter CRM";
if (!PAT || !WORKSPACE) {
  console.error("Set AIRTABLE_PAT and AIRTABLE_WORKSPACE_ID. See header for scopes.");
  process.exit(1);
}
const META = "https://api.airtable.com/v0/meta/bases";
const H = { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" };

// ---- field-type shorthands ----
const txt = (name) => ({ name, type: "singleLineText" });
const long = (name) => ({ name, type: "multilineText" });
const url = (name) => ({ name, type: "url" });
const int = (name) => ({ name, type: "number", options: { precision: 0 } });
const usd = (name) => ({ name, type: "currency", options: { precision: 0, symbol: "$" } });
const check = (name) => ({ name, type: "checkbox", options: { icon: "check", color: "greenBright" } });
const date = (name) => ({ name, type: "date", options: { dateFormat: { name: "us" } } });
const who = (name) => ({ name, type: "singleCollaborator" });
const attach = (name) => ({ name, type: "multipleAttachments" });
const sel = (name, choices) => ({ name, type: "singleSelect", options: { choices: choices.map((c) => ({ name: c })) } });
const msel = (name, choices) => ({ name, type: "multipleSelects", options: { choices: choices.map((c) => ({ name: c })) } });

const TITLE = ["clean", "salvage", "rebuilt", "branded", "unknown"];

// ---- table definitions (link fields added after creation) ----
const tables = [
  {
    name: "Deals",
    description: "Every possible car. CarHunter-owned fields auto-sync; workflow fields are owned by the team.",
    fields: [
      txt("Vehicle"), // primary
      txt("CarHunter Lead ID"),
      sel("Source", ["ksl", "facebook", "auction", "manual"]),
      url("Source link"),
      int("Year"), txt("Make"), txt("Model"), txt("Trim"),
      txt("VIN"), int("Mileage"), usd("Price"), txt("Location"),
      txt("Seller"),
      sel("Status", ["New", "Triage", "Need VIN", "Contacted", "Waiting reply", "Owner review", "Inspection scheduled", "Watch", "Dead", "Bought", "Missed"]),
      who("Assigned employee"),
      check("HOT"), check("Mechanic special"),
      int("Deal score"),
      usd("JD Clean Trade"), usd("JD Full Retail"), usd("KBB Lending"), usd("Base MMR"),
      sel("Title status", TITLE),
      msel("Risk flags", ["Salvage", "Rebuilt", "Branded title", "Mechanic special", "No VIN", "High miles", "Very low price"]),
      msel("Missing data", ["VIN", "Values", "Mileage", "Title", "Photos"]),
      txt("Next action"), date("Next action date"),
      check("Owner approval needed"),
      sel("Owner decision", ["Pending", "Approved", "Declined", "Watch"]),
      sel("Final outcome", ["Open", "Bought", "Missed", "Dead", "Watch"]),
      url("CarHunter link"),
      usd("Est profit"), usd("Est value"),
    ],
  },
  {
    name: "Tasks",
    description: "Employee work queue / follow-ups.",
    fields: [
      txt("Task"), // primary
      sel("Type", ["Follow-up", "Verify VIN", "Pull values", "Carfax", "Car-Part", "Owner packet", "Other"]),
      who("Assigned employee"),
      date("Due date"),
      sel("Status", ["To do", "Doing", "Done"]),
      sel("Priority", ["Low", "Normal", "High"]),
      long("Notes"),
    ],
  },
  {
    name: "Owner Approvals",
    description: "Offer approvals, auction max bids, inspection approvals, pass/watch decisions.",
    fields: [
      txt("Request"), // primary
      sel("Type", ["Offer approval", "Auction max bid", "Inspection", "Pass/Watch"]),
      usd("Ask amount"), usd("Profit estimate"),
      long("Risks / notes"),
      who("Requested by"), date("Requested at"),
      sel("Decision", ["Pending", "Approved", "Declined", "Watch"]),
      long("Decision note"), date("Decided at"),
    ],
  },
  {
    name: "Auctions",
    description: "Auction sale/date/source/run-list file.",
    fields: [
      txt("Auction"), // primary
      date("Sale date"),
      sel("Source", ["Manheim", "ADESA", "IAA", "Copart", "Other"]),
      attach("Run list file"),
      txt("Lanes"),
      sel("Status", ["Upcoming", "Reviewed", "Done"]),
      long("Notes"),
    ],
  },
  {
    name: "Auction Run Vehicles",
    description: "Separate from private-party leads. Group by auction, lane, run. Engine and transmission are SEPARATE scenarios.",
    fields: [
      txt("Vehicle"), // primary
      txt("Lane"), txt("Run number"),
      txt("VIN"), int("Mileage"), txt("Location"),
      long("Announcements"),
      sel("Title status", TITLE),
      usd("JD Clean Trade"), usd("JD Full Retail"), usd("KBB Lending"), usd("Base MMR"),
      usd("Transport estimate"),
      usd("Engine cost (Car-Part 84101)"), usd("Transmission cost (Car-Part 84101)"),
      usd("Engine labor"), usd("Transmission labor"),
      usd("Engine scenario all-in"), usd("Transmission scenario all-in"),
      usd("Engine room"), usd("Transmission room"),
      sel("Recommendation", ["Bid", "Watch", "Pass"]),
      long("Missing data"),
      txt("Owner ask"),
    ],
  },
  {
    name: "Tool Issues",
    description: "CarHunter, Laser, Carfax, Car-Part, Airtable, Slack, or sync problems.",
    fields: [
      txt("Issue"), // primary
      sel("Tool", ["CarHunter", "Laser", "Carfax", "Car-Part", "Airtable", "Slack", "Sync"]),
      sel("Severity", ["info", "warn", "error"]),
      long("Detail"),
      sel("Status", ["Open", "Resolved"]),
      date("First seen"), int("Count"), date("Resolved at"),
    ],
  },
];

async function api(method, path, body) {
  const r = await fetch(`https://api.airtable.com/v0/meta${path}`, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function addLink(baseId, tableId, name, linkedTableId) {
  return api("POST", `/bases/${baseId}/tables/${tableId}/fields`, {
    name, type: "multipleRecordLinks", options: { linkedTableId },
  });
}

(async () => {
  console.log(`Creating base "${BASE_NAME}" in workspace ${WORKSPACE} ...`);
  const res = await fetch(META, { method: "POST", headers: H, body: JSON.stringify({ name: BASE_NAME, workspaceId: WORKSPACE, tables }) });
  const body = await res.text();
  if (!res.ok) throw new Error(`create base -> ${res.status}: ${body}`);
  const base = JSON.parse(body);
  const baseId = base.id;
  const byName = Object.fromEntries(base.tables.map((t) => [t.name, t.id]));
  console.log(`Base created: ${baseId}`);
  for (const t of base.tables) console.log(`  table ${t.name} = ${t.id}`);

  // cross-table links (added after creation so the target table ids exist)
  console.log("Adding link fields ...");
  await addLink(baseId, byName["Tasks"], "Deal", byName["Deals"]);
  await addLink(baseId, byName["Owner Approvals"], "Deal", byName["Deals"]);
  await addLink(baseId, byName["Auction Run Vehicles"], "Linked deal", byName["Deals"]);
  await addLink(baseId, byName["Auction Run Vehicles"], "Auction", byName["Auctions"]);
  await addLink(baseId, byName["Tool Issues"], "Linked deal", byName["Deals"]);
  console.log("Links added.");

  console.log("\n========== paste into Convex env (npx convex env set) ==========");
  console.log(`AIRTABLE_BASE_ID=${baseId}`);
  console.log(`AIRTABLE_DEALS_TABLE_ID=${byName["Deals"]}`);
  console.log("# also set: AIRTABLE_PAT=<token with data.records:write on this base>");
  console.log("================================================================");
  console.log("\nNext: set the env vars, then run the backfill:");
  console.log("  npx convex run airtable:backfillAll");
})().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
