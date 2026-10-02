import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatToken, tokenFile } from "../agent/token.mjs";
import { ensureSigned, signBinary } from "../agent/sign.mjs";
import { enableTailscaleHttps, pageOrigins } from "../agent/net.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const webPort = process.env.WEB_PORT || "3000";
const agentPort = process.env.AGENT_PORT || "8787";
const pidPath = path.join(root, "agent", "bin", "remote.pid");
const menuSource = path.join(root, "agent", "menu.swift");
const menuInfo = path.join(root, "agent", "menu-Info.plist");
const menuApp = path.join(root, "agent", "bin", "Remote Control.app");
const menuBinary = path.join(menuApp, "Contents", "MacOS", "RemoteMenu");
const menuPidPath = path.join(root, "agent", "bin", "menu.pid");

const children = [];

function start(args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      // Started from the menu bar, PATH is bare and Next could not spawn its own node workers.
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
      WEB_PORT: webPort,
      AGENT_PORT: agentPort,
    },
  });
  children.push(child);
  return child;
}

function clearPid() {
  try {
    if (fs.readFileSync(pidPath, "utf8").trim() === String(process.pid)) fs.rmSync(pidPath, { force: true });
  } catch {
    // The pid file is only a hint for the menu bar.
  }
}

function pidAlive(file) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function openMenu() {
  try {
    // Older builds called the app RemoteMenu; drop it so only "Remote Control" is left.
    fs.rmSync(path.join(root, "agent", "bin", "RemoteMenu.app"), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(menuBinary), { recursive: true });
    fs.copyFileSync(menuInfo, path.join(menuApp, "Contents", "Info.plist"));
    const sourceTime = fs.statSync(menuSource).mtimeMs;
    const binaryTime = fs.existsSync(menuBinary) ? fs.statSync(menuBinary).mtimeMs : 0;
    fs.writeFileSync(path.join(root, "agent", "bin", "node-path"), process.execPath);
    if (binaryTime >= sourceTime) ensureSigned(menuApp, "local.remote-control.menu");
    if (binaryTime < sourceTime) {
      console.log("Compiling the menu bar control…");
      execFileSync("swiftc", ["-O", "-o", menuBinary, menuSource], { stdio: "inherit" });
      signBinary(menuApp, "local.remote-control.menu");
      // A menu bar app from the old build is still running; replace it with the new one.
      try {
        const old = Number(fs.readFileSync(menuPidPath, "utf8").trim());
        if (old) process.kill(old, "SIGTERM");
        fs.rmSync(menuPidPath, { force: true });
      } catch {
        // Nothing was running.
      }
    }
    if (pidAlive(menuPidPath)) return;
    const menu = spawn("/usr/bin/open", ["-n", menuApp, "--args", root, process.execPath], {
      detached: true,
      stdio: "ignore",
    });
    menu.unref();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  clearPid();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", clearPid);

fs.mkdirSync(path.dirname(pidPath), { recursive: true });
fs.writeFileSync(pidPath, String(process.pid));
openMenu();

const agent = start(["agent/server.mjs"]);
agent.on("exit", (code) => {
  if (code) shutdown(code);
});

const file = tokenFile(root);
const started = Date.now();
while (!fs.existsSync(file)) {
  if (Date.now() - started > 60000) {
    console.error("The agent did not start.");
    shutdown(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const token = formatToken(fs.readFileSync(file, "utf8"));
if (!process.env.NO_TAILSCALE_HTTPS) enableTailscaleHttps(webPort, agentPort);
const origins = pageOrigins(Number(webPort));
console.log("");
console.log("On your iPhone, with Tailscale connected, open:");
for (const origin of origins) console.log(`  ${origin}/#t=${token}`);
if (!origins.length) {
  console.log("  Tailscale is not running yet. Start it, then restart this command.");
}
console.log("");

const web = start([nextBin, "dev", "-H", "0.0.0.0", "-p", webPort]);
web.on("exit", (code) => shutdown(code ?? 0));
