// The app's API, independent of transport. server.js serves it over HTTP;
// the phone (GitHub Pages) build calls it directly inside the browser.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createRouter({ store, getCoach }) {
  function publicState() {
    const s = store.state;
    const today = store.now().date;
    return {
      now: store.now(),
      timezone: store.timezone,
      settings: s.settings,
      tasks: s.tasks.filter((t) => !t.done || t.doneAt === today),
      reminders: s.reminders,
      wakeLog: s.wakeLog.slice(-14),
      streak: store.streak(),
      memories: s.memories,
      history: s.history.slice(-12),
    };
  }

  /** @returns {Promise<object>} JSON body; throws HttpError on bad input. */
  return async function route(method, pathname, body = {}) {
    if (method === "GET" && pathname === "/api/state") return publicState();
    if (method === "GET" && pathname === "/api/due") return { due: store.collectDue() };

    if (method === "POST" && pathname === "/api/chat") {
      const { text, lang } = body;
      if (!text || typeof text !== "string" || !text.trim()) throw new HttpError(400, "text is required");
      const coach = getCoach();
      return coach.chat(text.trim().slice(0, 4000), lang);
    }

    if (method === "POST" && pathname === "/api/wake") return store.logWake(body.time);

    if (method === "POST" && pathname === "/api/history/clear") {
      store.clearHistory();
      return { ok: true };
    }

    let m;
    if (method === "POST" && (m = /^\/api\/tasks\/([\w-]+)\/done$/.exec(pathname))) return { task: store.completeTask(m[1]) };
    if (method === "DELETE" && (m = /^\/api\/tasks\/([\w-]+)$/.exec(pathname))) return { ok: store.deleteTask(m[1]) };
    if (method === "DELETE" && (m = /^\/api\/reminders\/([\w-]+)$/.exec(pathname))) return { ok: store.deleteReminder(m[1]) };
    if (method === "DELETE" && (m = /^\/api\/memories\/([\w-]+)$/.exec(pathname))) return { ok: store.forget(m[1]) };

    // Backup / restore (the phone version keeps data only on the device).
    if (method === "GET" && pathname === "/api/export") return store.state;
    if (method === "POST" && pathname === "/api/import") {
      if (!body || typeof body !== "object" || !Array.isArray(body.memories)) throw new HttpError(400, "not a Nigat backup file");
      store.replaceState(body);
      return { ok: true };
    }

    throw new HttpError(404, "unknown endpoint");
  };
}
