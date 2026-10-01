import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const record = "\u001e";
const field = "\u001f";

const kinds = {
  "com.google.Chrome": "chromium",
  "com.apple.Safari": "safari",
  "org.mozilla.firefox": "firefox",
};

export function browserKind(bundleId) {
  return kinds[bundleId] || "";
}

export function browserName(kind) {
  if (kind === "safari") return "Safari";
  if (kind === "firefox") return "Firefox";
  return "Google Chrome";
}

function cleanTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return title.slice(0, 90);
}

function decodeMozLz4(buffer) {
  if (buffer.subarray(0, 8).toString() !== "mozLz40\0") throw new Error("bad session");
  const size = buffer.readUInt32LE(8);
  if (size < 2 || size > 32 * 1024 * 1024) throw new Error("bad session size");
  const input = buffer.subarray(12);
  const out = Buffer.alloc(size);
  let i = 0;
  let o = 0;
  while (i < input.length && o < size) {
    const token = input[i++];
    let litLen = token >> 4;
    if (litLen === 15) {
      let extra;
      do {
        extra = input[i++];
        litLen += extra;
      } while (extra === 255);
    }
    input.copy(out, o, i, i + litLen);
    o += litLen;
    i += litLen;
    if (i >= input.length || o >= size) break;
    const offset = input[i] | (input[i + 1] << 8);
    i += 2;
    let matchLen = (token & 15) + 4;
    if ((token & 15) === 15) {
      let extra;
      do {
        extra = input[i++];
        matchLen += extra;
      } while (extra === 255);
    }
    let match = o - offset;
    if (offset === 0 || match < 0) throw new Error("bad session block");
    for (let n = 0; n < matchLen && o < size; n++) out[o++] = out[match++];
  }
  if (o !== size) throw new Error("short session");
  return JSON.parse(out.toString("utf8"));
}

function tabTitle(tab) {
  const entries = Array.isArray(tab?.entries) ? tab.entries : [];
  const entry = entries[Math.max(0, (tab?.index || 1) - 1)] || entries[entries.length - 1];
  const title = cleanTitle(entry?.title);
  if (title) return title;
  try {
    return new URL(entry?.url || "").hostname || "New tab";
  } catch {
    return "New tab";
  }
}

function newestFirefoxSession() {
  const root = path.join(os.homedir(), "Library/Application Support/Firefox/Profiles");
  let newest = "";
  let newestTime = 0;
  let profiles = [];
  try {
    profiles = fs.readdirSync(root);
  } catch {
    return "";
  }
  for (const profile of profiles) {
    const file = path.join(root, profile, "sessionstore-backups", "recovery.jsonlz4");
    try {
      const time = fs.statSync(file).mtimeMs;
      if (time >= newestTime) {
        newest = file;
        newestTime = time;
      }
    } catch {
      // This profile has no live session.
    }
  }
  return newest;
}

function firefoxWindows() {
  const file = newestFirefoxSession();
  if (!file) return { windows: [], selected: 1 };
  const data = decodeMozLz4(fs.readFileSync(file));
  const windows = (Array.isArray(data.windows) ? data.windows : []).filter(
    (win) => Array.isArray(win.tabs) && win.tabs.length,
  );
  return { windows, selected: Number(data.selectedWindow) || 1 };
}

function pickFirefoxWindow(windows, selected, frontTitle) {
  const current = windows[selected - 1] || windows[0];
  if (!frontTitle) return current;
  const selectedTab = current.tabs[(current.selected || 1) - 1];
  if (selectedTab && tabTitle(selectedTab) === frontTitle) return current;
  return windows.find((win) => win.tabs.some((tab) => tabTitle(tab) === frontTitle)) || current;
}

async function firefoxFrontTitle() {
  try {
    const { stdout } = await exec("osascript", ["-e", 'tell application "Firefox" to get name of front window'], {
      timeout: 2000,
    });
    return cleanTitle(stdout);
  } catch {
    return "";
  }
}

function firefoxTabList(frontTitle) {
  const { windows, selected } = firefoxWindows();
  if (!windows.length) return [];
  const win = pickFirefoxWindow(windows, selected, frontTitle);
  const selectedIndex = Number(win.selected) || 1;
  let marked = false;
  const tabs = win.tabs.slice(0, 40).map((tab, index) => {
    const title = tabTitle(tab);
    const active = !marked && (frontTitle ? title === frontTitle : index + 1 === selectedIndex);
    if (active) marked = true;
    return { index: index + 1, title, active };
  });
  tabs.total = win.tabs.length;
  return tabs;
}

function scriptError(error) {
  return `${error?.stderr || ""} ${error?.message || ""}`;
}

export function automationDenied(error) {
  return /-1743|not authorized|not allowed|-1719|1002/i.test(scriptError(error));
}

async function runScript(source) {
  const { stdout } = await exec("osascript", ["-e", source], { timeout: 4000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

function parseRows(stdout) {
  if (!stdout) return [];
  const rows = stdout.split(record).filter(Boolean);
  const active = Number(rows.shift());
  return rows.slice(0, 40).map((row) => {
    const [indexText, title] = row.split(field);
    const index = Number(indexText);
    return {
      index,
      title: cleanTitle(title) || "New tab",
      active: index === active,
    };
  }).filter((tab) => Number.isInteger(tab.index) && tab.index > 0);
}

const listScripts = {
  chromium: `
set recordSep to character id 30
set fieldSep to character id 31
tell application "Google Chrome"
  if (count of windows) is 0 then return ""
  set activeIndex to active tab index of front window
  set n to count of tabs of front window
  if n > 40 then set n to 40
  set rows to {}
  repeat with t from 1 to n
    set tabName to title of tab t of front window
    set AppleScript's text item delimiters to {return, linefeed, recordSep, fieldSep}
    set parts to text items of tabName
    set AppleScript's text item delimiters to " "
    set tabName to parts as text
    set AppleScript's text item delimiters to ""
    set end of rows to (t as text) & fieldSep & tabName
  end repeat
  set AppleScript's text item delimiters to recordSep
  return (activeIndex as text) & recordSep & (rows as text)
end tell`,
  safari: `
set recordSep to character id 30
set fieldSep to character id 31
tell application "Safari"
  if (count of windows) is 0 then return ""
  set activeIndex to index of current tab of front window
  set n to count of tabs of front window
  if n > 40 then set n to 40
  set rows to {}
  repeat with t from 1 to n
    set tabName to name of tab t of front window
    set AppleScript's text item delimiters to {return, linefeed, recordSep, fieldSep}
    set parts to text items of tabName
    set AppleScript's text item delimiters to " "
    set tabName to parts as text
    set AppleScript's text item delimiters to ""
    set end of rows to (t as text) & fieldSep & tabName
  end repeat
  set AppleScript's text item delimiters to recordSep
  return (activeIndex as text) & recordSep & (rows as text)
end tell`,
};

const focusScripts = {
  chromium: (index) => `tell application "Google Chrome"
  set active tab index of front window to ${index}
  activate
end tell`,
  safari: (index) => `tell application "Safari"
  set current tab of front window to tab ${index} of front window
  activate
end tell`,
};

export async function listTabs(kind) {
  if (kind === "firefox") {
    const frontTitle = await firefoxFrontTitle();
    return firefoxTabList(frontTitle);
  }
  const source = listScripts[kind];
  if (!source) return [];
  return parseRows(await runScript(source));
}

export async function activateTab(kind, index) {
  const source = focusScripts[kind]?.(index);
  if (!source) return;
  await runScript(source);
}

export function firefoxChords(index, count) {
  if (index <= 8) return [{ name: String(index), cmd: true }];
  if (index === count) return [{ name: "9", cmd: true }];
  const chords = [{ name: "1", cmd: true }];
  const steps = Math.min(index - 1, 24);
  for (let n = 0; n < steps; n++) chords.push({ name: "tab", ctrl: true });
  return chords;
}
