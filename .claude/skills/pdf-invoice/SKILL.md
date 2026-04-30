---
name: pdf-invoice
description: Generate a beautifully designed invoice, receipt, or expense report as a PDF. Use when the user asks for an invoice, a bill, a receipt, an expense report, or "send me a PDF for $X to <client>". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-invoice

You produce a polished, business-ready invoice PDF.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.** Read it in full before writing any HTML. Its design laws (OKLCH only, semantic color names, ≥1.25-stop heading/body weight contrast, 65–75ch line length, the spacing scale, the absolute bans) are non-negotiable.
2. Extract the invoice data from the user's request. Required: payee, payer, line items, currency, total. Optional: due date, terms, notes, logo. If a required field is missing, return one sentence asking for it instead of guessing.
3. Apply the layout rules in §Layout below.
4. Generate semantic HTML using §Template. Inline ALL CSS in a single `<style>` block. Do NOT pull external assets — Puppeteer prints offline.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "invoice" }`. The interaction agent attaches the file automatically.
6. Return ONE short summary line. Example: "Generated INV-2026-0042 — $4,200 to Acme, due Apr 12." Do NOT paste the URL.

## Layout (invoice-specific, on top of boop-design)

- Single column, 32mm horizontal margins (override the 20mm default via inline CSS `@page { margin: 32mm; }`).
- A4 default; US Letter if currency is USD.
- Top band: payee identity (left) and metadata block (right — number, issue date, due date, total).
- Line-items table: 4 columns (description, qty, rate, total). Right-align numerics. `font-variant-numeric: tabular-nums`.
- Totals stack right-aligned below the table: subtotal, tax (if any), total. Total is the only emphasis — heavier weight, no color.
- One accent color max (the action-primary OKLCH from boop-design), used only on the total row's underline.

## Template (reference HTML)

````html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 32mm; size: A4; }
  :root {
    --color-fg: oklch(15% 0 0);
    --color-muted: oklch(50% 0 0);
    --color-line: oklch(88% 0 0);
    --color-action-primary: oklch(58% 0.18 250);
    --color-bg: oklch(99% 0 0);
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--color-fg); background: var(--color-bg); margin: 0; line-height: 1.55; font-size: 16px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .payee h1 { font-size: 28px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.02em; }
  .payee p { margin: 0; font-size: 14px; color: var(--color-muted); }
  .meta { text-align: right; }
  .meta .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); display: block; }
  .meta .value { font-size: 14px; margin-bottom: 8px; display: block; }
  .meta .total-headline { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .billto { display: flex; gap: 64px; margin: 24px 0; font-size: 14px; }
  .billto .col .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; font-variant-numeric: tabular-nums; }
  th, td { padding: 10px 0; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); border-bottom: 1px solid var(--color-fg); }
  td { border-bottom: 1px solid var(--color-line); }
  .num { text-align: right; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; font-size: 14px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-variant-numeric: tabular-nums; }
  .totals .total { border-bottom: 2px solid var(--color-action-primary); padding-bottom: 6px; margin-top: 6px; font-size: 18px; font-weight: 700; }
  .footer { margin-top: 48px; font-size: 12px; color: var(--color-muted); }
</style></head><body>
  <div class="header">
    <div class="payee">
      <h1>Meridian Studio</h1>
      <p>14 Atlantic Way · hello@example.com</p>
    </div>
    <div class="meta">
      <span class="label">Invoice</span><span class="value">INV-2026-0042</span>
      <span class="label">Issued</span><span class="value">29 Apr 2026</span>
      <span class="label">Due</span><span class="value">12 May 2026</span>
      <span class="total-headline">$4,200.00</span>
    </div>
  </div>
  <div class="billto">
    <div class="col"><div class="label">Billed to</div><div>Acme Corp<br/>Billing Dept</div></div>
    <div class="col"><div class="label">Project</div><div>Design system v2</div></div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr><td>Design system v2 — components, tokens, docs</td><td class="num">40</td><td class="num">$85.00</td><td class="num">$3,400.00</td></tr>
      <tr><td>Component refactor</td><td class="num">10</td><td class="num">$80.00</td><td class="num">$800.00</td></tr>
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>$4,200.00</span></div>
    <div class="row total"><span>Total due</span><span>$4,200.00</span></div>
  </div>
  <p class="footer">Net 14. ACH preferred. Thank you.</p>
</body></html>
````

Adapt the values to the user's actual data. Keep the structure and the OKLCH variables.

## Examples

**Input:** "Invoice $4200 to Acme for design system v2 (40h @ $85) and component refactor (10h @ $80)."
**Filename:** `invoice-acme-2026-04-29.pdf`
**Returns:** "Generated INV-2026-0042 — $4,200 to Acme."

**Input:** "Receipt for the $42 Sushi Saito lunch yesterday, paid card."
**Filename:** `receipt-sushi-saito-2026-04-28.pdf`
**Returns:** "Generated receipt — $42 to Sushi Saito (28 Apr)."
