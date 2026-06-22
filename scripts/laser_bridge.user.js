// ==UserScript==
// @name         CarHunter Laser bridge
// @namespace    carhunter
// @version      4.0
// @description  Appraise CarHunter's queued VINs from inside your logged-in Laser session and post book values back. Auto-runs on every Laser page load. v4: also captures JD Full Retail (Comm.Retail) + Base MMR (Whole.Adjusted), and TRIM-MATCHES KBB/MMR (those partners return every trim) instead of grabbing the first block.
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
  const cb = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`; // cache-buster
  const expired = (h) => /security session has expired/i.test(h);
  const stale = (h) => /data for this vehicle is stale/i.test(h);

  const sess = () => {
    const h = (document.getElementById("devInfoHref")?.value || "") + "&" + document.documentElement.innerHTML + "&" + location.href;
    return { security: (h.match(/security=(\d{3,})/) || [])[1], deviceId: (h.match(/device[Ii]d=([A-Za-z0-9-]{8,})/) || [])[1] };
  };
  const get = async (u) => (await fetch(u, { credentials: "include", cache: "no-store" })).text();
  const pick = (html, key) => {
    const m = html.match(new RegExp('"' + key + '":\\s*\\{[^}]*\\}'));
    if (!m) return null;
    try { return JSON.parse("{" + m[0] + "}")[key]; } catch { return null; }
  };
  // NADA auto-matches the trim, so Comm is the matched vehicle's block.
  // JD Clean Trade = Comm.Trade (fallback Comm.TrAv); JD Full Retail = Comm.Retail.
  const nada = (h) => { const c = pick(h, "Comm"); return c ? (num(c.Trade) || num(c.TrAv)) : null; };
  const nadaRetail = (h) => { const c = pick(h, "Comm"); return c ? num(c.Retail) : null; };
  // KBB = first Whole.Adjusted (fallback when the trim can't be matched).
  const kbb = (h) => { const w = pick(h, "Whole"); return w ? (num(w.Adjusted) || num(w.Base)) : null; };

  // KBB + MMR responses contain one record PER TRIM, each labelled
  // "Trim":"4D SDN SR " with a "Whole":{"Adjusted":...} block. Match the queued
  // listing's trim as a whole-word token; return a value ONLY on a unique match
  // (never guess on ambiguity — that would invent a number).
  const tnorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wordMatch = (label, want) => {
    if (!want) return false;
    const have = tnorm(label).split(" ").filter(Boolean);
    const wants = tnorm(want).split(" ").filter(Boolean);
    return wants.length > 0 && wants.every((t) => have.includes(t));
  };
  const bookByTrim = (html, trim, block) => {
    if (!trim) return null;
    const re = /"Trim":\s*"([^"]*)"/g;
    const hits = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!wordMatch(m[1], trim)) continue;
      const tail = html.slice(m.index, m.index + 600);
      const bm = tail.match(new RegExp('"' + block + '":\\s*\\{[^}]*?"Adjusted":\\s*"(\\d+)"'));
      if (bm) hits.push(num(bm[1]));
    }
    return hits.length === 1 ? hits[0] : null; // unique match only
  };
  // "2017 toyota" fingerprint, to confirm NADA + KBB describe the SAME vehicle.
  const fp = (h) => { const m = h.match(/\b(20\d{2})\s+([A-Za-z][A-Za-z-]{1,})/); return m ? (m[1] + " " + m[2].toLowerCase()) : null; };
  const sameVehicle = (a, b) => { const x = fp(a), y = fp(b); return !x || !y ? true : x === y; };

  async function partners(vin, s) {
    const c = `security=${s.security}&deviceId=${s.deviceId}&deviceType=Android&appVersion=3.0&widthPixels=320&heightPixels=480&src=local&sim=1`;
    const loaded = await get(`${L}/wdVinData.jsp?${c}&retrievalDate=refresh&action=vinNew&vin=${vin}&r=${cb()}`);
    if (expired(loaded)) throw new Error("SESSION_EXPIRED");
    await sleep(900); // let the server settle on THIS vehicle before pulling books
    const n = await get(`${L}/wdVinPartnerData.jsp?wait=true&partner=NADA&vin=${vin}&r=${cb()}`);
    const k = await get(`${L}/wdVinPartnerData.jsp?wait=true&partner=KBB&vin=${vin}&r=${cb()}`);
    const m = await get(`${L}/wdVinPartnerData.jsp?wait=true&partner=MMR&vin=${vin}&r=${cb()}`);
    return { n, k, m };
  }

  async function lookup(v, s) {
    let { n, k, m } = await partners(v.vin, s);
    if (expired(n) || expired(k)) throw new Error("SESSION_EXPIRED");
    if (stale(n) || stale(k) || !sameVehicle(n, k)) {
      // one retry — clears a cross-read / not-yet-ready race
      await sleep(1500);
      ({ n, k, m } = await partners(v.vin, s));
      if (expired(n) || expired(k)) throw new Error("SESSION_EXPIRED");
    }
    if (stale(n) || stale(k) || !sameVehicle(n, k)) {
      return { dedupeKey: v.dedupeKey, jdCleanTrade: null, jdFullRetail: null, kbbLending: null, baseMmr: null, bad: true };
    }
    return {
      dedupeKey: v.dedupeKey,
      jdCleanTrade: nada(n),
      jdFullRetail: nadaRetail(n),
      // trim-match KBB; fall back to first-Whole if the trim can't be matched.
      kbbLending: bookByTrim(k, v.trim, "Whole") ?? kbb(k),
      // Base MMR = wholesale Whole.Adjusted for the matched trim (null if ambiguous).
      baseMmr: bookByTrim(m, v.trim, "Whole"),
    };
  }

  async function cycle() {
    const s = sess();
    if (!s.security) { log("no live session — open a Laser vehicle/list page"); return true; }
    const r = await (await fetch(`${SITE}/laser/pending?secret=${SECRET}&limit=8`)).json();
    if (r && r.error) { log("backend:", r.error, "(check SECRET)"); return true; }
    const vins = (r && r.vins) || [];
    if (!vins.length) { log("queue empty"); return true; }
    log("appraising", vins.length, "VIN(s)…");
    const vals = [];
    for (const v of vins) {
      try {
        const x = await lookup(v, s);
        vals.push({
          dedupeKey: x.dedupeKey,
          jdCleanTrade: x.jdCleanTrade,
          jdFullRetail: x.jdFullRetail,
          kbbLending: x.kbbLending,
          baseMmr: x.baseMmr,
        });
        log("  ", v.vin, x.bad ? "(skipped: cross-read)" : `JD ${x.jdCleanTrade} / Retail ${x.jdFullRetail} / KBB ${x.kbbLending} / MMR ${x.baseMmr}`);
      } catch (e) {
        if (e.message === "SESSION_EXPIRED") { log("⚠ session expired — refresh the Laser page; pausing this cycle (nothing posted)"); return false; }
        log("  ", v.vin, "error", e.message);
        vals.push({ dedupeKey: v.dedupeKey, jdCleanTrade: null, jdFullRetail: null, kbbLending: null, baseMmr: null });
      }
      await sleep(1500);
    }
    const out = await (await fetch(`${SITE}/laser/values`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: SECRET, values: vals }),
    })).json();
    log("posted ->", JSON.stringify(out));
    return true;
  }

  (async () => {
    if (SECRET.includes("PASTE_")) { log("set SECRET (your INGEST_SECRET) at the top"); return; }
    log("auto-bridge v4 running on", location.host);
    while (true) { let ok = true; try { ok = await cycle(); } catch (e) { log("cycle error", e.message); } await sleep(ok ? 60000 : 120000); }
  })();
})();
