import { spawn, execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { formatToken, loadToken, tokenMatches } from "./token.mjs";
import { pageOrigins } from "./net.mjs";
import { activateTab, automationDenied, browserKind, browserName, firefoxChords, listTabs } from "./tabs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = path.join(root, "agent");
const sourcePath = path.join(agentDir, "input.swift");
const binaryPath = path.join(agentDir, "bin", "RemoteInput");
const deskSourcePath = path.join(agentDir, "desk.swift");
const deskBinaryPath = path.join(agentDir, "bin", "RemoteDesk");
const port = Number(process.env.AGENT_PORT || 8787);
const webPort = Number(process.env.WEB_PORT || 3000);

if (process.platform !== "darwin") {
  console.error("The input agent only runs on macOS. The website can deploy anywhere; run the agent on the Mac you want to control.");
  process.exit(1);
}

const token = loadToken(root);

function compileBinary(source, binary, label) {
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  const sourceTime = fs.statSync(source).mtimeMs;
  const binaryTime = fs.existsSync(binary) ? fs.statSync(binary).mtimeMs : 0;
  if (binaryTime >= sourceTime) return binary;
  console.log(`Compiling ${label}…`);
  execFileSync("swiftc", ["-O", "-o", binary, source], { stdio: "inherit" });
  return binary;
}

function ensureBinary() {
  const sourceTime = fs.statSync(sourcePath).mtimeMs;
  const binaryTime = fs.existsSync(binaryPath) ? fs.statSync(binaryPath).mtimeMs : 0;
  const binary = compileBinary(sourcePath, binaryPath, "the Mac input helper");
  if (binaryTime >= sourceTime) return binary;
  try {
    execFileSync("codesign", ["-s", "-", "--force", binary], { stdio: "inherit" });
  } catch {
    console.warn("Could not sign RemoteInput. Accessibility permission may reset after each compile.");
  }
  return binary;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, number));
}

function buttonName(value) {
  return value === "right" || value === "center" ? value : "left";
}

function sanitize(message) {
  if (!message || typeof message !== "object") return null;
  switch (message.op) {
    case "move":
      return { op: "move", dx: clamp(message.dx, -2000, 2000), dy: clamp(message.dy, -2000, 2000) };
    case "scroll":
      return { op: "scroll", dx: clamp(message.dx, -6000, 6000), dy: clamp(message.dy, -6000, 6000) };
    case "down":
    case "up":
      return { op: message.op, button: buttonName(message.button) };
    case "click":
      return {
        op: "click",
        button: buttonName(message.button),
        count: clamp(Math.round(Number(message.count) || 1), 1, 3),
      };
    case "text":
      if (typeof message.s !== "string" || message.s.length === 0 || message.s.length > 500) return null;
      return { op: "text", s: message.s };
    case "key":
      if (typeof message.name !== "string" || !/^[a-z0-9]{1,16}$/.test(message.name)) return null;
      return { op: "key", name: message.name, down: message.down !== false };
    case "flags":
      return {
        op: "flags",
        cmd: Boolean(message.cmd),
        shift: Boolean(message.shift),
        alt: Boolean(message.alt),
        ctrl: Boolean(message.ctrl),
      };
    case "release":
      return { op: "release" };
    case "focus":
    case "quit":
      if (typeof message.id !== "string" || !/^[A-Za-z0-9._-]{1,180}$/.test(message.id)) return null;
      return { op: message.op, id: message.id };
    case "fullscreen":
      return { op: "fullscreen" };
    case "browse":
      if (message.action !== "back" && message.action !== "forward" && message.action !== "reload" && message.action !== "newtab") {
        return null;
      }
      return { op: "browse", action: message.action };
    case "tab":
      if (message.browser !== "chromium" && message.browser !== "safari" && message.browser !== "firefox") return null;
      return {
        op: "tab",
        browser: message.browser,
        index: clamp(Math.round(Number(message.index) || 1), 1, 40),
        count: clamp(Math.round(Number(message.count) || 1), 1, 80),
      };
    default:
      return null;
  }
}

let helper = null;
let helperWritable = true;
let trusted = false;
let active = null;
let restartTimer = null;
let desk = null;
let deskBuffer = "";
let deskWaiters = new Map();
let deskSerial = 0;
let deskEpoch = 0;
let deskBusy = false;
let deskQueued = false;
let deskTimer = null;
let latestDesk = null;
let battery = null;
let batteryTimer = null;

function broadcast(payload) {
  const data = JSON.stringify(payload);
  if (active && active.readyState === 1) active.send(data);
}

function helloPayload() {
  return { type: "hello", trusted, battery };
}

function parseBattery(text) {
  const match = String(text).match(/(\d+)%;\s*([^;\n]+)/);
  if (!match) return null;
  const percent = Number(match[1]);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return null;
  const state = match[2].trim().toLowerCase();
  const charging = state.startsWith("charging") || state.includes("finishing charge");
  return { percent, charging };
}

function publishBattery(next) {
  const same = battery?.percent === next?.percent && battery?.charging === next?.charging;
  battery = next;
  if (!same) broadcast({ type: "battery", percent: next ? next.percent : null, charging: Boolean(next?.charging) });
}

function readBattery() {
  execFile("pmset", ["-g", "batt"], { timeout: 2500 }, (error, stdout) => {
    if (error) return;
    publishBattery(parseBattery(stdout));
  });
}

function writeHelper(message) {
  if (!helper || helper.killed || !helper.stdin || helper.stdin.destroyed) return;
  if ((message.op === "move" || message.op === "scroll") && !helperWritable) return;
  const ok = helper.stdin.write(`${JSON.stringify(message)}\n`);
  if (!ok) helperWritable = false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rejectDeskWaiters(error) {
  for (const waiter of deskWaiters.values()) waiter.reject(error);
  deskWaiters.clear();
}

function startDesk() {
  const binary = compileBinary(deskSourcePath, deskBinaryPath, "the app switcher");
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  desk = child;
  deskBuffer = "";
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.stdout.on("data", (chunk) => {
    deskBuffer += chunk.toString();
    let newline = deskBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = deskBuffer.slice(0, newline);
      deskBuffer = deskBuffer.slice(newline + 1);
      newline = deskBuffer.indexOf("\n");
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        continue;
      }
      if (payload.event === "apps") {
        pokeDesk();
        continue;
      }
      const waiter = deskWaiters.get(payload.id);
      if (!waiter) continue;
      deskWaiters.delete(payload.id);
      clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
  });
  child.on("exit", () => {
    if (desk === child) desk = null;
    rejectDeskWaiters(new Error("app switcher stopped"));
    setTimeout(() => {
      if (!desk) {
        try {
          startDesk();
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
        }
      }
    }, 1000);
  });
}

function askDesk(message) {
  const id = ++deskSerial;
  return new Promise((resolve, reject) => {
    if (!desk || desk.killed || !desk.stdin || desk.stdin.destroyed) {
      reject(new Error("app switcher is not running"));
      return;
    }
    const timer = setTimeout(() => {
      deskWaiters.delete(id);
      reject(new Error("app switcher timed out"));
    }, 5000);
    deskWaiters.set(id, { resolve, reject, timer });
    desk.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
  });
}

function sendDesk(ws, payload) {
  if (!ws || ws.readyState !== 1 || !payload) return;
  const known = ws.knownIcons ?? (ws.knownIcons = new Set());
  const apps = payload.apps.map((app) => {
    if (!app.icon || known.has(app.id)) return { id: app.id, name: app.name };
    known.add(app.id);
    return { id: app.id, name: app.name, icon: app.icon };
  });
  ws.send(JSON.stringify({
    type: "desk",
    front: payload.front,
    browser: payload.browser,
    apps,
    tabs: payload.tabs,
    tabCount: payload.tabCount || payload.tabs.length,
    tabError: payload.tabError,
  }));
}

async function refreshDesk() {
  if (!active) return;
  if (deskBusy) {
    deskQueued = true;
    return;
  }
  deskBusy = true;
  try {
    while (active) {
      deskQueued = false;
      const seen = deskEpoch;
      try {
        const snap = await askDesk({ op: "snapshot" });
        if (!active || seen !== deskEpoch) continue;
        const browser = browserKind(snap.front);
        let tabs = [];
        let tabError = "";
        if (browser) {
          try {
            tabs = await listTabs(browser);
          } catch (error) {
            if (automationDenied(error)) {
              tabError = `Allow this Mac to control ${browserName(browser)} in System Settings → Privacy & Security → Automation.`;
            }
          }
        }
        if (!active || seen !== deskEpoch) continue;
        latestDesk = {
          front: typeof snap.front === "string" ? snap.front : "",
          browser,
          apps: Array.isArray(snap.apps) ? snap.apps : [],
          tabs: tabs.map((tab) => ({
            key: `${browser}:${tab.index}`,
            index: tab.index,
            title: tab.title,
            active: Boolean(tab.active),
          })),
          tabCount: tabs.total || tabs.length,
          tabError,
        };
        sendDesk(active, latestDesk);
      } catch (error) {
        if (seen === deskEpoch) console.error(error instanceof Error ? error.message : error);
      }
      if (!deskQueued && seen === deskEpoch) break;
    }
  } finally {
    deskBusy = false;
  }
}

let deskSoon = null;
function pokeDesk() {
  if (deskSoon) return;
  deskSoon = setTimeout(() => {
    deskSoon = null;
    void refreshDesk();
  }, 200);
}

function sendChord(name, mods = {}) {
  writeHelper({
    op: "chord",
    name,
    cmd: Boolean(mods.cmd),
    ctrl: Boolean(mods.ctrl),
    alt: Boolean(mods.alt),
    shift: Boolean(mods.shift),
  });
}

function watchDesk() {
  if (deskTimer || !active) return;
  deskTimer = setInterval(() => {
    if (!active) {
      clearInterval(deskTimer);
      deskTimer = null;
      return;
    }
    void refreshDesk();
  }, 1200);
  void refreshDesk();
}

async function focusApp(bundle) {
  deskEpoch += 1;
  try {
    await askDesk({ op: "focus", bundle });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  void refreshDesk();
}

async function quitApp(bundle) {
  deskEpoch += 1;
  try {
    await askDesk({ op: "quit", bundle });
    await wait(350);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  void refreshDesk();
}

async function focusTab(message) {
  deskEpoch += 1;
  try {
    if (message.browser === "firefox") {
      await askDesk({ op: "focus", bundle: "org.mozilla.firefox" });
      await wait(120);
      for (const chord of firefoxChords(message.index, message.count)) {
        writeHelper({
          op: "chord",
          name: chord.name,
          cmd: Boolean(chord.cmd),
          ctrl: Boolean(chord.ctrl),
          alt: false,
          shift: false,
        });
        await wait(45);
      }
    } else {
      await activateTab(message.browser, message.index);
    }
  } catch (error) {
    if (automationDenied(error)) {
      const tabError = `Allow this Mac to control ${browserName(message.browser)} in System Settings → Privacy & Security → Automation.`;
      if (latestDesk && active) sendDesk(active, { ...latestDesk, tabError });
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
  }
  void refreshDesk();
}

function readReady(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("READY trusted=")) continue;
    trusted = line.includes("trusted=1");
    broadcast(helloPayload());
  }
}

function startHelper() {
  const binary = ensureBinary();
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  helper = child;
  helperWritable = true;
  let stderr = "";

  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    stderr += text;
    const lines = stderr.split(/\r?\n/);
    stderr = lines.pop() ?? "";
    if (stderr.length > 4000) stderr = stderr.slice(-2000);
    for (const line of lines) readReady(`${line}\n`);
  });
  child.stdin.on("drain", () => {
    helperWritable = true;
  });
  child.stdin.on("error", () => {});
  child.on("exit", (code) => {
    if (helper === child) helper = null;
    trusted = false;
    broadcast(helloPayload());
    console.error(`Input helper exited (${code ?? "signal"}). Restarting…`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      try {
        startHelper();
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    }, 1000);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ ok: true, trusted, battery }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  maxPayload: 16 * 1024,
});

wss.on("connection", (ws) => {
  ws._socket?.setNoDelay?.(true);
  let authed = false;
  const authTimer = setTimeout(() => {
    if (!authed) ws.close(4001, "auth timeout");
  }, 4000);

  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      ws.close(4002, "bad message");
      return;
    }

    if (!authed) {
      if (message?.op !== "auth" || !tokenMatches(message.token, token)) {
        ws.close(4001, "unauthorized");
        return;
      }
      authed = true;
      clearTimeout(authTimer);
      if (active && active !== ws) {
        writeHelper({ op: "release" });
        active.close(4000, "replaced");
      }
      active = ws;
      ws.knownIcons = new Set();
      ws.send(JSON.stringify(helloPayload()));
      if (latestDesk) sendDesk(ws, latestDesk);
      watchDesk();
      return;
    }

    if (message?.op === "ping") {
      ws.send(JSON.stringify({ type: "pong", id: message.id ?? 0 }));
      return;
    }

    const clean = sanitize(message);
    if (!clean) return;
    if (clean.op === "focus") {
      void focusApp(clean.id);
      return;
    }
    if (clean.op === "quit") {
      void quitApp(clean.id);
      return;
    }
    if (clean.op === "tab") {
      void focusTab(clean);
      return;
    }
    if (clean.op === "fullscreen") {
      sendChord("f", { cmd: true, ctrl: true });
      return;
    }
    if (clean.op === "browse") {
      const chord = {
        back: { name: "left", cmd: true },
        forward: { name: "right", cmd: true },
        reload: { name: "r", cmd: true },
        newtab: { name: "t", cmd: true },
      }[clean.action];
      if (chord) sendChord(chord.name, chord);
      return;
    }
    writeHelper(clean);
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    if (active === ws) {
      active = null;
      writeHelper({ op: "release" });
    }
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other remote agent, or set AGENT_PORT.`);
    process.exit(1);
  }
  throw error;
});

const origins = pageOrigins(webPort);
const links = origins.length
  ? origins.map((origin) => `${origin}/#t=${formatToken(token)}`)
  : [`http://127.0.0.1:${webPort}/#t=${formatToken(token)}`];
const link = links[0];
fs.writeFileSync(path.join(agentDir, "link.txt"), `${links.join("\n")}\n`, { mode: 0o600 });

console.log("");
console.log("Remote control");
console.log(`  Token   ${formatToken(token)}`);
if (origins.length) {
  console.log("  iPhone  open this over Tailscale:");
  for (const origin of origins) console.log(`          ${origin}/#t=${formatToken(token)}`);
} else {
  console.log("  Tailscale was not found on this Mac.");
  console.log("  Install Tailscale on the Mac and the iPhone, then restart.");
  console.log(`  This Mac can still open http://127.0.0.1:${webPort}/#t=${formatToken(token)}`);
}
console.log("");

startHelper();
startDesk();
readBattery();
batteryTimer = setInterval(readBattery, 15000);
server.listen(port, () => {
  console.log(`Agent listening on port ${port}`);
});

function shutdown() {
  if (restartTimer) clearTimeout(restartTimer);
  if (deskTimer) clearInterval(deskTimer);
  if (batteryTimer) clearInterval(batteryTimer);
  writeHelper({ op: "release" });
  helper?.kill("SIGTERM");
  desk?.kill("SIGTERM");
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
