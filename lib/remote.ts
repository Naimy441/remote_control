export type MouseButton = "left" | "right" | "center";

export type AgentMessage =
  | { op: "move"; dx: number; dy: number }
  | { op: "scroll"; dx: number; dy: number }
  | { op: "down" | "up"; button: MouseButton }
  | { op: "click"; button: MouseButton; count: number }
  | { op: "text"; s: string }
  | { op: "key"; name: string; down: boolean }
  | { op: "flags"; cmd: boolean; shift: boolean; alt: boolean; ctrl: boolean }
  | { op: "focus"; id: string }
  | { op: "quit"; id: string }
  | { op: "tab"; browser: BrowserKind; index: number; count: number }
  | { op: "fullscreen" }
  | { op: "browse"; action: "back" | "forward" | "reload" | "newtab" };

export type BrowserKind = "chromium" | "safari" | "firefox";

export type DeskApp = {
  id: string;
  name: string;
  icon?: string;
};

export type DeskTab = {
  key: string;
  index: number;
  title: string;
  active: boolean;
};

export type DeskSnapshot = {
  front: string;
  browser: BrowserKind | "";
  apps: DeskApp[];
  tabs: DeskTab[];
  tabCount: number;
  tabError: string;
};

export type Mods = {
  cmd: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
};

export const emptyMods = (): Mods => ({
  cmd: false,
  shift: false,
  alt: false,
  ctrl: false,
});

export function normalizeToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatToken(value: string): string {
  const token = normalizeToken(value);
  if (token.length !== 8) return token;
  return `${token.slice(0, 4)}-${token.slice(4)}`;
}

export function normalizeAgentUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `ws://${value}`;
  const url = new URL(value);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Use a ws:// or wss:// address.");
  }
  if (!url.port && url.protocol === "ws:") url.port = "8787";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function defaultAgentUrl(): string {
  if (typeof window === "undefined") return "";
  if (window.location.protocol === "https:") return "";
  const host = window.location.hostname;
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".ts.net") ||
    host.endsWith(".local") ||
    isTailscaleIPv4(host) ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (!local) return "";
  return `ws://${host}:8787`;
}

function isTailscaleIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 100 && b >= 64 && b <= 127;
}

export function roundDelta(value: number): number {
  return Math.round(value * 100) / 100;
}

export function shapeDelta(delta: number, sensitivity: number): number {
  const magnitude = Math.abs(delta);
  if (magnitude === 0) return 0;
  const curved = magnitude <= 2 ? magnitude : Math.pow(magnitude, 1.22);
  return Math.sign(delta) * curved * sensitivity;
}

export function browserKind(bundleId: string): BrowserKind | "" {
  if (bundleId === "com.google.Chrome") return "chromium";
  if (bundleId === "com.apple.Safari") return "safari";
  if (bundleId === "org.mozilla.firefox") return "firefox";
  return "";
}

export function specialKey(key: string): string | null {
  switch (key) {
    case "Enter":
      return "return";
    case "Backspace":
      return "delete";
    case "Escape":
      return "escape";
    case "Tab":
      return "tab";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    default:
      return null;
  }
}
