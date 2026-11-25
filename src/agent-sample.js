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
  }

  chat(userText, langHint) {
    const run = () => this.#turn(userText, langHint);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async #turn(userText, langHint) {
    const events = [];
    const hint = langHint === "am" ? " (spoken in Amharic)" : langHint === "en" ? " (spoken in English)" : "";
    const input = [
      { role: "user", content: `${SYSTEM_PROMPT}\n${SAMPLE_NOTES}\n\n${buildContext(this.store)}\n\n(The conversation with the user follows.)` },
      ...this.store.state.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText + hint },
    ];
    // With tools, text from every round arrives as one growing string. Keep only
    // what was written after the last tool ran: that is the spoken reply.
    let soFar = "";
    let mark = 0;
    const { text } = await this.sample(input, {
      tools: toSampleTools(this.store, events, () => { mark = soFar.length; }),
      modelTier: this.modelTier,
      onText: ({ text }) => { soFar = text; },
    });
    let reply = text.slice(mark).trim() || text.trim();
    if (!reply) reply = langHint === "am" ? "እሺ፣ ተደርጓል።" : "Okay, done.";
    this.store.appendHistory(userText, reply);
    return { reply, events };
  }
}
