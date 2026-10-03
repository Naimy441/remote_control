import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSigned, signBinary } from "./sign.mjs";

const appName = "Remote Control.app";
const identifier = "local.remote-control.menu";

// /Applications puts RC in Spotlight and Launchpad like any other app; ~/Applications is the
// fallback when /Applications is not writable for this user.
export function menuAppPath() {
  try {
    fs.accessSync("/Applications", fs.constants.W_OK);
    return path.join("/Applications", appName);
  } catch {
    return path.join(os.homedir(), "Applications", appName);
  }
}

function plistValue(plist, key) {
  try {
    return execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function buildIcon(root, resources) {
  const svg = path.join(root, "app", "icon.svg");
  const iconset = path.join(os.tmpdir(), `rc-${process.pid}.iconset`);
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const px = size * scale;
        const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
        // macOS icons leave a margin around the artwork (824 of 1024).
        const art = Math.round((px * 824) / 1024);
        const out = path.join(iconset, name);
        execFileSync("sips", ["-s", "format", "png", "-z", String(art), String(art), svg, "--out", out], { stdio: "ignore" });
        execFileSync("sips", ["--padToHeightWidth", String(px), String(px), out], { stdio: "ignore" });
      }
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "AppIcon.icns")], { stdio: "ignore" });
  } catch {
    // The app works without an icon.
  } finally {
    fs.rmSync(iconset, { recursive: true, force: true });
  }
}

function stopRunning(pidFile) {
  try {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (pid) process.kill(pid, "SIGTERM");
  } catch {
    // Nothing was running.
  }
  fs.rmSync(pidFile, { force: true });
}

/** Compile, sign and install the menu bar app if it is missing or out of date. Returns its path. */
export function installMenuApp(root) {
  const app = menuAppPath();
  const source = path.join(root, "agent", "menu.swift");
  const template = path.join(root, "agent", "menu-Info.plist");
  const binary = path.join(app, "Contents", "MacOS", "RemoteMenu");
  const info = path.join(app, "Contents", "Info.plist");
  const menuPid = path.join(root, "agent", "bin", "menu.pid");

  fs.mkdirSync(path.join(root, "agent", "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "agent", "bin", "node-path"), process.execPath);

  // Older builds kept the app inside the project as agent/bin/Remote Control.app (or RemoteMenu.app),
  // where it was hard to find. Only the installed copy is kept.
  for (const old of ["Remote Control.app", "RemoteMenu.app"]) {
    const oldPath = path.join(root, "agent", "bin", old);
    if (fs.existsSync(oldPath)) {
      stopRunning(menuPid);
      fs.rmSync(oldPath, { recursive: true, force: true });
    }
  }

  const binaryTime = fs.existsSync(binary) ? fs.statSync(binary).mtimeMs : 0;
  const stale =
    binaryTime < fs.statSync(source).mtimeMs ||
    binaryTime < fs.statSync(template).mtimeMs ||
    plistValue(info, "RCProjectRoot") !== root;
  if (!stale) {
    ensureSigned(app, identifier);
    return app;
  }

  console.log(`Installing ${app}…`);
  const resources = path.join(app, "Contents", "Resources");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  fs.copyFileSync(template, info);
  // The app runs from outside the project, so it is told where the project lives.
  execFileSync("plutil", ["-replace", "RCProjectRoot", "-string", root, info]);
  buildIcon(root, resources);
  execFileSync("swiftc", ["-O", "-o", binary, source], { stdio: "inherit" });
  signBinary(app, identifier);
  // Let Spotlight and Launch Services pick up the new icon and version right away.
  try {
    execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", app], { stdio: "ignore" });
  } catch {
    // Spotlight finds it on its own a little later.
  }
  // A menu bar app from the old build is still running; it is replaced by the new one.
  stopRunning(menuPid);
  return app;
}
