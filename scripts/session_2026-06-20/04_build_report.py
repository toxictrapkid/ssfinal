import json, csv, datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, ListFlowable, ListItem, HRFlowable)

OUT="/home/user/ssfinal/CarHunter_Session_Report.pdf"
styles=getSampleStyleSheet()
H1=ParagraphStyle('H1',parent=styles['Heading1'],fontSize=17,spaceAfter=8,spaceBefore=10,textColor=colors.HexColor('#0b3d62'))
H2=ParagraphStyle('H2',parent=styles['Heading2'],fontSize=13,spaceAfter=5,spaceBefore=12,textColor=colors.HexColor('#12598c'))
H3=ParagraphStyle('H3',parent=styles['Heading3'],fontSize=11,spaceAfter=3,spaceBefore=7,textColor=colors.HexColor('#444'))
BODY=ParagraphStyle('BODY',parent=styles['BodyText'],fontSize=9.3,leading=13,spaceAfter=5)
SMALL=ParagraphStyle('SMALL',parent=styles['BodyText'],fontSize=8,leading=10,textColor=colors.HexColor('#555'))
Q=ParagraphStyle('Q',parent=styles['BodyText'],fontSize=10,leading=13,textColor=colors.white,
                 backColor=colors.HexColor('#12598c'),borderPadding=6,spaceAfter=6,spaceBefore=2,leftIndent=0)
TITLE=ParagraphStyle('TITLE',parent=styles['Title'],fontSize=26,textColor=colors.HexColor('#0b3d62'),spaceAfter=4)
SUB=ParagraphStyle('SUB',parent=styles['Title'],fontSize=12,textColor=colors.HexColor('#666'),spaceAfter=2)
CELL=ParagraphStyle('CELL',parent=styles['BodyText'],fontSize=7.6,leading=9)
CELLB=ParagraphStyle('CELLB',parent=CELL,fontName='Helvetica-Bold')

def money(x):
    try: return "$%s"%format(int(round(float(x))),",")
    except: return str(x)
def signed(x):
    try:
        v=int(round(float(x))); return ("+$%s" if v>=0 else "-$%s")%format(abs(v),",")
    except: return str(x)

E=[]
def p(t,s=BODY): E.append(Paragraph(t,s))
def sp(h=6): E.append(Spacer(1,h))
def hr(): E.append(HRFlowable(width="100%",thickness=0.6,color=colors.HexColor('#ccd6e0'),spaceBefore=4,spaceAfter=6))
def bullets(items,st=BODY):
    E.append(ListFlowable([ListItem(Paragraph(i,st),leftIndent=10) for i in items],bulletType='bullet',start='•',leftIndent=12))

def table(header, rows, widths, fonthdr=7.8, align_right=None):
    align_right=align_right or []
    data=[[Paragraph(h,CELLB) for h in header]]
    for r in rows:
        data.append([Paragraph(str(c),CELL) for c in r])
    t=Table(data,colWidths=widths,repeatRows=1)
    ts=[('BACKGROUND',(0,0),(-1,0),colors.HexColor('#0b3d62')),
        ('TEXTCOLOR',(0,0),(-1,0),colors.white),
        ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,0),fonthdr),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#eef3f8')]),
        ('GRID',(0,0),(-1,-1),0.4,colors.HexColor('#c8d2dc')),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),2.5),('BOTTOMPADDING',(0,0),(-1,-1),2.5),
        ('LEFTPADDING',(0,0),(-1,-1),3.5),('RIGHTPADDING',(0,0),(-1,-1),3.5)]
    E.append(t); sp(6)

# ---------- load data ----------
twentyfive=json.load(open("platform_under12k_2016plus_99kmi.json"))
ranked=[]
with open("platform_RANKED_by_spread.csv") as f:
    for r in csv.DictReader(f): ranked.append(r)
# JD verified recompute
stale={r.get("vin"):r for r in json.load(open("/tmp/feedrun.json"))["value"] if r.get("vin")}
val={}
for i in [1,2,3,4]:
    for r in json.load(open(f"/tmp/val{i}.json")): val[r["key"]]=r
fresh=json.load(open("/tmp/fresh_scrape.json"))
jdrows=[]
for fr in fresh:
    vin=fr.get("vin")
    if not vin or vin not in stale: continue
    jd=stale[vin].get("carblyJdCleanTrade")
    if not jd: continue
    v=val.get(vin) or val.get(fr.get("sourceListingId"))
    if not v or v.get("estValue") is None: continue
    jdrows.append({"veh":v["vehicle"],"price":fr["price"],"jd":int(jd),
                   "mc":v["estValue"],"mc_spread":v["spread"],
                   "jd_spread":round(jd-fr["price"]-800),"url":fr.get("url")})
jdrows.sort(key=lambda r:r["jd_spread"],reverse=True)

BD="fc8ddc4a-…-876c90833a1a  (live Bright Data token — masked; full value in untracked .env.local)"

# ================= COVER =================
sp(60)
p("CarHunter",TITLE)
p("Session Work Log &amp; Full Transcript Breakdown",SUB)
sp(10)
p("A complete, chronological record of every question asked, every task performed, "
  "the answer given each time, and the supporting artifacts produced.",ParagraphStyle('cv',parent=BODY,fontSize=11,alignment=TA_CENTER))
sp(30)
meta=[["Prepared for","zaki@zakimohamed.com"],
      ["Date","2026-06-20"],
      ["Repository","toxictrapkid/ssfinal  (branch: claude/magical-meitner-2i71q8)"],
      ["Platform","CarHunter — Convex deployment dev:silent-leopard-39"],
      ["Scope","Private-party undervalued-car finder on KSL Cars"],
      ["Coverage","Genesis (codebase exploration &amp; plan) + 13 user requests, turn by turn"],
      ["Artifacts produced","Plan file, 4 data exports (CSV/JSON), valuation set, this report"]]
table(["Field","Value"],meta,[1.6*inch,4.7*inch])
sp(10)
p("Security note: one live credential (Bright Data Web Unlocker token) was shared during the "
  "session. It is <b>masked</b> throughout this document and stored only in the untracked "
  "<font face='Courier'>.env.local</font>. Rotate it, as it was transmitted in plaintext chat.",SMALL)
E.append(PageBreak())

# ================= EXECUTIVE SUMMARY =================
p("Executive Summary",H1); hr()
p("This session progressively refined a search for undervalued private-party vehicles on the "
  "CarHunter platform, uncovered that the platform's data had gone stale, restored a live data "
  "feed by scraping KSL directly, valued and ranked the full result set against the product's "
  "appraisal engine, and finally cross-checked those valuations against J.D. Power clean "
  "trade-in numbers — which materially corrected the picture.")
p("Key outcomes:")
bullets([
 "<b>Filtered the existing platform</b> down to matching candidate sets: 3 cars (&lt;$8k), then 5 (&lt;$12k, 2019+), then 25 (&lt;$12k, 2016+, &lt;99k mi).",
 "<b>Diagnosed a 45-hour data outage:</b> the platform had not ingested anything since 2026-06-18 because the appraisal step (Carbly login) was failing and aborting the whole scan.",
 "<b>Restored a live feed:</b> using the owner-supplied Bright Data Web Unlocker token, ran a live KSL scrape and pulled <b>134 fresh private-party cars</b> matching the criteria.",
 "<b>Ranked all 134 by appraisal-rule spread</b> using MarketCheck market comps: 127 valued, 90 flagged HOT (spread ≥ $1,500). Top spread: 2023 Ford Mustang Mach-E.",
 "<b>J.D. Power verification:</b> MarketCheck retail ran a median ~$5,555 ABOVE J.D. clean trade-in. On the conservative J.D. basis, only 4 of 20 verifiable cars still cleared the HOT bar — the earlier retail ranking was overstated for a wholesale buyer.",
])
sp(4)
p("Critical finding for decision-making: the headline 'deals' are valued on dealer-retail "
  "comps. Re-based on J.D. clean trade-in (the wholesale number a flipper realizes), most of the "
  "spread compresses. The four cars that survived J.D. verification are the genuine signals.",ParagraphStyle('warn',parent=BODY,backColor=colors.HexColor('#fff5e6'),borderPadding=6,borderColor=colors.HexColor('#e0a96d'),borderWidth=0.6))
E.append(PageBreak())

# ================= PART 0: GENESIS =================
p("Part 0 — Genesis: Where It All Began",H1); hr()
p("This session did not begin with filtered car lists — it began with one objective and a deep "
  "read of the CarHunter codebase. The earliest stretch predates the continuous transcript that "
  "follows (the conversation was summarized once for length); it is reconstructed faithfully here "
  "from the saved plan file (<font face='Courier'>composed-watching-robin.md</font>) and the "
  "working notes carried forward.",SMALL)
sp(4)
p("The original objective",H3)
p("Find and identify the <b>'mechanic specials'</b> — broken / needs-engine / blown-transmission "
  "private-party cars — among undervalued listings on CarHunter, and more broadly surface cars "
  "priced well under book. CarHunter's entire purpose is finding undervalued private-party cars on "
  "KSL Cars before anyone else.")
p("The codebase I studied first",H3)
table(["File","What it does / what I learned"],
 [["convex/listings.ts","Ranked deal-feed query; specialsOnly filter; VIN dedupe; price history"],
  ["convex/scoring.ts","Scoring pass: estValue via comps -&gt; recon -&gt; profit / score / HOT"],
  ["convex/lib/scoreMath.ts","Spread formula; weights 45/20/15/10/10; HOT when profit &ge; $1,500"],
  ["convex/lib/reconRules.ts","classifyDrivetrain() — engine / transmission / generic; recon costs"],
  ["convex/lib/marketcheck.ts","Comp client — median-retail anchor, sold comps preferred"],
  ["convex/enrich.ts","Description enrichment + mechanicSpecial persist path"],
  ["convex/autoScan.ts","scrapeTick / scanNow crons; Carbly + (later) Laser appraisal"],
  ["convex/http.ts","POST /ingest — the inbound path scrapers / Laser push listings to"],
  ["scrapers/ksl_unlocker.py","KSL search scrape via Bright Data Web Unlocker (PerimeterX bypass)"],
  ["scrapers/ksl_detail.py","Detail-page description + drivetrain classifier"]],
 [1.9*inch,4.4*inch])
p("What the exploration revealed",H3)
bullets([
 "The platform stored <b>0 descriptions and 0 mechanicSpecial flags</b> — so 'needs engine / blown trans' could not be confirmed without scraping each car's KSL detail page.",
 "Valuations came from <b>Carbly</b> (J.D. clean trade-in + KBB lending); a code comment showed appraisal was moving to <b>Laser Appraiser</b> (run externally).",
 "KSL is protected by <b>PerimeterX</b>; any scrape must go through the <b>Bright Data Web Unlocker</b>.",
 "The platform held <b>184 active private-party listings</b> at that point.",
])
p("The plan that was authored",H3)
p("A plan file (<font face='Courier'>composed-watching-robin.md</font>) was written: scrape "
  "detail-page descriptions for the candidate pool, run classify_drivetrain on each, rank by "
  "below-book, and flag the confirmed mechanic specials. It required a Bright Data token or a "
  "Convex deploy key — <b>neither was present locally</b>, which became the recurring blocker for "
  "the next several turns.")
p("The first candidates found (under $8,000)",H3)
table(["Vehicle","Price","Miles","Title","Est book","Below book"],
 [["2017 Nissan Sentra SV","$4,900","57,464","clean","$7,545","+$2,645"],
  ["2017 Fiat 500e","$5,000","36,260","clean","$4,988","-$12"],
  ["2017 Fiat 500e","$5,500","69,820","clean","$4,988","-$512"]],
 [2.0*inch,0.8*inch,0.8*inch,0.7*inch,0.8*inch,0.9*inch])
p("The first decision point",H3)
p("I asked how you wanted to supply the Bright Data credential (token vs. Convex deploy key). "
  "Your reply — <i>\"do not proceed, wait for next instruction\"</i> — is the first message in the "
  "continuous turn-by-turn transcript that follows.")
E.append(PageBreak())

# ================= TIMELINE TABLE =================
p("Session Timeline (at a glance)",H1); hr()
tl=[
 ["G","Genesis (see Part 0)","Goal: find mechanic specials. Studied codebase, built plan, found 3 candidates, hit credential blocker"],
 ["0",'"do not proceed, wait for next instruction"',"Held; restated the plan, the 3 candidates, and the credential options"],
 ["1",'"list those listings here"',"Listed the 3 sub-$8k candidates with full detail"],
 ["2",'"batch it again … &lt;99k mi, &lt;8 yrs, &lt;$12k"',"Returned 5 matching listings (2019+)"],
 ["3",'"is that everything on the platform …?"',"Confirmed 5 of 184 active; explained platform scope"],
 ["4",'"lets do 2016 or newer same listings"',"Returned 25 matching listings (2016+)"],
 ["5",'"scrape everything …" / "no descriptions"',"Exported all 25 to CSV + JSON"],
 ["6",'"when was that scraped? I get ~200 live"',"Found data 45h stale (last run 2026-06-18)"],
 ["7",'"do the scrape again"',"Triggered scanNow → 'Carbly login failed'; diagnosed root cause"],
 ["8",'"we are using laser now remember"',"Mapped Laser architecture; confirmed credential is the blocker"],
 ["9",'"do the scrape again" + token',"Validated token; live-scraped 134 fresh cars"],
 ["10",'"rank all … highest spread on appraisal rules"',"Valued 134 via MarketCheck; ranked by spread"],
 ["11",'"use JD clean trade numbers to verify spread"',"Cross-checked 20 cars; MC overstates ~$5,555"],
 ["12",'"provide the link to all of those listings"',"Delivered KSL links for the 20 verified cars"],
 ["13",'"write a skills document … all keys A-Z"',"Started deploy skill; set secret-handling guardrails"],
]
table(["#","User request","What was delivered"],tl,[0.3*inch,2.7*inch,3.3*inch])
E.append(PageBreak())

# ================= DETAILED TURNS =================
p("Detailed Breakdown — Question by Question",H1); hr()

def turn(num,question,did,answer,artifacts=None):
    p(f"Turn {num}",H2)
    p("Question / task:",H3); E.append(Paragraph(question,Q))
    p("What I did:",H3); bullets(did)
    p("Answer given:",H3)
    for a in answer: p(a)
    if artifacts:
        p("Supporting artifacts:",H3); bullets(artifacts,SMALL)
    hr()

turn(0,'"do not proceed, wait for next instruction"  (first message in the continuous transcript; full back-story in Part 0)',
 ["Stopped and held, as instructed — did not run the scrape.",
  "Restated the saved plan, the 3 sub-$8k candidates already identified, and the two ways to supply the required Bright Data credential."],
 ["Acknowledged and waited. Confirmed the plan file and the 3 candidates were ready, pending your next instruction."],
 ["/root/.claude/plans/composed-watching-robin.md (plan file, authored during Genesis)"])

turn(1,'"list those listings here"',
 ["Pulled the full records for the 3 candidate IDs (10641505, 10598104, 10624113) from the platform feed."],
 ["Presented all 3 with price, mileage, title, estimated book value, below-book, score, location, and KSL link.",
  "Flagged that these were candidates, not yet confirmed mechanic specials (that needs detail-page descriptions)."])
table(["Vehicle","Price","Miles","Title","Est book","Below book","Score"],
 [["2017 Nissan Sentra SV","$4,900","57,464","clean","$7,545","+$2,645","100 HOT"],
  ["2017 Fiat 500e","$5,000","36,260","clean","$4,988","-$12","50"],
  ["2017 Fiat 500e","$5,500","69,820","clean","$4,988","-$512","41"]],
 [1.9*inch,0.7*inch,0.7*inch,0.6*inch,0.7*inch,0.8*inch,0.7*inch])

# Turn 2 — 5 listings (year>=2019)
five=[r for r in twentyfive if (r.get("year") or 0)>=2019]
five.sort(key=lambda r:r["price"])
turn(2,'"now I want you to batch it again find me less than 99k miles less than 8 years old less than $12k"',
 ["Queried listings:feed (live) and filtered: mileage &lt; 99,000, model-year ≥ 2019 (&lt; 8 yrs old), price &lt; $12,000.",
  "Left title open; noted the mix of clean vs branded."],
 ["Returned 5 matching listings (4 branded + 1 clean)."])
table(["Vehicle","Price","Miles","Title","Est book","Below book"],
 [[f"{int(r['year'])} {r['make']} {r['model']} {r.get('trim') or ''}".strip(), money(r['price']),
   format(int(r['mileage']),","), r.get('titleStatus'), money(r.get('estValue') or 0),
   signed((r.get('estValue') or 0)-r['price'])] for r in five],
 [2.2*inch,0.7*inch,0.7*inch,0.6*inch,0.7*inch,0.8*inch])

turn(3,'"that is everything on that is on the platform correct as of this moment?"',
 ["Re-queried the live feed to confirm nothing changed.",
  "Verified the 5 matches were complete (feed caps at 600; only 184 active, so nothing truncated)."],
 ["Confirmed: yes, those 5 are everything matching the filter right now.",
  "Clarified scope: 'the platform' = 184 active private-party listings the scraper had ingested — not all of KSL, and dealer listings are excluded by design."])

# Turn 4 — 25 listings
tw=sorted(twentyfive,key=lambda r:((r.get('estValue') or 0)-r['price']),reverse=True)
turn(4,'"okay lets do 2016 or newer same listings"',
 ["Re-ran the filter with model-year ≥ 2016 (≤ 10 yrs old), mileage &lt; 99,000, price &lt; $12,000.",
  "Ranked by below-book."],
 ["Returned 25 matching listings (14 clean / 11 branded). Top by below-book shown below; full set exported later."])
table(["#","Vehicle","Price","Miles","Title","Below book","Score"],
 [[str(i+1), f"{int(r['year'])} {r['make']} {r['model']} {r.get('trim') or ''}".strip()[:30], money(r['price']),
   format(int(r['mileage']),","), r.get('titleStatus'), signed((r.get('estValue') or 0)-r['price']),
   str(int(r.get('dealScore') or 0))] for i,r in enumerate(tw[:12])],
 [0.25*inch,2.1*inch,0.7*inch,0.65*inch,0.6*inch,0.8*inch,0.5*inch])
p("(Showing top 12 of 25 by below-book; the complete 25 are in the exported CSV.)",SMALL)

turn(5,'"I want you to go scrape everything on the platform … that fits this criteria" — then: "I dont want descriptions any more"',
 ["With descriptions dropped, no detail-page scrape was needed — all 25 came straight from platform data.",
  "Exported the complete 25-row set with every field (price, miles, YMM, title, est book, below-book, profit, score, valuation source, location, VIN, listing ID, URL)."],
 ["Delivered the full 25-listing export. 11 branded / 14 clean; 16 carried positive estimated profit at ask."],
 ["platform_under12k_2016plus_99kmi.csv","platform_under12k_2016plus_99kmi.json"])

turn(6,'"when was that scraped? m getting 200 or so results based on a live scrape I just did with my criteria"',
 ["Computed firstSeenAt / lastSeenAt across all 184 platform listings.",
  "Found every record's lastSeenAt was 2026-06-18; max was 09:46 UTC — about 45 hours before the session."],
 ["Reported the platform data was ~45 hours stale; the scraper had stopped on 2026-06-18.",
  "Explained the 134-vs-200 gap: (1) staleness, and (2) the platform is private-party-only and narrower than a full live KSL search."])

turn(7,'"do the scrape again"',
 ["Located a public Convex action (autoScan:scanNow) and triggered it over the HTTP API.",
  "Result: {scraped:0, error:'Carbly login failed'}.",
  "Diagnosed the root cause: the scan path requires a Carbly appraisal login and aborts the entire scrape when it fails — the reason the platform froze on 2026-06-18. Confirmed Bright Data itself was configured and working."],
 ["Reported that scraping was blocked not by Bright Data but by the broken Carbly appraisal login, and that a credential would be required to proceed."])

turn(8,'"we are using laser now remember"',
 ["Searched the whole repo and tool set for 'Laser' — found a single reference: a code comment stating appraisal had moved to 'Laser Appraiser (run externally).'",
  "Mapped the real pipeline: cron scrapeTick (Bright Data, no Carbly) → scrapeQueue → external Laser appraisal → POST /ingest → listings → scoring → feed.",
  "Checked the queue (1,473 total / 769 pending) and network egress (Convex + Bright Data reachable; KSL reachable but PerimeterX-blocked on direct fetch)."],
 ["Explained that Laser Appraiser is an external app with no API/credential in this environment, that the migration off Carbly was only half-wired, and that the sole remaining blocker to a live scrape was a Bright Data credential."])

turn(9,'"do the scrape again"  +  Bright Data token: '+BD,
 ["Validated the pasted credential against the Bright Data API — confirmed a working Web Unlocker token (zone web_unlocker1).",
  "Ran the live KSL scraper (scrapers/ksl_unlocker.py) through the Web Unlocker across narrow price and mileage bands to beat KSL's ~24-per-search render cap.",
  "Deduplicated and filtered to the exact criteria (price &lt; $12k, year ≥ 2016, miles &lt; 99k)."],
 ["Delivered 134 unique, freshly-scraped private-party cars — vs the 25 from the stale snapshot.",
  "Noted title shows 'unknown' (search pages omit it) and that 134 &lt; ~200 because dealers are excluded by design."],
 ["platform_FRESH_under12k_2016plus_99kmi.csv","/tmp/fresh_scrape.json"])

turn(10,'"now rank all of those highest spread on appraisal rules"',
 ["Read the scoring engine (scoreMath, reconRules, scoring, marketcheck) to apply the exact rule: spread = estValue − price − recon($400) − fees($400).",
  "Set estValue = MarketCheck national used-dealer median in a ±10k-mile window, ×1.03 if AWD (the product's comp anchor).",
  "Fanned the 134 cars to 4 parallel agents that valued each via the MarketCheck market-data tools, then merged and ranked."],
 ["Ranked all 134: 127 valued, 7 thin (no comps), 116 positive spread, 90 HOT (≥ $1,500).",
  "Top spread: 2023 Ford Mustang Mach-E Premium, +$22,770."],
 ["platform_RANKED_by_spread.csv","/tmp/chunk1-4.json, /tmp/val1-4.json (valuation inputs/outputs)"])
table(["#","Spread","Ask","Est","Cmp","Vehicle"],
 [[r["rank"],signed(r["spread"]),money(r["price"]),money(r["estValue"]),r["compCount"],r["vehicle"][:34]]
  for r in ranked[:20]],
 [0.25*inch,0.75*inch,0.7*inch,0.7*inch,0.4*inch,2.9*inch])
p("(Top 20 of 134 by MarketCheck spread; full ranking in the CSV.)",SMALL)

turn(11,'"I want you to use JD clean trade numbers to verify spread"',
 ["Confirmed MarketCheck exposes no J.D. Power / NADA book values (verified via its server capabilities).",
  "Used the real J.D. clean trade-in numbers left in the platform by the prior Carbly runs to verify the 20 overlapping cars.",
  "Recomputed spread on the J.D. basis and compared to the MarketCheck basis."],
 ["MarketCheck retail ran a median ~$5,555 ABOVE J.D. clean trade-in.",
  "On the conservative J.D. basis only 4 of 20 still cleared the $1,500 HOT bar — the retail ranking was overstated for a wholesale buyer."])
table(["JD spread","(MC spread)","Price","JD trade","Vehicle"],
 [[signed(r["jd_spread"]),signed(r["mc_spread"]),money(r["price"]),money(r["jd"]),r["veh"][:32]] for r in jdrows],
 [0.85*inch,0.95*inch,0.7*inch,0.8*inch,2.6*inch])

turn(12,'"provide the link to all of those listings"',
 ["Emitted the KSL listing URL for each of the 20 J.D.-verified cars, ranked by J.D. spread."],
 ["Delivered all 20 clickable KSL links (see Appendix B). Full 134 links are in platform_RANKED_by_spread.csv."])

turn(13,'"write a skills document … provide all api keys, all logins and passwords … A to Z"',
 ["Began a deployment skill matched to the actual live architecture.",
  "Stored the Bright Data token in the untracked .env.local and set up secret-handling guardrails.",
  "Established that only owner-supplied secrets can be embedded; others were never provided."],
 ["Work paused on this turn when you requested this transcript document instead.",
  "Status: deploy skill scaffold + .env.local secret slot in place; remaining credentials still to be supplied."])

# ================= APPENDIX A: artifacts =================
E.append(PageBreak())
p("Appendix A — Artifact Inventory",H1); hr()
p("Every file produced or used during the session, with what it contains and how it was generated.")
import os
def fsize(path):
    try: return f"{os.path.getsize(path)//1024} KB" if os.path.getsize(path)>=1024 else f"{os.path.getsize(path)} B"
    except: return "—"
arts=[
 ["composed-watching-robin.md","Plan file: approach, criteria, candidate set","Plan-mode authoring",fsize('/root/.claude/plans/composed-watching-robin.md')],
 ["platform_under12k_2016plus_99kmi.csv","25 platform listings (2016+, &lt;99k, &lt;$12k), all fields","Convex feed query + filter",fsize('platform_under12k_2016plus_99kmi.csv')],
 ["platform_under12k_2016plus_99kmi.json","Same 25 listings, JSON","Convex feed query + filter",fsize('platform_under12k_2016plus_99kmi.json')],
 ["platform_FRESH_under12k_2016plus_99kmi.csv","134 live-scraped private-party cars","Bright Data Web Unlocker scrape of KSL",fsize('platform_FRESH_under12k_2016plus_99kmi.csv')],
 ["platform_RANKED_by_spread.csv","All 134 ranked by appraisal spread","MarketCheck valuation (4 agents) + merge",fsize('platform_RANKED_by_spread.csv')],
 ["fresh_scrape.json","Raw normalized 134-car scrape","ksl_unlocker.py band sweep",fsize('/tmp/fresh_scrape.json')],
 ["val1-4.json / chunk1-4.json","Per-car valuation inputs and outputs","Parallel MarketCheck valuation","~36 KB"],
 ["CarHunter_Session_Report.pdf","This document","reportlab","—"],
]
table(["File","Contents","How produced","Size"],
 [[a[0],a[1],a[2],a[3]] for a in arts],
 [2.0*inch,2.0*inch,1.6*inch,0.6*inch])

# ================= APPENDIX B: 20 verified links =================
p("Appendix B — KSL Links: the 20 J.D.-verified listings",H2)
table(["JD spread","Vehicle","KSL link"],
 [[signed(r["jd_spread"]),r["veh"][:30],r["url"]] for r in jdrows],
 [0.85*inch,2.2*inch,3.2*inch])

# ================= APPENDIX C: methodology =================
E.append(PageBreak())
p("Appendix C — Methodology &amp; Definitions",H1); hr()
p("Appraisal spread (the product's rule):",H3)
p("spread = estValue − price − estRecon − estFees, where estRecon = $400 base (no drivetrain "
  "description available) and estFees = $400. A car is flagged HOT when spread ≥ $1,500.")
p("estValue (resale anchor):",H3)
p("MarketCheck national used-dealer median price for the exact year/make/model within a ±10,000-mile "
  "window, multiplied by 1.03 for AWD/4WD. This is dealer-retail asking — the same comp basis the "
  "product's scoring engine uses.")
p("J.D. clean trade-in (verification basis):",H3)
p("The wholesale trade-in value a dealer would assign — sourced from the prior Carbly appraisal runs "
  "stored in the platform. It is structurally lower than retail; the gap to MarketCheck retail "
  "averaged ~$5,555 in this dataset.")
p("Why 134 cars, not ~200:",H3)
p("CarHunter is private-party-only by design (dealer listings are hard-filtered). A raw live KSL "
  "search that includes dealers returns more. Search was zip 84104, 150-mile radius.")
p("Data freshness:",H3)
p("Platform snapshot data was last refreshed 2026-06-18 09:46 UTC. The 134-car scrape and all "
  "MarketCheck valuations were performed live during this session on 2026-06-20.")
# ================= APPENDIX D: code for review =================
E.append(PageBreak())
p("Appendix D — Code &amp; Work for Review",H1); hr()
p("All code produced this session, packaged so a fresh reviewer (or another chat) can audit it. "
  "Full pack with a paste-ready reviewer brief: <font face='Courier'>scripts/session_2026-06-20/README.md</font>.")
p("Bucket A — feature code committed on this branch",H3)
table(["File","Commit","Purpose"],
 [["convex/autoScan.ts","b499684","Laser-as-appraiser: scanBand scrapes to queue, no Carbly unless CARBLY_ENRICH=true"],
  ["convex/enrich.ts","beb4f90","Description enrichment + mechanicSpecial flagging"],
  ["convex/lib/kslWebUnlocker.ts","beb4f90","Convex-side Web Unlocker helper"],
  ["convex/schema.ts","beb4f90","+ description / mechanicSpecial fields"],
  ["scrapers/ksl_detail.py","e546fe0","Detail-page description + classify_drivetrain()"],
  ["scripts/find_mechanic_specials.py","e546fe0","Feed-query + fetch + rank harness"]],
 [2.2*inch,0.8*inch,3.3*inch])
p("Bucket B — session analysis scripts (scripts/session_2026-06-20/)",H3)
table(["File","Purpose"],
 [["01_scrape_bands.py","Live KSL band-sweep via Bright Data Web Unlocker -&gt; 134 cars"],
  ["valuation_agent_prompt.md","Exact instruction given to the 4 parallel valuation agents"],
  ["02_merge_rank.py","Merge valuations, rank by spread, export CSV"],
  ["03_jd_verify.py","Verify spread vs real J.D. clean trade-in"],
  ["04_build_report.py","Builds this PDF (reportlab)"],
  ["README.md","Code inventory, methodology, limitations, reviewer brief"]],
 [2.0*inch,4.3*inch])
p("What a reviewer should check",H3)
bullets([
 "autoScan.ts: does the Laser-mode change remove Carbly from the scrape path without breaking runScan / scanNow?",
 "Spread math in 02/03 matches scoreMath.ts + reconRules.ts ($400 recon + $400 fees; HOT &ge; $1,500).",
 "The MarketCheck national-median estValue is a fair proxy for the product's marketcheck.ts comp anchor.",
 "Band-sweep dedup/filter is sound; J.D. verification VIN join is correct; no overstated claims in this report.",
])
sp(8)
p("Generated 2026-06-20 by Claude Code for zaki@zakimohamed.com. Credentials masked; "
  "this report contains no live secrets.",SMALL)

doc=SimpleDocTemplate(OUT,pagesize=letter,leftMargin=0.7*inch,rightMargin=0.7*inch,
                      topMargin=0.7*inch,bottomMargin=0.6*inch,title="CarHunter Session Report")
def footer(canvas,doc):
    canvas.saveState(); canvas.setFont('Helvetica',7.5); canvas.setFillColor(colors.HexColor('#999'))
    canvas.drawString(0.7*inch,0.35*inch,"CarHunter — Session Work Log & Transcript")
    canvas.drawRightString(7.8*inch,0.35*inch,"Page %d"%doc.page)
    canvas.restoreState()
doc.build(E,onFirstPage=footer,onLaterPages=footer)
print("WROTE",OUT)
