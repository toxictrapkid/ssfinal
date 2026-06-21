#!/usr/bin/env python3
"""Build the CarHunter Employee SOP Binder PDF (reportlab)."""
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, ListFlowable, ListItem, HRFlowable, KeepTogether)
import re

OUT = "/home/user/ssfinal/docs/CarHunter_Employee_SOP_Binder.pdf"
NAVY = colors.HexColor("#0b3d62"); BLUE = colors.HexColor("#12598c"); GREY = colors.HexColor("#555")
LIGHT = colors.HexColor("#eef3f8"); LINE = colors.HexColor("#c8d2dc"); AMBER = colors.HexColor("#fff5e6")
ss = getSampleStyleSheet()
def mk(n,parent=None,**k): return ParagraphStyle(n, parent=parent or ss["BodyText"], **k)
TITLE = mk("TITLE", fontSize=28, textColor=NAVY, leading=32, spaceAfter=4, fontName="Helvetica-Bold")
SUB   = mk("SUB", fontSize=13, textColor=GREY, leading=16, alignment=TA_CENTER)
H1 = mk("H1", fontSize=17, textColor=NAVY, leading=20, spaceBefore=10, spaceAfter=6, fontName="Helvetica-Bold")
H2 = mk("H2", fontSize=12.5, textColor=BLUE, leading=15, spaceBefore=9, spaceAfter=3, fontName="Helvetica-Bold")
H3 = mk("H3", fontSize=10, textColor=colors.HexColor("#333"), leading=12, spaceBefore=6, spaceAfter=1, fontName="Helvetica-Bold")
BODY = mk("BODY", fontSize=9.3, leading=12.6, spaceAfter=4)
SMALL = mk("SMALL", fontSize=8, leading=10, textColor=GREY)
CELL = mk("CELL", fontSize=8, leading=10)
CELLB = mk("CELLB", fontSize=8, leading=10, fontName="Helvetica-Bold")
SCRIPT = mk("SCRIPT", fontSize=9.2, leading=12.5, textColor=colors.HexColor("#103a1a"),
            backColor=colors.HexColor("#f0f7f1"), borderColor=colors.HexColor("#a9ccb2"),
            borderWidth=0.6, borderPadding=6, spaceAfter=5, leftIndent=2)
WARN = mk("WARN", parent=BODY, backColor=AMBER, borderColor=colors.HexColor("#e0a96d"), borderWidth=0.6, borderPadding=6)

E = []
def esc(t): return t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def P(t, s=BODY): E.append(Paragraph(t if "<" in t and "&lt;" not in t else esc(t), s)) if False else E.append(Paragraph(esc(t), s))
def raw(t, s=BODY): E.append(Paragraph(t, s))  # allows inline tags already escaped
def sp(h=6): E.append(Spacer(1, h))
def hr(): E.append(HRFlowable(width="100%", thickness=0.6, color=LINE, spaceBefore=3, spaceAfter=5))
def pb(): E.append(PageBreak())
def bullets(items, s=BODY):
    E.append(ListFlowable([ListItem(Paragraph(esc(i), s), leftIndent=10) for i in items],
                          bulletType="bullet", start="•", leftIndent=14, spaceAfter=4))
def checks(items):
    E.append(ListFlowable([ListItem(Paragraph(esc(i), BODY), leftIndent=10) for i in items],
                          bulletType="bullet", start="☐", leftIndent=14, spaceAfter=3))
def script(label, text):
    E.append(Paragraph("<b>"+esc(label)+"</b>", H3))
    E.append(Paragraph(esc(text), SCRIPT))
def table(header, rows, widths, fs=8):
    data=[[Paragraph(esc(h),CELLB) for h in header]]+[[Paragraph(esc(str(c)),CELL) for c in r] for r in rows]
    t=Table(data,colWidths=widths,repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),NAVY),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),fs),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,LIGHT]),
        ("GRID",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),
        ("TOPPADDING",(0,0),(-1,-1),2.5),("BOTTOMPADDING",(0,0),(-1,-1),2.5),
        ("LEFTPADDING",(0,0),(-1,-1),3.5),("RIGHTPADDING",(0,0),(-1,-1),3.5)]))
    E.append(t); sp(6)

# Standard SOP renderer: fields is list of (label, kind, content)
def sop(num, title, fields):
    E.append(Paragraph(f"SOP {num}: {esc(title)}", H1)); hr()
    for label, kind, content in fields:
        E.append(Paragraph(esc(label), H2))
        if kind=="t": P(content)
        elif kind=="b": bullets(content)
        elif kind=="c": checks(content)
        elif kind=="raw": raw(content)
    pb()

# ============================== COVER ==============================
sp(70)
raw("CarHunter", TITLE)
raw("Employee Operating &amp; Training Binder", mk("c2",parent=SUB,fontSize=16,textColor=NAVY))
sp(8)
P("The complete desk manual for a high-volume vehicle-acquisition operation. "
  "Find, value, prioritize, contact, and prepare deals — every day — with CarHunter as the command center.", SUB)
sp(40)
table(["Field","Value"], [
 ["Operation","Private-party + auction vehicle arbitrage (Utah)"],
 ["System","CarHunter — Convex backend (deployment: silent-leopard-39) + React web app"],
 ["Live data sources","KSL Cars (scraped) -> Laser Appraiser (book values) -> CarHunter feed"],
 ["Your role","Execute the daily desk. Prepare deals. Contact sellers. Log everything."],
 ["Owner's role","Final purchase, bid, and risk decisions."],
 ["Golden rule","CarHunter is the source of truth. AI prepares the work. Humans decide."],
 ["Version / date","v1.0 — June 2026 (verify Capability Map before first shift)"],
], [1.5*inch, 4.8*inch])
sp(10)
raw("<b>Owner instruction to the employee:</b> \"Run the desk from this.\"", WARN)
pb()

# ============================== HOW TO USE / PRINCIPLES ==============================
raw("How to Use This Binder", H1); hr()
P("Read SOP 1 (Operating Manual) and the Capability Map first. Then keep this binder open while you work — "
  "each SOP is a step-by-step you follow in order. Tables, scripts, checklists, and worksheets are ready to use. "
  "When something breaks, go to SOP 13 (Troubleshooting). When a deal is big, risky, or unclear, go to SOP 10 (Escalation).")
raw("The 11 Operating Principles (never break these)", H2)
bullets([
 "CarHunter is the source of truth. No side spreadsheets unless the owner approves one as a temporary backup.",
 "AI prepares the work; humans make the final call.",
 "You do NOT approve purchases or auction bids unless the owner has given you written authority.",
 "Every lead must have a next action. Nothing sits with no plan.",
 "Every seller conversation must be logged in CarHunter.",
 "Every valuation must show where it came from (source + date).",
 "Missing information is marked MISSING — never guessed.",
 "Fast response matters, but accuracy matters more.",
 "Mechanic-special deals only work when repair, labor, fees, and risk reserves are priced conservatively.",
 "Escalate high-value, high-risk, unclear, or time-sensitive decisions to the owner.",
 "If you make a mistake, log it and tell your manager immediately — do not hide it.",
])
pb()

# ============================== CAPABILITY MAP (accuracy) ==============================
raw("CarHunter Capability Map — What the System Does Today", H1); hr()
raw("This is the single most important page for accuracy. It tells you exactly what CarHunter does "
    "<b>automatically</b> versus what <b>you do by hand</b> today. Do not assume a feature exists if it is "
    "not listed as AUTO.", WARN)
sp(4)
table(["Capability","Status today","How it works / what you do"], [
 ["KSL private-party scrape","AUTO","Bright Data Web Unlocker pulls new KSL listings every 2 minutes into the feed."],
 ["Dedupe (one row per car)","AUTO","By VIN, else a year/make/model/mileage/zip key."],
 ["Deal score, HOT flag, est profit","AUTO","Scoring engine runs on every valued listing. HOT = est profit >= $1,500."],
 ["Recon & fees estimate","AUTO","Base recon $400 + drivetrain parts/labor rules; fees $400 flat."],
 ["JD Clean Trade-in","AUTO (Laser bridge)","Captured per VIN from Laser (NADA Comm.Trade) while a Laser tab is open."],
 ["KBB value","AUTO (Laser bridge)","Captured per VIN from Laser (KBB wholesale)."],
 ["JD Full Retail","MANUAL today","Read it in Laser (NADA 'Retail') and type it into the listing notes. Auto-capture is on the roadmap."],
 ["Base MMR (Manheim)","MANUAL today","Read it in Laser's MMR tab and type it into the listing notes. Auto-capture is on the roadmap."],
 ["MarketCheck live comps","OFF","No MARKETCHECK_KEY set; the system uses a depreciation-curve fallback (flagged 'curve', never HOT)."],
 ["HOT deal SMS alert","AUTO","Sent via Mobile Text Alerts to the numbers in MTA_NUMBERS."],
 ["Pipeline board (Lead->Flipped)","AUTO","Move a lead through stages in CarHunter."],
 ["Auction run-list upload (in app)","MANUAL today","No upload screen yet. Use the Repair-Margin Worksheet (SOP 6 / Appendix) until it ships."],
 ["Employee task list / outreach kit screens","MANUAL today","Work leads from the feed + pipeline; use the Script Book (SOP 4) for outreach."],
 ["Owner decision packet","MANUAL today","Build it from the listing using the template in SOP 10."],
], [1.7*inch, 1.25*inch, 3.35*inch])
P("Note on labels: Laser-sourced values may display in the app with the legacy tag 'carbly' as the valuation "
  "source. That is a naming leftover — the numbers come from Laser Appraiser. Always confirm the value and date.")
pb()

# ============================== PLATFORM & API KEY SETUP ==============================
raw("Platform &amp; API-Key Setup Guide (Beginning to End)", H1); hr()
P("CarHunter runs on a handful of outside platforms. Most keys are already installed by the owner; you generally "
  "do NOT need to touch them. This guide exists so that if a key expires or the owner asks you to set one up, you "
  "know exactly where it goes and what can go wrong. Keys live in the Convex deployment's environment variables "
  "(Convex Dashboard -> your project -> Settings -> Environment Variables) or in an untracked .env.local file — "
  "NEVER in the code, chat, screenshots, or a spreadsheet.")
raw("Platforms used", H2)
table(["Platform","What it does","Key / login needed","Already set?"], [
 ["Convex","Backend database + automation that runs CarHunter","CONVEX_DEPLOY_KEY (to deploy)","Yes"],
 ["Bright Data","Web Unlocker proxy that lets us scrape KSL past bot protection","BRIGHTDATA_API_TOKEN + BRIGHTDATA_ZONE","Yes"],
 ["Laser Appraiser","Book values (JD Clean, JD Retail, KBB, MMR) per VIN","Account login (no public API) + INGEST_SECRET","Yes"],
 ["Mobile Text Alerts","Sends HOT-deal SMS","MTA_API_KEY + MTA_NUMBERS","Yes"],
 ["MarketCheck","Optional live market comps (upgrades valuations)","MARKETCHECK_KEY","No (optional)"],
 ["Vercel","Hosts the CarHunter web app","Vercel login + VITE_CONVEX_URL","Owner"],
 ["GitHub","Stores the code","GitHub login","Owner"],
], [1.15*inch, 2.5*inch, 2.0*inch, 0.65*inch])

raw("How to get each key (only if the owner asks)", H2)
raw("1) Convex deploy key", H3)
bullets([
 "Go to dashboard.convex.dev -> sign in -> open the project (team zaki-5ed1c / project dddf).",
 "Settings -> Deploy Keys -> Generate a Development deploy key. Copy it once (you cannot see it again).",
 "It is used only to deploy code (npx convex deploy). Day-to-day desk work does NOT need it.",
 "Hiccup: 'MissingAccessToken / 401 Unauthorized' when deploying = the key is missing or wrong. Re-generate.",
])
raw("2) Bright Data (Web Unlocker)", H3)
bullets([
 "brightdata.com -> sign in -> Proxies & Scraping -> the 'web_unlocker1' zone.",
 "API token: Account Settings -> API tokens. Zone name goes in BRIGHTDATA_ZONE (default web_unlocker1).",
 "Hiccup: KSL returns 403 / 'access denied' = token invalid, out of balance, or zone paused. Check the Bright Data balance and that the zone is active.",
 "Hiccup: scrape suddenly returns 0 cars = usually the token, not the code. Verify the token works (Bright Data has a test box in the zone page).",
])
raw("3) Laser Appraiser", H3)
bullets([
 "Laser Appraiser is a paid dealer subscription (laserappraiser.com). It has NO public API.",
 "We read values by running a small helper script inside YOUR logged-in Laser browser tab (the 'Laser bridge' — see SOP 8).",
 "You need: the Laser username + password (owner provides) and the CarHunter INGEST_SECRET (owner provides) pasted into the bridge script once.",
 "Hiccup: 'security session expired' = your Laser login timed out. Refresh the Laser page and the bridge resumes.",
 "Hiccup: values stop flowing = the Laser tab was closed. Keep one logged-in Laser tab open on an always-on computer.",
])
raw("4) Mobile Text Alerts (SMS)", H3)
bullets([
 "mobile-text-alerts.com -> sign in -> Account / API -> copy the API key into MTA_API_KEY.",
 "Put the phone numbers that should receive HOT alerts (comma-separated) into MTA_NUMBERS.",
 "Hiccup: no texts arriving = key missing, out of message credits, or numbers not opted in. Check the MTA dashboard balance + that numbers are subscribed.",
])
raw("5) MarketCheck (optional upgrade)", H3)
bullets([
 "marketcheck.com -> Developer / API -> request an API key -> put it in MARKETCHECK_KEY.",
 "When set, the system uses live market comps instead of the depreciation curve, and curve-only deals can become HOT.",
 "Hiccup: 401 from MarketCheck = bad key; 'subscribed package radius limit' = your plan caps the search radius (keep radius <= 100 miles).",
])
raw("6) Vercel + GitHub (owner-level, rare)", H3)
bullets([
 "Vercel hosts the web app. The only setting you might confirm is VITE_CONVEX_URL = https://silent-leopard-39.convex.cloud.",
 "GitHub stores the code on branch claude/magical-meitner-2i71q8. You normally never touch these.",
])
raw("Security rules for keys (do not break)", H2)
bullets([
 "Never paste a key into chat, email, a screenshot, or a spreadsheet.",
 "Keys live only in Convex env vars or an untracked .env.local on an approved machine.",
 "If a key is ever exposed, tell the owner immediately so it can be rotated.",
 "You do not need most keys to run the desk — only the Laser login + INGEST_SECRET for the bridge.",
])
pb()
print("front matter done")

# ============================== SOP 1 ==============================
sop("1","CarHunter Employee Operating Manual",[
 ("Purpose","t","Give you the big picture of how CarHunter works and how your day fits into it so you can run the buying desk confidently from day one."),
 ("Who owns the process","t","You (the buying-desk employee) run it daily. Your manager supervises. The owner sets the rules and makes final buy/bid decisions."),
 ("When to use it","t","Read first, then keep as your reference for how the whole system fits together."),
 ("Required tools","b",["A computer with Chrome","CarHunter web app login","A logged-in Laser Appraiser tab (for book values)","Phone/messaging for seller outreach","This binder"]),
 ("Required inputs","t","None to read. To operate: the live CarHunter feed (it fills itself automatically)."),
 ("Step-by-step process","b",[
   "CarHunter scrapes KSL every 2 minutes and drops new cars into the feed automatically.",
   "Each car is valued (JD Clean Trade + KBB via the Laser bridge), scored, and flagged HOT if est profit >= $1,500.",
   "You work the feed top-down: review, decide (contact / request VIN / watch / pass / escalate), contact sellers, log replies, schedule inspections.",
   "Strong or risky deals get packaged for the owner to approve.",
   "Approved deals move down the pipeline: Lead -> Contacted -> Negotiating -> Inspected -> Bought -> Flipped.",
 ]),
 ("Decision rules","b",[
   "Work HOT and mechanic-special cars first.",
   "Never guess a value or a fact — mark it MISSING and find it or escalate.",
   "Every lead leaves your hands with a next action set.",
 ]),
 ("What to enter into CarHunter","t","Your decision on each lead, every seller message and reply, appointment times, and status changes. CarHunter is the record — nothing important lives only in your head or a notepad."),
 ("What not to do","b",["Do not approve a purchase or bid.","Do not run side spreadsheets unless the owner approved one.","Do not delete or overwrite another person's notes."]),
 ("Escalation triggers","t","See SOP 10. In short: big profit, big spend, salvage/branded, major mechanical, missing VIN on a valuable car, conflicting values, seller pushing, auction time approaching, or you are unsure."),
 ("Common mistakes","b",["Chasing low-score cars while HOT ones expire","Forgetting to log a call","Trusting a value without checking its source/date"]),
 ("Troubleshooting","t","If anything in CarHunter, Laser, or outreach stops working, go to SOP 13 and follow the fallback steps."),
 ("Completion checklist","c",["I can explain the daily flow","I know what is AUTO vs MANUAL (Capability Map)","I know what I can decide vs must escalate"]),
 ("Example","t","New 2017 Honda Accord, $6,500, JD Clean $9,800, score 88, HOT. You confirm the value source/date, message the seller, ask condition + title + VIN, log the reply, and set a next action — all inside CarHunter."),
])

# ============================== SOP 2 ==============================
sop("2","Daily Buying Desk SOP",[
 ("Purpose","t","A repeatable open-to-close routine so no opportunity is missed and every lead is moved forward each day."),
 ("Who owns the process","t","You run it. Manager spot-checks. "),
 ("When to use it","t","Every shift, start to finish."),
 ("Required tools","b",["CarHunter feed","Laser tab open (bridge running)","Phone/messaging","This binder"]),
 ("Required inputs","t","The live feed, your open leads, and any owner replies from yesterday."),
 ("Step-by-step process","b",[
   "OPEN (first 15 min): confirm the Laser tab is open and the bridge shows recent 'posted' activity (SOP 8). Confirm the feed is updating (new cars with today's date). If not -> SOP 13.",
   "TRIAGE: sort the feed by deal score / HOT. Scan the Contact-Now (HOT) cars and any mechanic specials first.",
   "WORK EACH LEAD (SOP 3): review, decide, contact, log.",
   "FOLLOW-UPS (SOP 12): work yesterday's no-replies and scheduled callbacks.",
   "OWNER ITEMS: send any decision packets (SOP 10); action anything the owner approved.",
   "AUCTION (if a run-list came in): SOP 5 / SOP 6.",
   "CLOSE: every lead has a next action; every conversation is logged; flag anything still MISSING.",
 ]),
 ("Decision rules","b",["HOT + fresh (listed today) = contact within the hour.","Mechanic specials always get worked, even if score is moderate.","If you run out of time, prioritize freshest HOT first."]),
 ("What to enter into CarHunter","t","Status on every lead touched, all messages/replies, appointments, and a next action for each open lead."),
 ("What not to do","b",["Do not leave HOT cars sitting overnight without contact.","Do not close the day with un-logged conversations."]),
 ("Escalation triggers","t","Anything matching SOP 10 during triage goes to the owner immediately, not at end of day."),
 ("Common mistakes","b",["Starting with email/low-value cars instead of HOT","Forgetting to verify the bridge is running at open"]),
 ("Troubleshooting","t","Feed not updating or no Laser values -> SOP 13."),
 ("Completion checklist","c",["Bridge confirmed running at open","All HOT contacted or queued","All conversations logged","Every open lead has a next action","Owner items sent"]),
 ("Example","t","8:30 open: bridge posted 2 min ago, feed shows 6 new cars overnight, 2 HOT. You contact both HOT sellers by 9:00, log replies by 9:30, then work the rest."),
])

# ============================== SOP 3 ==============================
sop("3","Private-Party Lead SOP",[
 ("Purpose","t","The exact way to work a single private-party lead from open to owner-ready."),
 ("Who owns the process","t","You."),
 ("When to use it","t","Every private-party car you touch in the feed."),
 ("Required tools","b",["CarHunter listing detail","Laser (book values)","Script Book (SOP 4)"]),
 ("Required inputs","b",["Year, make, model, trim, VIN, mileage, location, asking price, title status, seller notes","JD Clean Trade, JD Full Retail, KBB Lending, Base MMR","Est recon, est fees, est profit, deal score, risk flags"]),
 ("Step-by-step process","b",[
   "1. OPEN the lead in CarHunter.",
   "2. REVIEW the car: year/make/model/trim, VIN, mileage, location, asking price, title status, seller notes.",
   "3. REVIEW the numbers: JD Clean Trade, JD Full Retail, KBB Lending, Base MMR, asking price, est recon, est fees, est profit, deal score, risk flags. Confirm each value shows a source + date. If JD Full Retail or MMR is blank, read it in Laser and enter it (MANUAL today).",
   "4. SCAN for mechanic-special wording (see Decision rules).",
   "5. DECIDE: Contact now / Request VIN / Watch / Pass / Escalate.",
   "6. CONTACT the seller using the right script (SOP 4).",
   "7. LOG the reply verbatim-ish in the lead (SOP 4 logging rules).",
   "8. SCHEDULE inspection if it qualifies (SOP 11).",
   "9. PREPARE owner review if it hits an escalation trigger (SOP 10).",
 ]),
 ("Decision rules","b",[
   "Mechanic-special wording to catch: needs engine, bad engine, blown motor, head gasket, needs transmission, no reverse, won't start, doesn't run, salvage, rebuilt, branded title, flood, frame damage.",
   "Contact now: HOT or strong score + plausible price + no disqualifying risk.",
   "Request VIN: value looks strong but VIN missing on a valuable car.",
   "Watch: marginal profit, or priced slightly high but could drop.",
   "Pass: price above book with no upside and no mechanic-special angle.",
   "Escalate: any SOP 10 trigger.",
   "Price-too-good (price < ~35% of book): treat as a red flag (error/scam/major damage) -> ask hard condition/title questions before getting excited.",
 ]),
 ("What to enter into CarHunter","b",["Your decision (contact/request VIN/watch/pass/escalate)","Any value you entered manually + its source (e.g., 'JD Retail $13,300 — Laser, 6/21')","Every message and reply","Appointment time","Next action"]),
 ("What not to do","b",["Do not contact before reviewing the numbers.","Do not enter a value without its source.","Do not mark a car Pass on a mechanic special without checking the repair-margin math (SOP 6)."]),
 ("Escalation triggers","t","Deal score 90+, profit over owner threshold, salvage/branded/flood/frame, major mechanical, missing VIN on a high-value car, conflicting values, seller pushing now, or you are unsure (SOP 10)."),
 ("Common mistakes","b",["Skipping the mechanic-special scan","Entering JD Retail/MMR without noting it came from Laser","Passing a mechanic special without the worksheet"]),
 ("Troubleshooting","t","Values missing or look wrong -> SOP 9 (verify) and SOP 13 (system)."),
 ("Completion checklist","c",["Car + numbers reviewed","Mechanic-special scan done","Decision recorded","Seller contacted (or reason not)","Reply logged","Next action set"]),
 ("Example","t","2015 Subaru Outback, $7,900, JD Clean $11,200, KBB $11,500, score 84, clean title. You enter JD Retail $14,100 from Laser, message the seller, ask condition/title/VIN, log 'owned 3 yrs, clean title in hand, minor bumper scuff', set inspection for tomorrow 5pm."),
])
print("sops 1-3 done")

# ============================== SOP 4 — SCRIPT BOOK ==============================
raw("SOP 4: Seller Outreach &amp; Appointment-Setting Script Book", H1); hr()
raw("Purpose", H2); P("Ready-to-send messages so outreach is fast, consistent, polite, and persistent — without pressure or false claims.")
raw("Who owns it / When", H2); P("You. Use the moment a lead qualifies for contact (SOP 3). Personalize {year}/{make}/{model}; never send a blank template.")
raw("Required tools", H2); P("CarHunter (to log every send + reply), phone/messaging app.")
raw("Style rules", H2); bullets([
 "Short, natural, local-buyer tone. Polite but persistent.","Ask for the appointment quickly.","Ask condition + title clearly.",
 "Easy-close / cash-ready positioning.","No pressure tactics, no false claims, no fake urgency.","One-to-one only — never mass-blast.",
])
raw("The Scripts", H2)
script("1. Initial availability","Hi, is your {year} {make} {model} still available?")
script("2. Availability + appointment request","Hi, is your {year} {make} {model} still available? I'm local and could come take a look today or tomorrow if that works.")
script("3. Ownership + condition questions","How long have you owned it? And is there anything wrong with it that's not in the listing — mechanical, accidents, warning lights?")
script("4. VIN request","Could you share the VIN? Just want to check the history and details before I come out so I don't waste your time.")
script("5. Easy-close / cash-ready","If everything checks out, I can make it simple and be ready to move quickly. I do my own paperwork and don't mess around.")
script("6. Seller has another buyer","Totally understand. If the other buyer doesn't end up taking it, I can be available quickly — feel free to reach back out anytime.")
script("7. Polite follow-up","Hey, just following up on the {make} {model} — still available? Happy to come take a look whenever works for you.")
script("8. Mechanic-special lead (general)","Hi, is the {year} {make} {model} still available? I buy cars that need work too, so the issues aren't a dealbreaker. Can you tell me what it's doing and whether you have the title?")
script("9. Bad-engine lead","Hi, still have the {year} {make} {model}? I understand it's got engine trouble — that's okay, I work on these. Does it start at all, any knocking or overheating, and do you have a clean title in hand?")
script("10. Bad-transmission lead","Hi, is the {year} {make} {model} still around? I know the transmission's acting up — no problem on my end. Does it move/shift at all, does reverse work, and is the title clean and in hand?")
script("11. Appointment confirmation","Great — confirming for {day} at {time} at {location}. I'll text when I'm on my way. Thanks!")
script("12. Running late","Hey, running about {minutes} minutes behind — still definitely coming. Appreciate your patience.")
script("13. Voicemail","Hi, this is {name} about the {year} {make} {model} you have listed. I'm a local buyer and interested — please call or text me back at {phone}. Thanks!")
script("14. Phone-call opening","Hi, calling about the {make} {model} you have for sale — is it still available? Great. Mind if I ask a couple quick questions before I come look?")
script("15. Price conversation","I appreciate the listing price. Based on condition and what comparable ones are going for, I was thinking around {offer}. I can keep it simple and quick — does that work, or is there a number that does?")
script("16. Owner handoff","Thanks — this looks like a strong one. Let me confirm a couple details on my end and I'll get right back to you today.  [Internally: escalate to owner per SOP 10 before committing.]")
script("17. Polite pass","Thanks for the details and your time — it's not the right fit for me right now, but I appreciate it. Good luck with the sale!")
raw("Logging rules (do every time)", H2); bullets([
 "Log every outbound message and every reply in the lead, with date/time.",
 "Capture facts the seller gives: ownership length, known issues, title status/in-hand, VIN, accident/flood, why selling.",
 "If they give a price, log it. If they go silent, set a follow-up (SOP 12).",
])
raw("What not to do", H2); bullets(["No pressure tactics or fake deadlines.","No claims you can't back up.","No committing to a price/purchase — that's owner-approved (SOP 10)."])
raw("Escalation triggers", H2); P("Seller pushing for an immediate decision, a strong/HOT car, or any SOP 10 trigger -> escalate before agreeing to buy.")
raw("Common mistakes / Troubleshooting", H2); bullets(["Sending a template with {brackets} still in it.","Not asking about the title.","Not logging the reply.","No reply? Use script 7 once, then follow SOP 12 cadence."])
raw("Completion checklist", H2); checks(["Right script chosen","Personalized","Sent + logged","Condition + title asked","Next action/follow-up set"])
raw("Example", H2); P("HOT 2016 Tacoma. You send Script 2, seller replies 'yes, owned 4 yrs, clean title, no issues.' You log it, send Script 11 to set 5pm today, and set inspection (SOP 11).")
pb()

# ============================== SOP 5 — AUCTION RUN-LIST ==============================
raw("SOP 5: Auction Run-List SOP", H1); hr()
raw("Reality check", H2); raw("There is no in-app run-list upload screen yet (see Capability Map). Until it ships, you work "
  "run-lists with the <b>Repair-Margin Worksheet</b> (SOP 6 / Appendix) and Laser values. This SOP describes the full "
  "intended flow AND the manual method to use today.", WARN)
raw("Purpose", H2); P("Turn an auction run-list into a ranked, owner-ready bid sheet — every vehicle valued, scored, and risk-flagged.")
raw("Who owns it / When", H2); P("You prepare it; the owner approves max bids. Use whenever a CSV/XLSX/PDF run-list arrives before a sale.")
raw("Required tools", H2); bullets(["The run-list file (CSV/XLSX/PDF)","Laser Appraiser (JD Clean, JD Retail, KBB, MMR by VIN)","Repair-Margin Worksheet (Appendix)","CarHunter (to log decisions/notes)"])
raw("Step-by-step process", H2); bullets([
 "1. UPLOAD/INTAKE: when the in-app uploader exists, drag in CSV/XLSX/PDF and map columns. Today: open the file and work it row by row into the worksheet.",
 "2. MAP COLUMNS: identify VIN, year/make/model, mileage, lane, run number, announcements, title status, seller, condition. Save the mapping per auction house for reuse.",
 "3. REVIEW LOW-CONFIDENCE ROWS: any row with a bad/short VIN, blank mileage, or garbled make/model — fix or mark MISSING.",
 "4. CONFIRM the key fields per vehicle: auction date, lane, run #, VIN, mileage, announcements, title status, seller, condition.",
 "5. ENRICH: get JD Clean, JD Full Retail, KBB Lending, Base MMR for each VIN (Laser). For mechanic-special announcements, switch to SOP 6.",
 "6. SCORE/SORT: rank by estimated profit and deal score; surface risk and missing-data rows; note lane time order.",
 "7. PREPARE the owner bid-review packet (SOP 10) with a recommended max/target/walk-away per vehicle.",
]),
raw("Decision rules", H2); bullets([
 "No VIN = no firm value. Mark MISSING; do not invent a value.",
 "Any mechanic-special / damage / title announcement -> SOP 6 worksheet (mandatory).",
 "Sort priority: profit, then deal score, then risk, then lane time, then missing-data.",
])
raw("What to enter into CarHunter", H2); P("Log the run-list reviewed, per-vehicle values + source/date, risk flags, and your recommended numbers. The owner's approved max bid is recorded before the sale.")
raw("What not to do", H2); bullets(["Never bid without an owner-approved max bid.","Never guess values for no-VIN rows.","Never skip announcements — they change everything."])
raw("Escalation triggers", H2); P("Every bid recommendation goes to the owner (SOP 10). Escalate early if lane time is close.")
raw("Common mistakes / Troubleshooting", H2); bullets(["Ignoring announcements","Mismapped columns (VIN in wrong field)","PDF won't parse -> fall back to manual entry; log which rows you did by hand."])
raw("Completion checklist", H2); checks(["All rows mapped/confirmed","Low-confidence rows fixed or marked MISSING","Every biddable vehicle valued (source+date)","Mechanic specials run through SOP 6","Bid packet sent to owner"])
raw("Example", H2); P("60-car run-list. You confirm fields, value all VINs in Laser, flag 4 'engine knock' cars to SOP 6, rank the rest by profit, and send the owner a 9-car bid packet with max bids.")
pb()
print("sops 4-5 done")

# ============================== SOP 6 — MECHANIC-SPECIAL AUCTION ==============================
raw("SOP 6: High-Risk / High-Return Mechanic-Special Auction SOP", H1); hr()
raw("Purpose", H2); P("A strict, conservative workflow for auction (or private-party) vehicles with major mechanical or title risk, so a 'cheap' car never turns into a loss. Every triggered vehicle gets a Repair-Margin Worksheet before any bid is recommended.")
raw("Who owns it / When", H2); P("You complete the worksheet; the owner approves the max bid. Use it whenever any trigger phrase appears.")
raw("Trigger phrases (any one = mandatory worksheet)", H2)
bullets(["needs engine, bad engine, blown motor, knocking, head gasket, overheating",
         "needs transmission, bad transmission, no reverse, slipping transmission, does not move",
         "won't start, does not run","salvage, rebuilt, branded title, frame damage, flood, parts only"])
raw("Required tools/inputs", H2); bullets(["Laser values (JD Clean, JD Retail, KBB, MMR)","Local engine/trans quotes (SOP 7)","This worksheet (Appendix has a blank copy)"])
raw("Default reserves (use owner Settings if different)", H2)
table(["Item","Default","Notes"], [
 ["Engine labor reserve","$1,000","Per owner. Use Settings value if it differs."],
 ["Transmission labor reserve","$1,000","Per owner. Use Settings value if it differs."],
 ["Standard recon","$400","Base detail/transport/light recon."],
 ["Diagnostic reserve","$250","Scan/inspection to confirm the real problem."],
 ["Unknown-risk reserve","$750","Buffer for the second hidden problem. Raise for older/luxury/EV."],
 ["Target profit (min)","$1,500","Mechanic specials: recommend $2,000-$3,000 due to risk."],
 ["Auction fees","actual / $400","Use the house's fee schedule."],
 ["Transport","actual / $150-$500","By distance."],
 ["Title/admin fees","$150","Title, temp tag, paperwork."],
], [1.7*inch, 1.1*inch, 3.5*inch])
raw("Repair-Margin Worksheet — fields to fill for EACH triggered vehicle", H2)
bullets(["Vehicle (year/make/model/trim), VIN, mileage, auction lane/run, announcement, title status, exit strategy (retail or wholesale)",
 "JD Clean Trade, JD Full Retail, KBB Lending, Base MMR, Expected exit value",
 "Auction fees, transport, title/admin fees, standard recon",
 "Engine part quote low/mid/high, engine labor reserve ($1,000 default)",
 "Transmission part quote low/mid/high, transmission labor reserve ($1,000 default)",
 "Diagnostic reserve, unknown-risk reserve, target profit",
 "Walk-away (engine), Walk-away (transmission), Walk-away (worst case both), Recommended action"])
raw("Formulas (use the MID part quote for the recommendation; check HIGH for safety)", H2)
raw("<b>Engine-scenario walk-away</b> = expected exit value − auction fees − transport − title/admin − standard recon "
    "− engine part cost − engine labor reserve − diagnostic reserve − unknown-risk reserve − target profit", BODY)
raw("<b>Transmission-scenario walk-away</b> = expected exit value − auction fees − transport − title/admin − standard recon "
    "− transmission part cost − transmission labor reserve − diagnostic reserve − unknown-risk reserve − target profit", BODY)
raw("<b>Worst-case walk-away</b> = expected exit value − auction fees − transport − title/admin − standard recon "
    "− engine part cost − engine labor reserve − transmission part cost − transmission labor reserve "
    "− diagnostic reserve − unknown-risk reserve − target profit", BODY)
raw("Decision rules", H2); bullets([
 "Recommend the MAX BID at or below the relevant walk-away for the announced problem (use worst-case if BOTH systems are suspect or title is branded).",
 "Branded/salvage/flood/frame: use a wholesale exit value and a larger unknown-risk reserve; never assume retail exit.",
 "If the worst-case walk-away is at/below $0, recommend PASS — there's no room.",
 "Always price with the MID quote; if HIGH quote turns it negative, flag it for the owner.",
])
raw("What to enter into CarHunter", H2); P("Attach/record the completed worksheet to the vehicle: all inputs, the three walk-aways, your recommended max bid, and a one-line recommendation (bid/watch/pass). Note every quote's source (SOP 7).")
raw("What not to do", H2); bullets(["Never use only the LOW part quote.","Never skip the diagnostic + unknown-risk reserves.","Never recommend a bid above the worst-case walk-away on a both-systems or branded car.","Never bid without owner approval."])
raw("Escalation triggers", H2); P("Every mechanic-special bid recommendation goes to the owner (SOP 10). Escalate immediately if lane time is near.")
raw("Common mistakes / Troubleshooting", H2); bullets(["Optimistic exit value (using retail on a branded car)","Forgetting transport/fees","No local quote yet -> get one (SOP 7) before recommending; if impossible, mark MISSING and recommend WATCH/PASS, not a guess."])
raw("Completion checklist", H2); checks(["Trigger identified","All values + quotes entered with sources","3 walk-aways computed","Recommended max bid set","Sent to owner"])
raw("Worked example", H2); P("2016 Ford Escape, 'engine knock', clean title. Exit (JD Retail) $11,000. Fees $400, transport $200, title/admin $150, recon $400. Engine part mid $2,300, engine labor $1,000, diagnostic $250, unknown-risk $750, target profit $2,000. "
  "Engine walk-away = 11,000 − 400 − 200 − 150 − 400 − 2,300 − 1,000 − 250 − 750 − 2,000 = $3,550 max bid. Recommend: BID up to $3,550.")
pb()

# ============================== SOP 7 — UTAH PRICING ==============================
raw("SOP 7: Engine &amp; Transmission Local Pricing SOP — Utah", H1); hr()
raw("Purpose", H2); P("Get real, local repair/part costs so the Repair-Margin Worksheet (SOP 6) is accurate, not guessed.")
raw("Who owns it / When", H2); P("You. Use before recommending any mechanic-special bid/offer where engine or transmission work is in play.")
raw("Where to get quotes (Utah)", H2); bullets([
 "Local salvage yards / 'pull-a-part' yards (used engines & transmissions, often with mileage + warranty)",
 "Auto recyclers (LKQ-type) and used-parts locators",
 "Transmission specialty shops (reman/rebuilt trans + install labor)",
 "General mechanic shops (install labor, diagnosis)",
 "Dealer parts departments (only when used isn't available or for exact fitment)",
 "Approved online parts sources that ship to Utah",
 "Owner-approved vendors list (ask your manager for the current list)",
])
raw("Labor defaults", H2); P("Unless owner Settings say otherwise, price engine replacement labor at about $1,000 and transmission replacement labor at about $1,000. These are reserves — if a shop quotes higher install labor, use the shop's number and note it.")
raw("Required: log EVERY quote with these fields", H2)
table(["Field","Example"], [
 ["Vendor name","Wasatch Auto Recyclers"],
 ["Contact method","Phone / website / in-person"],
 ["Contact person","Mike"],
 ["Phone or URL","801-555-0143"],
 ["Date/time","2026-06-21 10:15"],
 ["VIN or exact Y/M/M/engine","2016 Ford Escape 2.0L EcoBoost"],
 ["Engine/transmission code","T/A 2.0L; 6F35 trans"],
 ["Mileage on used part","78,000"],
 ["Warranty","90-day parts warranty"],
 ["Part-only price","$2,300"],
 ["Core charge","$200 (refundable)"],
 ["Shipping/delivery","$0 local pickup"],
 ["Availability date","In stock"],
 ["Labor quote (if applicable)","$1,100 install"],
 ["Notes","Engine tested, has compression report"],
 ["Confidence level","High / Medium / Low"],
], [1.9*inch, 4.4*inch])
raw("Decision rules", H2); bullets([
 "Get at least 2 quotes when time allows; use the MID for the worksheet, keep the HIGH for safety.",
 "Prefer tested used parts with a warranty over the cheapest no-warranty option.",
 "Add the core charge and shipping into the part cost.",
 "Low confidence on a quote -> widen the unknown-risk reserve in SOP 6.",
])
raw("What to enter into CarHunter", H2); P("Attach the quote log to the vehicle and feed the chosen part cost + labor into the SOP 6 worksheet. Every number must show its vendor + date.")
raw("What not to do", H2); bullets(["Never use a number with no vendor/source.","Never quote labor below the $1,000 default unless owner Settings say so.","Never forget core + shipping."])
raw("Escalation triggers", H2); P("Part unavailable, only dealer-new available (very expensive), or quotes vary wildly -> escalate with the numbers to the owner.")
raw("Common mistakes / Troubleshooting", H2); bullets(["Quoting the wrong engine size/fitment","Forgetting core charge","Only one low-confidence quote -> get a second or mark Low confidence + raise reserve."])
raw("Completion checklist", H2); checks(["2 quotes when possible","All log fields filled","Core + shipping included","Chosen cost fed into SOP 6","Confidence noted"])
raw("Example", H2); P("Escape 2.0L: Yard A used engine $2,300 (90-day warranty, 78k mi, +$200 core) and Yard B $2,600 (6-mo warranty). Use $2,300 mid in the worksheet, note Yard B as the HIGH safety check.")
pb()
print("sops 6-7 done")

# ============================== SOP 8 — LASER A-Z ==============================
raw("SOP 8: Laser Appraiser A-to-Z SOP", H1); hr()
raw("Important", H2); raw("Laser Appraiser has <b>no public API</b>. CarHunter reads its values by running a small helper "
  "script (the 'Laser bridge') inside YOUR logged-in Laser browser tab. Exact on-screen button/tab names can change — "
  "where this SOP says VERIFY LIVE, confirm the current screen in the authorized account and capture a screenshot/recording "
  "for the binder. Do not guess UI you haven't confirmed.", WARN)
raw("Purpose", H2); P("Keep accurate JD Clean Trade, JD Full Retail, KBB, and MMR values flowing into CarHunter via Laser.")
raw("Who owns it / When", H2); P("You. Set up once; then keep a logged-in Laser tab open every working day.")
raw("A. Login", H2); bullets([
 "Open laserappraiser.com and log in with the account the owner provided (username/password).",
 "MFA/password rules: VERIFY LIVE whether the account uses 2-factor. If it does, the owner must provide the method. Never store the password anywhere but the approved location.",
 "If login fails: confirm caps lock, try a password reset only with owner approval, and check the subscription is active. Repeated failure -> escalate to owner (account may be locked or expired).",
])
raw("B. Turn on the bridge (one-time)", H2); bullets([
 "Install the Tampermonkey browser extension, create a new script, paste the CarHunter Laser-bridge script (owner/manager provides it), set the SECRET line to the INGEST_SECRET, save.",
 "OR (temporary) paste the console version into the Laser tab's DevTools Console.",
 "Keep one logged-in Laser tab open on an always-on computer. The bridge appraises queued VINs automatically every ~60 seconds.",
])
raw("C. Confirm it's working", H2); bullets([
 "On the Laser tab press F12 -> Console, filter for 'bridge'. You should see 'auto-bridge running' then 'posted -> {appraised:N...}'.",
 "In CarHunter, new cars should show JD Clean + KBB with a recent valuation date.",
])
raw("D. Vehicle lookup / values", H2); bullets([
 "The bridge looks up each queued VIN automatically. To check a single car by hand: in Laser, search the VIN and open the vehicle (VERIFY LIVE the exact search box/screen).",
 "Confirm year, make, model, trim, mileage, region, condition, options match the listing before trusting the values.",
 "Capture JD Clean Trade (NADA 'Trade' clean), JD Full Retail (NADA 'Retail'), KBB (KBB value), Base MMR (Manheim MMR tab). VERIFY LIVE the exact tab labels and screenshot them for this binder.",
 "If the VIN is missing: look up by exact year/make/model/trim/mileage; mark the value 'by Y/M/M, VIN unconfirmed' and treat as lower confidence.",
])
raw("E. Get values into CarHunter", H2); bullets([
 "JD Clean + KBB: automatic via the bridge — no typing.",
 "JD Full Retail + MMR (MANUAL today): read them in Laser and enter them in the listing's valuation notes with source+date, e.g. 'JD Retail $13,300 / MMR $11,900 — Laser, 6/21'.",
 "CSV import: if/when a CSV import exists, follow SOP 9; today, manual entry is the method for Retail/MMR.",
])
raw("F. Missing / stale / conflicting values", H2); bullets([
 "Missing: mark MISSING; do not guess. Re-run the lookup or enter manually from Laser.",
 "Stale: if a value's date is old (>2 weeks) re-pull it.",
 "Conflicting: if JD and KBB or MMR disagree a lot, note it and treat as a risk flag; escalate if it's a high-value car (SOP 10).",
])
raw("Troubleshooting", H2); bullets([
 "'security session expired' in the console -> refresh the Laser page; the bridge resumes.",
 "No 'posted' lines -> the Laser tab was closed or you're on the wrong page (must be the Laser app, not the marketing/login page).",
 "Backend 'unauthorized' -> the SECRET in the script is wrong; fix it.",
 "Values look wrong for the car -> confirm trim/mileage/options in Laser (wrong trim = wrong value).",
])
raw("Escalation rules", H2); P("Login won't work after a reset, subscription expired, MFA blocking automation, or values are repeatedly missing/wrong on valuable cars -> escalate to owner.")
raw("Completion checklist", H2); checks(["Logged in","Bridge running (saw 'posted')","Values flowing into CarHunter","Manual Retail/MMR entered where needed","Screenshots of live Laser screens added to binder"])
raw("Example", H2); P("Morning: open Laser, bridge shows 'posted -> {appraised:8}'. A 2018 Camry shows JD Clean $14,150 + KBB $13,500 automatically; you add JD Retail $17,200 + MMR $13,900 from Laser into the notes with today's date.")
pb()

# ============================== SOP 9 — VALUATION IMPORT & VERIFY ==============================
sop("9","Valuation Import &amp; Verification SOP",[
 ("Purpose","t","Make sure every car shows correct values with a clear source and date, and that nothing is guessed."),
 ("Who owns the process","t","You. Manager audits (SOP 14)."),
 ("When to use it","t","On every lead before you contact, and before any owner packet."),
 ("Required tools","b",["CarHunter listing","Laser (source of book values)","SOP 8 for capture, SOP 7 for repair quotes"]),
 ("Required inputs","b",["JD Clean Trade, JD Full Retail, KBB Lending, Base MMR","Asking price / lane estimate","Est recon, est fees, est profit, deal score, risk flags"]),
 ("Step-by-step process","b",[
   "1. Confirm JD Clean + KBB populated by the bridge (and recent).",
   "2. Enter JD Full Retail + MMR from Laser if blank (MANUAL today) with source+date.",
   "3. Confirm asking price matches the live listing.",
   "4. Sanity-check recon/fees/profit/score; for mechanic specials, replace the auto recon with the SOP 6 worksheet.",
   "5. Verify each value's SOURCE + DATE is recorded. Re-pull anything stale.",
   "6. Mark anything you can't confirm as MISSING.",
 ]),
 ("Decision rules","b",[
   "If values conflict materially (e.g., JD vs KBB far apart), flag risk and, on a valuable car, escalate.",
   "If price < ~35% of book -> price-outlier flag (error/scam/major damage); verify before trusting.",
   "Curve-sourced value (no real book) is low confidence and never HOT — get a real Laser value.",
 ]),
 ("What to enter into CarHunter","t","All four book values with source+date, confirmed asking price, and (for specials) the worksheet recon. Note label quirk: Laser values may show source 'carbly' — that's a legacy tag; the data is from Laser."),
 ("What not to do","b",["Never enter a value without its source/date.","Never trust a 'curve' value as final on a real decision.","Never overwrite a value without noting why."]),
 ("Escalation triggers","t","Conflicting values on a high-value car, repeated missing values, or price-outlier on a valuable car -> SOP 10."),
 ("Common mistakes","b",["Leaving JD Retail/MMR blank","Trusting stale values","Not noticing the value came from the curve fallback"]),
 ("Troubleshooting","t","Values missing/stale/wrong -> SOP 8 (Laser) and SOP 13 (system)."),
 ("Completion checklist","c",["4 books present or MISSING marked","Each value has source+date","Asking price confirmed","Recon correct (worksheet for specials)","Risk flags reviewed"]),
 ("Example","t","2019 RAV4: bridge gives JD Clean $19,000 + KBB $19,300; you add JD Retail $24,500 + MMR $19,800 from Laser (6/21). Asking $17,500. Profit and score check out; no conflict; ready to work."),
])
print("sops 8-9 done")

# ============================== SOP 10 — OWNER ESCALATION ==============================
sop("10","Owner Escalation &amp; Decision Packet SOP",[
 ("Purpose","t","Get the owner exactly what they need to make a fast, confident buy/bid/pass decision — and nothing they don't."),
 ("Who owns the process","t","You build the packet; the owner decides."),
 ("When to use it","t","Whenever a deal hits any escalation trigger below."),
 ("Required tools","b",["CarHunter listing","Laser values","SOP 6 worksheet (if mechanical/auction)","Owner's preferred contact channel"]),
 ("Required inputs","t","The full valuation set, seller conversation summary, inspection status, and your recommendation."),
 ("Escalation triggers (escalate if ANY are true)","b",[
   "Deal score is 90+","Estimated profit exceeds the owner's threshold","Purchase amount exceeds your authority",
   "Title is salvage, rebuilt, branded, flood, frame, or unclear","A major mechanical issue exists",
   "VIN is missing on a high-value deal","Valuations conflict materially","Seller is pushing for immediate action",
   "Auction lane time is approaching","You are unsure",
 ]),
 ("Owner Decision Packet — include ALL of this","b",[
   "Vehicle summary (year/make/model/trim, mileage, location)","Source/link","Asking price or lane estimate",
   "JD Clean Trade, JD Full Retail, KBB Lending, Base MMR (each with source+date)","Estimated recon","Estimated fees",
   "Repair scenarios if relevant (SOP 6 walk-aways)","Estimated profit","Deal score","Risk flags",
   "Seller conversation summary","Inspection status","Your recommendation","The EXACT decision requested from the owner",
 ]),
 ("Step-by-step process","b",[
   "1. Confirm values are verified (SOP 9).","2. Summarize the seller conversation (facts, price, urgency).",
   "3. State inspection status.","4. Fill the packet template (Appendix).","5. Give ONE clear recommendation + the exact ask.",
   "6. Send via the owner's channel and log that you escalated + when.","7. When the owner replies, log the decision and act on it.",
 ]),
 ("Decision rules","b",["Ask for ONE specific decision (e.g., 'Approve buy up to $7,800?' / 'Approve max bid $3,550?').","Never bury the ask. Never send a packet missing a value — mark MISSING if truly unknown."]),
 ("What to enter into CarHunter","t","The packet contents, the time you escalated, the owner's decision, and the resulting next action."),
 ("What not to do","b",["Do not commit to the seller/auction before the owner approves.","Do not send vague 'what do you think?' messages — give a recommendation."]),
 ("Common mistakes / Troubleshooting","b",["Missing the exact ask","No risk flags listed","Owner unreachable + lane time close -> follow the owner's standing rule; if none, do NOT bid."]),
 ("Completion checklist","c",["All packet fields present","Values sourced+dated","One clear recommendation + exact ask","Sent + logged","Decision recorded"]),
 ("Example","t","'2023 Silverado 2500 LS, 105k mi, North SLC. Ask $15,000. JD Clean $34,000 / JD Retail ~$38,000 / KBB $28,000 / MMR (pending). Recon $400, fees $400, est profit ~$19,000, score 100. Risk: confirm not branded, high miles. Seller responsive. Inspection not yet set. Recommend: approve buy up to $16,000 pending clean title + test drive. Decision requested: approve max purchase $16,000?'"),
])

# ============================== SOP 11 — INSPECTION ==============================
sop("11","Inspection Scheduling SOP",[
 ("Purpose","t","Get qualified cars physically inspected/test-driven quickly and safely so a buy decision is based on facts."),
 ("Who owns the process","t","You schedule; the owner or an approved buyer inspects/buys."),
 ("When to use it","t","Once a lead is promising and the seller is responsive."),
 ("Required tools","b",["Calendar","Seller contact","CarHunter (log appointment)","Inspection checklist (Appendix)"]),
 ("Required inputs","b",["Confirmed availability","Location","Title status (clean & in hand?)","Known issues"]),
 ("Step-by-step process","b",[
   "1. Confirm the car is still available and the title is in hand.","2. Offer specific time windows (today/tomorrow).",
   "3. Confirm exact address + meeting spot (public, daytime when possible).","4. Send Script 11 (confirmation).",
   "5. Log the appointment + who is attending in CarHunter.","6. Send Script 11 reminder day-of; Script 12 if running late.",
   "7. After inspection, log condition findings + photos and update status.",
 ]),
 ("Decision rules","b",["No title in hand = flag and confirm plan before spending time.","Meet in safe, public locations in daylight when possible.","Bring the SOP 6 worksheet for mechanic specials."]),
 ("What to enter into CarHunter","b",["Appointment date/time/location","Attendee","Post-inspection condition notes + photos","Updated status + next action"]),
 ("What not to do","b",["Don't schedule without confirming availability + title.","Don't skip logging the appointment.","Don't authorize a purchase at inspection unless the owner pre-approved it."]),
 ("Escalation triggers","t","Seller won't show title, story changes at inspection, or value/condition differs materially from the listing -> escalate before buying."),
 ("Common mistakes / Troubleshooting","b",["No-shows -> SOP 12 follow-up","Unsafe meeting request -> reschedule to public spot","Forgot to log photos"]),
 ("Completion checklist","c",["Availability+title confirmed","Time+place set + confirmed","Logged in CarHunter","Reminder sent","Findings logged after"]),
 ("Example","t","2016 Tacoma: seller confirms clean title in hand; you set Sat 10am at a bank parking lot, log it, send confirmation, and attach the inspection checklist to the lead."),
])

# ============================== SOP 12 — FOLLOW-UP & MISSED DEAL ==============================
sop("12","Follow-Up &amp; Missed-Deal SOP",[
 ("Purpose","t","Make sure no lead dies from silence and learn from deals we lose."),
 ("Who owns the process","t","You."),
 ("When to use it","t","Any lead with no reply, a soft 'maybe', a competing buyer, or a deal that fell through."),
 ("Required tools","b",["CarHunter (statuses + follow-up reminders)","Script Book (7, 6, 17)"]),
 ("Required inputs","t","Open leads, last-contact dates, reason for any loss."),
 ("Step-by-step process","b",[
   "1. NO REPLY: follow up once with Script 7 after ~24h, again after ~48-72h, then mark Watch or Dead with a reason.",
   "2. ANOTHER BUYER: Script 6, set a follow-up for 3-5 days out in case it falls through.",
   "3. PRICE GAP: log their number, set Watch, revisit if the listing ages/price drops.",
   "4. MISSED/EXPIRED: if a HOT car sold before we acted, log it as Missed with the reason (slow contact? owner delay? value wrong?).",
   "5. Review Missed reasons weekly with your manager to fix the cause.",
 ]),
 ("Decision rules","b",["Max ~3 polite touches, then Watch/Dead — no pestering.","Always set the NEXT follow-up date; never leave 'waiting' open-ended.","A price-gap car that drops to our number becomes active again."]),
 ("What to enter into CarHunter","b",["Each follow-up + reply","Status (Watch/Dead/Missed) with a reason","Next follow-up date"]),
 ("What not to do","b",["Don't spam.","Don't let leads sit with no next action.","Don't mark Dead without a reason."]),
 ("Escalation triggers","t","A HOT car we missed due to a process gap (slow approval, wrong value) -> flag to owner/manager so we fix it."),
 ("Common mistakes / Troubleshooting","b",["No next-action date set","Marking Dead with no reason (kills our learning)","Over-following-up"]),
 ("Completion checklist","c",["Follow-ups logged","Status + reason set","Next date set (if still open)","Missed deals logged with cause"]),
 ("Example","t","HOT Civic, no reply: Script 7 at 24h, again at 72h, still nothing -> Watch with 'no response x2'. Three days later price drops $1,000; it re-surfaces and you re-engage."),
])

# ============================== SOP 13 — TROUBLESHOOTING ==============================
sop("13","System Troubleshooting SOP",[
 ("Purpose","t","Keep the desk running when a tool breaks, with safe manual fallbacks — and know when to stop and escalate."),
 ("Who owns the process","t","You first; manager/owner for anything you can't resolve in ~15 minutes."),
 ("When to use it","t","Any time CarHunter, imports, Laser, the bridge, or outreach misbehave."),
 ("Required tools","b",["This SOP","Manager/owner contact","A temporary note pad ONLY as approved backup"]),
 ("Step-by-step process (by symptom)","b",[
   "CarHunter won't load: refresh; try another browser; check internet. Still down >15 min -> notify owner; work follow-ups/outreach you already have.",
   "Lead import / feed not updating: check the Laser bridge is running (SOP 8) and that the KSL scrape is alive; if no new cars in 30+ min, notify owner (likely the Bright Data token or scrape) — SOP 13 'scrape' below.",
   "Scrape returns nothing: usually the Bright Data token/balance, not the code. Notify owner to check Bright Data.",
   "Auction PDF won't parse: switch to manual entry into the worksheet; log which rows were manual.",
   "Valuation import fails / values missing: pull values manually from Laser (SOP 8) and enter with source+date; mark MISSING what you can't get.",
   "Laser login fails: re-check credentials; subscription active? MFA? -> escalate to owner if unresolved.",
   "Bridge/browser workflow fails: refresh the Laser tab ('session expired'); confirm you're on the Laser app page; re-check the SECRET; restart the script.",
   "Score looks wrong: verify the values + trim/mileage (SOP 9). Wrong trim = wrong value. If values are right but score seems off, flag to manager.",
   "Duplicate lead appears: keep the most complete one, note the duplicate; don't double-contact the seller.",
   "Outreach tool down: send manually from an approved number and LOG it in CarHunter by hand.",
   "You made a mistake: stop, log exactly what happened, tell your manager immediately. Do not cover it up.",
   "Internet/comms down: switch to mobile hotspot if approved; keep a timestamped manual log; re-enter into CarHunter once back.",
 ]),
 ("Decision rules","b",["Always prefer a logged manual fallback over stopping entirely — unless data integrity is at risk.","If you can't trust the data, STOP and escalate rather than act on bad data.","Anything down >15 min that blocks the desk -> notify owner."]),
 ("What to enter into CarHunter","t","What broke, when, what you did, and re-enter any data captured manually during the outage."),
 ("What not to do","b",["Don't keep bidding/buying on data you can't verify.","Don't hide mistakes.","Don't start a permanent side spreadsheet."]),
 ("Escalation triggers","t","Anything unresolved in ~15 min, any data-integrity risk, Laser/subscription/token problems, or a mistake that affected a live deal."),
 ("Common mistakes","b",["Assuming the code broke when it's a key/token","Not logging the manual fallback","Continuing on bad data"]),
 ("Completion checklist","c",["Symptom identified","Fallback used + logged","Owner/manager notified if needed","Manual data re-entered","Root cause noted"]),
 ("Example","t","Feed stops updating. Bridge shows 'posted' fine, but no new KSL cars in 40 min. You notify the owner ('likely Bright Data token/balance'), and keep working existing leads + follow-ups meanwhile."),
])

# ============================== SOP 14 — DATA QUALITY & AUDIT ==============================
sop("14","Data Quality &amp; Audit SOP",[
 ("Purpose","t","Keep CarHunter clean, trustworthy, and auditable so decisions are based on real, sourced data."),
 ("Who owns the process","t","You maintain it daily; manager audits (SOP 16)."),
 ("When to use it","t","Continuously, plus a quick end-of-day sweep."),
 ("Required tools","b",["CarHunter","This SOP"]),
 ("Standards (every record must meet these)","b",[
   "One row per real car (watch for duplicates).","Every value shows source + date.","Missing data is marked MISSING, not blank-and-ignored or guessed.",
   "Every lead has a status + next action.","Every seller conversation is logged.","Every escalation + owner decision is logged.",
 ]),
 ("Step-by-step process","b",[
   "1. As you work, enter sources/dates on values and log conversations in real time (not from memory later).",
   "2. End-of-day sweep: scan your touched leads for missing sources, un-logged replies, or no next action; fix them.",
   "3. Flag duplicates and merge per manager guidance.",
   "4. Note the label quirk: Laser values may display source 'carbly' (legacy tag) — still record the real source/date in notes.",
 ]),
 ("Decision rules","b",["If you can't source a value, it's MISSING.","If two records are the same car, keep the most complete and note the merge.","Never edit history to hide a mistake — add a correcting note."]),
 ("What to enter into CarHunter","t","Sources, dates, statuses, next actions, conversation logs, and correction notes."),
 ("What not to do","b",["No guessed values.","No blank sources.","No silent overwrites.","No side spreadsheets (unapproved)."]),
 ("Escalation triggers","t","Systemic data problems (lots of missing values, wrong sources, duplicates) -> tell your manager so the root cause gets fixed."),
 ("Common mistakes","b",["Logging from memory at end of day (errors creep in)","Leaving sources blank","Ignoring duplicates"]),
 ("Completion checklist","c",["No blank sources on touched leads","All replies logged","All open leads have next actions","Duplicates flagged","EOD sweep done"]),
 ("Example","t","EOD sweep finds a Camry with KBB but no source noted and a missing JD Retail. You add 'KBB $13,500 — Laser 6/21', pull JD Retail from Laser, and set the next action."),
])
print("sops 10-14 done")

# ============================== SOP 15 — TRAINING & CERTIFICATION ==============================
raw("SOP 15: Employee Training Plan &amp; Certification Checklist", H1); hr()
raw("Purpose", H2); P("Take a new hire from zero to certified desk operator in 5 days.")
raw("Day 1 — CarHunter overview, daily workflow, private-party leads, outreach basics", H2)
bullets(["Read SOP 1 + Capability Map.","Shadow the daily routine (SOP 2).","Work 5 practice leads (SOP 3) read-only.","Learn the Script Book (SOP 4); send 3 supervised messages.","Practice logging conversations (SOP 14)."])
raw("Day 2 — Valuation basics, Laser, JD/KBB/MMR, recon, fees, deal score", H2)
bullets(["Set up + verify the Laser bridge (SOP 8).","Capture JD Clean/Retail/KBB/MMR on 5 cars (SOP 9).","Learn how recon, fees, profit, and deal score are built.","Verify values with sources+dates; practice marking MISSING."])
raw("Day 3 — Auction run-lists, mechanic-special flags, engine/transmission pricing", H2)
bullets(["Work a sample run-list (SOP 5).","Identify trigger phrases; complete 2 Repair-Margin Worksheets (SOP 6) with the 3 walk-away formulas.","Call 2 Utah vendors for engine/trans quotes and fill the quote log (SOP 7)."])
raw("Day 4 — Owner packets, inspection scheduling, follow-up, troubleshooting", H2)
bullets(["Build 2 Owner Decision Packets (SOP 10).","Schedule a mock inspection (SOP 11).","Run the follow-up cadence on 3 leads (SOP 12).","Walk every troubleshooting symptom (SOP 13)."])
raw("Day 5 — Supervised live queue, quality review, certification test", H2)
bullets(["Run the live queue solo with the manager watching.","Manager runs the QC checklist (SOP 16).","Pass the certification checklist below."])
raw("Certification Checklist — the employee can:", H2)
checks([
 "Work a private-party lead end to end (SOP 3)","Send approved outreach correctly (SOP 4)","Log a seller reply completely (SOP 4/14)",
 "Schedule an appointment (SOP 11)","Import/verify valuations with sources+dates (SOP 8/9)","Review an auction run-list (SOP 5)",
 "Complete an engine/transmission Repair-Margin Worksheet with all 3 walk-aways (SOP 6)","Prepare a complete Owner Decision Packet (SOP 10)",
 "Troubleshoot a failed import/feed and use a logged fallback (SOP 13)","Explain every escalation trigger from memory (SOP 10)",
])
P("Sign-off: Employee ______________  Manager ______________  Date __________   (Certified to run the desk.)")
pb()

# ============================== SOP 16 — MANAGER QC ==============================
raw("SOP 16: Manager Quality-Control Checklist", H1); hr()
raw("Purpose / cadence", H2); P("A fast daily/weekly audit to keep the desk accurate, fast, and compliant. Run daily for new hires, weekly once certified.")
raw("Daily spot-check (sample 5-10 leads)", H2)
checks([
 "Every value has a source + date (no blanks, no guesses)","Missing data marked MISSING, not invented",
 "Every touched lead has a status + next action","Every seller conversation logged (not from memory)",
 "HOT/fresh cars were contacted quickly","Mechanic specials have a Repair-Margin Worksheet",
 "No bids/purchases without owner approval","No unapproved side spreadsheets",
])
raw("Weekly review", H2)
checks([
 "Missed/expired HOT deals reviewed for root cause (slow contact? approval delay? wrong value?)",
 "Escalations were complete (all packet fields, one clear ask)","Owner decisions logged + acted on",
 "Duplicates cleaned","Laser bridge uptime good (values flowing)","Troubleshooting incidents logged + resolved",
 "Outreach stayed polite/compliant (no spam, no false claims)",
])
raw("Scoring", H2); P("Green = standards met. Yellow = minor gaps, coach. Red = data-integrity or escalation failure -> retrain on the specific SOP and re-audit next day.")
pb()

# ============================== SOP 17 — APPENDIX ==============================
raw("SOP 17: Appendix — Templates, Forms, Logs, Decision Tree", H1); hr()

raw("A. Daily Desk Checklist", H2)
checks(["Confirm Laser bridge running ('posted' in console)","Confirm feed updating (new cars today)","Triage HOT + mechanic specials first",
 "Work each lead (SOP 3) + log","Work follow-ups (SOP 12)","Send owner packets (SOP 10)","Process auction run-list if any (SOP 5/6)",
 "EOD: every lead has a next action; all conversations logged; MISSING marked"])

raw("B. Owner Decision Packet — copy/paste template", H2)
raw("Vehicle: {year} {make} {model} {trim} | Mileage: ____ | Location: ____<br/>"
    "Source/link: ____<br/>Asking / lane estimate: $____<br/>"
    "JD Clean Trade: $____ (src/date)  |  JD Full Retail: $____ (src/date)<br/>"
    "KBB Lending: $____ (src/date)  |  Base MMR: $____ (src/date)<br/>"
    "Est recon: $____ | Est fees: $____ | Est profit: $____ | Deal score: ____<br/>"
    "Repair scenarios (if any): engine walk-away $____ / trans walk-away $____ / worst-case $____<br/>"
    "Risk flags: ____<br/>Seller conversation summary: ____<br/>Inspection status: ____<br/>"
    "My recommendation: ____<br/>EXACT decision requested: ____", BODY)

raw("C. Repair-Margin Worksheet — blank", H2)
table(["Field","Value"], [["Vehicle / VIN / mileage",""],["Auction lane / run",""],["Announcement",""],["Title status",""],
 ["Exit strategy (retail/wholesale)",""],["JD Clean Trade",""],["JD Full Retail",""],["KBB Lending",""],["Base MMR",""],
 ["Expected exit value",""],["Auction fees",""],["Transport",""],["Title/admin fees",""],["Standard recon ($400)",""],
 ["Engine part low/mid/high",""],["Engine labor reserve ($1,000)",""],["Transmission part low/mid/high",""],
 ["Transmission labor reserve ($1,000)",""],["Diagnostic reserve ($250)",""],["Unknown-risk reserve ($750)",""],
 ["Target profit ($1,500+; specials $2-3k)",""],["Walk-away (engine)",""],["Walk-away (transmission)",""],
 ["Walk-away (worst case)",""],["Recommended action / max bid",""]], [2.6*inch, 3.7*inch])

raw("D. Utah Parts/Labor Quote Log — blank", H2)
table(["Field","Value"], [["Vendor name",""],["Contact method",""],["Contact person",""],["Phone / URL",""],["Date/time",""],
 ["VIN or Y/M/M/engine",""],["Engine/trans code",""],["Mileage on used part",""],["Warranty",""],["Part-only price",""],
 ["Core charge",""],["Shipping/delivery",""],["Availability",""],["Labor quote",""],["Notes",""],["Confidence (H/M/L)",""]],
 [2.1*inch, 4.2*inch])

raw("E. Inspection Checklist", H2)
checks(["Title clean + in hand (matches VIN)","VIN on car matches listing","Cold start / no knock / no smoke","Transmission shifts + reverse works",
 "No major leaks / overheating","Frame + panel gaps (accident/flood signs)","Tires/brakes condition","Electronics + AC",
 "Test drive done","Photos taken + attached to lead","Condition vs listing noted"])

raw("F. Escalation Decision Tree", H2)
bullets([
 "Score 90+? -> ESCALATE.","Profit over owner threshold OR spend over your authority? -> ESCALATE.",
 "Salvage/rebuilt/branded/flood/frame OR major mechanical? -> ESCALATE (with SOP 6 worksheet).",
 "VIN missing on a valuable car? -> request VIN; if still missing -> ESCALATE.",
 "Values conflict materially? -> ESCALATE.","Seller pushing now / auction lane time close? -> ESCALATE now.",
 "Unsure for any reason? -> ESCALATE. (When in doubt, escalate.)",
 "None of the above + within your authority + clean + verified? -> proceed per SOP and set next action.",
])

raw("G. Status vocabulary (use these exactly)", H2)
P("Lead states: New | Contacted | Waiting reply | Negotiating | Inspection scheduled | Owner review | Approved | Bought | Flipped | Watch | Dead | Missed. "
  "Every Dead/Missed needs a reason. Every open state needs a next action + date.")

raw("H. Key numbers quick-reference (owner Settings override these)", H2)
table(["Number","Default"], [["HOT threshold (min profit)","$1,500"],["Fees (flat)","$400"],["Base recon","$400"],
 ["Engine labor reserve","$1,000"],["Transmission labor reserve","$1,000"],["Diagnostic reserve","$250"],
 ["Unknown-risk reserve","$750"],["Title/admin","$150"],["Mechanic-special target profit","$2,000-$3,000"],
 ["Price-outlier flag","price < ~35% of book"]], [3.0*inch, 1.6*inch])

sp(10); raw("End of binder. Verify the Capability Map and the live Laser screens (SOP 8) before your first solo shift.", SMALL)

# ============================== BUILD ==============================
def footer(canvas, doc):
    canvas.saveState(); canvas.setFont("Helvetica", 7.5); canvas.setFillColor(colors.HexColor("#999"))
    canvas.drawString(0.7*inch, 0.35*inch, "CarHunter — Employee SOP & Training Binder")
    canvas.drawRightString(7.8*inch, 0.35*inch, "Page %d" % doc.page)
    canvas.restoreState()
doc = SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.7*inch, rightMargin=0.7*inch,
                        topMargin=0.7*inch, bottomMargin=0.6*inch, title="CarHunter Employee SOP Binder")
doc.build(E, onFirstPage=footer, onLaterPages=footer)
print("WROTE", OUT)
