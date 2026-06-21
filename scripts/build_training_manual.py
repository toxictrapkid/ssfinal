#!/usr/bin/env python3
"""Build the CarHunter Training Manual -> PDF + Markdown (one source)."""
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, ListFlowable, ListItem, HRFlowable)

PDF="/home/user/ssfinal/docs/CarHunter_Training_Manual.pdf"
MDP="/home/user/ssfinal/docs/CarHunter_Training_Manual.md"
NAVY=colors.HexColor("#0b3d62"); BLUE=colors.HexColor("#12598c"); GREY=colors.HexColor("#555")
LIGHT=colors.HexColor("#eef3f8"); LINE=colors.HexColor("#c8d2dc"); AMBER=colors.HexColor("#fff7e6")
SHOTBG=colors.HexColor("#fdf3f3"); SHOTBORDER=colors.HexColor("#d98a8a"); GREENBG=colors.HexColor("#eef8f0")
ss=getSampleStyleSheet()
def mk(n,parent=None,**k): return ParagraphStyle(n,parent=parent or ss["BodyText"],**k)
TITLE=mk("TITLE",fontSize=30,textColor=NAVY,leading=34,spaceAfter=4,fontName="Helvetica-Bold")
SUB=mk("SUB",fontSize=13,textColor=GREY,leading=17,alignment=TA_CENTER)
H1s=mk("H1",fontSize=18,textColor=NAVY,leading=22,spaceBefore=10,spaceAfter=6,fontName="Helvetica-Bold")
H2s=mk("H2",fontSize=12.5,textColor=BLUE,leading=15,spaceBefore=9,spaceAfter=3,fontName="Helvetica-Bold")
H3s=mk("H3",fontSize=10.5,textColor=colors.HexColor("#333"),leading=13,spaceBefore=6,spaceAfter=1,fontName="Helvetica-Bold")
BODY=mk("BODY",fontSize=9.6,leading=13.4,spaceAfter=5)
SMALL=mk("SMALL",fontSize=8,leading=10,textColor=GREY)
CELL=mk("CELL",fontSize=8.2,leading=10.5); CELLB=mk("CELLB",parent=CELL,fontName="Helvetica-Bold")
SHOTT=mk("SHOTT",fontSize=9.5,leading=12,fontName="Helvetica-Bold",textColor=colors.HexColor("#9a3b3b"))
SHOTB=mk("SHOTB",fontSize=8.6,leading=11.5,textColor=colors.HexColor("#5b3b3b"))
EXS=mk("EX",fontSize=9,leading=12,textColor=colors.HexColor("#14532d"),backColor=GREENBG,borderColor=colors.HexColor("#a9ccb2"),borderWidth=0.6,borderPadding=6,spaceAfter=5)
WARN=mk("WARN",parent=BODY,backColor=AMBER,borderColor=colors.HexColor("#e0a96d"),borderWidth=0.6,borderPadding=6)

E=[]; MD=[]; SHOTS=[]
def esc(t): return t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def raw(t,s=BODY): E.append(Paragraph(t,s))
def P(t,s=BODY): E.append(Paragraph(esc(t),s))
def md(s=""): MD.append(s)
def sp(h=6): E.append(Spacer(1,h))
def hr(): E.append(HRFlowable(width="100%",thickness=0.6,color=LINE,spaceBefore=3,spaceAfter=5))
def pb(): E.append(PageBreak())
def H1(t): E.append(Paragraph(esc(t),H1s)); hr(); md("\n\n# "+t)
def H2(t): E.append(Paragraph(esc(t),H2s)); md("\n## "+t)
def H3(t): E.append(Paragraph(esc(t),H3s)); md("\n**"+t+"**")
def body(t): P(t); md(t)
def warn(t): raw(esc(t),WARN); md("> ⚠️ "+t)
def bullets(items):
    E.append(ListFlowable([ListItem(Paragraph(esc(i),BODY),leftIndent=10) for i in items],bulletType="bullet",start="•",leftIndent=14,spaceAfter=4))
    md("");[md("- "+i) for i in items]
def steps(items):
    E.append(ListFlowable([ListItem(Paragraph(esc(i),BODY),leftIndent=10) for i in items],bulletType="1",leftIndent=16,spaceAfter=4))
    md("");[md(f"{n}. {i}") for n,i in enumerate(items,1)]
def checks(items):
    E.append(ListFlowable([ListItem(Paragraph(esc(i),BODY),leftIndent=10) for i in items],bulletType="bullet",start="☐",leftIndent=14,spaceAfter=3))
    md("");[md("- [ ] "+i) for i in items]
def example(t): E.append(Paragraph("<b>Example:</b> "+esc(t),EXS)); md("> **Example:** "+t)
def table(header,rows,widths,fs=8.2):
    data=[[Paragraph(esc(h),CELLB) for h in header]]+[[Paragraph(esc(str(c)),CELL) for c in r] for r in rows]
    t=Table(data,colWidths=widths,repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),fs),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,LIGHT]),("GRID",(0,0),(-1,-1),0.4,LINE),
        ("VALIGN",(0,0),(-1,-1),"TOP"),("TOPPADDING",(0,0),(-1,-1),2.5),("BOTTOMPADDING",(0,0),(-1,-1),2.5),
        ("LEFTPADDING",(0,0),(-1,-1),3.5),("RIGHTPADDING",(0,0),(-1,-1),3.5)]))
    E.append(t); sp(6)
    md(""); md("| "+" | ".join(header)+" |"); md("|"+"|".join(["---"]*len(header))+"|")
    [md("| "+" | ".join(str(c) for c in r)+" |") for r in rows]
def shot(title, where, notice, clicknext, mistake):
    SHOTS.append((title, where))
    inner=[Paragraph("[CAMERA] SCREENSHOT NEEDED — "+esc(title),SHOTT),
           Paragraph("<b>Where:</b> "+esc(where),SHOTB),
           Paragraph("<b>What to notice:</b> "+esc(notice),SHOTB),
           Paragraph("<b>What to click next:</b> "+esc(clicknext),SHOTB),
           Paragraph("<b>Common mistake here:</b> "+esc(mistake),SHOTB)]
    t=Table([[inner]],colWidths=[6.3*inch])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),SHOTBG),("BOX",(0,0),(-1,-1),0.8,SHOTBORDER),
        ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    E.append(t); sp(6)
    md(""); md(f"> [SCREENSHOT NEEDED — {title}]  "); md(f"> - Where: {where}  ")
    md(f"> - What to notice: {notice}  "); md(f"> - What to click next: {clicknext}  ")
    md(f"> - Common mistake here: {mistake}  ")

sp(80)
raw("CarHunter", TITLE); raw("Software Training Manual", mk("c",parent=SUB,fontSize=18,textColor=NAVY))
sp(14)
P("How to find, review, verify, and prepare vehicle deals for owner approval - from zero experience.", SUB)
sp(40)
table(["Field","Value"],[["Version","1.0"],["Date","June 2026"],["Owner","(owner name)"],
 ["Audience","New employee / buying-desk operator"],
 ["The app you'll use","APEX Deal Radar (the CarHunter web app)"],
 ["Golden rule","The software finds deals. YOU verify reality. The OWNER approves all money."]],[1.5*inch,4.8*inch])
sp(12)
warn("This manual never shows fake screenshots. Where a picture is needed you'll see a 'SCREENSHOT NEEDED' box telling you exactly what to capture. A full list is at the end.")
pb()
print("cover+helpers OK")

# ===== 2. PURPOSE =====
H1("2. Purpose of This Manual")
body("This manual teaches you how to use CarHunter to find car deals, check that they are real, and get them ready for the owner to approve. By the end you will be able to work the deal feed, verify a vehicle's facts and values, message sellers, review auction cars, and build a clean owner packet - even if you have never bought a car before.")
body("Read it in order the first week. After that, keep it open and jump to the section you need.")

# ===== 3. SOFTWARE OVERVIEW =====
H1("3. What CarHunter Does")
body("CarHunter is a system that watches car listings all day and pulls the best ones into one place so you do not have to search by hand. The screen you will use is the web app called APEX Deal Radar.")
H2("What the system does for you")
bullets([
 "Holds leads - every car it finds shows up as a card in the feed.",
 "Shows vehicle data - year, make, model, price, mileage, title, photos.",
 "Shows values - JD Clean Trade and KBB (pulled from Laser Appraiser automatically).",
 "Scores deals - a 0-100 Deal Score and an estimated profit for each car.",
 "Flags HOT deals - cars priced about $1,000+ under both books show under Contact Now.",
 "Tracks status and notes - you can save cars, add notes, and mark where each one stands.",
 "Helps you review auction run lists (done with the worksheet in Section 10 for now).",
 "Helps you build owner packets so the owner can decide fast.",
 "Keeps the business record - the feed is the source of truth.",
])
warn("Be honest about what is automatic vs manual. The app AUTO-shows JD Clean Trade + KBB, Deal Score, profit, and HOT. JD Full Retail, Base MMR, Carfax history, and Car-Part repair prices are looked up by YOU in outside tools (Sections 10-13). Auction run lists and owner packets are done by hand today.")

# ===== 4. EMPLOYEE ROLE =====
H1("4. Your Role - The Second Line of Defense")
body("The software is the first line: it finds opportunities fast. You are the second line: you make sure the deal is REAL before anyone spends money. The owner is the final line: the owner approves every purchase and every auction bid.")
bullets([
 "The app can be wrong or missing facts. Your job is to check reality - VIN, title, miles, condition, history.",
 "Never guess. If a fact is missing, mark it MISSING and go find it.",
 "Never approve a buy or a bid yourself unless the owner has given you written permission.",
 "Every car you touch must end with a clear next step and notes.",
])
example("The app shows a 2018 Accord, $4,000, profit +$13,000, HOT. That looks amazing - too amazing. You check and the description says 'blown engine, salvage title.' That is why you verify before the owner ever sees a 'great deal.'")

# ===== 5. LOGIN AND SETUP =====
H1("5. Opening the App and Starting Your Shift")
H2("Opening CarHunter (APEX Deal Radar)")
body("CarHunter does not have a username/password login today. You open it by going to its web address in Chrome. Ask the owner for the exact link (it is the Vercel web address, e.g. the CarHunter site). Bookmark it.")
shot("Home / Deal Feed (first screen)",
 "The CarHunter web address in Chrome.",
 "Top-left says APEX with 'Deal Radar' under it. A search box, three tabs (All deals / Contact Now / Watchlist), filter row, and a grid of car cards.",
 "Take a screenshot of the whole page after cars load. Add a label/arrow to the three tabs and the filter row.",
 "Taking the shot before cars load - you'll capture grey placeholder boxes instead of real cards.")
H2("Start-of-shift checklist")
checks([
 "Open the CarHunter feed in Chrome - confirm cars are showing (not all grey boxes).",
 "Open a second tab with Laser Appraiser, logged in (this powers the values + the value bridge - Section 11).",
 "Open Carfax and Car-Part tabs (you'll use them to verify - Sections 12-13).",
 "Check the Contact Now tab for new HOT deals first.",
])
H2("What to do if it will not open")
bullets([
 "Page is blank or won't load: refresh (F5). Still blank? Try again in 1 minute and check your internet.",
 "Cars never appear (all grey boxes): the data feed may be down - tell your manager; meanwhile work follow-ups you already have.",
 "Values are blank on every car: the Laser value bridge is probably not running - see Section 11 and Section 17.",
])

# ===== 6. DASHBOARD =====
H1("6. The Dashboard (Deal Feed) Explained")
body("Everything happens on one screen. Here is each part and what it means.")
table(["Area","What it is / what to do"],[
 ["Search box","Type a make, model, trim, or VIN to find a specific car."],
 ["All deals (tab)","Every car the system has right now, ranked by Deal Score."],
 ["Contact Now (tab)","The HOT deals - cars about $1,000+ under BOTH books. Work these first. The number on the tab is how many there are."],
 ["Watchlist (tab)","Cars you saved (tapped the heart) or added a note to. Saved in YOUR browser."],
 ["Make / Max price / Max miles","Filters to narrow the list."],
 ["Sort","Order the list: Best deal score, Most profit, Newest listed, Price, Miles, Year."],
 ["Vehicle count","Shows how many cars match your current filters."],
 ["Car cards","Each car: photo, year/make/model, price, miles, Deal Score, est profit, HOT badge."],
],[1.7*inch,4.6*inch])
shot("Deal Feed with the three tabs + filters",
 "Home screen, All deals tab.",
 "The three tabs at top-right (note the count on Contact Now), the filter row (Make, Max price, Max miles, Sort), and the card grid below.",
 "Click the Contact Now tab.",
 "Forgetting to label the Contact Now count - that number is the live HOT count.")
shot("Contact Now (HOT) tab",
 "Home screen after clicking Contact Now.",
 "Only HOT cars show. Each card has a HOT/Contact-Now marker and a strong est profit.",
 "Click any card to open its detail drawer.",
 "Capturing this when the list is empty - wait until at least one HOT car is present.")
H2("Things the manual mentions that are done OUTSIDE the app (today)")
bullets([
 "Mechanic specials, Missing VIN, Missing values, Red flags: you spot these by reading the card/description and the values - there is no separate tab for each yet.",
 "Auction items, Owner review, Follow-ups: handled with the worksheets/templates in Sections 10, 15, and the Appendix.",
 "Tool/status warnings (e.g., values not updating): see Section 17 Troubleshooting.",
])

# ===== 7. LEAD QUEUE =====
H1("7. Working the Lead Queue")
H2("Sort and filter")
steps([
 "Use Sort to put the best cars on top (start with Best deal score, or Most profit).",
 "Use Make / Max price / Max miles to narrow to what you buy.",
 "Use the Contact Now tab to see only HOT cars.",
])
H2("Open and read a card")
body("Click a card to open the detail drawer. Read it top to bottom: source, price, mileage, VIN, location, title, photos, and the full description. Then look at the values and the risk it implies.")
shot("Lead detail drawer (one car open)",
 "Home screen, after clicking a car card.",
 "The drawer shows the photo gallery (use the left/right arrows), price, miles, VIN (with a copy button), title, location, the description, and the values (Deal Score, est profit, JD Clean, KBB).",
 "Use the arrows to view all photos; click the VIN copy button to copy the VIN for Laser/Carfax.",
 "Skipping the description - mechanic-special wording (needs engine, etc.) lives there.")
H2("Save, note, set status")
bullets([
 "Tap the heart to save a car to your Watchlist.",
 "Add a note with the facts you verified (see Section 16 for good vs bad notes).",
 "Set the status so everyone knows where the car stands.",
 "Note: saves, notes, and status are stored in YOUR browser. Use the same computer/profile each shift, and follow the owner-packet step (Section 15) so important deals are recorded for the owner, not just on your machine.",
])
H2("Understanding scores and risk")
bullets([
 "Deal Score (0-100): higher = better deal. It blends profit, how far under book, freshness, mileage fit, and title.",
 "Est profit: the rough money in the deal (value minus price minus repair and fees). Verify it - it uses auto values.",
 "HOT: about $1,000+ under both books. Strong, but still verify.",
 "Risk to watch: branded/salvage title, very high miles, or a price that looks too good (often means damage or a scam).",
])

# ===== 8. PRIVATE-PARTY WORKFLOW =====
H1("8. Private-Party Lead Workflow (one car, start to finish)")
steps([
 "Open the lead (click the card).",
 "Check the vehicle facts: year, make, model, trim, price, location.",
 "Check the VIN: is it present and 17 characters? Copy it. (No VIN on a good car = ask the seller.)",
 "Check the mileage: does it fit the price and year? Very low or blank miles = verify.",
 "Check the title: clean, or branded/salvage/rebuilt? Branded changes the value a lot.",
 "Read the full description: look for mechanic-special words (Section listing below).",
 "Review the values: JD Clean Trade + KBB show in the app. Look up JD Full Retail + Base MMR in Laser (Section 11).",
 "Check history if needed: run Carfax (Section 12) for title brand, accidents, mileage, owners.",
 "Identify gaps: anything missing or that doesn't match - mark MISSING.",
 "Contact the seller using a script (Section 14).",
 "Log the reply with the facts the seller gives.",
 "Escalate to the owner if it's strong/risky/over your limit (Section 15).",
])
H2("Mechanic-special words to catch in the description")
body("needs engine, bad engine, blown motor, knocking, head gasket, overheating, needs transmission, no reverse, slipping, won't start, doesn't run, salvage, rebuilt, branded title, flood, frame damage, mechanic special, project, as-is.")
H2("Checklist - private-party lead")
checks(["Facts checked","VIN present + copied","Mileage makes sense","Title known","Description read for issues","Values reviewed (JD Clean/KBB + Laser Retail/MMR)","Carfax run if needed","Gaps marked MISSING","Seller contacted","Reply logged","Escalated if needed; next action set"])
H2("What to do if this happens")
bullets([
 "No VIN: ask the seller for it before spending more time. Still none on a high-value car? Escalate.",
 "Title is branded/salvage: flag it, use the lower (0.70) value basis, and escalate.",
 "Price is way below book (under ~35% of book): treat as a red flag - ask hard condition/title questions; likely damage or scam.",
 "Seller won't answer questions or rushes you: stay polite, log it, and escalate if it's a strong car.",
])
example("2016 RAV4, $5,000, clean title, 80k mi. JD Clean $10,833, KBB $10,892 in the app. You copy the VIN, run Carfax (clean, 1 owner, no accidents), message the seller (Script 1+3), they confirm title in hand. You log it and build an owner packet - strong, verified, ready.")
print("sections 2-8 done")

# ===== 9. FACEBOOK =====
H1("9. Facebook Marketplace Workflow (manual)")
warn("Facebook is a MANUAL process. Use only the approved account and the approved steps. Do NOT scrape, do NOT bypass any security, and NEVER use fake accounts. This protects the business.")
steps([
 "Log into the approved Facebook account (ask your manager which one).",
 "Open Marketplace and run the saved searches/keywords the owner set (e.g., the makes/models we buy).",
 "When you find a candidate, capture the listing details by hand.",
 "Create the lead record (or note) with: source = Facebook, the listing link, year, make, model, price, mileage, location, and VIN if shown.",
 "Read the description for mechanic-special words (same list as Section 8).",
 "Message the seller using a script (Section 14) and log every reply.",
])
shot("Facebook Marketplace saved search results",
 "Facebook Marketplace, signed in to the approved account, with a saved search open.",
 "The list of vehicle results for our keywords; price, title text, and location on each.",
 "Open one listing to copy its link + details.",
 "Using a personal or fake account - only the approved account is allowed.")
bullets([
 "Always paste the listing LINK so the car can be found again.",
 "If the VIN isn't shown, ask the seller for it before going further.",
 "Mark anything missing as MISSING - do not guess.",
])

# ===== 10. AUCTION RUN LIST =====
H1("10. Auction Run-List Workflow (kept SEPARATE from private-party leads)")
warn("Auction cars are NOT worked like normal feed leads. There is no in-app uploader yet, so you build an Auction Review using the worksheet/template (Appendix). Treat each auction car on its own.")
H2("Group every auction vehicle by")
bullets(["Auction name","Sale date","Lane","Run number"])
H2("For EACH vehicle, fill in")
table(["Field","Where it comes from"],[
 ["VIN","Run list"],["Year / make / model / trim","Run list / Laser"],["Mileage","Run list"],
 ["Location","Run list / auction"],["Announcements","Run list (very important - damage, title, etc.)"],
 ["Title status","Run list / Carfax"],
 ["JD Clean Trade","Laser (Section 11)"],["JD Full Retail","Laser"],["KBB Lending","Laser"],["Base MMR","Laser"],
 ["Transport estimate","Owner's transport rates by distance"],
 ["Engine cost","Car-Part, ZIP 84101 (Section 13)"],
 ["Transmission cost","Car-Part, ZIP 84101 (Section 13)"],
 ["$1,000 engine labor","Fixed labor reserve for an engine swap (unless owner settings differ)"],
 ["$1,000 transmission labor","Fixed labor reserve for a transmission swap (unless owner settings differ)"],
 ["Engine room","Money left if you replace the ENGINE only (see below)"],
 ["Transmission room","Money left if you replace the TRANSMISSION only"],
 ["Recommendation","Bid / Watch / Pass + a max bid"],
],[1.9*inch,4.4*inch])
H2("The most important rule: engine and transmission are SEPARATE scenarios")
warn("Never add engine repair AND transmission repair on the same car unless the owner asks for a worst-case review. Price the ENGINE scenario by itself, and the TRANSMISSION scenario by itself.")
H3("Engine room (engine scenario)")
body("Engine room = expected exit value - auction fees - transport - title/admin - standard recon - engine part (Car-Part 84101) - $1,000 engine labor - diagnostic reserve - unknown-risk reserve - target profit. If engine room is at or below $0, recommend PASS.")
H3("Transmission room (transmission scenario)")
body("Transmission room = expected exit value - auction fees - transport - title/admin - standard recon - transmission part (Car-Part 84101) - $1,000 transmission labor - diagnostic reserve - unknown-risk reserve - target profit.")
body("Your recommended MAX BID is at or below the room for the problem the car actually has. If a fact is missing, mark it MISSING - do not guess a value.")
shot("Auction run-list source file",
 "The run-list file the owner/auction sent (CSV, Excel, or PDF).",
 "Columns for VIN, year/make/model, mileage, lane, run number, and announcements.",
 "Copy each row's VIN into Laser + Car-Part to fill the worksheet.",
 "Ignoring the announcements column - it can change everything (damage, title, 'as-is').")
shot("Completed Auction Review (owner-ready)",
 "Your finished auction worksheet/template (Appendix).",
 "One row per car grouped by auction/date/lane/run, with all values, engine room, transmission room, and a recommendation + max bid.",
 "Send to the owner for bid approval.",
 "Combining engine + transmission on one car (only do that if the owner asks for worst-case).")
H2("Checklist - auction car")
checks(["Grouped by auction/date/lane/run","VIN + Y/M/M/trim + mileage confirmed","Announcements + title read","JD Clean/Full Retail/KBB/MMR from Laser","Transport estimated","Engine part + Transmission part from Car-Part 84101","Engine room AND transmission room figured SEPARATELY","Recommendation + max bid set","Missing facts marked MISSING","Sent to owner - no bidding without owner-approved max bid"])
example("Auction car: 2016 Escape, announced 'engine knock,' clean title. Exit (JD Full Retail) $11,000. Fees $400, transport $200, title/admin $150, recon $400. Car-Part 84101 engine $2,300, engine labor $1,000, diagnostic $250, unknown-risk $750, target profit $2,000. Engine room = 11,000-400-200-150-400-2,300-1,000-250-750-2,000 = $3,550 max bid. Transmission scenario isn't needed (no trans problem announced).")

# ===== 11. LASER =====
H1("11. Laser Appraiser Workflow (values)")
body("Laser Appraiser gives the book values. CarHunter automatically pulls JD Clean Trade and KBB from Laser through a helper running in your logged-in Laser tab (keep that tab open). You look up JD Full Retail and Base MMR by hand for now.")
warn("Exact Laser buttons/screens can change. Where this says VERIFY LIVE, confirm the real screen in the authorized account and capture the screenshot.")
steps([
 "Open Laser Appraiser and log in (ask the owner for the login).",
 "Keep one Laser tab open all shift - this powers the auto values + the value bridge.",
 "To check a car by hand: search by VIN (paste the VIN you copied from the card).",
 "Confirm year / make / model / trim / mileage / region match the listing (wrong trim = wrong value).",
 "Read JD Clean Trade, JD Full Retail, KBB Lending, and Base MMR.",
 "Enter JD Full Retail and Base MMR into the car's notes in CarHunter, with the source and date.",
])
shot("Laser Appraiser - VIN result with the four values",
 "Laser Appraiser, after searching a real used VIN (VERIFY LIVE).",
 "The JD/NADA Clean Trade, JD/NADA Retail, KBB value, and the Manheim MMR tab.",
 "Copy each value into the car's notes in CarHunter with today's date.",
 "Reading values for the wrong trim/mileage - confirm the vehicle first.")
H2("What to enter into CarHunter")
body("In the car's notes: 'JD Clean $___, JD Retail $___, KBB $___, MMR $___ - Laser, (date).' JD Clean + KBB may already be filled by the bridge; add Retail + MMR.")
H2("What to do if this happens")
bullets([
 "Values are blank on every car: the Laser tab is closed or your Laser session expired. Open/refresh the logged-in Laser tab (Section 17).",
 "Laser says 'security session expired': refresh the Laser page; the auto values resume.",
 "A value looks wrong: re-check trim/mileage/options in Laser. Still odd? mark it and note the conflict.",
 "Laser is down or login fails: mark values MISSING, tell your manager, and do not guess.",
])

# ===== 12. CARFAX / HISTORY =====
H1("12. Carfax / Vehicle-History Workflow")
body("History tells you if the car's past matches the seller's story. Use the VIN.")
steps([
 "Confirm the VIN (17 characters; matches the listing).",
 "Run the history report (Carfax or the approved tool).",
 "Check the title/brand: clean, salvage, rebuilt, flood, lemon?",
 "Check accidents/damage.",
 "Check the mileage history for rollback or gaps.",
 "Check owners and use (personal, fleet, rental).",
 "Compare to the seller's story - do they match?",
 "Grade the history and add notes to CarHunter.",
])
H2("History grade (simple)")
table(["Grade","Means"],[
 ["A","Clean title, no accidents, consistent miles, 1-2 owners."],
 ["B","Clean title, minor issue (small accident or fleet use) - usually fine, note it."],
 ["C","Clean title but real concerns (multiple accidents, odd miles) - escalate."],
 ["Red","Branded/salvage/flood/lemon title, rollback, or major damage - escalate; price on the low basis."],
],[0.8*inch,5.5*inch])
shot("Carfax / history report summary",
 "Carfax (or approved tool), after running a real VIN (VERIFY LIVE).",
 "Title brand line, accident count, mileage history, number of owners.",
 "Write the grade (A/B/C/Red) + key facts into the car's notes.",
 "Trusting the seller over the report - the report wins; log any mismatch.")
example("Seller says 'never wrecked, one owner.' Carfax shows 2 accidents and 3 owners. That's a mismatch - grade C, note it, and tell the owner before anyone drives out.")

# ===== 13. CAR-PART =====
H1("13. Car-Part Workflow (repair part prices)")
body("Car-Part.com tells you what a used engine or transmission really costs locally. Use it for mechanic specials and auction cars.")
steps([
 "Go to https://www.car-part.com/index.html.",
 "Search using ZIP 84101 (our local search ZIP).",
 "Pick the year/make/model and choose the part: Engine (search engines).",
 "Find the cheapest MATCHING part (right engine size/fitment).",
 "Record: price, vendor name, vendor location, the part's mileage, warranty, and today's date.",
 "Repeat for the Transmission (search transmissions).",
 "Note any fitment concerns (wrong engine size, sub-model differences).",
 "Put the engine price into the ENGINE scenario and the transmission price into the TRANSMISSION scenario (keep them separate - Section 10).",
])
shot("Car-Part.com search results (ZIP 84101)",
 "car-part.com, after searching a real engine or transmission with ZIP 84101.",
 "The results list: price, yard/vendor, location/distance, the part's mileage, and warranty.",
 "Pick the cheapest part that truly fits; copy its details into the worksheet.",
 "Grabbing a cheaper part that is the wrong engine size/fitment.")
H2("What to do if this happens")
bullets([
 "No Utah/local result: widen the search area or note 'no local part - shipping needed' and use the next closest; mark confidence Low.",
 "Prices vary a lot: use a mid price for the math, keep the high one as a safety check.",
 "Don't forget core charge + shipping in the part cost.",
])
print("sections 9-13 done")

# ===== 14. SELLER MESSAGING =====
H1("14. Seller Messaging (scripts)")
body("Keep messages short, polite, and local-sounding. Ask for the appointment quickly. Ask title + condition clearly. No pressure, no false claims. Log EVERY message you send and EVERY reply.")
def script_line(label, text): H3(label); E.append(Paragraph(esc(text),EXS)); md("> "+text)
script_line("First message","Hi, is your {year} {make} {model} still available? I'm a local buyer and can come take a look today or tomorrow if that works.")
script_line("Ask VIN","Could you share the VIN? I just want to check the details/history before I drive out so I don't waste your time.")
script_line("Ask title","Is the title clean and in hand, or is it branded/salvage?")
script_line("Ask condition","How long have you owned it, and is there anything wrong that's not in the listing - mechanical, accidents, warning lights?")
script_line("Ask engine issue","I understand it may have engine trouble - that's okay, I buy those. Does it start at all, any knocking or overheating?")
script_line("Ask transmission issue","Does it drive and shift okay? Does reverse work, any slipping?")
script_line("Follow-up","Hey, just following up on the {make} {model} - still available? Happy to come look whenever works.")
script_line("Polite pass","Thanks for the details and your time - it's not the right fit for me right now. Good luck with the sale!")
H2("Logging rule")
bullets(["Log each message you send (with time).","Log each reply with the facts: ownership, issues, title status, VIN, why selling.","If they go quiet, follow up once, then set Watch or Dead with a reason."])

# ===== 15. OWNER PACKET =====
H1("15. Owner Packet Workflow")
body("When a deal is strong, risky, big, or you're unsure, package it for the owner so they can decide fast. Put ALL of this in the packet:")
bullets(["Vehicle summary (year/make/model/trim, miles, location)","Values (JD Clean, JD Full Retail, KBB, Base MMR - each with source + date)",
 "History (Carfax grade + key facts)","Title status","Seller story (short summary + any price)","Repair math (engine room / transmission room if it's a mechanic special - separate scenarios)",
 "Gaps (anything still MISSING)","Your recommendation","The EXACT decision you're asking for (e.g., 'Approve buy up to $7,800?')"])
shot("Where to send the owner packet",
 "There is no owner-review screen in the app yet. Capture the channel you actually use (the car's notes + the owner's text/Slack/email).",
 "The packet template filled in (Appendix) and the message to the owner.",
 "Send it to the owner and log that you escalated + when.",
 "Sending a vague 'what do you think?' - always include a clear recommendation + the exact ask.")
example("'2023 Silverado 2500 LS, 105k mi, North SLC. Ask $15,000. JD Clean $34,000 / JD Retail ~$38,000 / KBB $28,000 / MMR (pending) - Laser 6/21. Recon $400, fees $400, est profit ~$19,000, score 100. Carfax: clean title, no accidents (grade A). Seller responsive, title in hand. Recommend: approve buy up to $16,000 pending test drive. Decision requested: approve max $16,000?'")

# ===== 16. STATUS AND NOTES =====
H1("16. Status and Notes")
H2("What each status means")
table(["Status","Use it when"],[
 ["New","Just arrived; not worked yet."],["Triage","You're reviewing it now."],["Need VIN","Good car but VIN missing - asking seller."],
 ["Contacted","You messaged the seller."],["Waiting reply","Message sent, no answer yet."],["Owner review","Sent to owner for a decision."],
 ["Inspection scheduled","A time is set to see the car."],["Watch","Maybe later (price too high / another buyer)."],
 ["Dead","Not happening - always add a reason."],["Bought","We bought it."],["Missed","A good one sold before we acted - add why."],
],[1.5*inch,4.8*inch])
H2("Good notes vs bad notes")
bullets(["BAD: 'Looks good.' (tells no one anything)",
 "GOOD: 'VIN verified; JD Clean $9,800; Carfax clean title, no accidents (A); 78k mi consistent; seller says title in hand; asking $6,500.'"])
body("Every open car needs a status AND a next action. Every Dead/Missed needs a reason so we learn.")

# ===== 17. TROUBLESHOOTING =====
H1("17. Troubleshooting - What To Do If This Happens")
def tb(prob, fix): H3(prob); body(fix)
tb("CarHunter won't load","Refresh (F5). Try another browser. Check internet. Down more than ~15 min? Tell your manager and work your existing leads/follow-ups meanwhile.")
tb("Feed is not updating (no new cars)","Confirm the Laser tab/value bridge is running (Section 11). If still nothing new for 30+ min, tell your manager - it may be the scraper or the Bright Data token.")
tb("A lead is missing data","Fill what you can from Laser/Carfax/the listing. Mark anything you can't confirm as MISSING. Don't guess.")
tb("Values are missing on every car","The Laser tab is closed or the session expired. Open/refresh the logged-in Laser tab. Still blank? Tell your manager.")
tb("Laser login fails","Re-check the login; is the subscription active? Try once more. Unresolved? Escalate to the owner - don't guess values.")
tb("Carfax unavailable","Note 'history not available' and proceed carefully; don't present unverified history as clean. Escalate big deals.")
tb("Auction file won't open/parse","Work it by hand into the worksheet (Section 10). Note which rows were manual.")
tb("Car-Part has no Utah result","Widen the area or note 'no local part - shipping needed,' use the next closest, mark confidence Low, raise the unknown-risk reserve.")
tb("Score looks wrong","Check the values + trim/mileage (wrong trim = wrong value). If values are right but the score seems off, tell your manager.")
tb("Seller changes their story","Log exactly what changed. Trust the history/VIN over the story. Escalate before any money moves.")
tb("Owner is unreachable","Follow the owner's standing rule. If there is none and it's a buy/bid decision, do NOT commit - wait.")
tb("You made a mistake","Stop. Log exactly what happened and tell your manager right away. Never hide it - fixing fast is what matters.")

# ===== 18. TRAINING PLAN =====
H1("18. New-Employee Training Plan (7 days)")
table(["Day","Focus"],[
 ["Day 1","Software overview - open the app, learn the tabs/filters, read cards (Sections 3-7)."],
 ["Day 2","Lead review - work 10 private-party leads end to end (Section 8)."],
 ["Day 3","Laser and values - set up/confirm the Laser tab; pull JD Clean/Retail/KBB/MMR on 5 cars (Section 11)."],
 ["Day 4","Carfax / history - run 5 VINs, grade A/B/C/Red, write notes (Section 12)."],
 ["Day 5","Seller scripts - send and log real messages; practice the follow-up + pass (Section 14)."],
 ["Day 6","Auction run lists - build 2 auction reviews with engine room + transmission room (Sections 10, 13)."],
 ["Day 7","Owner packets + troubleshooting - build 2 packets; walk every failure (Sections 15, 17). Certify."],
],[0.7*inch,5.6*inch])

# ===== 19. CERTIFICATION =====
H1("19. Certification Checklist")
body("You're certified to run the desk when you can do ALL of these without help:")
checks(["Work a private-party lead end to end","Work an auction run list (separate engine vs transmission scenarios)","Pull values from Laser (JD Clean, JD Full Retail, KBB, MMR)",
 "Check history on Carfax and grade it","Use Car-Part with ZIP 84101 for engine + transmission prices","Identify gaps and mark them MISSING",
 "Prepare a complete owner packet with the exact ask","Write good notes and set the right status","Troubleshoot a failure using a logged fallback","Follow the approval rules (never buy/bid without owner OK)"])
body("Employee __________  Manager __________  Date __________")

# ===== 20. APPENDIX =====
H1("20. Appendix - Templates, Scripts, Glossary")
H2("Glossary (plain English)")
table(["Term","Means"],[
 ["VIN","17-character Vehicle ID. The car's fingerprint - used for values + history."],
 ["JD Clean Trade","J.D. Power 'clean' trade-in value - a wholesale-ish number."],
 ["JD Full Retail","J.D. Power retail value - what it sells for retail."],
 ["KBB Lending","A Kelley Blue Book value used as a wholesale reference."],
 ["Base MMR","Manheim Market Report - the auction (wholesale) benchmark."],
 ["Deal Score","0-100 rating of how good the deal is (higher = better)."],
 ["HOT / Contact Now","About $1,000+ under BOTH books - act fast."],
 ["Recon","Reconditioning - the cost to get a car sale-ready."],
 ["Mechanic special","A car with a known engine/transmission/other major problem."],
 ["Branded title","Salvage/rebuilt/flood/lemon title - worth much less."],
 ["Engine room / Trans room","Money left after replacing the engine (or transmission) only."],
 ["Laser Appraiser","Outside tool that gives the book values."],
 ["Car-Part","Outside site for used engine/transmission prices (we use ZIP 84101)."],
 ["Carfax","Outside vehicle-history report."],
],[1.5*inch,4.8*inch])
H2("Copy/paste scripts")
body("First / VIN / Title / Condition / Engine / Transmission / Follow-up / Pass - see Section 14 (copy from there).")
H2("Owner Packet template")
body("Vehicle: {yr make model trim} | Miles ___ | Location ___ | Ask $___ | JD Clean $___ / JD Retail $___ / KBB $___ / MMR $___ (Laser, date) | Recon $___ | Fees $___ | Est profit $___ | Score ___ | Carfax grade ___ (facts) | Title ___ | Seller story ___ | Repair: engine room $___ / trans room $___ | Gaps: ___ | Recommendation: ___ | DECISION REQUESTED: ___")
H2("Auction Review template (one row per car)")
body("Auction ___ | Date ___ | Lane ___ | Run ___ | VIN ___ | Y/M/M/trim ___ | Miles ___ | Announcements ___ | Title ___ | JD Clean $___ | JD Retail $___ | KBB $___ | MMR $___ | Transport $___ | Engine part (CarPart 84101) $___ + $1,000 labor -> ENGINE ROOM $___ | Trans part (CarPart 84101) $___ + $1,000 labor -> TRANS ROOM $___ | Recommendation + MAX BID ___")
H2("Laser value note template")
body("JD Clean $___ / JD Retail $___ / KBB $___ / MMR $___ - Laser, (date). Trim/mileage confirmed: yes/no.")
H2("Carfax note template")
body("Grade A/B/C/Red. Title ___ | Accidents ___ | Mileage consistent? ___ | Owners ___ | Matches seller story? ___")
H2("Incident log template")
body("Date/time ___ | What broke ___ | What I did ___ | Manual fallback used ___ | Notified ___ | Resolved? ___")
H2("Daily handoff template")
body("Date ___ | HOT worked ___ | Owner packets sent ___ | Waiting on seller ___ | Auction reviews in progress ___ | Anything broken ___ | Top 3 to chase tomorrow ___")

# ===== FINAL REVIEW PAGE =====
H1("Final Review (read before your first solo shift)")
checks(["I can open the app and read the feed","Every workflow above has clear steps","I know the fallback for each failure (Section 17)",
 "I will never present unverified data as real","I will never buy or bid without the owner's OK","I treat auction run lists separately from feed leads, with engine and transmission as SEPARATE scenarios"])

# ===================== BUILD =====================
def footer(canvas, doc):
    canvas.saveState(); canvas.setFont("Helvetica",7.5); canvas.setFillColor(colors.HexColor("#999"))
    canvas.drawString(0.7*inch,0.35*inch,"CarHunter Software Training Manual"); canvas.drawRightString(7.8*inch,0.35*inch,"Page %d"%doc.page)
    canvas.restoreState()
SimpleDocTemplate(PDF,pagesize=letter,leftMargin=0.7*inch,rightMargin=0.7*inch,topMargin=0.7*inch,bottomMargin=0.6*inch,
                  title="CarHunter Software Training Manual").build(E,onFirstPage=footer,onLaterPages=footer)
open(MDP,"w").write("\n".join(MD))
# missing-screenshots list
lines=["# Screenshots needed for the CarHunter Training Manual","",
 "No screenshots could be captured automatically in the build environment (no browser available).",
 "Capture each of these from the live software/tools and drop them into this folder, then place them in the manual.",""]
for i,(t,w) in enumerate(SHOTS,1): lines.append(f"{i}. **{t}** — {w}")
open("/home/user/ssfinal/docs/screenshots/README.md","w").write("\n".join(lines)+"\n")
print("WROTE PDF:",PDF); print("WROTE MD:",MDP); print("SHOTS needed:",len(SHOTS))
