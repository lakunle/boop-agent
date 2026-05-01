---
name: pdf-pitch
description: Generate a beautifully designed pitch deck or presentation as a landscape PDF. Use when the user asks for a pitch deck, slide deck, presentation, fundraising deck, investor deck, investor brief, co-founder brief, sales deck, or any multi-slide "deck for X" / "deck about X" artifact. NOT for daily/morning/meeting briefs (use pdf-brief instead). Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-pitch

You produce a presentation-style PDF — landscape, full-bleed, one slide per page. Each section of the document is a self-contained slide that fills the entire page. The cover slide can paint the whole page edge-to-edge; subsequent slides have internal padding only.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.** Read it in full before any HTML.
2. Gather the source material. Required: title, tagline, audience (investors / co-founders / customers / etc.), and the slide outline (cover, problem, solution, market, traction/plan, ask). Optional: stage, sector, contact line.
3. Plan the slide count up front and **budget the content per slide** before writing HTML. Aim for 8–12 slides. If a section has more content than fits one slide at 16px body, split it into two slides — never let prose flow across pages.
4. Apply the layout in §Layout. Generate semantic HTML using §Template. Inline ALL CSS in a single `<style>` block. No external assets.
5. Call `mcp__boop-pdf__generate_pdf` with **all four** of these args:
   ```json
   {
     "html": "...",
     "filename": "pitch-<slug>-<yyyy-mm-dd>.pdf",
     "kind": "pitch",
     "pageOptions": {
       "orientation": "landscape",
       "margin": { "top": "0", "right": "0", "bottom": "0", "left": "0" }
     }
   }
   ```
   Without `pageOptions` the renderer falls back to A4 portrait with 20mm margins, which breaks the slide layout. Always pass it.
6. Return ONE short summary line. Example: "Pitch deck — Mise.AI · 10 slides · investor brief."

## Layout (pitch-specific)

### Page geometry

- A4 landscape: 297mm × 210mm.
- The renderer uses 0 page margin. The HTML controls all interior space via slide-level padding.
- Match this in CSS: `@page { size: A4 landscape; margin: 0; }`.

### One slide = one page

Every slide is a `<section class="slide">` sized **exactly** 297mm × 210mm with:

- `break-after: page; page-break-after: always;` (force a page break after every slide)
- `break-inside: avoid; page-break-inside: avoid;` (never split a slide across pages)
- `overflow: hidden` (a hard cap — if content overflows the slide it gets clipped, which forces you to split or shrink rather than letting it bleed into the next page)

The last slide should drop `break-after` so the PDF doesn't end with a trailing blank page.

### Slide types

- **Cover** (`.slide.cover`): full-bleed dark background, brand mark + headline + tagline, footer line. No header chrome.
- **Content** (`.slide`): light background, internal padding 18mm vertical / 22mm horizontal, top header chrome (brand · section title · page indicator), then content.
- **Closing** (optional): same as cover but with the ask / next-step CTA.

### Type scale (slides are bigger than documents)

- Cover hero: 56–72px, 800 weight
- Slide H2 (section headline): 36–44px, 700 weight, `max-width: 22ch`, line-height 1.1
- Body lede: 20–24px, 400 weight, `max-width: 60ch`, color muted
- Body copy: 16–18px, line-height 1.5
- Header chrome: 11px uppercase, letter-spacing 0.12em, muted

### Color

- One accent color only. ≤10% surface coverage. Cover slide paints background dark; accent on a single brand mark or one piece of typography.
- All values OKLCH. No hex, no hsl.
- Status / category cells must not rely on color alone — pair with label or icon.

### Patterns to use

- Stat grids (3 columns, max one row per slide)
- Two-column comparison
- Numbered step rows
- Side-aligned "step N" markers in muted accent
- Pull-quote callouts inside a tinted block (single accent, ≤10% surface)

### Patterns banned (per boop-design)

- Side-stripe accent borders as decoration
- Gradient text
- Identical hero-metric card grids ×6
- Decorative glassmorphism / `backdrop-filter` without functional purpose
- Inter without rationale (use system-ui / `-apple-system` stack)

## Template (reference HTML)

Two slides shown. Extend the same `.slide` pattern for every additional page.

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 0; }
  :root {
    --fg: oklch(18% 0 0);
    --muted: oklch(52% 0 0);
    --line: oklch(88% 0 0);
    --accent: oklch(68% 0.20 145);
    --bg: oklch(99% 0 0);
    --bg-dark: oklch(15% 0 0);
    --fg-dark: oklch(98% 0 0);
    --muted-dark: oklch(70% 0 0);
    --tint: oklch(96% 0.04 145);
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { padding: 0; margin: 0; }
  body {
    font-family: -apple-system, system-ui, "Segoe UI", Helvetica, sans-serif;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.55;
    font-size: 16px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .slide {
    width: 297mm;
    height: 210mm;
    padding: 18mm 22mm;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .slide:last-child { break-after: auto; page-break-after: auto; }

  /* Cover slide — full bleed dark */
  .slide.cover {
    padding: 22mm 26mm;
    background: var(--bg-dark);
    color: var(--fg-dark);
    justify-content: space-between;
  }
  .cover .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted-dark); }
  .cover h1 { font-size: 64px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.0; }
  .cover h1 .dot { color: var(--accent); }
  .cover .tagline { font-size: 22px; line-height: 1.4; color: oklch(85% 0 0); margin-top: 14px; max-width: 60ch; }
  .cover .footer { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted-dark); }

  /* Content slides */
  .slide-header {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--muted);
    padding-bottom: 8mm;
    border-bottom: 1px solid var(--line);
    margin-bottom: 10mm;
  }
  .slide-header .brand { color: var(--fg); font-weight: 700; }
  .slide-header .section { color: var(--accent); font-weight: 600; }
  .slide h2 { font-size: 40px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.1; max-width: 22ch; margin-bottom: 12px; }
  .slide .lede { font-size: 20px; line-height: 1.4; color: var(--muted); max-width: 60ch; margin-bottom: 18px; }
  .slide p, .slide li { font-size: 16px; line-height: 1.55; }

  /* Stat grid */
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 6mm; }
  .stat { padding: 18px 20px; background: oklch(97% 0 0); border-radius: 6px; }
  .stat .num { font-size: 38px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; color: var(--fg); }
  .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-top: 8px; font-weight: 600; }
  .stat .desc { font-size: 13px; color: var(--muted); margin-top: 4px; line-height: 1.4; }

  /* Pull quote */
  .pull { background: var(--tint); padding: 14px 18px; border-radius: 6px; margin: 14px 0; }
  .pull .q { font-size: 18px; font-style: italic; line-height: 1.4; }
  .pull .src { font-size: 12px; color: var(--muted); margin-top: 6px; }

  /* Page indicator on every content slide */
  .pageno { position: absolute; bottom: 10mm; right: 22mm; font-size: 10px; color: var(--muted); letter-spacing: 0.08em; }
</style></head><body>

  <section class="slide cover">
    <div class="meta">Confidential · Investor brief · 2026</div>
    <div>
      <h1>Mise<span class="dot">.</span>AI</h1>
      <div class="tagline">The autonomous food cost agent for independent restaurants.</div>
    </div>
    <div class="footer">
      <span>mise (n.) — from mise en place</span>
      <span>01 / 10</span>
    </div>
  </section>

  <section class="slide">
    <div class="slide-header">
      <span class="brand">Mise.AI</span>
      <span class="section">The Problem</span>
      <span>02 / 10</span>
    </div>
    <h2>Independent restaurants are bleeding money.</h2>
    <p class="lede">And most owners don't even know exactly where it's going.</p>
    <div class="stat-grid">
      <div class="stat">
        <div class="num">70%</div>
        <div class="label">No inventory role</div>
        <div class="desc">of independent US restaurants</div>
      </div>
      <div class="stat">
        <div class="num">$20–50K</div>
        <div class="label">Lost annually</div>
        <div class="desc">per location to waste &amp; overordering</div>
      </div>
      <div class="stat">
        <div class="num">$55K</div>
        <div class="label">Manager salary</div>
        <div class="desc">unaffordable for 1–3 locations</div>
      </div>
    </div>
    <div class="pull">
      <div class="q">"I know I'm losing money on food. I just don't have time to figure out where."</div>
      <div class="src">— Every independent restaurant owner, everywhere.</div>
    </div>
  </section>

</body></html>
```

## Examples

**Input:** "Make a pitch deck for Mise.AI — co-founder + investor brief, 10 slides"
**Filename:** `pitch-mise-ai-2026-04-29.pdf`
**Returns:** "Pitch deck — Mise.AI · 10 slides · investor + co-founder brief."

**Input:** "Build me a 6-slide deck I can send to potential customers about our new pricing"
**Filename:** `deck-pricing-2026-04-29.pdf`
**Returns:** "Pricing deck · 6 slides."

**Input:** "Investor brief PDF for the seed round"
**Filename:** `pitch-seed-2026-04-29.pdf`
**Returns:** "Seed-round investor pitch · 9 slides."
