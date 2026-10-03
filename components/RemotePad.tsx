"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  browserKind,
  defaultAgentUrl,
  emptyMods,
  formatToken,
  normalizeAgentUrl,
  normalizeToken,
  shapeDelta,
  specialKey,
  type Mods,
} from "@/lib/remote";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  CornerDownLeft,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Laptop,
  Smartphone,
  Delete,
  Grab,
  Keyboard,
  Maximize,
  MousePointerClick,
  Pause,
  ArrowBigUp,
  Command,
  Option,
  LayoutGrid,
  ChevronUp,
  Play,
  Plus,
  RotateCw,
  Settings,
  SquareMenu,
  Volume1,
  Volume2,
  VolumeX,
  X,
  Check,
  Mic,
  Move3d,
  Crosshair,
  Hand,
  type LucideIcon,
} from "lucide-react";
import { aimAngles, analyzeTremor, calibSteps, type TremorResult, defaultTune, fitTune, MIN_PEAK, OneEuro, wrapDegrees, type CalibStep } from "@/lib/gyro";
import { ConnectionFields } from "@/components/fields";
import { QuickRail, type QuickItem } from "@/components/QuickRail";
import { quickIcons } from "@/components/quickIcons";
import { SettingsPage } from "@/components/SettingsPage";
import { defaultQuick, parseQuick, quickMeta, quickStorageKey, type QuickId } from "@/lib/quick";
import { PressButton } from "@/components/PressButton";
import { useLast, usePresence } from "@/components/presence";
import { useAgent, type AgentStatus } from "@/components/useAgent";

type SpeechResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => Recognizer;
    webkitSpeechRecognition?: new () => Recognizer;
  }
}

type Session = { url: string; token: string; generation: number };

export default function RemotePad() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [agentUrl, setAgentUrl] = useState("");
  const [token, setToken] = useState("");
  const [formError, setFormError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sens, setSens] = useState(1.7);
  const [scrollSens, setScrollSens] = useState(2.8);
  const [mods, setMods] = useState<Mods>(emptyMods);
  const [dragLock, setDragLock] = useState(false);
  const [scrollMode, setScrollMode] = useState(false);
  const [gyro, setGyro] = useState(false);
  const [gyroSens, setGyroSens] = useState(1);
  const [calib, setCalib] = useState<{
    step: number;
    phase: "ready" | "moving" | "done";
    note: string;
    peaks: Partial<Record<CalibStep, number>>;
  } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [pendingTab, setPendingTab] = useState<{ index: number; title: string } | null>(null);
  const [pendingQuit, setPendingQuit] = useState<{ id: string; name: string } | null>(null);
  const [hint, setHint] = useState(true);

  const padRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sensRef = useRef(sens);
  const scrollSensRef = useRef(scrollSens);
  const dragLockRef = useRef(dragLock);
  const scrollModeRef = useRef(scrollMode);
  const gyroRef = useRef(gyro);
  const gyroSensRef = useRef(gyroSens);
  const tuneRef = useRef(defaultTune);
  const calibMode = useRef(false);
  const calibAcc = useRef<{ az0: number; el0: number; peakX: number; peakY: number; rows: number[][] } | null>(null);
  const [quickIds, setQuickIds] = useState<QuickId[]>(defaultQuick);
  const [quickReady, setQuickReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<Recognizer | null>(null);
  const wantRef = useRef(false);
  const tremorRec = useRef<number[][] | null>(null);
  const tremorTimer = useRef(0);
  const [tremor, setTremor] = useState<{
    phase: "ready" | "measuring" | "done" | "retry";
    progress: number;
    result?: TremorResult;
    note?: string;
  } | null>(null);
  const aimRef = useRef({ az: 0, el: 0 });
  const originRef = useRef<{ az: number; el: number } | null>(null);
  const needOrigin = useRef(true);
  const touchRef = useRef(false);
  const releasedRef = useRef(0);
  const modsRef = useRef(mods);
  const hintRef = useRef(hint);
  const [draftVolume, setDraftVolume] = useState<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const dockPos = useRef(new Map<string, number>());
  const [toast, setToast] = useState("");
  const [playOverride, setPlayOverride] = useState<boolean | null>(null);
  const playTimer = useRef(0);
  const settling = useRef(false);
  const settleTimer = useRef(0);
  const toastTimer = useRef(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const volumeSentAt = useRef(0);
  const volumeTimer = useRef(0);
  const volumeRelease = useRef(0);
  const latestVolume = useRef(50);
  const recentKey = useRef<Record<string, number>>({});
  const composedAt = useRef(0);
  const composing = useRef(false);

  useEffect(() => {
    sensRef.current = sens;
    scrollSensRef.current = scrollSens;
    dragLockRef.current = dragLock;
    // Gyro owns the pointer, so a one-finger drag scrolls instead.
    scrollModeRef.current = scrollMode || gyro;
    gyroRef.current = gyro;
    gyroSensRef.current = gyroSens;
    modsRef.current = mods;
    hintRef.current = hint;
  }, [dragLock, gyro, gyroSens, hint, mods, scrollMode, scrollSens, sens]);

  const { status, trusted, rtt, battery, volume, setVolume, playing, protocol, tune: agentTune, display, tabIcons, macClipboard, error, send, desk, setDesk } = useAgent({
    url: session?.url ?? "",
    token: session?.token ?? "",
    active: session !== null,
    generation: session?.generation ?? 0,
  });

  const showBrowser = Boolean(desk?.browser);
  const showTabs = Boolean(desk?.browser && (desk.tabs.length > 0 || desk.tabError));
  const tabDesk = useLast(showTabs ? desk : null);
  const dockIds = desk?.apps.map((app) => app.id).join("|") ?? "";
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) {
      dockPos.current.clear();
      return;
    }
    const first = dockPos.current.size === 0;
    const next = new Map<string, number>();
    for (const child of Array.from(dock.children) as HTMLElement[]) {
      const id = child.dataset.appId;
      if (!id) continue;
      const left = child.offsetLeft;
      next.set(id, left);
      if (first) continue;
      const before = dockPos.current.get(id);
      if (before === undefined) {
        child.animate(
          [{ opacity: 0, transform: "scale(0.4) translateY(10px)" }, { opacity: 1, transform: "none" }],
          { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.2)" },
        );
      } else if (before !== left) {
        child.animate(
          [{ transform: `translateX(${before - left}px)` }, { transform: "none" }],
          { duration: 340, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
    }
    dockPos.current = next;
  }, [dockIds]);

  useEffect(() => {
    // Saved after hydration; localStorage only exists in the browser.
    const timer = window.setTimeout(() => {
      const saved = parseQuick(localStorage.getItem(quickStorageKey));
      if (saved) setQuickIds(saved);
      setQuickReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!quickReady) return;
    localStorage.setItem(quickStorageKey, JSON.stringify(quickIds));
  }, [quickIds, quickReady]);

  const isPlaying = playOverride ?? playing ?? false;
  useEffect(() => {
    // Once the Mac's audio state catches up with the tap, hand control back to the real state.
    if (playOverride === null || playing !== playOverride) return;
    const timer = window.setTimeout(() => setPlayOverride(null), 0);
    return () => window.clearTimeout(timer);
  }, [playing, playOverride]);
  const tune = agentTune ?? defaultTune;
  useEffect(() => {
    const timer = tremorTimer.current;
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    tuneRef.current = tune;
  }, [tune]);

  function restoreSession(saved: {
    url: string;
    token: string;
    sens: number | null;
    scroll: number | null;
    scrollMode: boolean;
    session: Session | null;
  }) {
    setAgentUrl(saved.url);
    setToken(saved.token);
    if (saved.sens !== null) setSens(saved.sens);
    if (saved.scroll !== null) setScrollSens(saved.scroll);
    setScrollMode(saved.scrollMode);
    if (saved.session) setSession(saved.session);
    setBooted(true);
  }

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashToken = hash.get("t") ?? "";
    if (hashToken) history.replaceState(null, "", window.location.pathname + window.location.search);
    const savedToken = hashToken || localStorage.getItem("remote.token") || "";
    let savedUrl = localStorage.getItem("remote.agent") || defaultAgentUrl();
    try {
      savedUrl = savedUrl ? normalizeAgentUrl(savedUrl) : "";
    } catch {
      savedUrl = "";
    }
    const savedSens = Number(localStorage.getItem("remote.sens"));
    const savedScroll = Number(localStorage.getItem("remote.scroll"));
    const nextToken = normalizeToken(savedToken);
    if (savedUrl && nextToken.length >= 4) {
      localStorage.setItem("remote.agent", savedUrl);
      localStorage.setItem("remote.token", nextToken);
    }
    // The token and agent address live in localStorage, which exists only after hydration.
    const restoreTimer = window.setTimeout(() => {
      restoreSession({
        url: savedUrl,
        token: nextToken ? formatToken(nextToken) : "",
        sens: Number.isFinite(savedSens) && savedSens >= 0.4 && savedSens <= 4 ? savedSens : null,
        scroll: Number.isFinite(savedScroll) && savedScroll >= 0.5 && savedScroll <= 8 ? savedScroll : null,
        scrollMode: localStorage.getItem("remote.scrollmode") === "1",
        session: savedUrl && nextToken.length >= 4 ? { url: savedUrl, token: nextToken, generation: 1 } : null,
      });
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!booted) return;
    localStorage.setItem("remote.sens", String(sens));
    localStorage.setItem("remote.scroll", String(scrollSens));
    localStorage.setItem("remote.scrollmode", scrollMode ? "1" : "0");
    localStorage.setItem("remote.gyro", String(gyroSens));
  }, [booted, gyroSens, scrollMode, scrollSens, sens]);

  useEffect(() => {
    // Restored after hydration; the saved values only exist in localStorage.
    const timer = window.setTimeout(() => {
      const saved = Number(localStorage.getItem("remote.gyro"));
      if (Number.isFinite(saved) && saved >= 0.3 && saved <= 3) setGyroSens(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!gyro || !session) return;
    // The phone's top edge is the pointer: its azimuth and elevation, measured from the
    // orientation captured at recenter, map straight to a screen position.
    const filters = { x: new OneEuro(1, 0), y: new OneEuro(1, 0) };
    const history: { t: number; x: number; y: number }[] = [];
    let frozen: { x: number; y: number } | null = null;
    let sent = { x: -1e9, y: -1e9 };
    const onOrient = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null) return;
      const now = performance.now();
      const { az, el } = aimAngles(event.alpha, event.beta);
      aimRef.current = { az, el };

      const acc = calibAcc.current;
      if (acc) {
        const x = wrapDegrees(az - acc.az0);
        const y = -(el - acc.el0);
        if (Math.abs(x) > Math.abs(acc.peakX)) acc.peakX = x;
        if (Math.abs(y) > Math.abs(acc.peakY)) acc.peakY = y;
        const r = (v: number) => Math.round(v * 100) / 100;
        acc.rows.push([Math.round(now), r(event.alpha), r(event.beta), r(event.gamma ?? 0), r(x), r(y)]);
        if (acc.rows.length >= 24) send({ op: "calib", step: "samples", rows: acc.rows.splice(0) });
        return;
      }
      const rec = tremorRec.current;
      if (rec) {
        rec.push([now, az, el]);
        return;
      }
      if (calibMode.current || !display) return;
      // Ignore the jolt of tapping the button, then take the current aim as the screen center.
      if (settling.current) return;
      if (needOrigin.current || !originRef.current) {
        originRef.current = { az, el };
        needOrigin.current = false;
        filters.x.reset();
        filters.y.reset();
        history.length = 0;
        frozen = null;
        sent = { x: -1e9, y: -1e9 };
      }
      const origin = originRef.current;
      const t = tuneRef.current;
      const sens = gyroSensRef.current;
      const right = wrapDegrees(az - origin.az) * (t.flipX ? -1 : 1);
      const down = -(el - origin.el) * (t.flipY ? -1 : 1);
      const rawX = display.w / 2 + right * sens * (right > 0 ? t.right : t.left);
      const rawY = display.h / 2 + down * sens * (down > 0 ? t.down : t.up);
      filters.x.minCutoff = filters.y.minCutoff = t.minCutoff;
      filters.x.beta = filters.y.beta = t.beta;
      const x = Math.min(display.w - 1, Math.max(0, filters.x.filter(rawX, now)));
      const y = Math.min(display.h - 1, Math.max(0, filters.y.filter(rawY, now)));

      // While a finger is on the pad (and just after), hold the pointer where it was a moment
      // before the touch, so tapping or scrolling does not shove the pointer off its target.
      if (touchRef.current || now - releasedRef.current < 200) {
        if (!frozen) {
          const past = history.find((h) => h.t >= now - 120) ?? history[history.length - 1];
          frozen = past ? { x: past.x, y: past.y } : { x, y };
          sent = frozen;
          send({ op: "moveto", x: frozen.x, y: frozen.y });
        }
        return;
      }
      frozen = null;
      history.push({ t: now, x, y });
      while (history.length && history[0].t < now - 400) history.shift();
      if (Math.hypot(x - sent.x, y - sent.y) < t.deadband) return;
      sent = { x, y };
      send({ op: "moveto", x, y });
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [display, gyro, send, session]);

  useEffect(() => {
    if (status !== "open") return;
    send({ op: "flags", ...mods });
  }, [mods, send, status]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const fit = () => {
      const viewport = window.visualViewport;
      if (!viewport) return;
      // Only shrink to the visual viewport while the on-screen keyboard is up; otherwise the fixed layout fills the window.
      const keyboardUp = window.innerHeight - viewport.height > 120;
      if (keyboardUp) {
        root.style.height = `${viewport.height}px`;
        root.style.transform = `translateY(${viewport.offsetTop}px)`;
      } else {
        root.style.height = "";
        root.style.transform = "";
      }
    };

    const blockMove = (event: TouchEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest("[data-scroll]") || target.closest('input[type="range"]'))) return;
      event.preventDefault();
    };
    const blockGesture = (event: Event) => event.preventDefault();

    fit();
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    document.addEventListener("touchmove", blockMove, { passive: false });
    document.addEventListener("gesturestart", blockGesture);
    return () => {
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
      document.removeEventListener("touchmove", blockMove);
      document.removeEventListener("gesturestart", blockGesture);
    };
  }, []);

  useEffect(() => {
    const el = padRef.current;
    if (!el || !session) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let traveled = 0;
    let maxPointers = 0;
    let dragging = false;
    let gesture: "pending" | "move" | "scroll" | "drag" | "pan" | "pinch" = "pending";
    let arm = 0;
    let originX = 0;
    let originY = 0;
    let pinchDistance = 0;
    let twoFingerMoved = 0;
    let lastTap = { t: 0, x: 0, y: 0 };

    const clearArm = () => {
      if (arm) window.clearTimeout(arm);
      arm = 0;
    };
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const scrollBy = (dx: number, dy: number) => {
      const x = dx * scrollSensRef.current;
      const y = dy * scrollSensRef.current;
      if (!x && !y) return;
      send({ op: "scroll", dx: x, dy: y });
    };
    const beginDrag = () => {
      if (dragging || gesture === "scroll" || gesture === "pinch") return;
      dragging = true;
      gesture = "drag";
      el.dataset.dragging = "true";
      send({ op: "down", button: "left" });
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      delete el.dataset.dragging;
      send({ op: "up", button: "left" });
    };
    const dots = new Map<number, HTMLDivElement>();
    const dot = (id: number, x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      let node = dots.get(id);
      if (!node) {
        node = document.createElement("div");
        node.className = "touch-dot";
        el.appendChild(node);
        dots.set(id, node);
      }
      node.style.transform = `translate(${x - rect.left}px, ${y - rect.top}px)`;
    };
    const undot = (id: number) => {
      const node = dots.get(id);
      dots.delete(id);
      if (!node) return;
      node.classList.add("out");
      window.setTimeout(() => node.remove(), 220);
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      if (pointers.size >= 2) return;
      el.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      maxPointers = Math.max(maxPointers, pointers.size);
      dot(event.pointerId, event.clientX, event.clientY);
      touchRef.current = true;
      if (pointers.size === 1) {
        traveled = 0;
        gesture = "pending";
        originX = event.clientX;
        originY = event.clientY;
        clearArm();
        if (scrollModeRef.current) return;
        arm = window.setTimeout(() => {
          if (scrollModeRef.current) return;
          if (pointers.size === 1 && traveled < 14) beginDrag();
        }, dragLockRef.current ? 40 : 340);
        return;
      }
      if (pointers.size === 2) {
        clearArm();
        endDrag();
        twoFingerMoved = 0;
        pinchDistance = distance();
        return;
      }
    };

    const onMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      traveled += Math.hypot(dx, dy);
      dot(event.pointerId, event.clientX, event.clientY);
      if (pointers.size === 2 || gesture === "scroll" || gesture === "pinch") {
        const nextDistance = distance();
        if (pointers.size === 2 && Math.abs(nextDistance - pinchDistance) > 28) {
          gesture = "pinch";
          send({ op: "zoom", direction: nextDistance > pinchDistance ? "in" : "out" });
          pinchDistance = nextDistance;
          return;
        }
        if (gesture === "pinch") return;
        twoFingerMoved += Math.hypot(dx, dy);
        if (twoFingerMoved > 10) {
          gesture = "scroll";
        }
        if (gesture === "scroll") scrollBy(dx, dy);
        return;
      }
      if (scrollModeRef.current) {
        if (dragging) endDrag();
        if (gesture !== "pan" && Math.hypot(event.clientX - originX, event.clientY - originY) > 10) {
          clearArm();
          gesture = "pan";
        }
        if (gesture === "pan") {
          if (hintRef.current) {
            hintRef.current = false;
            setHint(false);
          }
          scrollBy(dx, dy);
        }
        return;
      }
      if (!dragging && Math.hypot(event.clientX - originX, event.clientY - originY) > 14) {
        clearArm();
        gesture = "move";
      }
      if (gesture !== "move" && gesture !== "drag") return;
      if (hintRef.current) {
        hintRef.current = false;
        setHint(false);
      }
      send({
        op: "move",
        dx: shapeDelta(dx, sensRef.current),
        dy: shapeDelta(dy, sensRef.current),
      });
    };

    const finish = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      undot(event.pointerId);
      if (pointers.size === 0) {
        touchRef.current = false;
        releasedRef.current = performance.now();
      }
      clearArm();
      if (pointers.size > 0) return;
      const tap = traveled < 14 && gesture === "pending";
      const fingers = maxPointers;
      const x = event.clientX;
      const y = event.clientY;
      const wasDragging = dragging;
      const wasScrolling = gesture === "scroll" || gesture === "pan";
      traveled = 0;
      maxPointers = 0;
      gesture = "pending";
      if (wasDragging) {
        endDrag();
        return;
      }
      if (wasScrolling) {
        return;
      }
      if (!tap) return;
      if (fingers >= 2) {
        send({ op: "click", button: "right", count: 1 });
        return;
      }
      const now = Date.now();
      const count = now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30 ? 2 : 1;
      lastTap = { t: now, x, y };
      send({ op: "click", button: "left", count });
    };

    const block = (event: Event) => event.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("lostpointercapture", finish);
    el.addEventListener("touchmove", block, { passive: false });
    el.addEventListener("contextmenu", block);
    return () => {
      clearArm();
      el.querySelectorAll(".touch-dot").forEach((node) => node.remove());
      dots.clear();
      if (dragging) send({ op: "up", button: "left" });
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", finish);
      el.removeEventListener("lostpointercapture", finish);
      el.removeEventListener("touchmove", block);
      el.removeEventListener("contextmenu", block);
    };
  }, [send, session]);

  function connect(event?: FormEvent) {
    event?.preventDefault();
    let url = "";
    try {
      url = normalizeAgentUrl(agentUrl);
    } catch {
      setFormError("Use an address like ws://100.x.x.x:8787.");
      return;
    }
    const nextToken = normalizeToken(token);
    if (!url || nextToken.length < 4) {
      setFormError("Enter the address and token printed on the Mac.");
      return;
    }
    localStorage.setItem("remote.agent", url);
    localStorage.setItem("remote.token", nextToken);
    setAgentUrl(url);
    setToken(formatToken(nextToken));
    setFormError("");
    setSession((current) => ({
      url,
      token: nextToken,
      generation: (current?.generation ?? 0) + 1,
    }));
    setSettingsOpen(false);
  }

  async function toggleGyro() {
    if (gyro) {
      setGyro(false);
      return;
    }
    if (await enableGyro()) recenter();
  }

  function recenter() {
    settling.current = true;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settling.current = false;
    }, 450);
    needOrigin.current = true;
    if (display) send({ op: "moveto", x: display.w / 2, y: display.h / 2 });
  }

  async function enableGyro() {
    if (gyroRef.current) return true;
    if (protocol < 2) {
      notify("Restart the Mac agent (npm run mac) to update it");
      return false;
    }
    const motion = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!motion) {
      notify("This browser has no motion sensors");
      return false;
    }
    if (typeof motion.requestPermission === "function") {
      try {
        if ((await motion.requestPermission()) !== "granted") {
          notify("Allow Motion & Orientation access in Safari settings");
          return false;
        }
      } catch {
        notify("Motion access needs HTTPS and a tap");
        return false;
      }
    }
    setScrollMode(false);
    setHint(true);
    setGyro(true);
    return true;
  }

  async function startCalibration() {
    if (!display) {
      notify("Restart the Mac agent so it reports the screen size");
      return;
    }
    if (!(await enableGyro())) return;
    setSettingsOpen(false);
    calibMode.current = true;
    recenter();
    send({ op: "calib", step: "begin", data: { display, tune: tuneRef.current, agent: navigator.userAgent } });
    setCalib({ step: 0, phase: "ready", note: "", peaks: {} });
  }

  async function startTremorTest() {
    if (!display) {
      notify("Restart the Mac agent so it reports the screen size");
      return;
    }
    if (!(await enableGyro())) return;
    setSettingsOpen(false);
    calibMode.current = true;
    setTremor({ phase: "ready", progress: 0 });
  }

  function cancelTremorTest() {
    window.clearInterval(tremorTimer.current);
    tremorRec.current = null;
    calibMode.current = false;
    needOrigin.current = true;
    setTremor(null);
  }

  function beginTremorTest() {
    tremorRec.current = [];
    const started = performance.now();
    setTremor({ phase: "measuring", progress: 0 });
    window.clearInterval(tremorTimer.current);
    tremorTimer.current = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / 6800);
      if (progress < 1) {
        setTremor({ phase: "measuring", progress });
        return;
      }
      window.clearInterval(tremorTimer.current);
      const samples = tremorRec.current ?? [];
      tremorRec.current = null;
      const rows = samples.map((row) => row.map((v) => Math.round(v * 100) / 100));
      for (let i = 0; i < rows.length; i += 150) send({ op: "calib", step: "tremor-samples", rows: rows.slice(i, i + 150) });
      const result = analyzeTremor(samples, tuneRef.current, gyroSensRef.current);
      if (!result || result.drift > 4) {
        send({ op: "calib", step: "tremor-result", data: { ok: false, drift: result?.drift ?? null } });
        setTremor({
          phase: "retry",
          progress: 1,
          note: "The phone moved too much. Brace your arm and hold it as still as you can.",
        });
        return;
      }
      const fitted = { ...tuneRef.current, ...result.tune };
      send({ op: "tune", tune: fitted });
      send({ op: "calib", step: "tremor-result", data: { ok: true, rmsPx: result.rmsPx, freq: result.freq, drift: result.drift, tune: result.tune } });
      setTremor({ phase: "done", progress: 1, result });
    }, 100);
  }

  function cancelCalibration() {
    calibAcc.current = null;
    calibMode.current = false;
    needOrigin.current = true;
    setCalib(null);
  }

  function beginCalibStep() {
    calibAcc.current = { az0: aimRef.current.az, el0: aimRef.current.el, peakX: 0, peakY: 0, rows: [] };
    setCalib((c) => (c ? { ...c, phase: "moving", note: "" } : c));
  }

  function endCalibStep() {
    const acc = calibAcc.current;
    const current = calib;
    if (!acc || !current || !display) return;
    calibAcc.current = null;
    if (acc.rows.length) send({ op: "calib", step: "samples", rows: acc.rows });
    const name = calibSteps[current.step];
    const peak = name === "right" || name === "left" ? acc.peakX : acc.peakY;
    send({ op: "calib", step: "result", data: { name, peak } });
    if (Math.abs(peak) < MIN_PEAK) {
      setCalib({ ...current, phase: "ready", note: "That was too small. Rotate at least a hand-width further and try again." });
      return;
    }
    const peaks = { ...current.peaks, [name]: peak };
    if (current.step + 1 < calibSteps.length) {
      setCalib({ step: current.step + 1, phase: "ready", note: "", peaks });
      return;
    }
    const fitted = fitTune(tuneRef.current, display, peaks as Record<CalibStep, number>);
    send({ op: "tune", tune: fitted });
    send({ op: "calib", step: "fit", data: { peaks, tune: fitted } });
    calibMode.current = false;
    needOrigin.current = true;
    setCalib({ step: current.step, phase: "done", note: "", peaks });
  }

  function toggleScrollMode() {
    if (!scrollMode) {
      setGyro(false);
      setDragLock(false);
      setHint(true);
    }
    setScrollMode((value) => !value);
  }

  function notify(text: string) {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }

  function sendPasted(text: string) {
    if (!text) {
      notify("Nothing to send");
      return;
    }
    send({ op: "clipboard", action: "write", text: text.slice(0, 30000) });
    setPasteOpen(false);
    notify("Sent to Mac clipboard");
  }

  async function sendPhoneClipboard() {
    // Without HTTPS the async clipboard API is missing; fall back to a paste box
    // the user can long-press into.
    if (!window.isSecureContext || !navigator.clipboard?.readText) {
      setPasteOpen(true);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        notify("iPhone clipboard is empty");
        return;
      }
      sendPasted(text);
    } catch {
      setPasteOpen(true);
    }
  }

  function copyMacClipboard() {
    // Mac clipboard text is already pushed to the phone, so copy it synchronously
    // inside the tap; iOS rejects copies that happen after an async wait.
    const text = macClipboard?.text;
    if (!text) {
      send({ op: "clipboard", action: "read" });
      notify("Mac clipboard is empty");
      return;
    }
    const fallback = () => {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;-webkit-user-select:text;user-select:text";
      document.body.appendChild(area);
      area.focus();
      area.setSelectionRange(0, text.length);
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      area.remove();
      notify(copied ? "Copied from Mac" : "Couldn't copy from Mac");
    };
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => notify("Copied from Mac"), fallback);
    } else {
      fallback();
    }
  }

  function focusApp(id: string) {
    setDesk((current) => {
      if (!current) return current;
      const kind = browserKind(id);
      return {
        ...current,
        front: id,
        browser: kind,
        tabs: kind && kind === current.browser ? current.tabs : [],
        tabError: kind && kind === current.browser ? current.tabError : "",
      };
    });
    send({ op: "focus", id });
  }

  useEffect(() => {
    if (!pendingQuit) return;
    if (!desk?.apps.some((app) => app.id === pendingQuit.id)) {
      const timer = window.setTimeout(() => setPendingQuit(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [desk, pendingQuit]);

  function quitApp(id: string) {
    setDesk((current) => {
      if (!current) return current;
      const apps = current.apps.filter((app) => app.id !== id);
      const leftFront = current.front === id;
      const front = leftFront ? "" : current.front;
      return {
        ...current,
        apps,
        front,
        browser: leftFront ? "" : current.browser,
        tabs: leftFront ? [] : current.tabs,
        tabError: leftFront ? "" : current.tabError,
      };
    });
    send({ op: "quit", id });
  }

  function focusTab(index: number) {
    if (!desk?.browser) return;
    setDesk((current) => {
      if (!current) return current;
      return {
        ...current,
        tabs: current.tabs.map((tab) => ({ ...tab, active: tab.index === index })),
      };
    });
    send({ op: "tab", browser: desk.browser, index, count: desk.tabCount || desk.tabs.length });
  }

  const shownVolume = draftVolume ?? volume ?? 50;

  function changeVolume(value: number) {
    window.clearTimeout(volumeRelease.current);
    setDraftVolume(value);
    setVolume(value);
    const wait = 60 - (Date.now() - volumeSentAt.current);
    window.clearTimeout(volumeTimer.current);
    const flush = () => {
      volumeSentAt.current = Date.now();
      send({ op: "media", action: "volume", value: latestVolume.current });
    };
    latestVolume.current = value;
    if (wait <= 0) flush();
    else volumeTimer.current = window.setTimeout(flush, wait);
  }

  function endVolumeDrag() {
    window.clearTimeout(volumeRelease.current);
    volumeRelease.current = window.setTimeout(() => setDraftVolume(null), 500);
  }

  function closeTab(index: number) {
    if (!desk?.browser) return;
    setDesk((current) => {
      if (!current) return current;
      const tabs = current.tabs
        .filter((tab) => tab.index !== index)
        .map((tab) => (tab.index > index ? { ...tab, index: tab.index - 1, key: `${current.browser}:${tab.index - 1}` } : tab));
      return { ...current, tabs, tabCount: Math.max(0, current.tabCount - 1) };
    });
    send({ op: "closetab", browser: desk.browser, index, count: desk.tabCount || desk.tabs.length });
  }

  function toggleMod(name: keyof Mods) {
    setMods((current) => ({ ...current, [name]: !current[name] }));
  }

  function typeSpoken(text: string) {
    // Plain text only: held modifiers are ignored, and a trailing space separates phrases.
    const clean = text.replace(/\s+/g, " ").trimStart();
    if (!clean.trim()) return;
    const spaced = clean.endsWith(" ") ? clean : `${clean} `;
    for (let at = 0; at < spaced.length; at += 400) send({ op: "text", s: spaced.slice(at, at + 400) });
  }

  function stopDictation() {
    wantRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    setInterim("");
  }

  function startDictation() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const openKeyboard = (message: string) => {
      notify(message);
      inputRef.current?.focus();
    };
    if (!Ctor) {
      openKeyboard("Dictation is not available here. Use the keyboard mic");
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      // Finished phrases are typed as they arrive; the preview is everything still in progress.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) typeSpoken(result[0].transcript);
      }
      let partial = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) partial += result[0].transcript;
      }
      setInterim(partial);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        stopDictation();
        openKeyboard("Mic or speech access is off. Use the keyboard mic instead");
      }
    };
    rec.onend = () => {
      // Safari ends a session after a pause; keep listening until the user stops.
      if (wantRef.current && recRef.current === rec) {
        window.setTimeout(() => {
          if (!wantRef.current || recRef.current !== rec) return;
          try {
            rec.start();
          } catch {
            stopDictation();
          }
        }, 120);
      } else if (recRef.current === rec) {
        setListening(false);
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      stopDictation();
      openKeyboard("Could not start dictation. Use the keyboard mic");
    }
  }

  function toggleDictation() {
    if (wantRef.current) stopDictation();
    else startDictation();
  }

  function toggleKeyboard() {
    const input = inputRef.current;
    if (!input) return;
    if (document.activeElement === input) input.blur();
    else input.focus();
  }

  function togglePlay() {
    const next = !(playOverride ?? playing ?? false);
    setPlayOverride(next);
    window.clearTimeout(playTimer.current);
    playTimer.current = window.setTimeout(() => setPlayOverride(null), 6000);
    send({ op: "media", action: "toggle" });
  }

  function tapKey(name: string) {
    send({ op: "key", name, down: true });
    send({ op: "key", name, down: false });
  }

  function tapPlain(name: string, shift: boolean) {
    const current = modsRef.current;
    send({ op: "flags", cmd: false, alt: false, ctrl: false, shift });
    send({ op: "key", name, down: true });
    send({ op: "key", name, down: false });
    send({ op: "flags", ...current });
  }

  function once(name: string) {
    const now = Date.now();
    if (now - (recentKey.current[name] ?? 0) < 40) return false;
    recentKey.current[name] = now;
    return true;
  }

  function sendTyped(text: string) {
    const current = modsRef.current;
    if (current.cmd || current.alt || current.ctrl) {
      for (const char of text) {
        const name = char.toLowerCase();
        if (!/^[a-z0-9]$/.test(name)) continue;
        tapKey(name);
      }
      return;
    }
    send({ op: "text", s: text });
  }

  useEffect(() => {
    const stop = () => {
      wantRef.current = false;
      recRef.current?.stop();
      recRef.current = null;
      setListening(false);
      setInterim("");
    };
    if (status !== "open") stop();
    const onHide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [status]);

  const dictationPresence = usePresence(listening);
  const interimText = useLast(interim);
  const toastPresence = usePresence(Boolean(toast));
  const toastText = useLast(toast);
  const calibPresence = usePresence(calib !== null, 260);
  const calibView = useLast(calib);
  const tremorPresence = usePresence(tremor !== null, 260);
  const tremorView = useLast(tremor);
  const pastePresence = usePresence(pasteOpen);
  const settingsPresence = usePresence(settingsOpen && session !== null);
  const tabAsk = usePresence(pendingTab !== null);
  const tabAskView = useLast(pendingTab);
  const quitAsk = usePresence(pendingQuit !== null);
  const quitAskView = useLast(pendingQuit);
  const hintPresence = usePresence(hint, 400);

  const quickActions: Record<QuickId, () => void> = {
    keyboard: toggleKeyboard,
    dictate: toggleDictation,
    enter: () => tapKey("return"),
    backspace: () => tapKey("delete"),
    scroll: toggleScrollMode,
    leftClick: () => send({ op: "click", button: "left", count: 1 }),
    rightClick: () => send({ op: "click", button: "right", count: 1 }),
    dragLock: () => setDragLock((value) => !value),
    mission: () => send({ op: "workspace", action: "mission-control" }),
    fullscreen: () => send({ op: "fullscreen" }),
    pageUp: () => tapPlain("space", true),
    pageDown: () => tapPlain("space", false),
    playPause: togglePlay,
    back: () => send({ op: "browse", action: "back" }),
    forward: () => send({ op: "browse", action: "forward" }),
    reload: () => send({ op: "browse", action: "reload" }),
    newTab: () => send({ op: "browse", action: "newtab" }),
  };
  const quickActive: Partial<Record<QuickId, boolean>> = {
    keyboard: keyboard,
    dictate: listening,
    scroll: scrollMode,
    dragLock,
    playPause: isPlaying,
  };
  const quickItems: QuickItem[] = quickIds.map((id) => ({
    id,
    label: quickMeta[id].label,
    icon: id === "playPause" && isPlaying ? Pause : quickIcons[id],
    active: Boolean(quickActive[id]),
    repeat: id === "backspace",
    onPress: quickActions[id],
  }));

  const message = formError || error;
  const connected = status === "open";

  return (
    <div className="remote" id="remote-app" ref={rootRef} data-keyboard={keyboard ? "open" : "closed"}>

      {connected && trusted === false ? (
        <p className="warn">Allow RemoteInput in System Settings → Privacy & Security → Accessibility, then restart the Mac command.</p>
      ) : null}
      {session && message ? <p className="warn">{message}</p> : null}

      <main className="remote-stage">
        <header className="remote-top">
          <div className="status" data-state={status}>
            <span className="status-dot" data-on={status} />
            <span>{labelFor(status)}</span>
            {connected && rtt !== null ? <span className={rtt > 60 ? "rtt slow" : "rtt"}>{rtt} ms</span> : null}
          </div>
          <div className="top-side">
            {connected && battery ? (
              <span
                className="battery"
                data-charging={battery.charging ? "true" : "false"}
                data-low={!battery.charging && battery.percent <= 20 ? "true" : "false"}
                aria-label={`Mac battery ${battery.percent} percent${battery.charging ? ", charging" : ""}`}
              >
                <BatteryIcon percent={battery.percent} charging={battery.charging} />
                {battery.percent}%
              </span>
            ) : null}
            {session && gyro ? (
              <button type="button" className="icon-button" aria-label="Recenter pointer" onClick={recenter}>
                <Crosshair />
              </button>
            ) : null}
            {session ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Gyro pointer"
                aria-pressed={gyro}
                data-on={gyro ? "true" : "false"}
                onClick={() => void toggleGyro()}
              >
                <Move3d />
              </button>
            ) : null}
            {session ? (
              <button
                type="button"
                className="icon-button"
                aria-label={settingsOpen ? "Close settings" : "Settings"}
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
              >
                {settingsOpen ? <X /> : <Settings />}
              </button>
            ) : null}
          </div>
        </header>

        {!booted ? null : !session ? (
          <form className="setup" onSubmit={connect}>
            <div>
              <h1>Control this Mac</h1>
              <p>Open the link printed on the Mac, or enter its address and token below.</p>
            </div>
            <ConnectionFields agentUrl={agentUrl} token={token} onUrl={setAgentUrl} onToken={setToken} />
            {message ? <p className="warn flat">{message}</p> : null}
            <button type="submit" className="primary">Connect</button>
            <p className="fine">Add this page to your Home Screen so it opens full screen.</p>
          </form>
        ) : (
          <div className="remote-pad" ref={padRef} role="application" aria-label="Trackpad" data-mode={gyro ? "gyro" : scrollMode ? "scroll" : "move"}>
            {hintPresence.mounted ? (
              <p className="hint" data-state={hintPresence.state}>
                {gyro
                  ? "Point the top of the phone at the screen. Drag to scroll. Tap to click. Crosshair recenters."
                  : scrollMode
                  ? "One finger scrolls. Tap still clicks."
                  : "Drag to move. Tap to click. Hold to drag. Two fingers scroll."}
              </p>
            ) : null}
          </div>
        )}
        {session ? <QuickRail items={quickItems} /> : null}
        {dictationPresence.mounted ? (
          <div className="dictation" role="status" data-state={dictationPresence.state}>
            <span className="dictation-dot" aria-hidden="true" />
            <div className="dictation-words" aria-live="polite">
              {dictationWords(interim || interimText).map(({ word, index, last }) => (
                <span key={index} data-last={last ? "true" : "false"}>{word}</span>
              ))}
              {!(interim || interimText) ? <span className="dictation-idle">Listening…</span> : null}
            </div>
          </div>
        ) : null}
        {toastPresence.mounted ? (
          <div className="toast" role="status" data-state={toastPresence.state}>
            <Check />
            {toastText}
          </div>
        ) : null}
        {calibPresence.mounted && calibView ? (
          <section className="calib" aria-label="Gyro calibration" data-state={calibPresence.state}>
            <button type="button" className="icon-button calib-close" aria-label="Cancel calibration" onClick={cancelCalibration}>
              <X />
            </button>
            <div className="calib-body" key={`${calibView.step}-${calibView.phase}`}>
            {calibView.phase === "done" ? (
              <>
                <Check className="calib-icon" />
                <h2>Calibrated</h2>
                <p>
                  Pixels per degree: right {tune.right.toFixed(0)}, left {tune.left.toFixed(0)}, up {tune.up.toFixed(0)}, down{" "}
                  {tune.down.toFixed(0)}.
                </p>
                <button type="button" className="primary" onClick={cancelCalibration}>Done</button>
              </>
            ) : (
              <>
                <p className="calib-step">Step {calibView.step + 1} of {calibSteps.length}</p>
                <CalibArrow step={calibSteps[calibView.step]} />
                <h2>Rotate {calibSteps[calibView.step]}</h2>
                <p>
                  {calibView.phase === "ready"
                    ? "Hold the phone naturally, pointing at the screen. Tap Start, rotate as far as feels comfortable, then tap Done."
                    : "Rotate as far as is comfortable, then tap Done."}
                </p>
                {calibView.note ? <p className="calib-note">{calibView.note}</p> : null}
                {calibView.phase === "ready" ? (
                  <button type="button" className="primary" onClick={beginCalibStep}>Start</button>
                ) : (
                  <button type="button" className="primary" onClick={endCalibStep}>Done</button>
                )}
              </>
            )}
            </div>
          </section>
        ) : null}
        {tremorPresence.mounted && tremorView ? (
          <section className="calib" aria-label="Hand tremor test" data-state={tremorPresence.state}>
            <button type="button" className="icon-button calib-close" aria-label="Cancel tremor test" onClick={cancelTremorTest}>
              <X />
            </button>
            <div className="calib-body" key={tremorView.phase}>
              {tremorView.phase === "done" && tremorView.result ? (
                <>
                  <Check className="calib-icon" />
                  <h2>Smoothing set</h2>
                  <p>
                    Your shake is about {tremorView.result.rmsPx.toFixed(1)} px at {tremorView.result.freq.toFixed(0)} Hz. The pointer filter
                    now cuts it ({tremorView.result.tune.minCutoff.toFixed(1)} Hz cutoff, {tremorView.result.tune.deadband.toFixed(1)} px
                    deadband).
                  </p>
                  <button type="button" className="primary" onClick={cancelTremorTest}>Done</button>
                </>
              ) : tremorView.phase === "measuring" ? (
                <>
                  <Hand className="calib-icon" />
                  <h2>Hold still</h2>
                  <p>Aim at the middle of the screen and keep the phone as steady as you can.</p>
                  <div className="meter" aria-hidden="true"><i style={{ width: `${Math.round(tremorView.progress * 100)}%` }} /></div>
                </>
              ) : (
                <>
                  <Hand className="calib-icon" />
                  <h2>Hand tremor</h2>
                  <p>Hold the phone the way you point with it, aimed at the screen, then tap Start and keep it as still as you can for a few seconds.</p>
                  {tremorView.note ? <p className="calib-note">{tremorView.note}</p> : null}
                  <button type="button" className="primary" onClick={beginTremorTest}>Start</button>
                </>
              )}
            </div>
          </section>
        ) : null}
        {pastePresence.mounted ? (
          <section className="sheet" data-state={pastePresence.state}>
            <h2>Send to Mac</h2>
            <textarea ref={pasteRef} className="paste-box" autoFocus placeholder="Long-press here and tap Paste" />
            <div className="sheet-actions">
              <button type="button" className="primary" onClick={() => sendPasted(pasteRef.current?.value ?? "")}>Send</button>
              <button type="button" onClick={() => setPasteOpen(false)}>Cancel</button>
            </div>
          </section>
        ) : null}
      </main>

      {session ? (
        <div className="remote-base">
          <div className="fold" data-open={showTabs ? "true" : "false"}>
            <div className="fold-inner">
              {tabDesk ? (
                <div className="tab-row" data-scroll>
                  {tabDesk.tabError ? <p className="tab-note">{tabDesk.tabError}</p> : null}
                  {tabDesk.tabs.map((tab) => {
                    const shared = tab.host ? tabDesk.tabs.filter((other) => other.host === tab.host).length : 0;
                    const icon = tab.host && shared === 1 ? tabIcons[tab.host] ?? "" : "";
                    return (
                      <TabButton
                        key={tab.key}
                        title={tab.title}
                        icon={icon}
                        active={tab.active}
                        onOpen={() => focusTab(tab.index)}
                        onAskClose={() => setPendingTab({ index: tab.index, title: tab.title })}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          {tabAsk.mounted && tabAskView ? (
            <div className="quit-confirm" data-state={tabAsk.state}>
              <p>Close tab “{tabAskView.title}”?</p>
              <button type="button" onClick={() => setPendingTab(null)}>Cancel</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const index = tabAskView.index;
                  setPendingTab(null);
                  closeTab(index);
                }}
              >
                Close
              </button>
            </div>
          ) : null}
          {quitAsk.mounted && quitAskView ? (
            <div className="quit-confirm" data-state={quitAsk.state}>
              <p>Force quit {quitAskView.name}?</p>
              <button type="button" onClick={() => setPendingQuit(null)}>Cancel</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const id = quitAskView.id;
                  setPendingQuit(null);
                  quitApp(id);
                }}
              >
                Force quit
              </button>
            </div>
          ) : null}
          {desk && desk.apps.length > 0 ? (
            <div className="dock" data-scroll aria-label="Open apps" ref={dockRef}>
              {desk.apps.map((app) => (
                <DockButton
                  key={app.id}
                  id={app.id}
                  name={app.name}
                  icon={app.icon || ""}
                  active={app.id === desk.front}
                  onOpen={() => focusApp(app.id)}
                  onAskQuit={() => setPendingQuit({ id: app.id, name: app.name })}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {session ? (
        <footer className="remote-foot">
          <div className="deck-line mod-row">
            <div className="seg" role="group" aria-label="Modifier keys">
              <PressButton label="Command" pressed={mods.cmd} onPress={() => toggleMod("cmd")}><Command /></PressButton>
              <PressButton label="Option" pressed={mods.alt} onPress={() => toggleMod("alt")}><Option /></PressButton>
              <PressButton label="Control" pressed={mods.ctrl} onPress={() => toggleMod("ctrl")}><ChevronUp /></PressButton>
              <PressButton label="Shift" pressed={mods.shift} onPress={() => toggleMod("shift")}><ArrowBigUp /></PressButton>
            </div>
            <div className="seg" role="group" aria-label="Clipboard">
              <PressButton label="Send iPhone clipboard to Mac" onPress={() => void sendPhoneClipboard()}>
                <span className="bridge"><Smartphone /><ArrowRight /><Laptop /></span>
              </PressButton>
              <PressButton label="Copy Mac clipboard to iPhone" onPress={copyMacClipboard}>
                <span className="bridge"><Laptop /><ArrowRight /><Smartphone /></span>
              </PressButton>
            </div>
          </div>
          <div className="deck-line">
            <div className="seg grow" role="group" aria-label="Arrow keys">
              <PressButton label="Left arrow" repeat onPress={() => tapKey("left")}><ArrowLeft /></PressButton>
              <PressButton label="Up arrow" repeat onPress={() => tapKey("up")}><ArrowUp /></PressButton>
              <PressButton label="Down arrow" repeat onPress={() => tapKey("down")}><ArrowDown /></PressButton>
              <PressButton label="Right arrow" repeat onPress={() => tapKey("right")}><ArrowRight /></PressButton>
              <PressButton label="Page up" onPress={() => tapPlain("space", true)}><ChevronsUp /></PressButton>
              <PressButton label="Page down" onPress={() => tapPlain("space", false)}><ChevronsDown /></PressButton>
            </div>
            <div className="seg" role="group" aria-label="Delete and enter">
              <PressButton label="Delete" repeat onPress={() => tapKey("delete")}><Delete /></PressButton>
              <PressButton label="Enter" onPress={() => tapKey("return")}><CornerDownLeft /></PressButton>
            </div>
          </div>
          <div className="deck-line click-row">
            <div className="seg grow" role="group" aria-label="Mouse">
              <PressButton label="Left click" onPress={() => send({ op: "click", button: "left", count: 1 })}><MousePointerClick /></PressButton>
              <PressButton label="Right click" onPress={() => send({ op: "click", button: "right", count: 1 })}><SquareMenu /></PressButton>
              <PressButton label="Drag lock" pressed={dragLock} onPress={() => setDragLock((value) => !value)}><Grab /></PressButton>
              <PressButton label="One-finger scroll" pressed={scrollMode} onPress={toggleScrollMode}><ArrowUpDown /></PressButton>
            </div>
            <div className="seg grow" role="group" aria-label="Keyboard and windows">
              <button
                type="button"
                aria-label="Keyboard"
                data-keyboard-toggle
                data-on={keyboard ? "true" : "false"}
                onClick={toggleKeyboard}
              >
                <Keyboard />
              </button>
              <button
                type="button"
                aria-label={listening ? "Stop dictation" : "Dictate"}
                aria-pressed={listening}
                data-on={listening ? "true" : "false"}
                data-listening={listening ? "true" : "false"}
                onClick={toggleDictation}
              >
                <Mic />
              </button>
              <PressButton label="Mission Control" onPress={() => send({ op: "workspace", action: "mission-control" })}><LayoutGrid /></PressButton>
              <PressButton label="Full screen" onPress={() => send({ op: "fullscreen" })}><Maximize /></PressButton>
            </div>
          </div>
          {connected ? (
            <section className="media-row" aria-label="Media controls">
              <div className="media-play">
                <PressButton label="Play or pause" onPress={togglePlay}>
                  {isPlaying ? <Pause key="pause" /> : <Play key="play" />}
                </PressButton>
              </div>
              <label>
                <VolumeIcon level={shownVolume} />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={shownVolume}
                  style={{ "--v": `${shownVolume}%` } as CSSProperties}
                  onChange={(event) => changeVolume(Number(event.target.value))}
                  onPointerUp={endVolumeDrag}
                  onPointerCancel={endVolumeDrag}
                  onBlur={endVolumeDrag}
                  aria-label="Mac volume"
                />
              </label>
              <div className="browse-wrap" data-open={showBrowser ? "true" : "false"} inert={!showBrowser}>
                <div className="seg browse-seg" role="group" aria-label="Browser">
                  <PressButton label="Back" onPress={() => send({ op: "browse", action: "back" })}><ChevronLeft /></PressButton>
                  <PressButton label="Forward" onPress={() => send({ op: "browse", action: "forward" })}><ChevronRight /></PressButton>
                  <PressButton label="Reload" onPress={() => send({ op: "browse", action: "reload" })}><RotateCw /></PressButton>
                  <PressButton label="New tab" onPress={() => send({ op: "browse", action: "newtab" })}><Plus /></PressButton>
                </div>
              </div>
            </section>
          ) : null}
        </footer>
      ) : null}

      {settingsPresence.mounted ? (
        <SettingsPage
          state={settingsPresence.state}
          onClose={() => setSettingsOpen(false)}
          agentUrl={agentUrl}
          token={token}
          onUrl={setAgentUrl}
          onToken={setToken}
          onReconnect={() => connect()}
          onDisconnect={() => {
            setSession(null);
            setSettingsOpen(false);
          }}
          sens={sens}
          onSens={setSens}
          scrollSens={scrollSens}
          onScrollSens={setScrollSens}
          gyroSens={gyroSens}
          onGyroSens={setGyroSens}
          onCalibrate={() => void startCalibration()}
          onTremor={() => void startTremorTest()}
          onResetGyro={() => send({ op: "tune", tune: defaultTune })}
          quick={quickIds}
          onQuick={setQuickIds}
        />
      ) : null}

      <input
        ref={inputRef}
        className="capture"
        aria-label="Type on the Mac"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="enter"
        onFocus={() => setKeyboard(true)}
        onBlur={() => setKeyboard(false)}
        onKeyDown={(event) => {
          const name = specialKey(event.key);
          if (!name) return;
          event.preventDefault();
          if ((name === "return" || name === "delete") && !once(name)) return;
          tapKey(name);
        }}
        onBeforeInput={(event) => {
          const input = event.nativeEvent as InputEvent;
          if (input.inputType === "insertLineBreak") {
            event.preventDefault();
            if (once("return")) tapKey("return");
          } else if (input.inputType === "deleteContentBackward") {
            event.preventDefault();
            if (once("delete")) tapKey("delete");
          }
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          composedAt.current = Date.now();
          if (event.data) sendTyped(event.data);
        }}
        onInput={(event) => {
          if (composing.current) return;
          const field = event.currentTarget;
          const value = field.value;
          field.value = "";
          if (!value || Date.now() - composedAt.current < 80) return;
          sendTyped(value);
        }}
      />
    </div>
  );
}

function labelFor(status: AgentStatus) {
  switch (status) {
    case "open":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "closed":
      return "Reconnecting";
    case "denied":
      return "Check token";
    case "replaced":
      return "In use";
    default:
      return "Offline";
  }
}

function useHold(onHold: () => void) {
  const [holding, setHolding] = useState(false);
  const timers = useRef({ arm: 0, fire: 0 });
  const moved = useRef(false);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const pending = timers.current;
    return () => {
      window.clearTimeout(pending.arm);
      window.clearTimeout(pending.fire);
    };
  }, []);

  function clear() {
    window.clearTimeout(timers.current.arm);
    window.clearTimeout(timers.current.fire);
    timers.current.arm = 0;
    timers.current.fire = 0;
    setHolding(false);
  }

  return {
    holding,
    props: {
      onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
      onPointerDown: (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        moved.current = false;
        held.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        timers.current.arm = window.setTimeout(() => setHolding(true), 280);
        timers.current.fire = window.setTimeout(() => {
          held.current = true;
          onHold();
        }, 460);
      },
      onPointerMove: (event: ReactPointerEvent) => {
        if (moved.current) return;
        if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) {
          moved.current = true;
          clear();
        }
      },
      onPointerUp: clear,
      onPointerCancel: () => {
        moved.current = true;
        clear();
      },
    },
    /** True when the release that follows should not count as a tap. */
    consumed: () => held.current || moved.current,
  };
}

function DockButton({
  id,
  name,
  icon,
  active,
  onOpen,
  onAskQuit,
}: {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  onOpen: () => void;
  onAskQuit: () => void;
}) {
  const hold = useHold(onAskQuit);
  return (
    <button
      type="button"
      data-app-id={id}
      data-on={active ? "true" : "false"}
      data-holding={hold.holding ? "true" : "false"}
      aria-label={hold.holding ? `Force quit ${name}` : name}
      {...hold.props}
      onClick={() => {
        if (hold.consumed()) return;
        onOpen();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- These are runtime data URLs from the local Mac, not network images. */}
      {icon ? <img src={`data:image/png;base64,${icon}`} alt="" draggable={false} /> : <i>{name.slice(0, 1)}</i>}
      <span>{hold.holding ? "Quit?" : name}</span>
    </button>
  );
}

function TabButton({
  title,
  icon,
  active,
  onOpen,
  onAskClose,
}: {
  title: string;
  icon: string;
  active: boolean;
  onOpen: () => void;
  onAskClose: () => void;
}) {
  const hold = useHold(onAskClose);
  return (
    <button
      type="button"
      data-on={active ? "true" : "false"}
      data-holding={hold.holding ? "true" : "false"}
      data-icon={icon ? "true" : "false"}
      aria-label={hold.holding ? `Close ${title}` : title}
      title={title}
      {...hold.props}
      onClick={() => {
        if (hold.consumed()) return;
        onOpen();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Runtime data URL fetched by the local agent. */}
      {icon ? <img src={icon} alt="" draggable={false} /> : hold.holding ? "Close?" : title}
    </button>
  );
}

/** The latest words with stable keys (their position in the phrase), so only new words animate in. */
function dictationWords(text: string | null, max = 14) {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  const start = Math.max(0, words.length - max);
  return words.slice(start).map((word, k) => ({ word, index: start + k, last: start + k === words.length - 1 }));
}

function CalibArrow({ step }: { step: CalibStep }) {
  const Glyph: LucideIcon = step === "right" ? ArrowRight : step === "left" ? ArrowLeft : step === "up" ? ArrowUp : ArrowDown;
  return <Glyph className="calib-icon" aria-hidden="true" />;
}

function VolumeIcon({ level }: { level: number }) {
  const Glyph: LucideIcon = level === 0 ? VolumeX : level < 50 ? Volume1 : Volume2;
  return <Glyph className="vol-icon" aria-hidden="true" />;
}

function BatteryIcon({ percent, charging }: { percent: number; charging: boolean }) {
  const Glyph: LucideIcon = charging ? BatteryCharging : percent <= 20 ? BatteryLow : BatteryFull;
  return <Glyph aria-hidden="true" />;
}

