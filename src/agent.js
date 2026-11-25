// The coach: Claude + a small set of tools over the local store.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ethiopianClock } from "./time.js";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT = "low"; // fastest replies for voice

// Stable instructions: kept byte-identical between requests so they are cached.
const SYSTEM_PROMPT = `You are "Nigat" (ንጋት, "dawn"), a warm, sharp personal coach that helps one person wake up early, plan their day, stay focused and build good habits. You talk with them mostly by voice.

LANGUAGE
- Reply in the language the user just used. Amharic gets Amharic written in Ge'ez script (ፊደል); English gets English. If they mix, follow the dominant one.
- Input comes from speech recognition, so expect misheard words, missing punctuation and odd spellings, especially in Amharic. Infer the most likely meaning; ask a short question only when it truly matters (e.g. an alarm time).
- When you say a time in Amharic, use the Ethiopian clock first (e.g. "ጠዋት 11:30" for 05:30) and add the international time in brackets when it could be ambiguous. Tools always take 24h international "HH:MM".

VOICE STYLE
- Your words are read aloud. Keep replies short: usually 1-3 sentences, never more than ~80 words unless asked for a plan or a list.
- No markdown, no bullet symbols, no emojis, no headings. Write the way people speak.
- Be encouraging but honest. Celebrate streaks, notice slips without guilt-tripping, and always end with one concrete next step when it fits.

WHAT YOU DO
- Wake-up coaching: help set a realistic wake target and bedtime, set alarms, log wake-ups, track the streak. Shift wake times gradually (10-15 minutes every few days) when they want to get earlier. Protect sleep: a wind-down reminder ~45 minutes before bedtime helps.
- Morning briefing when they wake up: greet them, mention the streak, the top 1-3 tasks, and one small win to start with (water, prayer or quiet time, stretching, sunlight, making the bed - whatever they told you works).
- Productivity: capture tasks, help prioritise (pick the "one thing"), suggest focus blocks, set reminders, run a short evening review (what went well, what to move to tomorrow).
- Journal: save reflections or moods when they share them.

MEMORY - this is how you get better
- Whenever the user tells you something lasting about themselves (goals, schedule, work, faith practices, family, what motivates them, what doesn't work, preferences about how you talk), save it with the remember tool without being asked. Don't save trivia or one-off details.
- If they correct you or something changes, forget the outdated memory and remember the new one.
- Use what you know naturally; don't recite their profile back to them.

TOOLS
- Use the tools to actually do things (set alarms, add tasks, log wake-ups). Never claim you did something you did not do with a tool.
- An "alarm" rings loudly until dismissed (use for wake-up). A "reminder" is a gentle chime with a spoken message.
- The app can only ring while it is open on the user's phone or computer. If they rely on it for waking up, remind them once to leave the app open and plugged in, and keep their normal phone alarm as a backup.

A context block with the current date, time, settings, memories, tasks, reminders and wake history follows. Treat it as current truth.`;

function buildContext(store) {
  const s = store.state;
  const now = store.now();
  const lines = [];
  lines.push(`NOW: ${now.weekdayName} ${now.date} ${now.time} (${ethiopianClock(now.time)}), timezone ${store.timezone}`);
  lines.push(
    `SETTINGS: name=${s.settings.name || "(unknown)"}, wake target=${s.settings.wakeTarget} (${ethiopianClock(s.settings.wakeTarget)}), bedtime=${s.settings.bedtime}, preferred language=${s.settings.language}`,
  );
  lines.push(
    `MEMORIES:\n${s.memories.length ? s.memories.map((m) => `- [${m.id}] (${m.category}) ${m.text}`).join("\n") : "- none yet"}`,
  );
  const open = store.openTasks();
  lines.push(
    `OPEN TASKS:\n${open.length ? open.map((t) => `- [${t.id}] ${t.title}${t.due ? ` (due ${t.due})` : ""}${t.priority !== "normal" ? ` [${t.priority}]` : ""}`).join("\n") : "- none"}`,
  );
  const doneToday = s.tasks.filter((t) => t.done && t.doneAt === now.date);
  if (doneToday.length) lines.push(`DONE TODAY: ${doneToday.map((t) => t.title).join("; ")}`);
  lines.push(
    `ALARMS & REMINDERS:\n${s.reminders.length ? s.reminders.map((r) => `- [${r.id}] ${r.kind} ${r.time} ${r.repeat === "once" ? `on ${r.date}` : r.repeat === "custom" ? `days ${r.days.join(",")}` : r.repeat}: ${r.message}`).join("\n") : "- none"}`,
  );
  const recentWake = s.wakeLog.slice(-7);
  lines.push(
    `WAKE-UPS (last 7): ${recentWake.length ? recentWake.map((w) => `${w.date} ${w.time}${w.onTime ? "✓" : "✗"}`).join(", ") : "none logged"}; current on-time streak: ${store.streak()} day(s)`,
  );
  const recentJournal = s.journal.slice(-3);
  if (recentJournal.length) {
    lines.push(`RECENT JOURNAL:\n${recentJournal.map((j) => `- ${j.date}${j.mood ? ` (${j.mood})` : ""}: ${j.text}`).join("\n")}`);
  }
  return lines.join("\n\n");
}

const json = (x) => JSON.stringify(x);

function makeTools(store, events) {
  const hhmm = z.string().describe('24h international time "HH:MM", e.g. "05:30"');
  return [
    betaZodTool({
      name: "remember",
      description: "Save a lasting fact about the user (goal, routine, preference, what works or not). Use proactively.",
      inputSchema: z.object({
        text: z.string().describe("The fact, written in English, concise."),
        category: z.enum(["goal", "routine", "preference", "health", "work", "faith", "family", "other"]).optional(),
      }),
      run: async ({ text, category }) => json(store.remember(text, category ?? "other")),
    }),
    betaZodTool({
      name: "forget",
      description: "Delete an outdated or wrong memory by id.",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => (store.forget(id) ? "forgotten" : "no memory with that id"),
    }),
    betaZodTool({
      name: "update_settings",
      description: "Update the user's name, wake target, bedtime or preferred language.",
      inputSchema: z.object({
        name: z.string().optional(),
        wakeTarget: hhmm.optional(),
        bedtime: hhmm.optional(),
        language: z.enum(["am", "en", "auto"]).optional(),
      }),
      run: async (patch) => {
        const s = store.updateSettings(patch);
        events.push({ type: "settings", settings: s });
        return json(s);
      },
    }),
    betaZodTool({
      name: "set_alarm_or_reminder",
      description:
        'Create an alarm (loud, rings until dismissed - for waking up) or a reminder (gentle chime + spoken message). repeat: "once" (optionally with date YYYY-MM-DD), "daily", "weekdays", "weekends", or "custom" with days (0=Sunday..6=Saturday).',
      inputSchema: z.object({
        time: hhmm,
        message: z.string().describe("What to say when it fires, in the user's language."),
        kind: z.enum(["alarm", "reminder"]),
        repeat: z.enum(["once", "daily", "weekdays", "weekends", "custom"]),
        days: z.array(z.number().int().min(0).max(6)).optional(),
        date: z.string().optional(),
      }),
      run: async (input) => {
        const r = store.addReminder(input);
        events.push({ type: "reminders" });
        return json(r);
      },
    }),
    betaZodTool({
      name: "delete_alarm_or_reminder",
      description: "Delete an alarm or reminder by id.",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const ok = store.deleteReminder(id);
        events.push({ type: "reminders" });
        return ok ? "deleted" : "not found";
      },
    }),
    betaZodTool({
      name: "add_task",
      description: "Add a task to the user's list.",
      inputSchema: z.object({
        title: z.string(),
        due: z.string().optional().describe("YYYY-MM-DD"),
        priority: z.enum(["high", "normal", "low"]).optional(),
      }),
      run: async (input) => {
        const t = store.addTask(input);
        events.push({ type: "tasks" });
        return json(t);
      },
    }),
    betaZodTool({
      name: "complete_task",
      description: "Mark a task done by id.",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const t = store.completeTask(id);
        events.push({ type: "tasks" });
        return t ? json(t) : "not found";
      },
    }),
    betaZodTool({
      name: "delete_task",
      description: "Remove a task that is no longer relevant (not completed, just dropped).",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const ok = store.deleteTask(id);
        events.push({ type: "tasks" });
        return ok ? "deleted" : "not found";
      },
    }),
    betaZodTool({
      name: "log_wake_up",
      description: "Record what time the user got up today (defaults to now). Returns whether it was on time and the streak.",
      inputSchema: z.object({ time: hhmm.optional() }),
      run: async ({ time }) => {
        const w = store.logWake(time);
        events.push({ type: "wake", wake: w });
        return json(w);
      },
    }),
    betaZodTool({
      name: "add_journal_entry",
      description: "Save a reflection, gratitude note, or mood the user shares.",
      inputSchema: z.object({ text: z.string(), mood: z.string().optional() }),
      run: async ({ text, mood }) => json(store.addJournal(text, mood)),
    }),
  ];
}

export class Coach {
  /**
   * @param {import("./store.js").Store} store
   * @param {import("@anthropic-ai/sdk").default} client an Anthropic client
   * @param {{ model?: string, effort?: string }} [options]
   */
  constructor(store, client, { model, effort } = {}) {
    this.store = store;
    this.client = client;
    this.model = model || DEFAULT_MODEL;
    this.effort = effort || DEFAULT_EFFORT;
    this.queue = Promise.resolve(); // serialize turns so history stays consistent
  }

  /**
   * Handle one user utterance. Returns { reply, events }.
   * langHint: "am" | "en" | undefined - which recognizer produced the text.
   */
  chat(userText, langHint) {
    const run = () => this.#turn(userText, langHint);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async #turn(userText, langHint) {
    const events = [];
    const history = this.store.state.history.map((m) => ({ role: m.role, content: m.content }));
    const hint = langHint === "am" ? " (spoken in Amharic)" : langHint === "en" ? " (spoken in English)" : "";

    const runner = this.client.beta.messages.toolRunner({
      model: this.model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: this.effort },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: buildContext(this.store) },
      ],
      tools: makeTools(this.store, events),
      messages: [...history, { role: "user", content: userText + hint }],
      max_iterations: 8,
    });

    const final = await runner.runUntilDone();
    let reply = final.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    if (final.stop_reason === "refusal") {
      reply = langHint === "am" ? "ይቅርታ፣ በዚህ ጉዳይ መርዳት አልችልም።" : "Sorry, I can't help with that one.";
    }
    if (!reply) reply = langHint === "am" ? "እሺ፣ ተደርጓል።" : "Okay, done.";

    this.store.appendHistory(userText, reply);
    return { reply, events };
  }
}
