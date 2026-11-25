# Nigat ንጋት: voice coach for waking up early and staying productive

Nigat ("dawn") is a personal agent you talk to in **Amharic or English**. It sets alarms and reminders, logs wake-ups and keeps a streak, gives you a morning briefing, tracks tasks, keeps a journal, and **remembers what you tell it about yourself** so it gets better the more you use it.

Claude (`claude-opus-5-5`) does the thinking, and a small set of tools lets it act on your data. Everything is stored on your machine in `data/state.json`.

## Quick start

```bash
npm install
cp .env.example .env        # then put your Anthropic API key in .env
npm start                   # open http://localhost:3000 in Chrome
```

1. Tap **Start · ጀምር** and allow the microphone and notifications.
2. Choose **አማርኛ** or **English**, tap the mic, and speak.
3. Try:
   - "ከሰኞ እስከ አርብ ጠዋት 11:30 ላይ አስነሳኝ" / "Wake me up at 5:30 every weekday"
   - "I want to get up at 5 eventually. Right now I wake up at 7."
   - "ዛሬ ሪፖርቱን መጨረስ አለብኝ" / "Add: finish the report today, high priority"
   - "Remind me to start winding down at 9:15 every night"
   - "Let's do my evening review"

## How it gets better

- **Memory.** When you mention something lasting (goals, schedule, prayer or quiet time, work, what motivates you, what doesn't work), Nigat saves it on its own, without being asked. You can see and delete these memories under *What Nigat knows about you*.
- **History.** Your wake-up log, streak, tasks and journal go into every conversation, so its advice is based on how you've actually been doing.
- **Teaching it directly.** Say "Remember that…" or "From now on, …". If you want a lasting change to its personality or rules, edit `SYSTEM_PROMPT` in `src/agent.js`.

## Voice support (read this)

| | Chrome on Android | Chrome on desktop | Safari on iPhone |
|---|---|---|---|
| Speaking to it in English | ✅ | ✅ | ✅ |
| Speaking to it in Amharic | ✅ (`am-ET`) | ✅ | ⚠️ usually not supported, so type instead |
| Hearing replies in English | ✅ | ✅ | ✅ |
| Hearing replies in Amharic | ✅ if an Amharic voice is installed* | depends on the OS | ❌ shown as text |

\*Android: **Settings › System › Text-to-speech › Google › install Amharic**. If the device has no Amharic voice, Amharic replies show up as text and the app tells you so.

- The microphone only works over **https** or on **localhost**.
- **Alarms only ring while the app is open.** Before you sleep, tap **Night mode**: it keeps the screen on and dims it. Leave the phone plugged in, and keep your normal phone alarm as a backup until you trust it.
- When the alarm rings, tap **I'm up! · ተነስቻለሁ!**. That logs your wake-up time and starts your morning briefing.

## Using it from your phone

The server holds your API key, so run it somewhere you control:

- **Same computer:** open `http://localhost:3000`.
- **Phone:** the mic needs https. Either deploy to a host that gives you https (Render, Railway, Fly.io, a VPS with Caddy) or put an https tunnel in front of your computer (for example `cloudflared tunnel --url http://localhost:3000`). In both cases:
  - set `HOST=0.0.0.0` and a strong **`APP_PASSCODE`** in `.env`; the app asks for the passcode once
  - make sure `data/` is on persistent storage, because that's your coach's memory
- Then open the page in Chrome and choose **Add to Home screen**.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none, required) | Your key from console.anthropic.com |
| `APP_PASSCODE` | empty | Required by the app if set. **Set it whenever the app can be reached from outside your own computer.** |
| `TIMEZONE` | `Africa/Addis_Ababa` | Used for alarms and "today" |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Where the server listens |
| `COACH_MODEL` | `claude-opus-5-5` | Claude model |
| `COACH_EFFORT` | `low` | `low` gives the fastest voice replies; `medium` or `high` think harder |

The server-side refusal fallback (`fallbacks: "default"`) is on, so if the main model declines a request, another model answers it.

## Project layout

```
server.js          HTTP server + JSON API (no framework)
src/agent.js       Claude agent: system prompt, context, tools
src/store.js       JSON storage: settings, memories, tasks, alarms, wake log, journal
src/time.js        Timezone + Ethiopian-clock helpers
public/            Voice web app (Web Speech API, alarms, panels), installable as a PWA
test/              node --test unit tests
```

## Adding new abilities

Each ability is a tool in `makeTools()` in `src/agent.js`: a name, a description, a zod input schema and a `run` function. To add one (a habit tracker, Bible or Quran reading plans, a workout log, calendar sync, and so on), store its data in `src/store.js`, add a tool, and if Nigat should always know about it, add a line in `buildContext()`.
