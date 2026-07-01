# Mo / Z Partnership Ledger Report

A partner-facing, audit-style PDF that reconciles the Mo / Z vehicle partnership
line by line, ending in the current balance **Z Owes Mo $13,414.02**.

## Files

| File | Purpose |
|------|---------|
| `generate_report.py` | Single source of truth. Encodes every transaction from raw inputs, computes total cost, profit, splits, Mo/Z take-home, and the running balance, **asserts each figure against the source ledger**, and emits `ledger_report.html`. Refuses to run if any check fails. |
| `render_pdf.js` | Renders the HTML to `ledger_report.pdf` via the pre-installed Chromium (puppeteer-core), with native page-margin footers. |
| `ledger_report.html` | Generated report (do not edit by hand — regenerate). |
| `ledger_report.pdf` | **The deliverable.** 33-page CPA-style partnership statement. |

## Report structure

1. Cover page — final balance
2. Ledger rules
3. Executive summary — balance, cash paid to Mo, inventory
4. Chronological ledger — 23 transactions, each with Purchase / Expenses /
   Sale / Mo take-home / Z take-home / running balance
5. Full reconciliation — the complete running-balance chain
6. Current inventory statement
7. Audit notes & verification

## Ledger rule

- Positive balance = **Z owes Mo**
- Negative balance = **Mo owes Z**
- Partner deals are 50/50 unless stated; only expenses labeled "Mo" are Mo
  expenses; all other non-Mo expenses are Z-paid unless the ledger names another
  payer. Z-funded purchases are written as *"Z paid for Mo's 50% share of the
  purchase."*

## Regenerate

```bash
python3 generate_report.py     # builds HTML, runs all math assertions
npm install                    # first time only (puppeteer-core)
node render_pdf.js             # builds ledger_report.pdf
```
