# Changelog

Notable changes per release. `[BREAKING]` entries require action on your fork — `/upgrade-boop` will surface these and offer to run the relevant migration skill.

Format:
- One section per release.
- Prefix breaking items with `[BREAKING]` and include a migration path (ideally a skill to run).

---

## Unreleased — Proactive email surfacing

- Added: webhook-driven Gmail watcher. On boot (or on every `npm run dev` ngrok URL change), Boop registers a project-level webhook subscription against Composio's `/api/v3.1/webhook_subscriptions` endpoint and a `GMAIL_NEW_GMAIL_MESSAGE` trigger instance per active Gmail connection. When Composio fires `composio.trigger.message`, the new `POST /composio/webhook` route verifies the HMAC signature, runs a Haiku classifier, and on a positive decision routes the summary into the interaction agent as a synthetic `role="system"` message — the IA decides the iMessage tone and any follow-up.
- Added: `server/composio-webhook.ts` — REST helpers (`GET/POST/PATCH/DELETE /api/v3.1/webhook_subscriptions`) plus `ensureWebhookSubscription(publicUrl)` that POSTs once or PATCHes the URL on subsequent runs, persisting the returned signing secret to the existing `settings` table.
- Added: `server/proactive-email.ts` — `handleEmailEvent`, `classifyEmailImportance` (hardcoded rubric + recall of `preference`-segment memories so the user can teach it via `write_memory`), `dispatchProactiveNotice`, and `ensureProactiveWatcher` for the boot setup. Per-connection warmup safeguard skips classification on the first event after a process boot.
- Added: `scripts/composio-webhook.ts` (one-shot tsx) + auto-call from `scripts/dev.mjs` on every ngrok URL change. Set `COMPOSIO_AUTO_WEBHOOK=false` to opt out.
- Added: `BOOP_USER_PHONE` env var in `.env.example` — required to dispatch proactive notices.
- Added: `kind?: "user" | "proactive"` parameter on `handleUserMessage` (server/interaction-agent.ts). Proactive messages persist with `role="system"` so they don't pollute the user-message history.
- Added: `proactive` source on `usageRecords` so the classifier's per-event cost rolls up cleanly in `usageRecords:summary`.
- Added: `ensureTrigger(triggerSlug, connectedAccountId)` helper in `server/composio.ts`.
- Added: classifier rubric tightening — drops cold outreach disguised as personal (sales pitches with first-name greetings on prospecting domains), user's-own-SaaS form submissions (UserJot/Canny/Webflow Forms/Formspark/Tally), user-initiated auth flows (magic-link sign-ins), expired deadlines, and low-severity automated scans. Summary writing rule now requires second-person framing so notices don't refer to the user in the third person.
- Added: user-identity injection. Classifier prompt now includes the user's connected Gmail addresses so it can reason about self-sends/forwards across accounts. Cached for 30 minutes per process.
- Added: deterministic self-send pre-filter in `handleEmailEvent`. If `sender` matches any user identity, the event drops before reaching the LLM — cheaper, can't be argued out of by a clever email body.
- Added: `proactive_enabled` flag in the `settings` table (default true) plus a new **Settings** tab in the Debug UI with a toggle. Flipping the toggle silences proactive notices within ~30s without disconnecting Gmail. Read in `handleEmailEvent` via `isProactiveEnabled()` (cached, 30s TTL).
- Fixed: proactive dispatch was running the IA but never sending the IA's reply over iMessage — `handleUserMessage` only sends from inside `send_ack`; the final reply is the caller's responsibility (matches the user-driven path in `server/sendblue.ts`). `dispatchProactiveNotice` now sends and persists the reply, with a fallback to the raw classifier summary if the IA stays silent.

## Unreleased — Self-inspection & runtime model switching

- Added: `server/self-tools.ts` — interaction-agent MCP server (`boop-self`) exposing `get_config`, `list_integrations`, `search_composio_catalog`, `inspect_toolkit`, and `set_model`. Lets the user ask Boop about its own configuration from iMessage without spawning a sub-agent.
- Added: runtime model override via `convex/settings.ts` + `server/runtime-config.ts`. Both the dispatcher and execution agent now read the model from a Convex-backed setting on each turn (with 30s in-memory cache and `BOOP_MODEL` fallback). User can say "use opus" / "switch to sonnet" / "make it faster (haiku)" from iMessage; takes effect on the next turn. Aliases: `opus`, `sonnet`, `haiku`.
- Added: `agentLogs.accounts` field — each tool_use row now records which Composio account aliases were targeted (e.g. `gmail_charry-fusc`). Surfaced as a small badge in the debug UI's agent timeline. Pulled from `account` / `connectedAccountId` / `tools[].account` in tool input.
- Added: new Convex `settings` table (key/value/updatedAt) and `convex/settings.ts` with `get` / `set` / `clear`.
- Fixed: per-connection identity lookup. `fetchToolkitIdentity` was calling `composio.tools.execute` without a `connectedAccountId`, so multiple Gmail / Slack / etc. connections all got labeled with the user's *default* account email. Now scoped per connection — the Connections panel shows the correct email per row.

## Unreleased — Composio integration layer

- **[BREAKING]** Hand-built integrations (`/integrations/gmail`, `/integrations/google-calendar`, `/integrations/notion`, `/integrations/slack`, `/integrations/_template`) removed. To reconnect equivalents: set `COMPOSIO_API_KEY` in `.env.local`, open the Debug UI's Connections tab, click Connect on the toolkit you want. The dispatcher will see it under the same slug (`gmail`, `slack`, `notion`, `googlecalendar`).
- **[BREAKING]** Convex `connections` table dropped. Composio stores OAuth state on its side. Any existing rows in that table are discarded on the next `convex dev` push.
- **[BREAKING]** `server/oauth.ts` removed. The `/oauth/*` HTTP routes no longer exist. OAuth flows now live at `https://platform.composio.dev`.
- **[BREAKING]** Env vars removed: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_ACCESS_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_USER_TOKEN`, `NOTION_TOKEN`. Delete from `.env.local`.
- Added: `server/composio.ts`, `server/composio-routes.ts`, `server/integrations/composio-loader.ts`, `debug/src/components/ComposioSection.tsx`.
- Added: `@composio/core`, `@composio/claude-agent-sdk` npm deps.
- Added: env vars `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID` (optional, defaults to `boop-default`).
- Added: `/upgrade-boop` Claude Code skill for bringing upstream changes into a customized fork.
- Added: `CHANGELOG.md` and `CONTRIBUTING.md`.
- Fixed: Sendblue links updated from `sendblue.co` to `sendblue.com` (the `.co` host 301-redirects; API base aligned with Sendblue's own docs).
