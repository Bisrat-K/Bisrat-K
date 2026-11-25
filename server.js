// Nigat voice coach - HTTP server (no framework, just node:http).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Store } from "./src/store.js";
import { Coach } from "./src/agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (so no extra dependency is needed).
const envFile = path.join(here, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] !== "" && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const TIMEZONE = process.env.TIMEZONE || "Africa/Addis_Ababa";
const PASSCODE = process.env.APP_PASSCODE || "";

const store = new Store(path.join(here, "data"), TIMEZONE);
const coach = new Coach(store);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

function authorized(req) {
  if (!PASSCODE) return true;
  const given = Buffer.from(String(req.headers["x-passcode"] || ""));
  const want = Buffer.from(PASSCODE);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function publicState() {
  const s = store.state;
  return {
    now: store.now(),
    timezone: store.timezone,
    settings: s.settings,
    tasks: s.tasks.filter((t) => !t.done || t.doneAt === store.now().date),
    reminders: s.reminders,
    wakeLog: s.wakeLog.slice(-14),
    streak: store.streak(),
    memories: s.memories,
    history: s.history.slice(-12),
  };
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(here, "public", rel));
  if (!file.startsWith(path.join(here, "public") + path.sep)) return send(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleApi(req, res, pathname) {
  if (!authorized(req)) return send(res, 401, { error: "passcode required" });

  if (req.method === "GET" && pathname === "/api/state") return send(res, 200, publicState());

  if (req.method === "GET" && pathname === "/api/due") return send(res, 200, { due: store.collectDue() });

  if (req.method === "POST" && pathname === "/api/chat") {
    const { text, lang } = await readJson(req);
    if (!text || typeof text !== "string" || !text.trim()) return send(res, 400, { error: "text is required" });
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return send(res, 500, { error: "ANTHROPIC_API_KEY is not set on the server - add it to the .env file and restart." });
    }
    const result = await coach.chat(text.trim().slice(0, 4000), lang);
    return send(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/wake") {
    const { time } = await readJson(req);
    return send(res, 200, store.logWake(time));
  }

  if (req.method === "POST" && pathname === "/api/history/clear") {
    store.clearHistory();
    return send(res, 200, { ok: true });
  }

  let m;
  if (req.method === "POST" && (m = /^\/api\/tasks\/([\w-]+)\/done$/.exec(pathname))) {
    return send(res, 200, { task: store.completeTask(m[1]) });
  }
  if (req.method === "DELETE" && (m = /^\/api\/tasks\/([\w-]+)$/.exec(pathname))) {
    return send(res, 200, { ok: store.deleteTask(m[1]) });
  }
  if (req.method === "DELETE" && (m = /^\/api\/reminders\/([\w-]+)$/.exec(pathname))) {
    return send(res, 200, { ok: store.deleteReminder(m[1]) });
  }
  if (req.method === "DELETE" && (m = /^\/api\/memories\/([\w-]+)$/.exec(pathname))) {
    return send(res, 200, { ok: store.forget(m[1]) });
  }

  return send(res, 404, { error: "unknown endpoint" });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  try {
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
    return serveStatic(req, res);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return send(res, 500, { error: "Invalid ANTHROPIC_API_KEY - check your .env file." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return send(res, 429, { error: "Rate limited by the Claude API - try again in a moment." });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return send(res, 502, { error: "Could not reach the Claude API - check the internet connection." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error:", err.status, err.message);
      return send(res, 502, { error: `Claude API error (${err.status ?? "?"})` });
    }
    console.error(err);
    return send(res, err.status || 500, { error: err.message || "server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Nigat coach running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (timezone ${TIMEZONE})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("WARNING: ANTHROPIC_API_KEY is not set - copy .env.example to .env and add your key.");
  }
  if (!PASSCODE && HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.warn("WARNING: listening beyond localhost with no APP_PASSCODE - anyone who can reach this port can use your API key.");
  }
});
