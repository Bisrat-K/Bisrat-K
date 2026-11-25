// Coach for the claude.ai-hosted page: thinks through the platform's `sample`
// capability (the viewer's own Claude account, no API key), reusing the same
// instructions, context and tools as the API version in agent.js.
import { SYSTEM_PROMPT, buildContext, makeTools } from "./agent.js";

const SAMPLE_NOTES = `
NOTE FOR THIS APP: you are running inside the user's Nigat page. Call the tools you need first, then write your spoken reply once, at the end. Do not write anything before or between tool calls.`;

function toSampleTools(store, events, onRun) {
  return makeTools(store, events).map((t) => {
    const { $schema, ...schema } = t.input_schema; // keep schemas small
    return {
      name: t.name,
      description: t.description,
      inputSchema: schema,
      // Validate with the tool's zod schema; a thrown error goes back to Claude.
      execute: async (input) => {
        onRun();
        return t.run(t.parse(input));
      },
    };
  });
}

// Fallback when this view can't run page tools: Claude replies with JSON naming
// the actions to take, and the page runs them itself.
function jsonModeInstructions(tools) {
  const catalog = tools
    .map((t) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.inputSchema)}`)
    .join("\n");
  return `
NOTE FOR THIS APP: you cannot call tools directly here. Instead, list the actions you want and the app will run them. Available actions:
${catalog}

Reply with ONLY one JSON object, no other text:
{"reply": "<what you say to the user, following the voice style rules>", "actions": [{"tool": "<action name>", "input": {...}}]}
Use an empty "actions" array when nothing needs doing. Only claim in "reply" what the actions will actually do.`;
}

const RETRY_IN_JSON = new Set(["tools_unavailable", "invalid_request"]);

export class SampleCoach {
  /**
   * @param {import("./store.js").Store} store
   * @param {Function} sample the namespace from `await claude.use("sample")`
   * @param {{ modelTier?: string }} [options]
   */
  constructor(store, sample, { modelTier = "quick" } = {}) {
    this.store = store;
    this.sample = sample;
    this.modelTier = modelTier;
    this.queue = Promise.resolve();
    this.mode = null; // "tools" | "json"
  }

  /** Use page tools when this view supports enough of them, else JSON actions. */
  async detectMode() {
    if (this.mode) return this.mode;
    const toolCount = makeTools(this.store, []).length;
    const limits = await this.sample.limits?.().catch(() => null);
    this.mode = (limits?.tools?.maxCount ?? 0) >= toolCount ? "tools" : "json";
    return this.mode;
  }

  chat(userText, langHint) {
    const run = () => this.#turn(userText, langHint);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  #baseInput(userText, langHint, notes) {
    const hint = langHint === "am" ? " (spoken in Amharic)" : langHint === "en" ? " (spoken in English)" : "";
    return [
      { role: "user", content: `${SYSTEM_PROMPT}\n${notes}\n\n${buildContext(this.store)}\n\n(The conversation with the user follows.)` },
      ...this.store.state.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText + hint },
    ];
  }

  async #turnWithTools(userText, langHint, events) {
    // With tools, text from every round arrives as one growing string. Keep only
    // what was written after the last tool ran: that is the spoken reply.
    let soFar = "";
    let mark = 0;
    const { text } = await this.sample(this.#baseInput(userText, langHint, SAMPLE_NOTES), {
      tools: toSampleTools(this.store, events, () => { mark = soFar.length; }),
      modelTier: this.modelTier,
      onText: ({ text }) => { soFar = text; },
    });
    return text.slice(mark).trim() || text.trim();
  }

  async #turnWithJson(userText, langHint, events) {
    const tools = toSampleTools(this.store, events, () => {});
    const out = await this.sample.json(this.#baseInput(userText, langHint, jsonModeInstructions(tools)), {
      modelTier: this.modelTier,
      cache: false,
    });
    const actions = Array.isArray(out?.actions) ? out.actions : [];
    const failed = [];
    for (const a of actions.slice(0, 8)) {
      const tool = tools.find((t) => t.name === a?.tool);
      if (!tool) continue;
      try {
        await tool.execute(a.input && typeof a.input === "object" ? a.input : {});
      } catch (e) {
        failed.push(a.tool);
        console.warn("Nigat action failed", a.tool, e);
      }
    }
    let reply = typeof out?.reply === "string" ? out.reply.trim() : "";
    if (failed.length) {
      reply += langHint === "am" ? " (ማስታወሻ፦ አንዳንድ ለውጦች አልተቀመጡም፤ እባክዎ እንደገና ይሞክሩ።)" : " (Note: some changes didn't save. Please try again.)";
    }
    return reply;
  }

  async #turn(userText, langHint) {
    const events = [];
    let reply;
    if ((await this.detectMode()) === "tools") {
      try {
        reply = await this.#turnWithTools(userText, langHint, events);
      } catch (e) {
        if (!RETRY_IN_JSON.has(e?.code) || events.length) throw e;
        this.mode = "json"; // this view can't run tools: switch for good
        reply = await this.#turnWithJson(userText, langHint, events);
      }
    } else {
      reply = await this.#turnWithJson(userText, langHint, events);
    }
    if (!reply) reply = langHint === "am" ? "እሺ፣ ተደርጓል።" : "Okay, done.";
    this.store.appendHistory(userText, reply);
    return { reply, events };
  }
}
