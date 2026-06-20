// ==UserScript==
// @name         CarHunter Laser bridge
// @namespace    carhunter
// @version      2.0
// @description  Appraise CarHunter's queued VINs from inside your logged-in Laser session and post book values back. Auto-runs on every Laser page load (plain fetch via CORS endpoints — no special grants).
// @match        https://prd.laserappraiserservices.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  "use strict";
  // Set SECRET to your deployment's INGEST_SECRET.
  const SECRET = "PASTE_YOUR_INGEST_SECRET_HERE";
  const SITE = "https://silent-leopard-39.convex.site";
  const L = "https://prd.laserappraiserservices.com/wavisprd";

  const log = (...a) => console.log("%c[bridge]", "color:#0b3d62;font-weight:bold", ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (x) => { const n = parseInt(String(x).replace(/[^0-9]/g, ""), 10); return n > 0 ? n : null; };
  const sess = () => {
    const h = (document.getElementById("devInfoHref")?.value || "") + "&" + document.documentElement.innerHTML + "&" + location.href;
    return { security: (h.match(/security=(\d{3,})/) || [])[1], deviceId: (h.match(/device[Ii]d=([A-Za-z0-9-]{8,})/) || [])[1] };
  };
  const get = async (u) => (await fetch(u, { credentials: "include" })).text();
  const pick = (html, key) => {
    const m = html.match(new RegExp('"' + key + '":\\s*\\{[^}]*\\}'));
    if (!m) return null;
    try { return JSON.parse("{" + m[0] + "}")[key]; } catch { return null; }
  };
  // NADA clean trade-in = Comm.Trade (fallback Comm.TrAv = trade average).
  const nada = (h) => { const c = pick(h, "Comm"); return c ? (num(c.Trade) || num(c.TrAv)) : null; };
  // KBB = Whole (wholesale) Adjusted as the lending proxy.
  const kbb = (h) => { const w = pick(h, "Whole"); return w ? (num(w.Adjusted) || num(w.Base)) : null; };

  async function lookup(v, s) {
    const c = `security=${s.security}&deviceId=${s.deviceId}&deviceType=Android&appVersion=3.0&widthPixels=320&heightPixels=480&src=local&sim=1`;
    await get(`${L}/wdVinData.jsp?${c}&retrievalDate=refresh&action=vinNew&vin=${v.vin}`);
    const n = await get(`${L}/wdVinPartnerData.jsp?wait=true&partner=NADA&vin=${v.vin}`);
    const k = await get(`${L}/wdVinPartnerData.jsp?wait=true&partner=KBB&vin=${v.vin}`);
    return { dedupeKey: v.dedupeKey, jdCleanTrade: nada(n), kbbLending: kbb(k) };
  }

  async function cycle() {
    const s = sess();
    if (!s.security) { log("no live session — open a Laser vehicle/list page"); return; }
    const r = await (await fetch(`${SITE}/laser/pending?secret=${SECRET}&limit=8`)).json();
    const vins = r.vins || [];
    if (!vins.length) { log("queue empty"); return; }
    log("appraising", vins.length, "VIN(s)…");
    const vals = [];
    for (const v of vins) {
      try { vals.push(await lookup(v, s)); }
      catch (e) { vals.push({ dedupeKey: v.dedupeKey, jdCleanTrade: null, kbbLending: null }); }
      await sleep(1500);
    }
    const out = await (await fetch(`${SITE}/laser/values`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: SECRET, values: vals }),
    })).json();
    log("posted ->", JSON.stringify(out));
  }

  (async () => {
    if (SECRET.includes("PASTE_")) { log("set SECRET (your INGEST_SECRET) at the top"); return; }
    log("auto-bridge running on", location.host);
    while (true) { try { await cycle(); } catch (e) { log("cycle error", e.message); } await sleep(60000); }
  })();
})();
