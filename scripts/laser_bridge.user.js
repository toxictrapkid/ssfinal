// ==UserScript==
// @name         CarHunter ↔ Laser Appraiser bridge
// @namespace    carhunter
// @version      1.0
// @description  Appraise CarHunter's queued VINs from inside your logged-in Laser session and post book values back to Convex.
// @match        https://prd.laserappraiserservices.com/*
// @grant        GM_xmlhttpRequest
// @connect      silent-leopard-39.convex.cloud
// @run-at       document-idle
// ==/UserScript==
(function () {
  "use strict";

  // ---- CONFIG (fill in your INGEST_SECRET) -------------------------------
  const CONVEX_URL = "https://silent-leopard-39.convex.cloud";
  const SECRET = "PASTE_YOUR_INGEST_SECRET_HERE";
  const BATCH = 8;          // VINs per cycle
  const CYCLE_MS = 60000;   // wait between cycles
  const PER_VIN_MS = 1500;  // polite pacing between VIN lookups
  // ------------------------------------------------------------------------

  const log = (...a) => console.log("%c[laser-bridge]", "color:#0b3d62;font-weight:bold", ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (x) => { const n = parseInt(String(x).replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) && n > 0 ? n : null; };

  // Read the live session token + device id off the page (always current).
  function getSession() {
    const hay = (document.getElementById("devInfoHref")?.value || "") + "&" +
                document.documentElement.innerHTML + "&" + location.href;
    const sec = hay.match(/security=(\d{3,})/);
    const dev = hay.match(/device[Ii]d=([A-Za-z0-9-]{8,})/);
    return { security: sec && sec[1], deviceId: dev && dev[1] };
  }

  // Cross-origin call to Convex (bypasses CORS via GM_xmlhttpRequest).
  function convex(kind, path, args) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${CONVEX_URL}/api/${kind}`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ path, args, format: "json" }),
        onload: (r) => {
          try {
            const j = JSON.parse(r.responseText);
            if (j.status === "success") resolve(j.value);
            else reject(new Error(j.errorMessage || r.responseText.slice(0, 200)));
          } catch (e) { reject(e); }
        },
        onerror: () => reject(new Error("convex network error")),
      });
    });
  }

  // Same-origin fetch inside the authenticated Laser session.
  async function laserGet(url) {
    const r = await fetch(url, { credentials: "include" });
    return await r.text();
  }

  // Pull the first balanced {...} after a key, JSON.parse it.
  function jsonAfter(s, keyRe) {
    const m = s.match(keyRe);
    if (!m) return null;
    let i = s.indexOf("{", m.index), depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; } } }
    }
    return null;
  }

  // NADA clean trade-in = Comm.Trade (fallback Comm.TrAv = trade average).
  function parseNada(html) {
    const comm = jsonAfter(html, /"Comm"\s*:/);
    if (!comm) return null;
    return num(comm.Trade) || num(comm.TrAv) || null;
  }

  // KBB lending: prefer an explicit Lending value, else KBB wholesale (Whole.Adjusted).
  function parseKbb(html) {
    let m = html.match(/"Lending"\s*:\s*\{[^}]*"Adjusted"\s*:\s*"?(\d+)/i) ||
            html.match(/"Loan"\s*:\s*"?(\d{3,})/i);
    if (m) return num(m[1]);
    const comm = jsonAfter(html, /"Comm"\s*:/);
    if (comm && comm.Whole) return num(comm.Whole.Adjusted) || num(comm.Whole.Base);
    return null;
  }

  async function appraiseVin(v, sess) {
    const base = `https://prd.laserappraiserservices.com/wavisprd`;
    const common = `security=${sess.security}&deviceId=${sess.deviceId}&deviceType=Android&appVersion=3.0&widthPixels=320&heightPixels=480&src=local&sim=1`;
    // 1) load the VIN into the session
    await laserGet(`${base}/wdVinData.jsp?${common}&retrievalDate=refresh&action=vinNew&vin=${v.vin}`);
    // 2) pull NADA + KBB partner data
    const nada = await laserGet(`${base}/wdVinPartnerData.jsp?wait=true&partner=NADA&vin=${v.vin}`);
    const kbb = await laserGet(`${base}/wdVinPartnerData.jsp?wait=true&partner=KBB&vin=${v.vin}`);
    return { dedupeKey: v.dedupeKey, jdCleanTrade: parseNada(nada), kbbLending: parseKbb(kbb) };
  }

  async function cycle() {
    const sess = getSession();
    if (!sess.security || !sess.deviceId) { log("no live session on this page — open a vehicle/list page while logged in"); return; }
    let res;
    try { res = await convex("query", "laser:pendingVins", { secret: SECRET, limit: BATCH }); }
    catch (e) { log("pendingVins failed:", e.message); return; }
    if (res && res.error) { log("backend:", res.error, "(check SECRET)"); return; }
    const vins = (res && res.vins) || [];
    if (!vins.length) { log("queue empty — nothing to appraise"); return; }
    log(`appraising ${vins.length} VIN(s)…`);
    const values = [];
    for (const v of vins) {
      try { values.push(await appraiseVin(v, sess)); }
      catch (e) { log("vin", v.vin, "error", e.message); values.push({ dedupeKey: v.dedupeKey, jdCleanTrade: null, kbbLending: null }); }
      await sleep(PER_VIN_MS);
    }
    try {
      const out = await convex("action", "laser:appraise", { secret: SECRET, values });
      log("posted:", JSON.stringify(out));
    } catch (e) { log("appraise post failed:", e.message); }
  }

  async function main() {
    if (SECRET.includes("PASTE_")) { log("⚠ set SECRET (your INGEST_SECRET) at the top of the script"); return; }
    log("bridge running on", location.host);
    // eslint-disable-next-line no-constant-condition
    while (true) { try { await cycle(); } catch (e) { log("cycle error", e.message); } await sleep(CYCLE_MS); }
  }
  main();
})();
