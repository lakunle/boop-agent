---
name: pdf-reference
description: Generate a beautifully designed cheat sheet, quick reference, or glossary as a PDF. Use when the user asks for a cheatsheet, quick reference, packing list, glossary, API reference, command reference, or "make me a one-page cheat sheet for X". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-reference

You produce a dense, scannable, look-it-up-fast reference document.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Gather the reference content. Required: title, sections, key/value pairs (or term/definition pairs). Pull from docs / WebSearch / memory as needed.
3. Apply the layout in §Layout.
4. Generate HTML using §Template.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "reference" }`.
6. Return ONE short summary line. Example: "Convex cheat sheet — 18 entries across 4 sections."

## Layout (reference-specific)

- Single column, 70ch.
- Section headings: H2.
- Body: a 2-column inner grid for term/definition. Term in monospace + accent color. Definition in body type.
- ONE accent color on the term column.
- No prose blocks. Lists, definitions, or rows only.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 22mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.5; font-size: 13px; max-width: 75ch; }
  .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
  h1 { font-size: 28px; font-weight: 700; margin: 4px 0 4px; letter-spacing: -0.02em; }
  .summary { color: var(--muted); margin: 0 0 18px; padding-bottom: 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 18px 0 8px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 220px 1fr; gap: 4px 16px; }
  .grid .term { font-family: ui-monospace, SF Mono, Menlo, monospace; color: var(--accent); font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--line); }
  .grid .def { padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
</style></head><body>
  <div class="meta">Cheat sheet · Convex</div>
  <h1>Convex quick reference</h1>
  <p class="summary">Most-used functions and patterns. Index names follow the by_field1_and_field2 convention.</p>

  <h2>Function definitions</h2>
  <div class="grid">
    <div class="term">query()</div><div class="def">Define a read function. Read-only access to the DB; transactional.</div>
    <div class="term">mutation()</div><div class="def">Define a write function. Read + write; transactional.</div>
    <div class="term">action()</div><div class="def">HTTP-callable function with side effects. Can call ctx.runQuery / ctx.runMutation.</div>
    <div class="term">internalQuery / internalMutation</div><div class="def">Like query / mutation but private — only callable from other Convex code.</div>
  </div>

  <h2>Schema and validators</h2>
  <div class="grid">
    <div class="term">defineSchema</div><div class="def">Top-level schema declaration in convex/schema.ts.</div>
    <div class="term">defineTable({...})</div><div class="def">Table definition with field validators.</div>
    <div class="term">v.id("table")</div><div class="def">Reference to a row in another table.</div>
    <div class="term">v.union(...)</div><div class="def">Discriminated union via v.literal(...) members.</div>
    <div class="term">.index("by_x_and_y", ["x", "y"])</div><div class="def">Index on multiple fields. Order matters.</div>
  </div>

  <h2>Storage</h2>
  <div class="grid">
    <div class="term">ctx.storage.store(blob)</div><div class="def">Upload a blob. Returns Id&lt;"_storage"&gt;.</div>
    <div class="term">ctx.storage.getUrl(id)</div><div class="def">Long-lived signed URL for a stored file.</div>
  </div>

  <h2>Calling between functions</h2>
  <div class="grid">
    <div class="term">ctx.runQuery(api.x.f, args)</div><div class="def">Call a query from a mutation or action.</div>
    <div class="term">ctx.runMutation(internal.x.g, args)</div><div class="def">Call an internal mutation from an action.</div>
  </div>
</body></html>
```

## Examples

**Input:** "Make me a one-page cheat sheet for git rebase"
**Filename:** `cheatsheet-git-rebase-2026-04-29.pdf`
**Returns:** "Git rebase cheat sheet — 12 entries across 3 sections."

**Input:** "Pack list for Tokyo, weather will be 18–22°C"
**Filename:** `packlist-tokyo-2026-05-04.pdf`
**Returns:** "Pack list — 26 items across 5 sections."
