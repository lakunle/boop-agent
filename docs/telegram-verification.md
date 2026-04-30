# Telegram Channel — Manual Verification

Run through this after the implementation lands. Every checkbox is something a
human needs to eyeball; the smoke script (`npm run telegram:smoke`) covers a
subset automatically.

## Setup prerequisites

- [ ] `.env.local` has `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- [ ] You messaged the bot once and ran `npm run telegram:approve` to add your chat_id
- [ ] `npm run dev` shows the Telegram banner lines

## Telegram inbound — text

- [ ] Send "hello" → bot replies on Telegram
- [ ] Send a question that requires an integration (e.g. "what's on my calendar?") → ack appears, then result
- [ ] Send a long message (>500 chars) → reply is properly chunked

## Telegram inbound — voice

- [ ] Send a short voice note (~10s, English) → reply is the agent answering, with the voice transcript visible in Convex `messages` as `🎤 (voice 0:0X) ...`
- [ ] Send a 15-min voice note → bot replies "longer than I can transcribe" without making a Whisper call (verify in `usageRecords` — no transcribe row)
- [ ] Temporarily unset `OPENAI_API_KEY` and restart, send a voice note → bot replies "Voice notes need OPENAI_API_KEY..."
- [ ] Send mostly silence → bot replies "I couldn't hear that"

## Telegram inbound — non-text/non-voice

- [ ] Send a photo, sticker, or document → no reply, server logs `skipped` (intended)
- [ ] Edit a sent message → no reply (intended)

## Telegram inbound — group chat

- [ ] Add bot to a group, send "hello" → no reply, log shows `chat_id < 0` skip

## Allowlist

- [ ] From an account NOT in the allowlist (a friend's account, with their permission) → bot stays silent, server log shows `denied chat_id=...`, `npm run telegram:approve` lists the entry
- [ ] Approve the entry → friend can now message the bot
- [ ] Add a chat_id to `TELEGRAM_ALLOWED_CHAT_IDS` env var, restart → that chat_id works without needing approval

## Active channel switching

- [ ] On iMessage: text "use telegram now" → reply confirms, automation results 5 min later land on Telegram
- [ ] On Telegram: text "switch back to imessage" → reply confirms, next automation lands on iMessage
- [ ] Try "use telegram" without ever messaging Telegram → bot refuses with "text @bot once first"
- [ ] Unset `TELEGRAM_BOT_TOKEN`, restart, text "use telegram" → bot refuses with config hint

## Cross-channel context (Q3 = C)

- [ ] On iMessage at T=0: "remember I'm meeting Sarah at 2pm tomorrow"
- [ ] On Telegram at T+5min: "what time was that meeting?"
- [ ] Bot recalls 2pm without needing `recall()` (verify by watching server logs — no `tool: recall` line)

## Regressions on iMessage

- [ ] Text round-trip on iMessage works identically
- [ ] PDF generation in iMessage arrives as attachment
- [ ] `send_ack` shows up before slow tool calls
- [ ] Automation creation, run, and notify still works
- [ ] Proactive nudges land on the active channel (test by switching active channel between iMessage and Telegram and observing where the next nudge appears)

## Stress

- [ ] Stop server mid-Telegram-turn → restart → no crash; the in-flight update_id is in `telegramDedup` so the retry is dropped
- [ ] Block the bot in Telegram client → next outbound send logs an error, server doesn't crash
- [ ] Set `activeChannel` to `tg` then unset `TELEGRAM_BOT_TOKEN` and restart → boot warning appears, automations fail silently with log line

## Cost tracking

- [ ] After a few voice notes, `usageRecords` has rows with `source="transcribe"` and reasonable `costUsd` values
- [ ] Debug dashboard's cost tile shows transcribe cost alongside dispatcher / execution costs (if the dashboard surfaces all sources)
