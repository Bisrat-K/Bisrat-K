import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { ethiopianClock, normalizeTime } from "../src/time.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nigat-"));
  return new Store(dir, "Africa/Addis_Ababa");
}

const at = (date, time, weekday) => ({ date, time, weekday, minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) });

test("time helpers", () => {
  assert.equal(normalizeTime("5:30"), "05:30");
  assert.equal(normalizeTime("25:00"), null);
  assert.equal(ethiopianClock("07:00"), "ጠዋት 1:00");
  assert.equal(ethiopianClock("05:30"), "ሌሊት 11:30");
  assert.equal(ethiopianClock("19:15"), "ምሽት 1:15");
  assert.equal(ethiopianClock("12:00"), "ከሰዓት 6:00");
});

test("weekday alarm fires once per day, only on weekdays, within the window", () => {
  const s = freshStore();
  s.addReminder({ time: "05:30", message: "Wake up", kind: "alarm", repeat: "weekdays" });
  assert.equal(s.collectDue(at("2026-11-23", "05:29", 1)).length, 0); // Monday, early
  assert.equal(s.collectDue(at("2026-11-23", "05:31", 1)).length, 1); // fires
  assert.equal(s.collectDue(at("2026-11-23", "05:32", 1)).length, 0); // already fired today
  assert.equal(s.collectDue(at("2026-11-29", "05:31", 0)).length, 0); // Sunday
  assert.equal(s.collectDue(at("2026-11-24", "06:30", 2)).length, 0); // too late (missed window)
  assert.equal(s.state.reminders.length, 1);
});

test("one-time reminder is removed after firing", () => {
  const s = freshStore();
  s.addReminder({ time: "21:15", message: "Wind down", kind: "reminder", repeat: "once", date: "2026-11-25" });
  assert.equal(s.collectDue(at("2026-11-25", "21:15", 3)).length, 1);
  assert.equal(s.state.reminders.length, 0);
});

test("wake log and streak", () => {
  const s = freshStore();
  s.updateSettings({ wakeTarget: "05:30" });
  const today = s.now().date;
  const d = (n) => {
    const x = new Date(`${today}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() - n);
    return x.toISOString().slice(0, 10);
  };
  s.state.wakeLog = [
    { date: d(3), time: "07:00", target: "05:30", onTime: false },
    { date: d(2), time: "05:35", target: "05:30", onTime: true },
    { date: d(1), time: "05:20", target: "05:30", onTime: true },
  ];
  assert.equal(s.streak(), 2);
  const w = s.logWake("05:39");
  assert.equal(w.onTime, true);
  assert.equal(w.streak, 3);
});

test("state persists to disk", () => {
  const s = freshStore();
  s.remember("Wants to pray Fajr before work", "faith");
  s.addTask({ title: "Finish report", priority: "high" });
  const again = new Store(s.dir, "Africa/Addis_Ababa");
  assert.equal(again.state.memories[0].text, "Wants to pray Fajr before work");
  assert.equal(again.openTasks()[0].title, "Finish report");
});
