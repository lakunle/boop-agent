---
name: pdf-newsletter
description: Generate a beautifully designed newsletter, digest, or weekly roundup as a PDF. Use when the user asks for a newsletter, digest, link roundup, weekly recap, "best of the week", or "issue N of my newsletter". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-newsletter

You produce a multi-section, multi-column digest PDF — issue-style, scannable, dense without feeling cramped.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Gather content. Required: title, issue number, date, sections (each with 2–5 items). Optional: cover quote, masthead tagline. Pull from inbox / RSS / WebSearch as needed.
3. Apply the layout in §Layout.
4. Generate HTML using §Template.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "newsletter" }`.
6. Return ONE short summary line. Example: "Issue 042 — 4 sections, 12 items."

## Layout (newsletter-specific)

- Masthead: large title (italic serif welcome — but only via system fonts like Georgia or system-ui-serif), issue number + date below, full-width rule.
- Body: 2 columns, balanced. Use CSS `column-count: 2; column-gap: 24px; column-rule: 1px solid var(--line);`
- Section headings: H3 with subtle italic.
- Items: short paragraph + optional inline link (rendered as `[text]` since URLs are clickable in iMessage anyway).
- One accent color on the masthead rule only.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 22mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(85% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.55; font-size: 14px; }
  .masthead { text-align: center; padding-bottom: 12px; border-bottom: 3px solid var(--accent); margin-bottom: 24px; }
  .masthead .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
  .masthead h1 { font-family: Georgia, "Times New Roman", serif; font-style: italic; font-size: 36px; font-weight: 600; margin: 4px 0 0; letter-spacing: -0.02em; }
  .masthead .tagline { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .columns { column-count: 2; column-gap: 24px; column-rule: 1px solid var(--line); }
  h3 { font-family: Georgia, serif; font-style: italic; font-size: 18px; font-weight: 600; margin: 0 0 6px; break-after: avoid; }
  h3:not(:first-child) { margin-top: 18px; }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.55; orphans: 3; widows: 3; }
  .ref { color: var(--muted); font-size: 11px; }
</style></head><body>
  <div class="masthead">
    <div class="meta">Issue 042 · Week of 27 Apr 2026</div>
    <h1>The Roundup</h1>
    <div class="tagline">A weekly digest of design, AI, and the in-between.</div>
  </div>
  <div class="columns">
    <h3>In tech</h3>
    <p>Anthropic shipped Claude Agent SDK 1.0 — the prebuilt loops for tool-use orchestration land in the same week as the Convex 1.18 schema-evolution rewrite. <span class="ref">[Anthropic blog]</span></p>
    <p>OKLCH crossed 90% browser support after Safari 18 — meaning the workaround period is officially over.</p>
    <h3>Reading list</h3>
    <p>"Patterns of Distributed Systems" — Unmesh Joshi. Long but the chapter on consensus alone is worth the read.</p>
    <p>"The visual display of quantitative information" — Tufte, second edition. Re-read; the section on data-ink ratio still scorches.</p>
    <h3>From the inbox</h3>
    <p>Acme is shipping their new design system on May 12. Demo invite landed Tuesday — sneak peek looks deeply impressive.</p>
    <h3>Coming up</h3>
    <p>Tokyo trip 4–11 May. Dispatches likely.</p>
  </div>
</body></html>
```

## Examples

**Input:** "Compile this week's reading list as a newsletter"
**Filename:** `roundup-issue-042-2026-04-29.pdf`
**Returns:** "Issue 042 — 4 sections, 9 items."

**Input:** "Make a digest of my saved-for-later articles from last month"
**Filename:** `digest-2026-04-29.pdf`
**Returns:** "Digest — 5 sections, 14 items."
