// Storage for everything the coach learns about you. The data itself is plain
// JSON; *where* it is kept is pluggable: a file on the server (src/persist-file.js)
// or the browser's localStorage (web/standalone.js).
import { localParts, toMinutes, normalizeTime, addDays } from "./time.js";

const DEFAULT_STATE = {
  settings: {
    name: "",
    wakeTarget: "05:30",
    bedtime: "22:00",
    language: "auto", // "am" | "en" | "auto"
  },
  memories: [], // { id, text, category, createdAt }
  tasks: [], // { id, title, due, priority, done, createdAt, doneAt }
  reminders: [], // { id, time, message, kind, repeat, days, date, lastFired, createdAt }
  wakeLog: [], // { date, time, target, onTime }
  journal: [], // { id, date, text, mood }
  history: [], // { role, content } plain-text conversation turns
};

const DAY_SETS = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
};

export const DUE_WINDOW_MINUTES = 15;
const HISTORY_LIMIT = 40; // messages kept for conversational context

export class Store {
  /**
   * @param {{ load(): object|null, save(state: object): void }} persist
   * @param {string} timezone IANA timezone, e.g. "Africa/Addis_Ababa"
   */
  constructor(persist, timezone) {
    this.persist = persist;
    this.timezone = timezone;
    this.state = this.#load();
  }

  #load() {
    let raw = null;
    try {
      raw = this.persist.load();
    } catch {
      raw = null;
    }
    if (!raw) return structuredClone(DEFAULT_STATE);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...raw,
      settings: { ...DEFAULT_STATE.settings, ...(raw.settings ?? {}) },
    };
  }

  save() {
    this.persist.save(this.state);
  }

  /** Restore from a backup (keeps defaults for any missing fields). */
  replaceState(raw) {
    this.state = {
      ...structuredClone(DEFAULT_STATE),
      ...raw,
      settings: { ...DEFAULT_STATE.settings, ...(raw.settings ?? {}) },
    };
    this.save();
  }

  now() {
    return localParts(this.timezone);
  }

  #id() {
    const b = globalThis.crypto.getRandomValues(new Uint8Array(3));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // ---------- settings ----------
  updateSettings(patch) {
    const s = this.state.settings;
    if (patch.name !== undefined) s.name = patch.name;
    if (patch.language !== undefined) s.language = patch.language;
    for (const key of ["wakeTarget", "bedtime"]) {
      if (patch[key] !== undefined) {
        const t = normalizeTime(patch[key]);
        if (!t) throw new Error(`${key} must be HH:MM (24h), got "${patch[key]}"`);
        s[key] = t;
      }
    }
    this.save();
    return s;
  }

  // ---------- memories ----------
  remember(text, category = "general") {
    const m = { id: this.#id(), text, category, createdAt: this.now().date };
    this.state.memories.push(m);
    this.save();
    return m;
  }

  forget(id) {
    const before = this.state.memories.length;
    this.state.memories = this.state.memories.filter((m) => m.id !== id);
    this.save();
    return before !== this.state.memories.length;
  }

  // ---------- tasks ----------
  addTask({ title, due, priority = "normal" }) {
    const t = { id: this.#id(), title, due: due || null, priority, done: false, createdAt: this.now().date };
    this.state.tasks.push(t);
    this.save();
    return t;
  }

  completeTask(id) {
    const t = this.state.tasks.find((x) => x.id === id);
    if (!t) return null;
    t.done = true;
    t.doneAt = this.now().date;
    this.save();
    return t;
  }

  deleteTask(id) {
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
    this.save();
    return before !== this.state.tasks.length;
  }

  openTasks() {
    return this.state.tasks.filter((t) => !t.done);
  }

  // ---------- reminders / alarms ----------
  addReminder({ time, message, kind = "reminder", repeat = "once", days, date }) {
    const t = normalizeTime(time);
    if (!t) throw new Error(`time must be HH:MM (24h), got "${time}"`);
    const now = this.now();
    let r = { id: this.#id(), time: t, message, kind, repeat, lastFired: null, createdAt: now.date };
    if (repeat === "once") {
      // If no date given: today if the time is still ahead, otherwise tomorrow.
      r.date = date || (toMinutes(t) > now.minutes ? now.date : addDays(now.date, 1));
    } else if (repeat === "custom") {
      if (!Array.isArray(days) || days.length === 0) throw new Error("custom repeat needs days (0=Sun..6=Sat)");
      r.days = [...new Set(days)].sort();
    } else {
      r.days = DAY_SETS[repeat];
      if (!r.days) throw new Error(`unknown repeat "${repeat}"`);
    }
    this.state.reminders.push(r);
    this.save();
    return r;
  }

  deleteReminder(id) {
    const before = this.state.reminders.length;
    this.state.reminders = this.state.reminders.filter((r) => r.id !== id);
    this.save();
    return before !== this.state.reminders.length;
  }

  /** Returns reminders that should fire now and marks them fired. */
  collectDue(now = this.now()) {
    const due = [];
    for (const r of this.state.reminders) {
      const mins = toMinutes(r.time);
      const late = now.minutes - mins;
      if (late < 0 || late > DUE_WINDOW_MINUTES) continue;
      if (r.lastFired === now.date) continue;
      if (r.repeat === "once" ? r.date !== now.date : !r.days.includes(now.weekday)) continue;
      r.lastFired = now.date;
      due.push(r);
    }
    // One-time reminders are removed after firing.
    const firedOnce = new Set(due.filter((r) => r.repeat === "once").map((r) => r.id));
    if (due.length) {
      this.state.reminders = this.state.reminders.filter((r) => !firedOnce.has(r.id));
      this.save();
    }
    return due;
  }

  // ---------- wake-up tracking ----------
  logWake(time) {
    const now = this.now();
    const t = normalizeTime(time || now.time);
    if (!t) throw new Error(`time must be HH:MM, got "${time}"`);
    const target = this.state.settings.wakeTarget;
    const entry = { date: now.date, time: t, target, onTime: toMinutes(t) <= toMinutes(target) + 10 };
    this.state.wakeLog = this.state.wakeLog.filter((w) => w.date !== now.date);
    this.state.wakeLog.push(entry);
    this.state.wakeLog.sort((a, b) => a.date.localeCompare(b.date));
    this.save();
    return { ...entry, streak: this.streak() };
  }

  streak() {
    const byDate = new Map(this.state.wakeLog.map((w) => [w.date, w]));
    let day = this.now().date;
    if (!byDate.has(day)) day = addDays(day, -1); // today not logged yet: count up to yesterday
    let n = 0;
    while (byDate.get(day)?.onTime) {
      n++;
      day = addDays(day, -1);
    }
    return n;
  }

  // ---------- journal ----------
  addJournal(text, mood) {
    const e = { id: this.#id(), date: this.now().date, text, mood: mood || null };
    this.state.journal.push(e);
    this.save();
    return e;
  }

  // ---------- conversation history ----------
  appendHistory(userText, assistantText) {
    this.state.history.push({ role: "user", content: userText }, { role: "assistant", content: assistantText });
    if (this.state.history.length > HISTORY_LIMIT) {
      this.state.history = this.state.history.slice(-HISTORY_LIMIT);
    }
    this.save();
  }

  clearHistory() {
    this.state.history = [];
    this.save();
  }
}
