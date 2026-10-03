"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DisplaySize, GyroTune } from "@/lib/gyro";
import { normalizeToken, roundDelta, type AgentMessage, type DeskApp, type DeskBrowser, type DeskSnapshot, type DeskTab } from "@/lib/remote";

export type AgentStatus = "idle" | "connecting" | "open" | "denied" | "replaced" | "closed";

export function useAgent(options: { url: string; token: string; active: boolean; generation: number }) {
  const { url, token, active, generation } = options;
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [trusted, setTrusted] = useState<boolean | null>(null);
  const [rtt, setRtt] = useState<number | null>(null);
  const [battery, setBattery] = useState<{ percent: number; charging: boolean } | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [tabIcons, setTabIcons] = useState<Record<string, string>>({});
  const [protocol, setProtocol] = useState(0);
  const [tune, setTune] = useState<GyroTune | null>(null);
  const [display, setDisplay] = useState<DisplaySize | null>(null);
  const [playing, setPlaying] = useState<boolean | null>(null);
  const [macClipboard, setMacClipboard] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState("");
  const [desk, setDesk] = useState<DeskSnapshot | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const openRef = useRef(false);
  const pending = useRef({ dx: 0, dy: 0, sx: 0, sy: 0 });
  // App icons are only sent once per connection, so keep them here: an app that lingers while quitting must keep its
  // real icon instead of falling back to its first letter.
  const iconCache = useRef(new Map<string, string>());
  // Apps being force-quit stay hidden for a moment, so one that takes a second to disappear does not flash back.
  const hiddenApps = useRef(new Map<string, number>());
  const hideApp = useCallback((id: string, ms = 3000) => {
    hiddenApps.current.set(id, Date.now() + ms);
  }, []);
  const pingId = useRef(0);
  const pingSent = useRef(0);

  const send = useCallback((message: AgentMessage) => {
    const socket = socketRef.current;
    if (!openRef.current || !socket || socket.readyState !== WebSocket.OPEN) return false;

    if (message.op === "moveto" && socket.bufferedAmount > 24000) return true;
    if (message.op === "move") {
      pending.current.dx += message.dx;
      pending.current.dy += message.dy;
      if (socket.bufferedAmount > 24000) return true;
    } else if (message.op === "scroll") {
      pending.current.sx += message.dx;
      pending.current.sy += message.dy;
      if (socket.bufferedAmount > 24000) return true;
    }

    const queued = pending.current;
    const dx = roundDelta(queued.dx);
    const dy = roundDelta(queued.dy);
    if (dx || dy) {
      socket.send(JSON.stringify({ op: "move", dx, dy }));
      queued.dx -= dx;
      queued.dy -= dy;
    }
    const sx = roundDelta(queued.sx);
    const sy = roundDelta(queued.sy);
    if (sx || sy) {
      socket.send(JSON.stringify({ op: "scroll", dx: sx, dy: sy }));
      queued.sx -= sx;
      queued.sy -= sy;
    }
    if (message.op !== "move" && message.op !== "scroll") {
      socket.send(JSON.stringify(message));
    }
    return true;
  }, []);

  const activeKey = active && url && token ? `${generation}|${url}|${token}` : "";
  const [seenKey, setSeenKey] = useState(activeKey);
  if (seenKey !== activeKey) {
    setSeenKey(activeKey);
    setStatus(activeKey ? "connecting" : "idle");
    setTrusted(null);
    setRtt(null);
    setBattery(null);
    setVolume(null);
    setPlaying(null);
    setTune(null);
    setProtocol(0);
    setDisplay(null);
    setTabIcons({});
    setMacClipboard(null);
    setError("");
  }

  useEffect(() => {
    if (!active || !url || !token) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let pingTimer = 0;
    let attempt = 0;

    const clearPing = () => {
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = 0;
    };

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      let next: WebSocket;
      try {
        next = new WebSocket(url);
      } catch {
        setStatus("closed");
        setError("Enter a valid agent address, like ws://100.x.x.x:8787.");
        return;
      }

      socket = next;
      socketRef.current = next;
      openRef.current = false;

      next.onopen = () => {
        if (stopped) {
          next.close();
          return;
        }
        next.send(JSON.stringify({ op: "auth", token: normalizeToken(token) }));
      };

      next.onmessage = (event) => {
        if (stopped) return;
        let message: {
          type?: string;
          trusted?: boolean;
          id?: number;
          percent?: number | null;
          charging?: boolean;
          battery?: { percent?: number; charging?: boolean } | null;
          volume?: number | null;
          playing?: boolean;
          protocol?: number;
          tune?: GyroTune;
          tabIcons?: Record<string, string>;
          display?: DisplaySize | null;
          text?: string;
          truncated?: boolean;
          front?: string;
          browser?: DeskSnapshot["browser"];
          apps?: DeskApp[];
          tabs?: DeskTab[];
          browsers?: DeskBrowser[];
          tabCount?: number;
          tabError?: string;
        };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "desk" && Array.isArray(message.apps)) {
          const icons = message.tabIcons;
          if (icons && Object.keys(icons).length) setTabIcons((current) => ({ ...current, ...icons }));
          for (const app of message.apps) if (app.icon) iconCache.current.set(app.id, app.icon);
          const now = Date.now();
          const apps = message.apps.filter((app) => (hiddenApps.current.get(app.id) ?? 0) < now);
          setDesk((current) => {
            const known = new Map((current?.apps ?? []).map((app) => [app.id, app.icon || ""]));
            return {
              front: message.front || "",
              browser: message.browser || "",
              tabCount: message.tabCount || message.tabs?.length || 0,
              tabError: message.tabError || "",
              tabs: Array.isArray(message.tabs) ? message.tabs : [],
              // An agent from before per-browser tab lists only sends the front browser's tabs; wrap them the same way.
              browsers: Array.isArray(message.browsers)
                ? message.browsers
                : message.browser
                  ? [
                      {
                        kind: message.browser,
                        id: message.front || "",
                        name: apps.find((app) => app.id === message.front)?.name ?? "",
                        front: true,
                        tabs: Array.isArray(message.tabs) ? message.tabs : [],
                        tabCount: message.tabCount || message.tabs?.length || 0,
                        tabError: message.tabError || "",
                      },
                    ]
                  : [],
              apps: apps.map((app) => ({
                id: app.id,
                name: app.name,
                icon: app.icon || iconCache.current.get(app.id) || known.get(app.id) || "",
              })),
            };
          });
          return;
        }
        if (message.type === "battery") {
          if (typeof message.percent === "number") {
            setBattery({ percent: message.percent, charging: Boolean(message.charging) });
          } else {
            setBattery(null);
          }
          return;
        }
        if (message.type === "tune" && message.tune) {
          setTune(message.tune);
          return;
        }
        if (message.type === "display" && message.display) {
          setDisplay(message.display);
          return;
        }
        if (message.type === "playing") {
          setPlaying(Boolean(message.playing));
          return;
        }
        if (message.type === "media") {
          setVolume(typeof message.volume === "number" ? message.volume : null);
          return;
        }
        if (message.type === "clipboard" && typeof message.text === "string") {
          setMacClipboard({ text: message.text, truncated: Boolean(message.truncated) });
          return;
        }
        if (message.type === "hello") {
          attempt = 0;
          openRef.current = true;
          setStatus("open");
          setTrusted(Boolean(message.trusted));
          if (message.battery && typeof message.battery.percent === "number") {
            setBattery({ percent: message.battery.percent, charging: Boolean(message.battery.charging) });
          }
          if (typeof message.volume === "number") setVolume(message.volume);
          if (typeof message.playing === "boolean") setPlaying(message.playing);
          setProtocol(typeof message.protocol === "number" ? message.protocol : 1);
          if (message.tune) setTune(message.tune);
          if (message.display) setDisplay(message.display);
          setError("");
          clearPing();
          pingTimer = window.setInterval(() => {
            if (next.readyState !== WebSocket.OPEN) return;
            pingId.current += 1;
            pingSent.current = performance.now();
            next.send(JSON.stringify({ op: "ping", id: pingId.current }));
          }, 2000);
        } else if (message.type === "pong" && message.id === pingId.current) {
          setRtt(Math.max(0, Math.round(performance.now() - pingSent.current)));
        }
      };

      next.onerror = () => {
        if (!stopped) setError("Can't reach the Mac. Keep Tailscale on, and leave npm run mac running.");
      };

      next.onclose = (event) => {
        clearPing();
        openRef.current = false;
        if (socketRef.current === next) socketRef.current = null;
        if (stopped) return;
        if (event.code === 4001) {
          setStatus("denied");
          setTrusted(null);
          setError("That token doesn't match the Mac. Copy the one printed in the terminal.");
          return;
        }
        if (event.code === 4000) {
          setStatus("replaced");
          setError("This Mac is connected to another screen.");
          return;
        }
        setStatus("closed");
        setTrusted(null);
        const delay = Math.min(5000, 300 * 2 ** attempt);
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      openRef.current = false;
      window.clearTimeout(retryTimer);
      clearPing();
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
      pending.current = { dx: 0, dy: 0, sx: 0, sy: 0 };
      setDesk(null);
    };
  }, [active, generation, token, url]);

  return { status, trusted, rtt, battery, volume, setVolume, playing, setPlaying, protocol, tune, display, tabIcons, macClipboard, error, send, hideApp, desk, setDesk };
}
