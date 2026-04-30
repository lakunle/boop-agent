# `assets/voice-smoke.ogg` — placeholder

This repo intentionally does NOT ship a binary `voice-smoke.ogg` because the
environment that authored these changes did not have `ffmpeg` available, and
committing a fake/empty `.ogg` would be misleading.

## What the fixture is

A 2–3 second OGG/Opus voice clip saying *"hello boop testing"*. Used as the
audio body of the opt-in voice path in `scripts/telegram-smoke.mjs` (Task 32).

Note: the smoke test does NOT actually upload this file to Telegram — instead
it posts a synthetic webhook `update` referencing a real Telegram `file_id`
that the user obtains by manually sending a voice note to the bot. The
fixture lives in `assets/` so a contributor can do that manual `sendVoice`
once and then re-use the resulting `file_id` via `TELEGRAM_SMOKE_FILE_ID`.

## How to generate (macOS)

```bash
say "hello boop testing" -o /tmp/voice-smoke.aiff
ffmpeg -i /tmp/voice-smoke.aiff -c:a libopus -b:a 24k assets/voice-smoke.ogg
rm /tmp/voice-smoke.aiff
```

Install `ffmpeg` via Homebrew if missing: `brew install ffmpeg`.

## How to use after generating

1. Send the file to your bot once via Telegram's `sendVoice` API (or just
   record a voice note in the Telegram client) so Telegram caches it on its
   CDN and assigns it a `file_id`.
2. Grab that `file_id` from `getUpdates` or your webhook log.
3. Export it: `export TELEGRAM_SMOKE_FILE_ID=<that file_id>`.
4. Run `npm run telegram:smoke` — the voice path will now exercise the
   Whisper transcription + 🎤 marker assertion.

Once a real OGG is generated and committed, this placeholder file should be
deleted.
