# Nigat ንጋት: voice coach for waking up early and staying productive

Nigat ("dawn") is a personal agent you talk to in **Amharic or English**. It sets alarms and reminders, logs wake-ups and keeps a streak, gives you a morning briefing, tracks tasks, keeps a journal, and **remembers what you tell it about yourself** so it gets better the more you use it.

Claude (`claude-opus-5-5`) does the thinking, and a small set of tools lets it act on your data. Everything is stored on your machine in `data/state.json`.

## Use it on your phone (no computer needed)

The `docs/` folder is a complete version that runs **entirely in your browser**. GitHub Pages hosts it for free and gives you an https link.

1. **Turn on GitHub Pages (one time):** go to the repo's **Settings › Pages**. Under *Build and deployment*, choose **Deploy from a branch**, pick branch **`claude/voice-productivity-agent-en2jj5`** and folder **`/docs`**, then **Save**.
2. After a minute, open **https://bisrat-k.github.io/Bisrat-K/** in Chrome on your phone.
3. Tap **Start · ጀምር** and paste your Anthropic API key. Create one at https://console.anthropic.com/settings/keys, and set a monthly spend limit on it.
4. In Chrome's menu, choose **Add to Home screen** so it opens like an app.

In this version, your key and everything Nigat learns are stored **only on that phone**. The key is sent only to Anthropic. Use **Download backup** and **Restore backup** (under *What Nigat knows about you*) to move your data to another device.

After changing the code, rebuild the phone version with `npm run build:web` and commit `docs/`.

## Run it on a computer (server version)

```bash
npm install
cp .env.example .env        # then put your Anthropic API key in .env
npm start                   # open http://localhost:3000 in Chrome
```

## Things to try

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

## Running the server version for your phone

If you'd rather keep your key on a server instead of the phone, run the server version somewhere you control:

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
server.js            HTTP server (computer version)
src/agent.js         Claude agent: system prompt, context, tools
src/routes.js        The app's API, shared by the server and phone versions
src/store.js         Data: settings, memories, tasks, alarms, wake log, journal
src/persist-file.js  Saves data to data/state.json (server)
src/time.js          Timezone + Ethiopian-clock helpers
public/              Voice web app (Web Speech API, alarms, panels)
web/                 Phone-version glue: localStorage + direct Claude calls
docs/                Built phone version served by GitHub Pages (npm run build:web)
test/              node --test unit tests
```

## Adding new abilities

Each ability is a tool in `makeTools()` in `src/agent.js`: a name, a description, a zod input schema and a `run` function. To add one (a habit tracker, Bible or Quran reading plans, a workout log, calendar sync, and so on), store its data in `src/store.js`, add a tool, and if Nigat should always know about it, add a line in `buildContext()`.
