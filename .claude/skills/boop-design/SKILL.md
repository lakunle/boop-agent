---
name: boop-design
description: Boop's design law book. Use when generating any visual artifact (PDFs, HTML, slide layouts) to enforce typography, color (OKLCH), spacing, and motion rules. Required reading before producing visual output.
user-invocable: false
---

# Boop Design Skill

When any design task arrives — a screenshot, a Figma link, a PRD, a question about UI — load this skill first. It defines how to think, what to check, and what to produce.

---

## 1. Design Laws

These are non-negotiable. Violations are always flagged, regardless of task type.

### Color
- Use **OKLCH** color space exclusively for any color specification. Never hex-first, never HSL-first.
- All color values must have **semantic names** (`color-action-primary`, `color-feedback-error`) — never bare values in specs.
- **One Voice Rule**: one accent color, ≤10% surface coverage. A page with three "accent" colors has no accent.
- Surfaces should be near-neutral. Color earns meaning through restraint.
- Status must never be communicated by color alone (WCAG 1.4.1). Always pair with icon, label, or pattern.

### Typography
- Body line length: **65–75 characters maximum**. Beyond that, the eye loses the return trip.
- Weight contrast between heading and body: **≥1.25 stops** on the type scale. If the hierarchy isn't visible, it isn't hierarchy.
- **Never use Inter without a reason.** Inter is a default, not a choice. If a product is using Inter, ask: *why this face, not another?* If the answer is "it was the default," flag it.
- Minimum body text: **16px / 1rem**. No exceptions for "secondary" or "supporting" copy.
- Line-height for body: **1.5–1.6**. For headings: **1.1–1.25**.

### Layout
- **Vary spacing deliberately.** Uniform 16px everywhere is not a spacing system — it's an absence of one. Use a scale (4/8/12/16/24/32/48/64) and choose intentionally.
- **No card nesting.** A card inside a card creates depth without meaning. Flatten.
- **No identical card grids.** If all cards are the same size, weight, and content shape, you have a list with padding. That's fine — call it a list.
- Whitespace is not empty space. It is the loudest element on the page.

### Motion
- **Easing: ease-out exponential** for entrances. Things that arrive should decelerate, as if placing an object down.
- **Never animate layout properties** (height, width, top, left, margin, padding). Animate transform and opacity only.
- **No bounce easing in product UI.** Bounce belongs in games and onboarding celebrations, not in data tables.
- Duration: 150–250ms for micro-interactions, 300–400ms for page-level transitions.

### Absolute Bans
These patterns are blocked. If found, flag as **blocking severity** regardless of execution quality.

| Anti-Pattern | Why Banned |
|---|---|
| Side-stripe "accent" borders (left-border as visual interest) | Decoration masquerading as structure |
| Gradient text | Legibility hazard; WCAG failure risk; visual noise |
| Decorative glassmorphism | Backdrop blur without functional meaning is pixel waste |
| Hero-metric card templates (big number, label, sparkline, repeated ×6) | Copy-paste dashboards that communicate nothing |
| Modal-first thinking | Modals interrupt. Use inline, drawer, or contextual disclosure first |

---

## 2. Design Critique Protocol

Use this when asked to review a design, screenshot, or Figma output.

### Step 1: Load Context
Before scoring anything, establish:
- **What product is this?** (tool, consumer app, dashboard, marketing site)
- **Who is the user?** (technical, non-technical, high-frequency, occasional)
- **What platform?** (iOS, Android, web desktop, web mobile, cross-platform)
- **What moment in the journey?** (first use, habitual use, recovery, offboarding)

If context is missing, ask for it before proceeding. A critique without context is noise.

### Step 2: Heuristic Scan

Score each dimension **1–5** with at least one specific piece of evidence. Do not give 3s without explanation — "average" is not an observation.

| Dimension | What to Evaluate |
|---|---|
| **Typography** | Scale, weight contrast, line length, font choice, hierarchy legibility |
| **Color** | Palette restraint, semantic clarity, contrast ratios, One Voice compliance |
| **Layout** | Spacing system, alignment, information density, visual rhythm |
| **Hierarchy** | Can you tell what to look at first, second, third? |
| **Interaction** | Are affordances visible? Are states (hover, active, disabled, loading) defined? |
| **UX Writing** | Are labels clear, buttons action-object, errors recoverable? |

### Step 3: Anti-Pattern Scan
Cross-reference against the Anti-Pattern Detector (Section 5). List every hit with its severity.

### Step 4: Flag and Prioritize
Severity levels:
- **Blocking** — ships broken (WCAG failure, missing states, absolute ban violation)
- **Major** — ships diminished (hierarchy failure, unclear affordances, copy-paste template)
- **Minor** — ships slightly worse (spacing inconsistency, weight could be stronger)

### Step 5: Output

Produce:
1. **Scores** — 6 dimensions, 1–5, one-line evidence each
2. **Anti-patterns found** — list with severity
3. **Top 3 Fixes** — ordered by impact, written as actionable instructions, not observations

> ✅ Format: Score table → Anti-pattern list → 3 numbered fixes. No more than 400 words total unless depth was requested.

---

## 3. PRD Design Review Protocol

Use this when asked to review a product spec, requirements doc, or feature brief for design gaps.

### Gate Check
First: is this a PRD (requirements/spec) or a design (visual artifact)? If it's a design, use Section 2 instead.

### The Six Gap Checks

Run each check in order. For each: **pass**, **partial**, or **missing** — and if partial or missing, write the specific gap.

**Check 1: Are user flows described visually or only textually?**
- Pass: flows are diagrammed, or steps are numbered with explicit branching logic
- Partial: flows are described in prose but branching is implicit
- Missing: "the user navigates to the settings page" with no entry/exit/error path

**Check 2: Are edge cases covered?**
Specifically look for:
- Empty state (first use, zero results, cleared data)
- Error state (network failure, validation failure, permission denied)
- Loading state (initial load, pagination, async action in progress)
- Partial data (one item, one character, maximum limits)

Flag each missing state by name.

**Check 3: Is the interaction model explicit?**
- Tap target sizes specified (minimum 44×44pt / 48×48dp)?
- Gestures named and fallback defined?
- Transitions described (what animates, how, when)?
- Keyboard/focus order considered?

**Check 4: Is UX writing specified?**
- Button labels defined (not just "CTA")?
- Error messages written out, not described?
- Empty state copy provided?
- Confirmation dialogs written?

If UX writing is deferred ("copy TBD"), flag it — copy is not a finishing step, it is a structural decision.

**Check 5: Are accessibility requirements present?**
- WCAG level target stated (AA minimum)?
- Screen reader behavior described for custom components?
- Color contrast requirements referenced?
- Focus management for modals/drawers specified?

**Check 6: Are design system constraints referenced?**
- Does the spec reference existing components or invent new ones?
- Are new components justified?
- Is the spec consistent with platform conventions (iOS HIG, Material, etc.)?

### Output Format
```
PRD Design Gap Report

✅ Pass | ⚠️ Partial | ❌ Missing

[Check 1–6 results]

Priority Gaps:
1. [Highest impact gap] — [suggested resolution]
2. ...
3. ...
```

---

## 4. UX Writing Rules

Apply these when writing copy in specs, or when critiquing copy in designs.

### Error Messages
**Formula: [What happened] + [Why] + [What to do next]**

- ❌ "Something went wrong."
- ❌ "Error 403."
- ✅ "We couldn't save your changes. Your session expired — sign in again to continue."

Every error message must answer: *can the user recover from this, and do they know how?*

### Buttons
**Format: Action + Object**

- ❌ "OK", "Submit", "Continue", "Yes"
- ✅ "Save changes", "Delete project", "Send invite", "Try again"

The button label should be readable as a sentence fragment the user is authorizing: *I want to [button label].*

Exception: secondary/cancel actions may be single words ("Cancel", "Dismiss") when the primary action is fully labeled.

### Empty States
**Treat as onboarding, not as absence.**

An empty state is the first touchpoint for a feature. It should:
1. Name what would be here when it's not empty
2. Explain why it's empty (first use vs. cleared vs. filtered)
3. Give a single clear action to fill it

- ❌ "No results found."
- ✅ "No projects yet. Create your first project to get started." + [Create project] button

### Microcopy
**Specific beats generic.**

- ❌ "Are you sure?"
- ✅ "Delete 'Q4 Campaign'? This can't be undone."

- ❌ "Loading..."
- ✅ "Loading your projects..." or (better) a skeleton screen with no copy at all

### Tone Calibration
Match the product's register:
- **Tool/productivity**: direct, minimal, never cute
- **Consumer/social**: warm, human, allowed to have personality
- **Health/finance/legal**: calm, confident, never breezy
- **Developer tool**: precise, no hand-holding, trust the user

---

## 5. Anti-Pattern Detector

Run this scan on any design artifact. Flag every hit.

### Visual Anti-Patterns

| Pattern | Severity | How to Spot |
|---|---|---|
| **Gradient text** | Blocking | `background-clip: text` on headings; multi-stop colored gradients on any label |
| **Side-stripe borders** | Blocking | `border-left: 4px solid accent` used as decoration, not status |
| **Hero metric cards × N** | Major | Dashboard with 4–8 identical cards: big number, label, tiny sparkline |
| **Decorative glassmorphism** | Major | `backdrop-filter: blur` on elements with no layering purpose |
| **Rainbow palette** | Major | More than 3 distinct hues in the UI chrome (excluding data visualization) |
| **Flat flat flat** | Minor | Zero elevation, zero contrast between surface levels — everything reads as one plane |

### Typography Anti-Patterns

| Pattern | Severity | How to Spot |
|---|---|---|
| **Inter by default** | Minor–Major | Inter used with no explicit rationale; no alternate considered |
| **Weak hierarchy** | Major | Heading and body differ by ≤1 weight step and ≤2px size |
| **Tiny body text** | Blocking | Any readable body copy below 16px |
| **Measure overflow** | Minor | Text columns wider than ~75 characters |
| **All-caps body** | Major | Paragraphs or sentences in uppercase |

### Interaction Anti-Patterns

| Pattern | Severity | How to Spot |
|---|---|---|
| **Hover-only affordance** | Blocking | Actions only revealed on hover — invisible on touch, keyboard, or first glance |
| **Confirmation modals for simple actions** | Major | "Are you sure?" modal for reversible or low-stakes actions |
| **Missing loading states** | Major | Async actions with no spinner, skeleton, or progress indicator |
| **Disabled buttons without explanation** | Minor | Greyed button with no tooltip or inline copy explaining why |
| **Infinite scroll without escape** | Major | No pagination fallback, no "back to top", no way to link to position |

### Accessibility Anti-Patterns

| Pattern | Severity | How to Spot |
|---|---|---|
| **Color-only status** | Blocking | Red/green used alone to indicate error/success with no icon or label |
| **WCAG AA failure** | Blocking | Text contrast ratio below 4.5:1 (normal), 3:1 (large/bold) |
| **Missing focus styles** | Blocking | `outline: none` or `outline: 0` without a custom visible replacement |
| **Icon-only buttons** | Major | Clickable icons with no accessible label (`aria-label` or visible text) |
| **Motion without respect** | Major | Animations that do not respect `prefers-reduced-motion` |

---

## 6. Commands

When a message matches one of these intents, map it to the corresponding protocol.

### "critique this design" / "give me feedback on this" / "review this UI"
→ Run **Section 2: Design Critique Protocol** in full.
→ Deliver: scores, anti-patterns, top 3 fixes.
→ Ask for context (product, user, platform) if not provided.

### "review PRD for design gaps" / "does this spec cover design?" / "what's missing from this PRD?"
→ Run **Section 3: PRD Design Review Protocol** in full.
→ Deliver: six-check gap report, priority gaps with resolutions.

### "is this good design?" / "what do you think of this?"
→ Quick 3-point assessment only:
  1. Strongest element (what's working and why)
  2. Biggest single problem (most impactful fix)
  3. One anti-pattern flag if found, or "none detected"
→ Under 150 words. Offer full critique if they want more.

### "what's wrong with this?" / "find the problems" / "roast this"
→ Run **Section 5: Anti-Pattern Detector** only.
→ List every hit, sorted by severity (blocking first).
→ No scores, no positives — they asked for problems.

### "write a design spec for X"
→ Produce a structured spec with these sections:
  1. **Overview** — what this feature is, who it's for, what platform
  2. **User flows** — numbered steps with explicit branching (happy path + error path + empty state)
  3. **States** — enumerate every state: default, loading, empty, error, success, disabled, edge cases
  4. **UX writing** — all visible copy: headings, labels, buttons, errors, empty states, confirmations
  5. **Interaction notes** — transitions, tap targets, gestures, keyboard behavior
  6. **Accessibility requirements** — contrast targets, ARIA roles for custom components, focus order
  7. **Open questions** — unresolved decisions that need product/engineering input
→ Apply Section 4 UX Writing Rules throughout.

---

## Boop's Design Voice

When delivering design feedback over iMessage:
- **Short verdict first.** One sentence. Then evidence.
- **Name the problem specifically.** Not "hierarchy could be better" — "the page title and section headers are the same weight, so there's no hierarchy."
- **Give the fix, not just the diagnosis.** Every flag should end with a direction.
- **Don't soften blocking issues.** "This fails WCAG AA" is accurate and kind. Softening it ("might want to consider contrast") makes it ignorable.
- **Celebrate what works.** Good design decisions deserve acknowledgment. It sharpens the credibility of the critique.
