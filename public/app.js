// Nigat voice client: speech in (Web Speech API), Claude via the server, speech out.
const $ = (id) => document.getElementById(id);
const ETHIOPIC = /[\u1200-\u137F]/;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const LS = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let lang = LS.get("lang", "am");
let passcode = LS.get("passcode", "");
let busy = false;
let listening = false;
let recognition = null;
let audioCtx = null;
let alarmTimer = null;
let currentAlarm = null;
let wakeLock = null;

// ---------------- API ----------------
const STANDALONE = Boolean(globalThis.NIGAT_STANDALONE);
const API_KEY_LS = "nigat-api-key";

async function api(path, opts = {}) {
  const method = opts.method || "GET";
  let status, body;
  if (globalThis.NIGAT_TRANSPORT) {
    // Phone build: everything runs inside this browser.
    ({ status, body } = await globalThis.NIGAT_TRANSPORT(method, path, opts.body ? JSON.parse(opts.body) : {}));
  } else {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", "x-passcode": passcode, ...(opts.headers || {}) },
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  }
  if (status === 401) {
    showKeyPrompt(body.error);
    throw Object.assign(new Error(body.error || "Passcode required"), { needsKey: true });
  }
  if (status >= 400) throw new Error(body.error || `HTTP ${status}`);
  return body;
}

function showKeyPrompt(message) {
  if (STANDALONE) {
    $("passTitle").textContent = "Your Claude API key";
    $("passHelp").hidden = false;
    $("passInput").placeholder = "sk-ant-...";
    $("passInput").value = LS.get(API_KEY_LS, "");
  }
  $("passMsg").textContent = message && !/passcode required/i.test(message) ? message : "";
  $("passMsg").hidden = !$("passMsg").textContent;
  $("passcode").hidden = false;
}

// ---------------- chat UI ----------------
function addMsg(text, who) {
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.textContent = text;
  $("chat").appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
  return el;
}

async function send(text, spokenLang) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  $("mic").classList.add("busy");
  addMsg(text, "user");
  const wait = addMsg(lang === "am" ? "እያሰብኩ ነው…" : "Thinking…", "bot thinking");
  try {
    const { reply } = await api("/api/chat", { method: "POST", body: JSON.stringify({ text, lang: spokenLang }) });
    wait.remove();
    addMsg(reply, "bot");
    refresh();
    await speak(reply);
    if ($("handsfree").checked && !currentAlarm) startListening(false);
  } catch (e) {
    wait.remove();
    addMsg(e.message, "err");
  } finally {
    busy = false;
    $("mic").classList.remove("busy");
  }
}

// ---------------- speech out ----------------
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); updateVoiceNote(); }
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function pickVoice(code) {
  const matches = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(code));
  return matches.find((v) => /google|natural|neural|premium|enhanced/i.test(v.name)) || matches[0] || null;
}

// Voice provided by the claude.ai host (dictation + Claude voice), when present.
const platformVoice = () => globalThis.NIGAT_VOICE || {};
const platformDictationOff = {}; // lang -> true once the platform says it can't serve it
let platformTtsOff = false;
let platformListening = false;

function updateVoiceNote() {
  const notes = [];
  if (!SR && !platformVoice().dictation) notes.push("Voice input isn't supported in this browser - use Chrome (Android/desktop) or type below.");
  if (lang === "am" && voices.length && !pickVoice("am")) {
    notes.push("No Amharic voice on this device, so Amharic replies are shown as text. On Android: Settings › Text-to-speech › Google › install Amharic.");
  }
  $("voiceNote").textContent = notes.join(" ");
  $("voiceNote").hidden = notes.length === 0;
}

async function speak(text) {
  const tts = platformVoice().tts;
  if (tts && !platformTtsOff) {
    try {
      await tts.speak(text.slice(0, 2000), { language: ETHIOPIC.test(text) ? "am" : "en" });
      return;
    } catch (e) {
      if (e?.code === "not_granted") platformTtsOff = true;
      if (e?.code === "viewer_stopped" || e?.code === "busy") return;
      // Otherwise fall through to the device voice.
    }
  }
  return speakWithDevice(text);
}

function speakWithDevice(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const isAm = ETHIOPIC.test(text);
    const voice = pickVoice(isAm ? "am" : "en");
    if (isAm && !voice) return resolve(); // can't pronounce Ge'ez with an English voice
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = isAm ? "am-ET" : "en-US";
    if (voice) u.voice = voice;
    u.rate = 1;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
    // Safety net: some browsers never fire onend.
    setTimeout(resolve, Math.min(60000, 2000 + text.length * 120));
  });
}

// ---------------- speech in ----------------

const CLAUDE_PAGE = globalThis.NIGAT_MODE === "claude";

// Explain why the mic can't be used here, and offer the keyboard's voice typing.
function micHelp(reason) {
  const why = {
    unsupported: "Voice input isn't offered in this view. The Claude phone app, Safari and Firefox don't support it. Open the link in Chrome instead.",
    not_granted: "The microphone is turned off for this page.",
    language: "Claude's dictation doesn't support Amharic yet.",
    error: "Dictation had a problem just now. Try again in a moment.",
  }[reason] || "";
  $("voiceTipWhy").textContent = why;
  $("voiceTipWhy").hidden = !why;
  const perms = platformVoice().permissions;
  $("allowMic").hidden = !(reason === "not_granted" && perms?.manage);
  $("voiceTip").hidden = false;
  $("voiceTip").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Platform dictation (claude.ai): must start straight from a click.
function startPlatformDictation(d) {
  const spokenLang = lang;
  let finalText = "";
  const show = (partial = "") => {
    $("interim").hidden = false;
    $("interim").textContent = (finalText + " " + partial).trim() || (spokenLang === "am" ? "እያዳመጥኩ ነው…" : "Listening…");
  };
  const offs = [
    d.onPartial(({ text }) => show(text)),
    d.onFinal(({ text }) => { finalText += text; show(); }),
    d.onState(({ state, reason }) => {
      if (state === "listening") { listening = true; platformListening = true; $("mic").classList.add("listening"); show(); }
      if (state !== "idle") return;
      offs.forEach((off) => off());
      listening = false;
      platformListening = false;
      $("mic").classList.remove("listening");
      $("interim").hidden = true;
      if (finalText.trim()) send(finalText, spokenLang);
      else if (reason === "unavailable") {
        platformDictationOff[spokenLang] = true;
        micHelp(spokenLang === "am" ? "language" : "unsupported");
      } else if (reason === "not_granted") {
        micHelp("not_granted");
      } else if (reason === "rate_limited" || reason === "upstream_error") {
        micHelp("error");
      }
    }),
  ];
  d.start({ language: spokenLang }).catch((e) => {
    // Most outcomes arrive through onState; these can fail before it fires.
    if (e?.code === "no_gesture") micHelp("error");
  });
}

function startListening(fromGesture = true) {
  if (listening || busy) return;
  if (CLAUDE_PAGE && !globalThis.NIGAT_VOICE) { addMsg("Still connecting to Claude. Tap the mic again in a moment.", "sys"); return; }
  const d = platformVoice().dictation;
  if (d && fromGesture && !platformDictationOff[lang]) {
    platformVoice().tts?.stop?.();
    speechSynthesis?.cancel();
    $("voiceTip").hidden = true;
    return startPlatformDictation(d);
  }
  // On claude.ai the browser's own recognizer is blocked, so go to the keyboard tip.
  if (CLAUDE_PAGE) {
    if (fromGesture) micHelp(!d ? "unsupported" : lang === "am" ? "language" : "unsupported");
    return;
  }
  if (!SR) { if (fromGesture) { updateVoiceNote(); $("typeInput").focus(); } return; }
  speechSynthesis?.cancel();
  recognition = new SR();
  recognition.lang = lang === "am" ? "am-ET" : "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let finalText = "";
  const spokenLang = lang;

  recognition.onstart = () => { listening = true; $("mic").classList.add("listening"); };
  recognition.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    $("interim").hidden = false;
    $("interim").textContent = (finalText + " " + interim).trim();
  };
  recognition.onerror = (ev) => {
    if (ev.error === "not-allowed") { addMsg("Microphone permission was denied. Allow it in the browser's site settings.", "err"); micHelp(""); }
    else if (ev.error === "language-not-supported") addMsg("This browser can't recognise that language. Try Chrome.", "err");
    else if (ev.error !== "no-speech" && ev.error !== "aborted") addMsg(`Speech error: ${ev.error}`, "err");
  };
  recognition.onend = () => {
    listening = false;
    $("mic").classList.remove("listening");
    $("interim").hidden = true;
    if (finalText.trim()) send(finalText, spokenLang);
  };
  recognition.start();
}

function stopListening() {
  if (platformListening) platformVoice().dictation?.stop().catch(() => {});
  else recognition?.stop();
}

// ---------------- sounds, alarms, reminders ----------------
function beep(freq = 880, dur = 0.25, when = 0, vol = 0.4) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + when;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function chime() { beep(660, 0.4, 0, 0.3); beep(880, 0.4, 0.25, 0.3); beep(1320, 0.6, 0.5, 0.25); }

function notify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, icon: "icon.svg" });
  } catch {}
}

function ringAlarm(r) {
  currentAlarm = r;
  stopListening();
  $("alarmTime").textContent = r.time;
  $("alarmMsg").textContent = r.message;
  $("alarm").hidden = false;
  document.body.classList.remove("night");
  notify("⏰ Nigat", r.message);
  let n = 0;
  const loop = () => {
    // Gets gradually louder; repeats the spoken message every ~30s.
    const vol = Math.min(0.9, 0.25 + n * 0.03);
    [0, 0.3, 0.6].forEach((w) => beep(988, 0.22, w, vol));
    navigator.vibrate?.([300, 150, 300]);
    if (n % 15 === 5) speak(r.message);
    n++;
  };
  loop();
  alarmTimer = setInterval(loop, 2000);
}

function stopAlarm() {
  clearInterval(alarmTimer);
  alarmTimer = null;
  platformVoice().tts?.stop?.();
  speechSynthesis?.cancel();
  $("alarm").hidden = true;
}

$("alarmUp").onclick = async () => {
  const r = currentAlarm;
  stopAlarm();
  currentAlarm = null;
  try { await api("/api/wake", { method: "POST", body: "{}" }); } catch {}
  const msg = lang === "am"
    ? `(ማንቂያው "${r?.message ?? ""}" ጠፍቷል - አሁን ተነሳሁ። የጠዋት መግለጫ ስጠኝ።)`
    : `(Alarm "${r?.message ?? ""}" dismissed - I just got up. Give me my morning briefing.)`;
  send(msg, lang);
};

$("alarmSnooze").onclick = () => {
  const r = currentAlarm;
  stopAlarm();
  setTimeout(() => ringAlarm(r), 5 * 60 * 1000);
};

async function checkDue() {
  try {
    const { due } = await api("/api/due");
    for (const r of due) {
      if (r.kind === "alarm") { if (!currentAlarm) ringAlarm(r); }
      else {
        chime();
        addMsg(`🔔 ${r.message}`, "sys");
        notify("🔔 Nigat", r.message);
        setTimeout(() => speak(r.message), 1200);
      }
    }
  } catch {}
}

// Keep the screen awake overnight so alarms can ring.
async function toggleNight() {
  if (wakeLock) {
    await wakeLock.release().catch(() => {});
    wakeLock = null;
    document.body.classList.remove("night");
    $("nightMode").textContent = "Night mode (keep screen on for alarms)";
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
    document.body.classList.add("night");
    $("nightMode").textContent = "Night mode ON - tap to turn off";
    addMsg("Night mode on: leave this screen open and plugged in. Keep a backup phone alarm too.", "sys");
  } catch {
    addMsg("This browser can't keep the screen on. Set the screen timeout to 'never' while charging.", "err");
  }
}
$("nightMode").onclick = toggleNight;
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && document.body.classList.contains("night") && !wakeLock) {
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }
  if (document.visibilityState === "visible") { checkDue(); refresh(); }
});

// ---------------- side panels ----------------
function li(html, cls = "") {
  const el = document.createElement("li");
  if (cls) el.className = cls;
  el.innerHTML = html;
  return el;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function render(state) {
  $("streak").textContent = state.streak;
  $("wakeTarget").textContent = state.settings.wakeTarget;
  $("bedtime").textContent = state.settings.bedtime;
  $("clock").textContent = `${state.now.weekdayName} ${state.now.date} · ${state.now.time}`;

  const tasks = $("tasks");
  tasks.innerHTML = "";
  if (!state.tasks.length) tasks.appendChild(li('<span class="empty">No tasks yet - just tell Nigat what you need to do.</span>'));
  for (const t of state.tasks) {
    const el = li(
      `<input type="checkbox" ${t.done ? "checked disabled" : ""} aria-label="Done">
       <span class="grow">${esc(t.title)} ${t.due ? `<small>· ${esc(t.due)}</small>` : ""} ${t.priority === "high" ? "<small>· ★</small>" : ""}</span>
       <button class="icon-btn" aria-label="Delete">✕</button>`,
      t.done ? "done" : "",
    );
    el.querySelector("input").onchange = () => api(`/api/tasks/${t.id}/done`, { method: "POST" }).then(refresh);
    el.querySelector("button").onclick = () => api(`/api/tasks/${t.id}`, { method: "DELETE" }).then(refresh);
    tasks.appendChild(el);
  }

  const rem = $("reminders");
  rem.innerHTML = "";
  if (!state.reminders.length) rem.appendChild(li('<span class="empty">None. Try: "Wake me up at 5:30 every weekday."</span>'));
  for (const r of [...state.reminders].sort((a, b) => a.time.localeCompare(b.time))) {
    const when = r.repeat === "once" ? r.date : r.repeat === "custom" ? `days ${r.days.join(",")}` : r.repeat;
    const el = li(
      `<span>${r.kind === "alarm" ? "⏰" : "🔔"}</span>
       <span class="grow"><strong>${esc(r.time)}</strong> ${esc(r.message)} <small>· ${esc(when)}</small></span>
       <button class="icon-btn" aria-label="Delete">✕</button>`,
    );
    el.querySelector("button").onclick = () => api(`/api/reminders/${r.id}`, { method: "DELETE" }).then(refresh);
    rem.appendChild(el);
  }

  const mem = $("memories");
  mem.innerHTML = "";
  if (!state.memories.length) mem.appendChild(li('<span class="empty">Nothing yet. Tell Nigat about your goals, routine and what motivates you.</span>'));
  for (const m of state.memories) {
    const el = li(`<span class="grow">${esc(m.text)} <small>· ${esc(m.category)}</small></span><button class="icon-btn" aria-label="Forget">✕</button>`);
    el.querySelector("button").onclick = () => api(`/api/memories/${m.id}`, { method: "DELETE" }).then(refresh);
    mem.appendChild(el);
  }

  const chart = $("wakeChart");
  chart.innerHTML = "";
  if (!state.wakeLog.length) chart.innerHTML = '<span class="empty">Wake-ups you log will show here.</span>';
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  for (const w of state.wakeLog) {
    // Earlier wake-up = taller bar (scale: 03:00 -> full, 10:00 -> tiny).
    const pct = Math.max(8, Math.min(100, ((600 - toMin(w.time)) / 420) * 100));
    const el = document.createElement("div");
    el.className = `bar ${w.onTime ? "ok" : ""}`;
    el.title = `${w.date}: ${w.time} (target ${w.target})`;
    el.innerHTML = `<span>${esc(w.time)}</span><i style="height:${pct}%"></i><span>${esc(w.date.slice(5))}</span>`;
    chart.appendChild(el);
  }
}

async function refresh() {
  try { render(await api("/api/state")); } catch {}
}

// ---------------- wiring ----------------
function setLang(l) {
  lang = l;
  LS.set("lang", l);
  document.documentElement.lang = l;
  document.querySelectorAll(".lang button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === l)));
  updateVoiceNote();
}
document.querySelectorAll(".lang button").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
setLang(lang);

$("mic").onclick = () => (listening ? stopListening() : startListening(true));
$("typeForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("typeInput").value;
  $("typeInput").value = "";
  send(v, ETHIOPIC.test(v) ? "am" : "en");
};
$("clearHistory").onclick = async () => {
  await api("/api/history/clear", { method: "POST" });
  $("chat").innerHTML = "";
  addMsg("Fresh conversation started. Nigat still remembers your profile, tasks and alarms.", "sys");
};
$("exportBtn").onclick = async () => {
  const data = await api("/api/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nigat-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async () => {
  const f = $("importFile").files[0];
  if (!f) return;
  try {
    await api("/api/import", { method: "POST", body: await f.text() });
    addMsg("Backup restored.", "sys");
    refresh();
  } catch (e) {
    addMsg(`Couldn't restore: ${e.message}`, "err");
  }
  $("importFile").value = "";
};
$("changeKey").hidden = !STANDALONE;
$("changeKey").onclick = () => showKeyPrompt();
$("tipClose").onclick = () => { $("voiceTip").hidden = true; $("typeInput").focus(); };
$("allowMic").onclick = async () => {
  try { await platformVoice().permissions.manage(); } catch { addMsg("Open the page's Permissions menu (top of the page) and turn on dictation.", "sys"); }
  $("voiceTip").hidden = true;
};
if (CLAUDE_PAGE) $("handsfree").closest("label").hidden = true; // needs a tap each time here
$("passCancel").onclick = () => { $("passcode").hidden = true; };

$("passForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("passInput").value.trim();
  if (STANDALONE) LS.set(API_KEY_LS, v);
  else { passcode = v; LS.set("passcode", v); }
  $("passcode").hidden = true;
  boot();
  if (STANDALONE && v) addMsg("Key saved on this device. Tap the mic and say hello! · ማይኩን ይጫኑና ሰላም ይበሉ!", "sys");
};
$("handsfree").checked = LS.get("handsfree", "0") === "1";
$("handsfree").onchange = () => LS.set("handsfree", $("handsfree").checked ? "1" : "0");

$("startBtn").onclick = async () => {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  beep(880, 0.08, 0, 0.05);
  speechSynthesis?.speak(new SpeechSynthesisUtterance("")); // unlock TTS on iOS
  $("start").hidden = true;
  if (STANDALONE && !LS.get(API_KEY_LS, "")) showKeyPrompt();
  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}
};

let booted = false;
async function boot() {
  try {
    const state = await api("/api/state");
    render(state);
    if (!booted) {
      for (const m of state.history) addMsg(m.content, m.role === "user" ? "user" : "bot");
      if (!state.history.length) {
        addMsg(
          "Selam! I'm Nigat, your wake-up and productivity coach. Tap the mic and talk to me in Amharic or English.\nሰላም! እኔ ንጋት ነኝ። ማይኩን ይጫኑና በአማርኛ ወይም በእንግሊዝኛ ያናግሩኝ።",
          "bot",
        );
      }
      booted = true;
      setInterval(checkDue, 20000);
      setInterval(refresh, 60000);
      checkDue();
    }
  } catch (e) {
    if (!e.needsKey) addMsg(e.message, "err");
  }
}
boot();

if ("serviceWorker" in navigator && !globalThis.NIGAT_MODE) navigator.serviceWorker.register("sw.js").catch(() => {});
