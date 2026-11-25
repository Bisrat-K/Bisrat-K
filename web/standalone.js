// Phone / GitHub Pages build: no server. Data lives in this browser's
// localStorage and the app talks to the Claude API directly with the user's key.
// Imported before app.js (see web/entry.js) so the transport is ready at boot.
import Anthropic from "@anthropic-ai/sdk";
import { Store } from "../src/store.js";
import { Coach } from "../src/agent.js";
import { createRouter, HttpError } from "../src/routes.js";

const STATE_KEY = "nigat-state";
export const API_KEY_KEY = "nigat-api-key";

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const persist = {
  load() {
    const raw = ls.get(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  save(state) {
    ls.set(STATE_KEY, JSON.stringify(state));
  },
};

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Addis_Ababa";
const store = new Store(persist, timezone);

let coach = null;
let coachKey = null;

const route = createRouter({
  store,
  getCoach() {
    const key = ls.get(API_KEY_KEY);
    if (!key) throw new HttpError(401, "Add your Anthropic API key to start talking.");
    if (!coach || coachKey !== key) {
      // The key stays on this device and is sent only to api.anthropic.com.
      coach = new Coach(store, new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }));
      coachKey = key;
    }
    return coach;
  },
});

globalThis.NIGAT_STANDALONE = true;
globalThis.NIGAT_TRANSPORT = async (method, path, body) => {
  try {
    return { status: 200, body: await route(method, path, body ?? {}) };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { status: 401, body: { error: "That API key didn't work. Check it and paste it again." } };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { status: 401, body: { error: "This API key isn't allowed to use the model. Check your Anthropic account." } };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, body: { error: "Too many requests or out of credit - check your Anthropic billing, then try again." } };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { status: 502, body: { error: "No internet connection to Claude. Check your data or Wi-Fi." } };
    }
    if (err instanceof Anthropic.APIError) {
      return { status: 502, body: { error: `Claude API error (${err.status ?? "?"}): ${err.message}` } };
    }
    return { status: err.status || 500, body: { error: err.message || "Something went wrong" } };
  }
};
