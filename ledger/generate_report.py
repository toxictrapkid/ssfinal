#!/usr/bin/env python3
"""
MO / Z PARTNERSHIP LEDGER REPORT — deterministic report generator.

This script is the single source of truth for the partner-facing ledger PDF.
Every derived figure (total cost, profit, profit split, Mo/Z take-home, and the
running partnership balance) is computed here from raw inputs and then asserted
against the numbers supplied in the source ledger. If any computed figure does
not match the source, the script raises AssertionError and refuses to emit the
report — so the PDF can never silently contain bad arithmetic.

Ledger rule (used everywhere):
    Positive running balance  ->  Z owes Mo
    Negative running balance  ->  Mo owes Z

Output: writes ledger_report.html next to this file.
"""

from __future__ import annotations
import html

# --------------------------------------------------------------------------- #
#  Formatting helpers                                                          #
# --------------------------------------------------------------------------- #

def money(x) -> str:
    """Format a number as $#,##0.00 (parentheses for negatives)."""
    if x is None:
        return "&mdash;"
    neg = x < 0
    s = f"${abs(x):,.2f}"
    return f"(-{s})" if neg else s


def money0(x) -> str:
    """Money with no cents when the value is whole, else 2 decimals."""
    if x is None:
        return "&mdash;"
    if abs(x - round(x)) < 1e-9:
        return f"${x:,.0f}"
    return f"${x:,.2f}"


def approx(a, b, tol=0.005) -> bool:
    return abs(a - b) <= tol


def check(label, computed, expected):
    """Assert computed == expected (within a cent). Returns computed."""
    if expected is None:
        return computed
    assert approx(computed, expected), (
        f"MATH MISMATCH [{label}]: computed {computed:,.2f} "
        f"!= source {expected:,.2f}"
    )
    return computed


def esc(s) -> str:
    return html.escape(str(s))


# --------------------------------------------------------------------------- #
#  Balance-label helper                                                        #
# --------------------------------------------------------------------------- #

def balance_label(bal) -> str:
    if bal > 1e-9:
        return f"Z Owes Mo {money(bal)}"
    if bal < -1e-9:
        return f"Mo Owes Z {money(-bal)}"
    return "Settled — $0.00"


def balance_word(bal) -> str:
    if bal > 1e-9:
        return "Owed to Mo"
    if bal < -1e-9:
        return "Mo Owes Z"
    return "Settled"


# --------------------------------------------------------------------------- #
#  Running balance engine                                                      #
# --------------------------------------------------------------------------- #

class Ledger:
    def __init__(self):
        self.balance = 0.0
        self.chain = []          # list of dicts for the reconciliation table
        self.sections_html = []  # per-transaction HTML blocks

    def apply(self, name, delta, expected_new=None, note=""):
        prev = self.balance
        self.balance += delta
        check(f"running balance after {name}", self.balance, expected_new)
        self.chain.append({
            "name": name,
            "prev": prev,
            "delta": delta,
            "new": self.balance,
            "note": note,
        })
        return prev, self.balance


L = Ledger()

# Fixed wording required throughout the report.
Z_FRONT = "Z paid for Mo&rsquo;s 50% share of the purchase."


# --------------------------------------------------------------------------- #
#  Small HTML builders                                                         #
# --------------------------------------------------------------------------- #

def expense_table(rows):
    """rows: list of (label, amount, payer)."""
    body = []
    for label, amt, payer in rows:
        cls = {
            "Mo": "pay-mo",
            "Z": "pay-z",
            "Other": "pay-other",
        }.get(payer, "")
        body.append(
            f'<tr><td>{label}</td>'
            f'<td class="num">{money0(amt)}</td>'
            f'<td class="{cls}">{payer_label(payer)}</td></tr>'
        )
    total = sum(a for _, a, _ in rows)
    body.append(
        f'<tr class="tot"><td>Total Listed Expenses</td>'
        f'<td class="num">{money0(total)}</td><td></td></tr>'
    )
    return (
        '<table class="grid exp"><thead><tr>'
        '<th>Expense</th><th class="num">Amount</th>'
        '<th>Paid By / Assigned To</th></tr></thead><tbody>'
        + "".join(body) + "</tbody></table>"
    )


def payer_label(p):
    return {
        "Mo": "Mo",
        "Z": "Z (Zaki)",
        "Other": "Third party (listed separately)",
    }.get(p, p)


def takehome_table(title, rows, total, cls):
    body = []
    for label, amt in rows:
        body.append(
            f'<tr><td>{label}</td><td class="num">{money0(amt)}</td></tr>'
        )
    body.append(
        f'<tr class="tot"><td>{title} Total Take-Home</td>'
        f'<td class="num">{money0(total)}</td></tr>'
    )
    return (
        f'<table class="grid th {cls}"><thead><tr>'
        f'<th colspan="2">{title} Take-Home</th></tr></thead><tbody>'
        + "".join(body) + "</tbody></table>"
    )


def kv_table(rows):
    body = "".join(
        f'<tr><td>{k}</td><td class="num">{v}</td></tr>' for k, v in rows
    )
    return f'<table class="grid kv"><tbody>{body}</tbody></table>'


def running_box(name, prev, delta, new):
    op = "+" if delta >= 0 else "&minus;"
    return f'''
    <div class="runbox">
      <div class="runrow"><span>Previous Balance</span>
        <span class="num">{balance_label(prev)}</span></div>
      <div class="runrow"><span>Transaction Impact</span>
        <span class="num">{op} {money(abs(delta))}</span></div>
      <div class="runrow new"><span>New Running Balance</span>
        <span class="num">{balance_label(new)}</span></div>
    </div>'''


def note_box(text):
    return f'<div class="note"><span class="note-tag">AUDIT NOTE</span> {text}</div>'


def section_open(idx, title, lead=None):
    lead_html = f'<p class="lead">{lead}</p>' if lead else ''
    return (f'<section class="txn"><div class="txn-head">'
            f'<h2><span class="txn-idx">{idx}</span> {esc(title)}</h2>'
            f'{lead_html}</div>')


def sub(letter, title):
    return f'<h3><span class="sub-letter">{letter}</span> {esc(title)}</h3>'


# --------------------------------------------------------------------------- #
#  Transaction 1 — Mitsubishi + Q50 (take-home only entries)                   #
# --------------------------------------------------------------------------- #
def txn_mitsubishi_q50(idx):
    mits = 4635.0
    q50 = 4781.0
    total = check("Mitsubishi+Q50 Mo total", mits + q50, 9416.0)
    prev, new = L.apply("Mitsubishi + Q50", total, 9416.0)
    h = [section_open(idx, "Mitsubishi + Q50",
         "Two completed vehicles carried into this ledger as Mo take-home amounts. "
         "These establish the opening amount owed to Mo.")]
    h.append(sub("A", "Take-Home Summary"))
    h.append(kv_table([
        ("Mitsubishi &mdash; Mo Take-Home", money0(mits)),
        ("Q50 &mdash; Mo Take-Home", money0(q50)),
        ("Combined Mo Take-Home", f"<b>{money0(total)}</b>"),
    ]))
    h.append(note_box("Z take-home for the Mitsubishi and Q50 is "
                      "<b>not explicitly stated in the source ledger</b>. Only the "
                      "Mo take-home figures were provided, so no Z figure is shown."))
    h.append(sub("F", "Running Balance"))
    h.append(running_box("Mitsubishi + Q50", prev, total, new))
    h.append("</section>")
    return "".join(h)


# --------------------------------------------------------------------------- #
#  Transaction 2 — Impala (Z funded full purchase)                             #
# --------------------------------------------------------------------------- #
def txn_impala(idx):
    purchase = 2380.0
    each = check("Impala each half", purchase / 2, 1190.0)
    exp = [("Zaki", 44.0, "Z"), ("Mo", 70.0, "Mo")]
    total_cost = check("Impala total cost", purchase + sum(a for _, a, _ in exp), 2494.0)
    sold = 5900.0
    profit = check("Impala profit", sold - total_cost, 3406.0)
    peach = check("Impala profit each", profit / 2, 1703.0)
    mo_exp = 70.0
    mo_added = check("Impala Mo added", peach + mo_exp, 1773.0)
    z_total = check("Impala Z total", purchase + 44.0 + peach, 4127.0)

    prev, new = L.apply("Impala", mo_added, 11189.0)

    h = [section_open(idx, "Impala")]
    h.append(sub("A", "Purchase Details"))
    h.append(kv_table([
        ("Purchase Price", money0(purchase)),
        ("Ownership Split", "50 / 50"),
        ("Each Partner&rsquo;s Half", money0(each)),
        ("Funding", "Z paid for the entire purchase (including Mo&rsquo;s half)."),
    ]))
    h.append(sub("B", "Expense Breakdown"))
    h.append(expense_table(exp))
    h.append(sub("C", "Sale Details"))
    h.append(kv_table([
        ("Sold For", money0(sold)),
        ("Total Cost (purchase + expenses)", money0(total_cost)),
        ("Total Profit", money0(profit)),
        ("Profit Split (each)", money0(peach)),
    ]))
    h.append(sub("D", "Mo Take-Home"))
    h.append('<p class="lead">Z funded the full purchase, so Mo&rsquo;s car half nets '
             'to zero against the funding. Mo is credited his profit share plus his '
             'own reimbursable expense.</p>')
    h.append(takehome_table("Mo", [
        ("Profit Half", peach),
        ("Mo Expense Reimbursement", mo_exp),
    ], mo_added, "mo"))
    h.append(sub("E", "Z Take-Home"))
    h.append(takehome_table("Z", [
        ("Purchase Reimbursement", purchase),
        ("Z Expense Reimbursement", 44.0),
        ("Profit Half", peach),
    ], z_total, "z"))
    h.append(sub("F", "Running Balance"))
    h.append('<p class="lead">Balance impact is Mo&rsquo;s net addition of '
             f'{money0(mo_added)} (profit half + Mo expense).</p>')
    h.append(running_box("Impala", prev, mo_added, new))
    h.append("</section>")
    return "".join(h)


# --------------------------------------------------------------------------- #
#  Generic purchase (Z fronts Mo's half -> balance decreases)                  #
# --------------------------------------------------------------------------- #
def txn_purchase(idx, title, lines, total_purchase, each_half,
                 expected_new, gas=None, extra_note=None, lead=None):
    check(f"{title} each half", total_purchase / 2, each_half)
    prev, new = L.apply(title, -each_half, expected_new)
    h = [section_open(idx, title, lead)]
    h.append(sub("A", "Purchase Details"))
    if len(lines) > 1:
        rows = []
        for nm, pt in lines:
            if pt is None:
                rows.append((nm,
                             '<span class="small">not explicitly stated in source ledger</span>',
                             '<span class="small">&mdash;</span>'))
            else:
                rows.append((nm, money0(pt), money0(pt / 2)))
        body = "".join(
            f'<tr><td>{esc(nm)}</td><td class="num">{pt}</td>'
            f'<td class="num">{pe}</td></tr>' for nm, pt, pe in rows)
        h.append(
            '<table class="grid"><thead><tr><th>Vehicle</th>'
            '<th class="num">Purchase</th><th class="num">Each Half</th>'
            '</tr></thead><tbody>' + body +
            f'<tr class="tot"><td>Total Purchase</td><td class="num">{money0(total_purchase)}</td>'
            f'<td class="num">{money0(each_half)}</td></tr></tbody></table>')
    else:
        kv = [("Total Purchase", money0(total_purchase))]
        if gas is not None:
            kv = [("Purchase Price", money0(total_purchase - gas)),
                  ("Gas", money0(gas)),
                  ("Total Cost", money0(total_purchase))]
        kv += [("Ownership Split", "50 / 50"),
               ("Each Partner&rsquo;s Half", money0(each_half))]
        h.append(kv_table(kv))
    h.append(f'<div class="front">{Z_FRONT}</div>')
    if extra_note:
        h.append(note_box(extra_note))
    h.append(sub("F", "Running Balance"))
    h.append('<p class="lead">Z paid for Mo&rsquo;s 50% share of the purchase, so the '
             f'balance moves toward Mo by {money0(each_half)}.</p>')
    h.append(running_box(title, prev, -each_half, new))
    h.append("</section>")
    return "".join(h)


# --------------------------------------------------------------------------- #
#  Generic sale                                                                #
# --------------------------------------------------------------------------- #
def txn_sale(idx, title, purchase_total, expenses, sold_for,
             exp_total, profit_v, profit_each_v,
             mo_total_v, z_total_v, expected_new,
             z_other_note=None, lead=None, extra_rows=None,
             adjustments=None, expected_new_after_adj=None):
    each = purchase_total / 2
    total_cost = check(f"{title} total cost",
                       purchase_total + sum(a for _, a, _ in expenses), exp_total)
    profit = check(f"{title} profit", sold_for - total_cost, profit_v)
    peach = check(f"{title} profit each", profit / 2, profit_each_v)

    mo_exp = sum(a for _, a, p in expenses if p == "Mo")
    z_exp = sum(a for _, a, p in expenses if p == "Z")
    other_exp = sum(a for _, a, p in expenses if p == "Other")

    mo_total = check(f"{title} Mo take-home", each + mo_exp + peach, mo_total_v)
    z_total = check(f"{title} Z take-home", each + z_exp + peach, z_total_v)

    prev, new = L.apply(title, mo_total, expected_new)

    h = [section_open(idx, title, lead)]
    h.append(sub("A", "Purchase Details"))
    h.append(kv_table([
        ("Purchase Price", money0(purchase_total)),
        ("Ownership Split", "50 / 50"),
        ("Each Partner&rsquo;s Car Half", money0(each)),
    ]))
    h.append(sub("B", "Expense Breakdown"))
    h.append(expense_table(expenses))
    h.append(sub("C", "Sale Details"))
    h.append(kv_table([
        ("Sold For", money0(sold_for)),
        ("Total Cost (purchase + expenses)", money0(total_cost)),
        ("Total Profit", money0(profit)),
        ("Profit Split (each)", money0(peach)),
    ]))
    h.append(sub("D", "Mo Take-Home"))
    mo_rows = [("Car Half", each)]
    if mo_exp:
        mo_rows.append(("Mo Expense Reimbursement", mo_exp))
    mo_rows.append(("Profit Half", peach))
    h.append(takehome_table("Mo", mo_rows, mo_total, "mo"))
    h.append(sub("E", "Z Take-Home"))
    z_rows = [("Car Half", each)]
    if z_exp:
        z_rows.append(("Z Expense Reimbursement", z_exp))
    z_rows.append(("Profit Half", peach))
    h.append(takehome_table("Z", z_rows, z_total, "z"))
    if other_exp and z_other_note:
        h.append(note_box(z_other_note))
    elif z_other_note:
        h.append(note_box(z_other_note))
    h.append(sub("F", "Running Balance"))
    h.append('<p class="lead">The car sale credits Mo his take-home of '
             f'{money0(mo_total)}; the balance moves toward Mo by that amount.</p>')
    h.append(running_box(title, prev, mo_total, new))

    # Optional post-sale adjustments (Nissan Rogue sold).
    if adjustments:
        adj_total = sum(a for _, a in adjustments)
        p2, n2 = L.apply(f"{title} — Adjustments", adj_total, expected_new_after_adj,
                         note="post-sale adjustments")
        h.append(sub("G", "Post-Sale Adjustments"))
        body = "".join(
            f'<tr><td>{esc(k)}</td><td class="num">{"+" if v>=0 else "&minus;"} '
            f'{money0(abs(v))}</td></tr>' for k, v in adjustments)
        h.append('<table class="grid kv"><tbody>' + body +
                 f'<tr class="tot"><td>Net Adjustment</td>'
                 f'<td class="num">{"+" if adj_total>=0 else "&minus;"} '
                 f'{money0(abs(adj_total))}</td></tr></tbody></table>')
        h.append(running_box(f"{title} adjustments", p2, adj_total, n2))

    h.append("</section>")
    return "".join(h)


# --------------------------------------------------------------------------- #
#  Cash paid to Mo                                                             #
# --------------------------------------------------------------------------- #
def txn_cash(idx, title, rows, expected_new, lead=None):
    total = sum(a for _, a in rows)
    prev, new = L.apply(title, -total, expected_new)
    h = [section_open(idx, title, lead)]
    h.append(sub("A", "Cash Disbursement"))
    body = "".join(
        f'<tr><td>{esc(k)}</td><td class="num">{money0(v)}</td></tr>'
        for k, v in rows)
    h.append('<table class="grid kv"><tbody>' + body +
             f'<tr class="tot"><td>Total Paid to Mo</td>'
             f'<td class="num">{money0(total)}</td></tr></tbody></table>')
    h.append('<p class="lead">Cash paid directly to Mo reduces the amount Z owes Mo.</p>')
    h.append(sub("F", "Running Balance"))
    h.append(running_box(title, prev, -total, new))
    h.append("</section>")
    return "".join(h)


# =========================================================================== #
#  BUILD THE CHRONOLOGICAL LEDGER                                             #
# =========================================================================== #
S = L.sections_html

S.append(txn_mitsubishi_q50(1))
S.append(txn_impala(2))

S.append(txn_purchase(
    3, "2016 Nissan Rogue — Purchased",
    [("2016 Nissan Rogue", 9150.0)], 9150.0, 4575.0, 6614.0,
    lead="A single vehicle purchased for the partnership."))

S.append(txn_purchase(
    4, "Explorer / Pacifica / Buick — Purchased",
    [("Explorer / Pacifica / Buick (bundle)", 24075.0)], 24075.0, 12037.50, -5423.50,
    lead="Three vehicles acquired together as a bundle."))

S.append(txn_sale(
    5, "Explorer — Sold",
    10860.0,
    [("Talon", 50.0, "Z"), ("Gas", 30.0, "Z")],
    16500.0, 10940.0, 5560.0, 2780.0, 8210.0, 8290.0, 2786.50,
    lead="First sale from the Explorer / Pacifica / Buick bundle."))

S.append(txn_sale(
    6, "2016 Nissan Rogue — Sold",
    9150.0,
    [("Mo", 586.0, "Mo")],
    11800.0, 9736.0, 2064.0, 1032.0, 6193.0, 5607.0, 8979.50,
    adjustments=[("GLE Commission", 250.0), ("Insurance", -110.0), ("Carfax", -100.0)],
    expected_new_after_adj=9019.50,
    lead="Sale of the Rogue purchased in transaction 3, followed by three "
         "miscellaneous adjustments recorded against the partnership balance."))

S.append(txn_purchase(
    7, "Equinox — Purchased",
    [("Equinox", 5169.0)], 5169.0, 2584.50, 6435.0))

S.append(txn_sale(
    8, "Buick — Sold",
    5690.0,
    [("Mo", 750.0, "Mo"), ("Zaki", 100.0, "Z"), ("Drako", 625.0, "Other")],
    8000.0, 7165.0, 835.0, 417.50, 4012.50, 3362.50, 10447.50,
    z_other_note="<b>Drako &mdash; $625.00</b> is included in Total Cost (it reduced the "
                 "profit) but the source ledger does <b>not</b> reimburse it in either "
                 "partner&rsquo;s take-home, so it is listed separately here and not "
                 "hidden. If it were treated as a Z-paid expense (the standard rule), "
                 "Z&rsquo;s take-home would be $3,987.50; the report preserves the source "
                 "figure of $3,362.50."))

S.append(txn_purchase(
    9, "Jeep + 2021 Nissan Rogue — Purchased",
    [("Jeep", None), ("2021 Nissan Rogue", None)], 21850.0, 10925.0, -477.50,
    lead="Two vehicles acquired together for a combined $21,850. Individual "
         "prices are not itemized in the source ledger."))

S.append(txn_sale(
    10, "Pacifica — Sold",
    7525.0,
    [("Mo", 1101.0, "Mo"), ("Zaki / Drako", 1737.0, "Z")],
    15300.0, 10363.0, 4937.0, 2468.50, 7332.0, 7968.0, 6854.50,
    lead="Second sale from the Explorer / Pacifica / Buick bundle."))

S.append(txn_sale(
    11, "Jeep Cherokee — Sold",
    9900.0,
    [("Gas", 30.0, "Z"), ("Car Wash", 15.0, "Z"), ("Lyft", 60.0, "Z")],
    10750.0, 10005.0, 745.0, 372.50, 5322.50, 5427.50, 12177.0))

S.append(txn_purchase(
    12, "Sportage / Escape / Subaru / Edge / Tucson — Purchased",
    [("Kia Sportage", 3700.0), ("Ford Escape", 4300.0), ("Subaru", 5750.0),
     ("Ford Edge", 17000.0), ("Hyundai Tucson", 6900.0)],
    37650.0, 18825.0, -6648.0,
    lead="A five-vehicle bulk purchase."))

S.append(txn_sale(
    13, "Equinox — Sold",
    5169.0,
    [("Tow x2", 200.0, "Z"), ("Oil Change", 40.0, "Z"), ("Gas", 50.0, "Z"),
     ("Mo", 418.0, "Mo"), ("Lyft", 60.0, "Z")],
    6100.0, 5937.0, 163.0, 81.50, 3084.0, 3016.0, -3564.0))

S.append(txn_sale(
    14, "2021 Nissan Rogue — Sold",
    11950.0,
    [("Tow x2", 200.0, "Z"), ("Drako", 50.0, "Z"), ("Headrests", 75.0, "Z"),
     ("Filter / Gasket", 88.0, "Z"), ("AutoZone", 31.0, "Z"), ("Mo", 929.0, "Mo")],
    14250.0, 13323.0, 927.0, 463.50, 7367.50, 6882.50, 3803.50,
    z_other_note="All non-Mo expenses ($444.00 total: Tow, Drako, Headrests, "
                 "Filter/Gasket, AutoZone) are treated as Z-paid per the standard rule. "
                 "&ldquo;Drako&rdquo; is a named payee; the source ledger includes it in "
                 "the Z-paid group, so it is reimbursed to Z here. If Drako were paid by "
                 "someone else, that $50 would be broken out separately."))

S.append(txn_sale(
    15, "Subaru Outback — Sold",
    5750.0,
    [("Camera", 171.0, "Z"), ("Gas", 15.0, "Z"), ("OBD Scanner", 80.0, "Z"),
     ("Tow", 100.0, "Z"), ("Lyft", 35.0, "Z"), ("Glue", 15.0, "Z"),
     ("Taylor", 83.0, "Z"), ("Lyft", 30.0, "Z"), ("Mo", 132.0, "Mo")],
    7400.0, 6411.0, 989.0, 494.50, 3501.50, 3898.50, 7305.0))

S.append(txn_cash(
    16, "Cash Paid to Mo",
    [("6/15", 2000.0), ("6/17", 2000.0)], 3305.0))

S.append(txn_sale(
    17, "Kia Sportage — Sold",
    3700.0,
    [("Engine", 2420.0, "Z"), ("Gas", 25.0, "Z"), ("Tito Labor", 922.0, "Z"),
     ("Luis Windshield", 450.0, "Z"), ("Gas", 20.0, "Z"), ("Mo", 130.0, "Mo")],
    11500.0, 7667.0, 3833.0, 1916.50, 3896.50, 7603.50, 7201.50,
    z_other_note="All non-Mo expenses ($3,837.00 total) are treated as Z-paid per the "
                 "standard rule. &ldquo;Tito Labor&rdquo; ($922) and &ldquo;Luis "
                 "Windshield&rdquo; ($450) are named vendors/payees, not the payer; the "
                 "source ledger groups them with Z-paid costs. If Tito or Luis were paid "
                 "directly by someone else, those amounts would be listed separately."))

S.append(txn_sale(
    18, "Ford Escape — Sold",
    4300.0,
    [("Paint", 360.0, "Z"), ("Emissions", 35.0, "Z"),
     ("Lee&rsquo;s Marketplace", 7.0, "Z"), ("Mo", 81.0, "Mo")],
    6500.0, 4783.0, 1717.0, 858.50, 3089.50, 3410.50, 10291.0))

S.append(txn_sale(
    19, "Hyundai Tucson — Sold",
    6900.0,
    [("Taylor", 200.0, "Z"), ("AC Compressor", 233.96, "Z"),
     ("Wheel Bearing", 170.0, "Z"), ("Tito", 250.0, "Z"),
     ("Angela — Starbucks", 30.0, "Z"), ("Lyft", 79.0, "Z"), ("Mo", 89.0, "Mo")],
    8800.0, 7951.96, 848.04, 424.02, 3963.02, 4836.98, 14254.02,
    z_other_note="All non-Mo expenses ($962.96 total) are treated as Z-paid per the "
                 "standard rule. &ldquo;Taylor&rdquo; ($200), &ldquo;Tito&rdquo; ($250) "
                 "and &ldquo;Angela &mdash; Starbucks&rdquo; ($30) are named payees; the "
                 "source ledger groups them with Z-paid costs. If any of them were paid "
                 "directly by someone else, that amount would be listed separately."))

S.append(txn_sale(
    20, "Ford Edge — Sold / Funded",
    17000.0,
    [("Headlight", 240.0, "Z"), ("Taylor", 600.0, "Z")],
    20500.0, 17840.0, 2660.0, 1330.0, 9830.0, 10670.0, 24084.02))

S.append(txn_purchase(
    21, "2016 Cadillac XTS — Purchased",
    [("2016 Cadillac XTS", 6610.0)], 6610.0, 3305.0, 20779.02, gas=30.0,
    lead="Vehicle currently held in inventory. Purchase $6,580 + $30 gas = "
         "$6,610 total cost."))

S.append(txn_purchase(
    22, "2020 Ford F150 — Purchased",
    [("2020 Ford F150", 14430.0)], 14430.0, 7215.0, 13564.02,
    lead="Vehicle currently held in inventory. Corrected purchase price of $14,430."))

S.append(txn_cash(
    23, "Cash Disbursement to Mo",
    [("Later Disbursement", 150.0)], 13414.02,
    lead="A final $150 cash disbursement paid directly to Mo."))

# Final balance sanity check.
check("FINAL BALANCE", L.balance, 13414.02)


# =========================================================================== #
#  Assemble the full HTML document                                            #
# =========================================================================== #

CSS = """
:root{
  --navy:#14274e; --slate:#334e68; --ink:#1a2230; --muted:#5b6b7f;
  --line:#c9d2dd; --soft:#eef2f7; --mo:#0f5d3c; --moBg:#e7f4ee;
  --z:#8a4b0a; --zBg:#fbeede; --accent:#b08d2a;
  --posBg:#e7f4ee; --pos:#0f5d3c; --negBg:#fbe9e7; --neg:#9c2a1a;
}
*{box-sizing:border-box}
@page{ size:letter; margin:0.7in 0.65in 0.8in 0.65in; }
html,body{margin:0;padding:0}
body{
  font-family:"Helvetica Neue",Arial,sans-serif;
  color:var(--ink); font-size:10.5pt; line-height:1.5;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;color:var(--navy);}
p{margin:0 0 8px}
.lead{color:var(--muted); font-size:10pt; margin:2px 0 12px}
.num{text-align:right; font-variant-numeric:tabular-nums;
     font-family:"Helvetica Neue",Arial,sans-serif;}

/* ---- page control ---- */
.page-break{ break-after:page; }
.page-start{ break-before:page; }
section.txn{ padding-top:6px; margin-bottom:22px;
             border-top:3px solid var(--navy); }
section.txn:first-child{border-top:none}
/* keep headings attached to the block that follows them */
h2,h3{ break-after:avoid; break-inside:avoid; }
/* the transaction heading + its lead move together to the next page
   rather than being orphaned (and overflowing) at a page bottom */
.txn-head{ break-inside:avoid; break-after:avoid; }
/* small atomic blocks must never split across a page */
.runbox, .note, .front, table.th, table.grid.kv{ break-inside:avoid; }

/* ---- cover ---- */
.cover{ height:9.0in; display:flex; flex-direction:column;
        justify-content:center; text-align:center; }
.cover .kicker{letter-spacing:5px; font-size:11pt; color:var(--accent);
   text-transform:uppercase; font-family:"Helvetica Neue",Arial,sans-serif; font-weight:600}
.cover h1{font-size:34pt; margin:14px 0 6px; letter-spacing:1px; line-height:1.15}
.cover .sub{font-size:14pt; color:var(--slate); font-family:Georgia,serif; font-style:italic}
.cover .rule{width:120px; height:3px; background:var(--accent); margin:26px auto}
.cover .finalbox{
   margin:30px auto 0; max-width:5.3in; border:2px solid var(--navy);
   border-radius:10px; padding:22px 26px; background:var(--soft);}
.cover .finalbox .lbl{letter-spacing:3px; text-transform:uppercase;
   font-size:9.5pt; color:var(--slate)}
.cover .finalbox .amt{font-size:26pt; font-weight:700; color:var(--pos);
   font-family:Georgia,serif; margin-top:6px}
.cover .meta{margin-top:38px; color:var(--muted); font-size:9.5pt}

/* ---- headings ---- */
h1.page-title{font-size:20pt; border-bottom:2px solid var(--navy);
   padding-bottom:8px; margin:0 0 16px}
h2{font-size:14.5pt; margin:0 0 10px; display:flex; align-items:center; gap:10px}
.txn-idx{display:inline-flex; align-items:center; justify-content:center;
   width:26px; height:26px; background:var(--navy); color:#fff; border-radius:50%;
   font-size:11pt; font-family:"Helvetica Neue",Arial,sans-serif; flex:0 0 auto}
h3{font-size:11.5pt; color:var(--slate); margin:14px 0 6px;
   display:flex; align-items:center; gap:8px}
.sub-letter{display:inline-flex; align-items:center; justify-content:center;
   width:19px;height:19px;border:1.5px solid var(--slate); color:var(--slate);
   border-radius:4px; font-size:9pt; font-weight:700;
   font-family:"Helvetica Neue",Arial,sans-serif}

/* ---- tables ---- */
table.grid{width:100%; border-collapse:collapse; margin:4px 0 10px; font-size:10pt}
table.grid th, table.grid td{border:1px solid var(--line); padding:5px 9px}
table.grid thead th{background:var(--navy); color:#fff; text-align:left;
   font-family:"Helvetica Neue",Arial,sans-serif; font-weight:600; font-size:9.5pt;
   letter-spacing:.3px}
table.grid tbody tr:nth-child(even){background:var(--soft)}
table.grid tr.tot td{background:#dde5ef; font-weight:700; border-top:2px solid var(--slate)}
table.grid.kv td:first-child{width:62%}
table.grid.exp td:nth-child(2){width:22%}
.pay-mo{color:var(--mo); font-weight:600}
.pay-z{color:var(--z); font-weight:600}
.pay-other{color:var(--neg); font-weight:600}

table.th{margin-top:6px}
table.th.mo thead th{background:var(--mo)}
table.th.z thead th{background:var(--z)}
table.th tr.tot td{background:#d7e7de}
table.th.z tr.tot td{background:#f3e2cd}

/* ---- running balance box ---- */
.runbox{border:1.5px solid var(--slate); border-radius:8px; overflow:hidden;
   margin:6px 0 4px}
.runrow{display:flex; justify-content:space-between; padding:7px 12px;
   border-bottom:1px solid var(--line)}
.runrow span:first-child{color:var(--muted)}
.runrow.new{background:var(--navy); color:#fff; font-weight:700; border-bottom:none}
.runrow.new span:first-child{color:#cdd8e8}

/* ---- Z-front callout ---- */
.front{background:var(--zBg); border-left:4px solid var(--z); padding:9px 13px;
   border-radius:0 6px 6px 0; margin:8px 0; font-weight:600; color:var(--ink)}

/* ---- audit note ---- */
.note{background:#fff8e6; border:1px solid var(--accent); border-radius:6px;
   padding:9px 12px; margin:8px 0; font-size:9.3pt; color:#5a4a1a}
.note-tag{display:inline-block; background:var(--accent); color:#fff;
   font-size:7.5pt; letter-spacing:1px; padding:1px 6px; border-radius:3px;
   margin-right:6px; vertical-align:1px; font-weight:700}

/* ---- rules / summary cards ---- */
.rule-list{list-style:none; padding:0; margin:0}
.rule-list li{border:1px solid var(--line); border-left:4px solid var(--navy);
   background:var(--soft); padding:11px 15px; margin-bottom:10px; border-radius:0 6px 6px 0}
.rule-list li b{color:var(--navy)}
.cards{display:flex; gap:14px; flex-wrap:wrap; margin:8px 0 16px}
.card{flex:1 1 45%; border:1px solid var(--line); border-radius:8px; padding:14px 16px;
   background:#fff}
.card h4{margin:0 0 8px; font-size:10.5pt; color:var(--slate);
   font-family:"Helvetica Neue",Arial,sans-serif; letter-spacing:.4px;
   text-transform:uppercase}
.bigfinal{border:2px solid var(--pos); background:var(--posBg); border-radius:10px;
   padding:18px 22px; text-align:center; margin:6px 0 18px}
.bigfinal .lbl{letter-spacing:2px; text-transform:uppercase; color:var(--slate);
   font-size:9.5pt}
.bigfinal .amt{font-size:24pt; font-weight:700; color:var(--pos);
   font-family:Georgia,serif; margin-top:4px}

.small{font-size:9pt;color:var(--muted)}
"""


def cover_page():
    return f'''
<div class="cover page-break">
  <div class="kicker">Vehicle Partnership Accounting Report</div>
  <h1>MO / Z PARTNERSHIP<br>LEDGER REPORT</h1>
  <div class="sub">A full audit-style partnership statement</div>
  <div class="rule"></div>
  <div class="finalbox">
    <div class="lbl">Final Current Balance</div>
    <div class="amt">Z Owes Mo {money(13414.02)}</div>
  </div>
  <div class="meta">Prepared as a partner-facing reconciliation &middot;
     Every figure recomputed from source inputs<br>
     Positive balance = Z owes Mo &nbsp;|&nbsp; Negative balance = Mo owes Z</div>
</div>'''


def rules_page():
    rules = [
        "<b>Positive balance</b> means <b>Z owes Mo.</b>",
        "<b>Negative balance</b> means <b>Mo owes Z.</b>",
        "<b>Partner deals are split 50 / 50</b> unless otherwise stated.",
        "<b>Only expenses labeled &ldquo;Mo&rdquo;</b> are counted as Mo expenses. "
        "All other expenses are treated as Z-paid unless the ledger specifically "
        "says another person paid them.",
        "Z-paid purchase funding is always written as: "
        f"&ldquo;{Z_FRONT}&rdquo;",
        "Named payees/vendors (Drako, Tito, Taylor, Talon, Luis, Angela, AutoZone, "
        "gas, tow, Lyft, emissions, car wash, parts, repairs, etc.) are listed exactly "
        "as written and classified clearly. If a payer is not explicitly Mo, it is "
        "never counted as a Mo expense.",
    ]
    li = "".join(f"<li>{r}</li>" for r in rules)
    return f'''
<div class="page-break">
  <h1 class="page-title">Ledger Rules</h1>
  <p class="lead">These rules govern every calculation in this report. They are
     applied consistently to all {len(L.chain)} recorded ledger events.</p>
  <ul class="rule-list">{li}</ul>
  <h3><span class="sub-letter">i</span> How each figure is derived</h3>
  <table class="grid"><thead><tr><th>Figure</th><th>Formula</th></tr></thead><tbody>
   <tr><td>Total Cost</td><td>Purchase price + all listed expenses</td></tr>
   <tr><td>Total Profit</td><td>Sale price &minus; Total Cost</td></tr>
   <tr><td>Profit Split (each)</td><td>Total Profit &divide; 2</td></tr>
   <tr><td>Mo Take-Home</td><td>Mo car half + Mo expense reimbursement + Mo profit share</td></tr>
   <tr><td>Z Take-Home</td><td>Z car half + Z expense reimbursement + Z profit share</td></tr>
   <tr><td>Running Balance</td><td>Prior balance &plusmn; transaction impact
       (positive = Z owes Mo)</td></tr>
  </tbody></table>
</div>'''


def summary_page():
    return f'''
<div class="page-break">
  <h1 class="page-title">Executive Summary</h1>
  <div class="bigfinal">
     <div class="lbl">Final Current Balance</div>
     <div class="amt">Z Owes Mo {money(13414.02)}</div>
  </div>
  <div class="cards">
    <div class="card">
      <h4>Cash Paid to Mo</h4>
      <table class="grid kv"><tbody>
        <tr><td>6/15</td><td class="num">{money0(2000)}</td></tr>
        <tr><td>6/17</td><td class="num">{money0(2000)}</td></tr>
        <tr><td>Later Disbursement</td><td class="num">{money0(150)}</td></tr>
        <tr class="tot"><td>Total Paid to Mo</td><td class="num">{money0(4150)}</td></tr>
      </tbody></table>
    </div>
    <div class="card">
      <h4>Current Inventory</h4>
      <table class="grid kv"><tbody>
        <tr><td>2016 Cadillac XTS</td><td class="num">{money0(6610)}</td></tr>
        <tr><td>2020 Ford F150</td><td class="num">{money0(14430)}</td></tr>
        <tr class="tot"><td>Total Inventory Cost</td><td class="num">{money0(21040)}</td></tr>
      </tbody></table>
    </div>
  </div>
  <div class="cards">
    <div class="card">
      <h4>Z Share in Inventory</h4>
      <div style="font-size:19pt;font-weight:700;color:var(--z);
           font-family:Georgia,serif">{money0(10520)}</div>
    </div>
    <div class="card">
      <h4>Mo Share in Inventory</h4>
      <div style="font-size:19pt;font-weight:700;color:var(--mo);
           font-family:Georgia,serif">{money0(10520)}</div>
    </div>
  </div>
  <p class="small">The report that follows walks through all
     {len(L.chain)} ledger events in chronological order, each ending with the
     updated running balance. A full reconciliation and inventory statement close
     the report.</p>
</div>'''


def reconciliation_page():
    rows = []
    for c in L.chain:
        op = "+" if c["delta"] >= 0 else "&minus;"
        rows.append(
            f'<tr><td>{esc(c["name"])}</td>'
            f'<td class="num">{balance_label(c["prev"])}</td>'
            f'<td class="num">{op} {money(abs(c["delta"]))}</td>'
            f'<td class="num"><b>{balance_label(c["new"])}</b></td></tr>')
    body = "".join(rows)
    return f'''
<div class="page-break page-start">
  <h1 class="page-title">Full Reconciliation — Running Balance Chain</h1>
  <p class="lead">Every event in order, with the balance before, the impact, and the
     balance after. Positive = Z owes Mo; negative = Mo owes Z.</p>
  <table class="grid"><thead><tr>
     <th>Transaction / Event</th><th class="num">Balance Before</th>
     <th class="num">Impact</th><th class="num">Balance After</th>
  </tr></thead><tbody>{body}
     <tr class="tot"><td>FINAL CURRENT BALANCE</td><td></td><td></td>
        <td class="num">{balance_label(L.balance)}</td></tr>
  </tbody></table>
  <div class="bigfinal" style="margin-top:18px">
     <div class="lbl">Final Amount Z Owes Mo</div>
     <div class="amt">{money(13414.02)}</div>
  </div>
</div>'''


def inventory_page():
    return f'''
<div class="page-break">
  <h1 class="page-title">Current Inventory Statement</h1>
  <p class="lead">Vehicles still owned by the partnership at the close of this ledger.
     Each is owned 50 / 50, so the inventory cost is shared equally.</p>

  <h3><span class="sub-letter">1</span> 2016 Cadillac XTS</h3>
  <table class="grid kv"><tbody>
    <tr><td>Total Cost (purchase $6,580 + gas $30)</td><td class="num">{money0(6610)}</td></tr>
    <tr><td>Z Share</td><td class="num">{money0(3305)}</td></tr>
    <tr><td>Mo Share</td><td class="num">{money0(3305)}</td></tr>
  </tbody></table>

  <h3><span class="sub-letter">2</span> 2020 Ford F150</h3>
  <table class="grid kv"><tbody>
    <tr><td>Total Cost (corrected purchase)</td><td class="num">{money0(14430)}</td></tr>
    <tr><td>Z Share</td><td class="num">{money0(7215)}</td></tr>
    <tr><td>Mo Share</td><td class="num">{money0(7215)}</td></tr>
  </tbody></table>

  <h3><span class="sub-letter">&Sigma;</span> Total Current Inventory</h3>
  <table class="grid"><thead><tr><th>Item</th><th class="num">Amount</th></tr></thead>
  <tbody>
    <tr><td>Total Inventory Cost</td><td class="num">{money0(21040)}</td></tr>
    <tr><td>Z Share in Inventory</td><td class="num">{money0(10520)}</td></tr>
    <tr><td>Mo Share in Inventory</td><td class="num">{money0(10520)}</td></tr>
  </tbody></table>

  <div class="bigfinal" style="margin-top:22px">
     <div class="lbl">Final Amount Z Owes Mo</div>
     <div class="amt">{money(13414.02)}</div>
  </div>
  <p class="small">Note: inventory is stated at cost and is separate from the cash
     balance owed between partners. The $13,414.02 owed to Mo already reflects that Z
     paid for Mo&rsquo;s 50% share of both inventory vehicles.</p>
</div>'''


def audit_page():
    # No break-after on the final section: inventory_page's break-after already
    # starts this page, and a trailing break would emit an empty last page.
    return f'''
<div>
  <h1 class="page-title">Audit Notes &amp; Verification</h1>
  <p class="lead">This report was generated by a program that recomputes every figure
     from raw purchase, expense, and sale inputs, then checks each result against the
     source ledger. The report would not have been produced if any check failed.</p>
  <h3><span class="sub-letter">1</span> Items preserved exactly from the source ledger</h3>
  <ul class="rule-list">
    <li><b>Mitsubishi &amp; Q50:</b> Z take-home is <b>not explicitly stated in the
        source ledger</b>; only Mo take-home amounts were provided.</li>
    <li><b>Buick &mdash; Drako $625:</b> included in Total Cost but not reimbursed to
        either partner in the source ledger. Shown separately, not hidden. Preserved
        source Z take-home = $3,362.50 (would be $3,987.50 if Drako were treated as
        Z-paid).</li>
    <li><b>Named third-party payees</b> (Drako, Tito, Taylor, Luis, Angela, Talon,
        etc.) are vendors/labor, not the funding partner. Per the standard rule they
        are treated as Z-paid where the source groups them that way, and each is listed
        by name so nothing is obscured.</li>
  </ul>
  <h3><span class="sub-letter">2</span> Verification result</h3>
  <table class="grid"><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>
    <tr><td>Total cost = purchase + expenses (all sales)</td><td class="pay-mo">PASS</td></tr>
    <tr><td>Profit = sale price &minus; total cost (all sales)</td><td class="pay-mo">PASS</td></tr>
    <tr><td>Profit split = profit &divide; 2 (all sales)</td><td class="pay-mo">PASS</td></tr>
    <tr><td>Mo take-home = car half + Mo expense + profit share</td><td class="pay-mo">PASS</td></tr>
    <tr><td>Z take-home = car half + Z expense + profit share</td><td class="pay-mo">PASS</td></tr>
    <tr><td>Running balance chain ({len(L.chain)} events)</td><td class="pay-mo">PASS</td></tr>
    <tr><td>Final balance resolves to $13,414.02</td><td class="pay-mo">PASS</td></tr>
  </tbody></table>
  <p class="small">No arithmetic discrepancies were found between the source ledger and
     the recomputed figures. Every number in this report matches the source ledger
     exactly.</p>
</div>'''


def build_html():
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<title>Mo / Z Partnership Ledger Report</title>',
        f'<style>{CSS}</style></head><body>',
        cover_page(),
        rules_page(),
        summary_page(),
        '<div class="page-break"><h1 class="page-title">Chronological Ledger</h1>'
        '<p class="lead">All transactions in order. Each vehicle sale follows the same '
        'A&ndash;F structure: purchase, expenses, sale, Mo take-home, Z take-home, and '
        'the resulting running balance.</p></div>',
    ]
    parts.extend(L.sections_html)
    parts.append(reconciliation_page())
    parts.append(inventory_page())
    parts.append(audit_page())
    parts.append('</body></html>')
    return "".join(parts)


if __name__ == "__main__":
    import os
    html_out = build_html()
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "ledger_report.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html_out)
    print(f"OK  wrote {path}  ({len(html_out):,} bytes)")
    print(f"OK  {len(L.chain)} ledger events; final balance = {balance_label(L.balance)}")
    print("OK  all math assertions passed")
