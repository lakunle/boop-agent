---
name: pdf-brief
description: Generate a beautifully designed brief, recap, or summary as a 1–3 page portrait PDF. Use ONLY for short personal/work briefings — daily brief, morning brief, weekly summary, meeting prep, research summary, or "make me a brief on X". DO NOT use for pitch decks, investor briefs, fundraising decks, slide decks, presentations, or anything multi-section/landscape — use pdf-pitch instead. Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-brief

You produce a tight, scannable briefing PDF — calendar + tasks + key signals for the day, prep notes for a meeting, or a focused research summary.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.** Read it in full before any HTML.
2. Gather the source material. For a daily brief: pull recent calendar, inbox priorities, and active project context (call other tools or skills as needed). For a meeting brief: history with the attendee(s), recent threads, open items. For a research brief: synthesize from your tools (WebSearch, WebFetch).
3. Apply the layout in §Layout. Brief should be 1–3 pages MAX.
4. Generate semantic HTML using §Template. Inline ALL CSS in a single `<style>` block.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "brief" }`.
6. Return ONE short summary line. Example: "Brief for 29 Apr — 3 meetings, 5 inbox priorities, 2 deadlines."

## Layout (brief-specific)

- Single column, body width 65–75ch (apply via `max-width` on the main).
- Top: date + brief title + 1-line tldr.
- Section headings: H2, uppercase, 11px, letter-spacing 0.08em, muted color.
- Body: 16px, line-height 1.55, prose-friendly.
- Lists: bulleted (•) or numbered, never "card grids".
- One accent color for the tldr underline only — no other color emphasis.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 24mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.55; font-size: 16px; max-width: 70ch; }
  .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 12px; }
  .tldr { font-size: 18px; line-height: 1.4; padding-bottom: 16px; border-bottom: 2px solid var(--accent); margin-bottom: 24px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 24px 0 8px; font-weight: 600; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 6px 0; }
  p { margin: 0 0 12px; }
  .when { color: var(--muted); font-variant-numeric: tabular-nums; }
</style></head><body>
  <div class="meta">Daily brief · Mon 29 Apr 2026</div>
  <h1>Today at a glance</h1>
  <p class="tldr">3 meetings, 5 inbox priorities, 2 deadlines. Mid-afternoon is your only deep-work window.</p>
  <h2>Schedule</h2>
  <ul>
    <li><span class="when">09:00</span> · 1:1 with Sarah — ship-readiness review</li>
    <li><span class="when">11:30</span> · Acme demo — design system v2 walkthrough</li>
    <li><span class="when">16:00</span> · Q2 retro</li>
  </ul>
  <h2>Inbox priorities</h2>
  <ul>
    <li>Acme — invoice 0042 needs sign-off before noon</li>
    <li>Sarah — feedback on the spec, due EOD</li>
    <li>Granola — recording quota renewal, optional</li>
  </ul>
  <h2>Deadlines</h2>
  <ul>
    <li>Tax filing reminder — Friday 3 May</li>
    <li>Conference talk submission — Friday 3 May</li>
  </ul>
</body></html>
```

## Examples

**Input:** "Summarize today as a brief PDF"
**Filename:** `brief-2026-04-29.pdf`
**Returns:** "Brief for 29 Apr — 3 meetings, 5 inbox priorities, 2 deadlines."

**Input:** "Meeting prep for the 11:30 with Acme"
**Filename:** `meeting-prep-acme-2026-04-29.pdf`
**Returns:** "Prep brief for Acme demo — design system v2 walkthrough."
