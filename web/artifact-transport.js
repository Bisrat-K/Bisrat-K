// claude.ai-hosted build: no server and no API key. Claude answers through the
// page's `sample` capability (the viewer's own Claude account), data is kept in
// the page's private `db` store (falling back to this browser's localStorage),
// and voice uses the platform's dictation and Claude voice where available.
import { Store } from "../src/store.js";
import { SampleCoach } from "../src/agent-sample.js";
import { createRouter, HttpError } from "../src/routes.js";

const LOCAL_KEY = "nigat-state";
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Addis_Ababa";

const SAMPLE_ERRORS = {
  not_granted: "Nigat needs your permission to use Claude. Reload the page and choose Allow.",
  sampling_disabled: "Claude isn't available on this account right now.",
  rate_limited: "You've hit a Claude usage limit. Wait a little, then try again.",
  tools_unavailable: "This view can't run Nigat's tools. Open the page in a Chrome browser tab.",
  cancelled: "Stopped.",
  session_expired: "Your Claude sign-in expired. Reload the page and sign in again.",
  capability_disabled: "Using Claude from pages is turned off for this account or organization.",
  not_declared: "This page isn't set up to use Claude. Tell Claude Code to republish it.",
  refused: "Claude declined that request. Try saying it another way.",
  empty_completion: "Claude sent an empty answer. Try again.",
  invalid_json: "Claude's answer came back garbled. Try again.",
  upstream_error: "Claude had a temporary problem. Try again in a moment.",
  queue_overflow: "Too many requests at once. Wait a moment and try again.",
};

function localPersist() {
  return {
    load() {
      try { const raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    save(state) {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch {}
    },
  };
}

// One write at a time to the db doc; coalesce bursts into the latest state.
function dbPersist(docRef, initial) {
  let latest = null;
  let writing = false;
  async function flush() {
    if (writing || !latest) return;
    writing = true;
    const snapshot = latest;
    latest = null;
    try {
      await docRef.set({ json: JSON.stringify(snapshot), savedAt: new Date().toISOString() });
    } catch (e) {
      console.warn("Nigat: could not save to the page store", e);
    } finally {
      writing = false;
      if (latest) flush();
    }
  }
  return {
    load: () => initial,
    save(state) {
      latest = state;
      setTimeout(flush, 300);
    },
  };
}

async function init() {
  const c = globalThis.claude;
  const use = (name) => (c?.use ? c.use(name).catch(() => null) : Promise.resolve(null));
  const [sample, db, user, dictation, tts, permissions] = await Promise.all(
    ["sample", "db", "user", "dictation", "tts", "permissions"].map(use),
  );

  // Storage: the private per-user db doc when signed in, else localStorage.
  let persist = localPersist();
  let storage = "this browser";
  if (db && user) {
    try {
      const uid = await user.id();
      if (uid) {
        const ref = db.doc(`data/users/${uid}/state`);
        const snap = await ref.get();
        let initial = null;
        if (snap.exists) {
          const d = snap.data();
          initial = d && typeof d.json === "string" ? JSON.parse(d.json) : null;
        } else {
          initial = localPersist().load(); // carry over anything saved before
        }
        persist = dbPersist(ref, initial);
        storage = "your Claude account";
      }
    } catch (e) {
      console.warn("Nigat: page store unavailable, using this browser", e);
    }
  }

  const store = new Store(persist, timezone);
  let coach = null;
  const route = createRouter({
    store,
    getCoach() {
      if (!sample) throw new HttpError(503, "Claude isn't reachable from this view. Open the page from claude.ai in Chrome.");
      coach ??= new SampleCoach(store, sample);
      return coach;
    },
  });

  let claudeStatus = sample ? "ready" : "unavailable";
  if (sample) {
    const limits = await sample.limits?.().catch(() => null);
    if (limits && !limits.tools) claudeStatus = "ready (simple mode)";
  }
  globalThis.NIGAT_VOICE = { dictation, tts, permissions, storage, claudeStatus };
  return route;
}

const ready = init();

globalThis.NIGAT_MODE = "claude";
globalThis.NIGAT_TRANSPORT = async (method, path, body) => {
  const route = await ready;
  try {
    return { status: 200, body: await route(method, path, body ?? {}) };
  } catch (err) {
    if (err && typeof err.code === "string" && !(err instanceof HttpError)) {
      const msg = SAMPLE_ERRORS[err.code] || "Claude couldn't answer. Try again.";
      return { status: 502, body: { error: `${msg} [${err.code}]` } };
    }
    return { status: err.status || 500, body: { error: err.message || "Something went wrong" } };
  }
};
