// Time helpers. All stored times are 24h "HH:MM" in the user's timezone.

export function localParts(timezone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: weekdays[p.weekday],
    weekdayName: p.weekday,
  };
}

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function normalizeTime(hhmm) {
  const mins = toMinutes(hhmm);
  if (mins === null) return null;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// Ethiopian clock: the day starts at 6:00 international time.
// 07:00 -> "1:00 ጠዋት" (morning), 19:00 -> "1:00 ምሽት" (evening).
export function ethiopianClock(hhmm) {
  const mins = toMinutes(hhmm);
  if (mins === null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let eh = (h - 6 + 24) % 12;
  if (eh === 0) eh = 12;
  let period;
  if (h >= 6 && h < 12) period = "ጠዋት";
  else if (h >= 12 && h < 18) period = "ከሰዓት";
  else if (h >= 18 && h < 24) period = "ምሽት";
  else period = "ሌሊት";
  return `${period} ${eh}:${String(m).padStart(2, "0")}`;
}

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
