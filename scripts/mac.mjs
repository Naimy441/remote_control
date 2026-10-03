import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatToken, tokenFile } from "../agent/token.mjs";
import { installMenuApp } from "../agent/menu-app.mjs";
import { enableTailscaleHttps, pageOrigins } from "../agent/net.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const webPort = process.env.WEB_PORT || "3000";
const agentPort = process.env.AGENT_PORT || "8787";
const pidPath = path.join(root, "agent", "bin", "remote.pid");
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
    const menuApp = installMenuApp(root);
    if (pidAlive(menuPidPath)) return;
    const menu = spawn("/usr/bin/open", [menuApp, "--args", root, process.execPath], {
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
