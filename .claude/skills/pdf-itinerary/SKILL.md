---
name: pdf-itinerary
description: Generate a beautifully designed travel itinerary, event agenda, or timed schedule as a PDF. Use when the user asks for a trip plan, itinerary, travel agenda, event schedule, conference agenda, or "plan my X trip". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-itinerary

You produce a clean, day-by-day, time-anchored itinerary or agenda PDF.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Extract trip/agenda data. Required: title, date range, day-by-day entries (time + activity). Optional: confirmation numbers, addresses, weather, travel-time hints. Pull from calendar/email/etc. as needed.
3. Apply the layout in §Layout.
4. Generate HTML using §Template. Inline all CSS.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "itinerary" }`.
6. Return ONE short summary line. Example: "Itinerary — Tokyo May 4–11, 23 entries across 7 days."

## Layout (itinerary-specific)

- Single column, body 70ch.
- Cover band: trip title + date range + 1-line summary.
- Each day: H2 heading "Day N — Day-of-week Date".
- Within a day: time-anchored rows. Two-column grid: time (tabular-nums, accent color) on the left, content on the right.
- No card grids. No "tips" sidebars. Itineraries are timelines.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 24mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.55; font-size: 16px; max-width: 70ch; }
  .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 8px; }
  .summary { font-size: 16px; color: var(--muted); margin: 0 0 24px; padding-bottom: 16px; border-bottom: 2px solid var(--accent); }
  h2 { font-size: 18px; font-weight: 600; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .row { display: grid; grid-template-columns: 64px 1fr; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .time { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; font-size: 14px; }
  .what { font-size: 14px; }
  .what .note { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
</style></head><body>
  <div class="meta">Trip · Tokyo · 4–11 May 2026</div>
  <h1>Tokyo — 7 days</h1>
  <p class="summary">Solo trip. JL061 from JFK. Park Hyatt 4–8, Aman 8–11. Yuki dinner Day 1.</p>

  <h2>Day 1 — Mon 4 May</h2>
  <div class="row"><div class="time">06:30</div><div class="what">NRT arrival, Terminal 1<br/><span class="note">Flight JL061 from JFK · Passport: ready</span></div></div>
  <div class="row"><div class="time">09:00</div><div class="what">Park Hyatt check-in<br/><span class="note">Confirmation #PHT-44291 · Suite 5102</span></div></div>
  <div class="row"><div class="time">13:00</div><div class="what">Sushi Saito lunch<br/><span class="note">For 2 · 90 min · 6F Hibiya</span></div></div>
  <div class="row"><div class="time">19:00</div><div class="what">Dinner with Yuki — Den<br/><span class="note">2-1-3 Jingumae · 30-min walk from hotel</span></div></div>

  <h2>Day 2 — Tue 5 May</h2>
  <div class="row"><div class="time">07:00</div><div class="what">Tsukiji breakfast walk</div></div>
  <div class="row"><div class="time">10:00</div><div class="what">teamLab Borderless<br/><span class="note">Tickets: emailed · ~2.5 hr</span></div></div>
  <div class="row"><div class="time">15:00</div><div class="what">Aoyama design district stroll</div></div>
</body></html>
```

## Examples

**Input:** "Plan my Tokyo trip May 4–11" (with calendar context)
**Filename:** `itinerary-tokyo-2026-05-04.pdf`
**Returns:** "Itinerary — Tokyo May 4–11, ~22 entries across 7 days."

**Input:** "Make me an agenda for the team offsite next week"
**Filename:** `agenda-team-offsite-2026-05-06.pdf`
**Returns:** "Offsite agenda — 2 days, 14 sessions."
