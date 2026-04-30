---
name: pdf-resume
description: Generate a beautifully designed resume, CV, or one-page profile as a PDF. Use when the user asks for a resume, CV, one-pager, profile sheet, or "build me a resume from <data source>". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-resume

You produce a single-page (strict — no overflow) resume or one-page profile.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Gather data. Required: name, role/title, contact, experience (3–5 entries with dates), skills. Optional: education, projects, links. Pull from memory or ask if missing.
3. Apply the strict layout in §Layout. ONE PAGE. If content overflows, the agent must trim — it's not a brochure.
4. Generate HTML using §Template.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "resume" }`.
6. Return ONE short summary line. Example: "Resume — 4 roles, 8 skills, single page."

## Layout (resume-specific)

- Two-column: dark sidebar on left (32% width), main on right (68%). Use a flex/grid layout that's tested at A4.
- Sidebar: name (white, large), title, contact, skills.
- Main: experience (most weight), education, optional projects.
- ONE accent color, used only on a thin underline below the name.
- Strict 1-page constraint: agent must trim content to fit.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 0; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); --dark: oklch(20% 0 0); --dark-fg: oklch(95% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.5; font-size: 11px; }
  .page { display: grid; grid-template-columns: 32% 1fr; min-height: 297mm; }
  .sidebar { background: var(--dark); color: var(--dark-fg); padding: 28px 22px; }
  .sidebar .name { font-size: 22px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; padding-bottom: 6px; border-bottom: 2px solid var(--accent); margin-bottom: 4px; }
  .sidebar .title { font-size: 11px; opacity: 0.7; margin-bottom: 24px; }
  .sidebar h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.5; margin: 18px 0 6px; font-weight: 600; }
  .sidebar p { margin: 0 0 4px; font-size: 11px; }
  .sidebar ul { margin: 0; padding: 0; list-style: none; font-size: 11px; line-height: 1.7; }
  .main { padding: 28px 28px; }
  .main h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 0 0 8px; font-weight: 600; }
  .main h2:not(:first-child) { margin-top: 18px; }
  .role { margin-bottom: 12px; }
  .role .head { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; }
  .role .when { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .role .where { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
  .role ul { margin: 0; padding-left: 16px; font-size: 11px; line-height: 1.5; }
  .role li { margin: 2px 0; }
</style></head><body>
  <div class="page">
    <div class="sidebar">
      <div class="name">Lakunle<br/>Akinde</div>
      <div class="title">Designer · Engineer</div>
      <h3>Contact</h3>
      <p>hello@example.com</p>
      <p>Lagos, Nigeria</p>
      <h3>Skills</h3>
      <ul>
        <li>TypeScript / React</li>
        <li>Design Systems</li>
        <li>Convex / Postgres</li>
        <li>Product Strategy</li>
      </ul>
      <h3>Tools</h3>
      <ul><li>Figma</li><li>Linear</li><li>Notion</li></ul>
    </div>
    <div class="main">
      <h2>Experience</h2>
      <div class="role">
        <div class="head"><span>Meridian Studio</span><span class="when">2023 – present</span></div>
        <div class="where">Founder · Remote</div>
        <ul>
          <li>Build personal-agent infrastructure on top of Claude Agent SDK and Convex.</li>
          <li>Lead 4-person team across design, product, and engineering.</li>
        </ul>
      </div>
      <div class="role">
        <div class="head"><span>Acme Inc.</span><span class="when">2020 – 2023</span></div>
        <div class="where">Staff Engineer · NYC</div>
        <ul>
          <li>Architected the design-system shared infra used by 60+ engineers across 14 teams.</li>
          <li>Migrated 1.2M LOC from Webpack to Vite over two quarters.</li>
        </ul>
      </div>
      <h2>Education</h2>
      <div class="role">
        <div class="head"><span>BSc Computer Science</span><span class="when">2018</span></div>
        <div class="where">University of Lagos</div>
      </div>
    </div>
  </div>
</body></html>
```

## Examples

**Input:** "Build me a resume from my LinkedIn data" (with the data passed in)
**Filename:** `resume-lakunle-akinde-2026-04-29.pdf`
**Returns:** "Resume — 4 roles, 8 skills, single page."

**Input:** "Make a one-pager about me for the conference badge"
**Filename:** `one-pager-2026-04-29.pdf`
**Returns:** "One-pager — single page, 6 sections."
