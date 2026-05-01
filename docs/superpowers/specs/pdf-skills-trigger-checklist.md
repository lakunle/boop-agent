# PDF Skills Trigger Checklist

Manual verification that each `pdf-*` skill auto-engages on its intended phrases. Run from the dashboard Chat tab or via real iMessage.

For each row: text the prompt, watch the server logs for the expected `[agent ...] tool: Skill (<skill-name>)` line and the subsequent `tool: generate_pdf`. If the wrong skill fires (or none fires), tighten that skill's frontmatter `description` until it triggers reliably.

## pdf-invoice

- [ ] "Invoice $4200 to Acme for the design system" → fires
- [ ] "Bill Acme $4200 for design work" → fires
- [ ] "Send me a receipt PDF for the $42 lunch" → fires
- [ ] "Make me an expense report PDF for last week" → fires

## pdf-brief

- [ ] "Summarize today as a PDF brief" → fires
- [ ] "Morning brief PDF" → fires
- [ ] "Meeting prep PDF for the 11:30 with Acme" → fires
- [ ] "Weekly review PDF" → fires
- [ ] "Schedule for Monday" → does NOT fire (this is a calendar lookup, no PDF)
- [ ] "Investor brief PDF for Mise.AI" → does NOT fire (use pdf-pitch instead)
- [ ] "Co-founder brief / pitch deck" → does NOT fire (use pdf-pitch instead)

## pdf-pitch

- [ ] "Make me a pitch deck for Mise.AI" → fires
- [ ] "Investor brief PDF — 10 slides" → fires
- [ ] "Co-founder brief deck" → fires
- [ ] "Slide deck about our pricing change" → fires
- [ ] "Fundraising deck for the seed round" → fires
- [ ] "Sales deck for Acme" → fires
- [ ] "Morning brief PDF" → does NOT fire (use pdf-brief instead)
- [ ] Visually verify: each slide is one landscape page, the cover background is full-bleed (no white margin around it), and no slide overflows / clips the next page.

## pdf-itinerary

- [ ] "Plan my Tokyo trip May 4–11 as a PDF" → fires
- [ ] "Make me an itinerary PDF for Friday" → fires
- [ ] "Agenda PDF for the team offsite" → fires
- [ ] "What's on my calendar Friday" → does NOT fire (calendar lookup)

## pdf-resume

- [ ] "Build me a resume from my LinkedIn data" → fires
- [ ] "One-pager PDF about me for the conference" → fires
- [ ] "CV PDF" → fires

## pdf-newsletter

- [ ] "Compile this week as a newsletter PDF" → fires
- [ ] "Make a digest PDF of my saved articles" → fires
- [ ] "Weekly roundup PDF" → fires

## pdf-reference

- [ ] "Make me a cheat sheet for git rebase" → fires
- [ ] "Quick reference PDF for the Convex API" → fires
- [ ] "Pack list PDF for Tokyo" → fires
- [ ] "Glossary PDF for the company terms" → fires

## boop-design auto-engagement

- [ ] When any `pdf-*` skill runs, the agent should ALSO invoke `boop-design` (visible in the agent log as a separate `Skill` tool call, ideally before `generate_pdf`)
- [ ] Open one rendered PDF per kind. Visually verify against the boop-design laws:
  - [ ] OKLCH only (no hex / hsl)
  - [ ] Heading/body weight contrast ≥1.25 stops
  - [ ] One accent color per page, ≤10% surface coverage
  - [ ] No banned patterns: gradient text, side-stripe accents, decorative glassmorphism
  - [ ] Body line-length 65–75ch
  - [ ] Body line-height 1.5–1.6
