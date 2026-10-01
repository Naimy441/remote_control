"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
import { useAgent, type AgentStatus } from "@/components/useAgent";

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
  const [keyboard, setKeyboard] = useState(false);
  const [pendingQuit, setPendingQuit] = useState<{ id: string; name: string } | null>(null);
  const [hint, setHint] = useState(true);

  const padRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sensRef = useRef(sens);
  const scrollSensRef = useRef(scrollSens);
  const dragLockRef = useRef(dragLock);
  const scrollModeRef = useRef(scrollMode);
  const modsRef = useRef(mods);
  const hintRef = useRef(hint);
  const recentKey = useRef<Record<string, number>>({});
  const composedAt = useRef(0);
  const composing = useRef(false);

  useEffect(() => {
    sensRef.current = sens;
    scrollSensRef.current = scrollSens;
    dragLockRef.current = dragLock;
    scrollModeRef.current = scrollMode;
    modsRef.current = mods;
    hintRef.current = hint;
  }, [dragLock, hint, mods, scrollMode, scrollSens, sens]);

  const { status, trusted, rtt, error, send, desk, setDesk } = useAgent({
    url: session?.url ?? "",
    token: session?.token ?? "",
    active: session !== null,
    generation: session?.generation ?? 0,
  });

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restoreSession({
      url: savedUrl,
      token: nextToken ? formatToken(nextToken) : "",
      sens: Number.isFinite(savedSens) && savedSens >= 0.4 && savedSens <= 4 ? savedSens : null,
      scroll: Number.isFinite(savedScroll) && savedScroll >= 0.5 && savedScroll <= 8 ? savedScroll : null,
      scrollMode: localStorage.getItem("remote.scrollmode") === "1",
      session: savedUrl && nextToken.length >= 4 ? { url: savedUrl, token: nextToken, generation: 1 } : null,
    });
  }, []);

  useEffect(() => {
    if (!booted) return;
    localStorage.setItem("remote.sens", String(sens));
    localStorage.setItem("remote.scroll", String(scrollSens));
    localStorage.setItem("remote.scrollmode", scrollMode ? "1" : "0");
  }, [booted, scrollMode, scrollSens, sens]);

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
      root.style.height = `${viewport.height}px`;
      root.style.transform = `translateY(${viewport.offsetTop}px)`;
    };

    const blockMove = (event: TouchEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-scroll]")) return;
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
    let gesture: "pending" | "move" | "scroll" | "drag" | "pan" = "pending";
    let arm = 0;
    let originX = 0;
    let originY = 0;
    let lastTap = { t: 0, x: 0, y: 0 };

    const clearArm = () => {
      if (arm) window.clearTimeout(arm);
      arm = 0;
    };
    const beginDrag = () => {
      if (dragging || gesture === "scroll") return;
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
    const glow = (x: number, y: number, on: boolean) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--x", `${x - rect.left}px`);
      el.style.setProperty("--y", `${y - rect.top}px`);
      el.style.setProperty("--glow", on ? "1" : "0");
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      el.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      maxPointers = Math.max(maxPointers, pointers.size);
      glow(event.clientX, event.clientY, true);
      if (pointers.size >= 2) {
        clearArm();
        endDrag();
        return;
      }
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
    };

    const onMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      traveled += Math.hypot(dx, dy);
      glow(event.clientX, event.clientY, true);
      if (pointers.size >= 2 || gesture === "scroll") {
        if (pointers.size >= 2 && traveled > 10) gesture = "scroll";
        if (gesture === "scroll" && pointers.size >= 2) {
          send({ op: "scroll", dx: dx * scrollSensRef.current, dy: dy * scrollSensRef.current });
        }
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
          send({ op: "scroll", dx: dx * scrollSensRef.current, dy: dy * scrollSensRef.current });
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
      clearArm();
      if (pointers.size > 0) return;
      glow(event.clientX, event.clientY, false);
      const tap = traveled < 14 && gesture === "pending";
      const fingers = maxPointers;
      const x = event.clientX;
      const y = event.clientY;
      const wasDragging = dragging;
      traveled = 0;
      maxPointers = 0;
      gesture = "pending";
      if (wasDragging) {
        endDrag();
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

  function toggleScrollMode() {
    if (!scrollMode) {
      setDragLock(false);
      setHint(true);
    }
    setScrollMode((value) => !value);
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
    if (!desk?.apps.some((app) => app.id === pendingQuit.id)) setPendingQuit(null);
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

  function toggleMod(name: keyof Mods) {
    setMods((current) => ({ ...current, [name]: !current[name] }));
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

  const message = formError || error;
  const connected = status === "open";

  return (
    <div className="remote" id="remote-app" ref={rootRef} data-keyboard={keyboard ? "open" : "closed"}>
      <header className="remote-top">
        <div className="status">
          <span className="status-dot" data-on={status} />
          <span>{labelFor(status)}</span>
          {connected && rtt !== null ? <span className={rtt > 60 ? "rtt slow" : "rtt"}>{rtt} ms</span> : null}
        </div>
        {session ? (
          <button type="button" className="text-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            {settingsOpen ? "Close" : "Settings"}
          </button>
        ) : null}
      </header>

      {connected && trusted === false ? (
        <p className="warn">Allow RemoteInput in System Settings → Privacy & Security → Accessibility, then restart the Mac command.</p>
      ) : null}
      {session && message ? <p className="warn">{message}</p> : null}

      <main className="remote-stage">
        {!booted ? null : !session ? (
          <form className="setup" onSubmit={connect}>
            <div>
              <h1>Control this Mac</h1>
              <p>Open the link printed by the Mac. Drag moves the pointer, tap clicks, and two fingers scroll.</p>
            </div>
            <ConnectionFields agentUrl={agentUrl} token={token} onUrl={setAgentUrl} onToken={setToken} />
            {message ? <p className="warn flat">{message}</p> : null}
            <button type="submit" className="primary">Connect</button>
            <p className="fine">Add this page to your Home Screen so it opens full screen. Page down sends the space bar.</p>
          </form>
        ) : (
          <div className="remote-pad" ref={padRef} role="application" aria-label="Trackpad" data-mode={scrollMode ? "scroll" : "move"}>
            {hint ? (
              <p className="hint">
                {scrollMode
                  ? "One finger scrolls. Tap still clicks."
                  : "Drag to move. Tap to click. Hold to drag. Two fingers scroll."}
              </p>
            ) : null}
          </div>
        )}
        {settingsOpen && session ? (
          <section className="sheet" data-scroll>
            <h2>Settings</h2>
            <ConnectionFields agentUrl={agentUrl} token={token} onUrl={setAgentUrl} onToken={setToken} />
            <Slider label="Pointer" value={sens} min={0.4} max={4} step={0.1} onChange={setSens} />
            <Slider label="Scroll" value={scrollSens} min={0.5} max={8} step={0.1} onChange={setScrollSens} />
            <div className="sheet-actions">
              <button type="button" className="primary" onClick={() => connect()}>Reconnect</button>
              <button type="button" onClick={() => { setSession(null); setSettingsOpen(false); }}>Disconnect</button>
            </div>
          </section>
        ) : null}
      </main>

      {session ? (
        <footer className="remote-foot">
          <div className="remote-row mod-row">
            <PressButton label="Command" pressed={mods.cmd} onPress={() => toggleMod("cmd")}>⌘</PressButton>
            <PressButton label="Option" pressed={mods.alt} onPress={() => toggleMod("alt")}>⌥</PressButton>
            <PressButton label="Control" pressed={mods.ctrl} onPress={() => toggleMod("ctrl")}>⌃</PressButton>
            <PressButton label="Shift" pressed={mods.shift} onPress={() => toggleMod("shift")}>⇧</PressButton>
            <button
              type="button"
              data-keyboard-toggle
              data-on={keyboard ? "true" : "false"}
              onClick={() => {
                const input = inputRef.current;
                if (!input) return;
                if (document.activeElement === input) input.blur();
                else input.focus();
              }}
            >
              Keyboard
            </button>
          </div>
          <div className="remote-row">
            <PressButton label="Left arrow" repeat onPress={() => tapKey("left")}>←</PressButton>
            <PressButton label="Up arrow" repeat onPress={() => tapKey("up")}>↑</PressButton>
            <PressButton label="Down arrow" repeat onPress={() => tapKey("down")}>↓</PressButton>
            <PressButton label="Right arrow" repeat onPress={() => tapKey("right")}>→</PressButton>
            <PressButton label="Escape" onPress={() => tapKey("escape")}>esc</PressButton>
            <PressButton label="Delete" repeat onPress={() => tapKey("delete")}>⌫</PressButton>
          </div>
          <div className="remote-row click-row">
            <PressButton label="Left click" onPress={() => send({ op: "click", button: "left", count: 1 })}>Click</PressButton>
            <PressButton label="Right click" onPress={() => send({ op: "click", button: "right", count: 1 })}>Right</PressButton>
            <PressButton label="Drag lock" pressed={dragLock} onPress={() => setDragLock((value) => !value)}>Drag</PressButton>
            <PressButton label="One-finger scroll" pressed={scrollMode} onPress={toggleScrollMode}>Scroll</PressButton>
          </div>
          <div className="remote-row page-row">
            <PressButton label="Page up" onPress={() => tapPlain("space", true)}>
              <span>Page up</span>
              <small>shift space</small>
            </PressButton>
            <PressButton label="Full screen" onPress={() => send({ op: "fullscreen" })}>
              <span>Full screen</span>
              <small>ctrl ⌘ F</small>
            </PressButton>
            <PressButton label="Page down" onPress={() => tapPlain("space", false)}>
              <span>Page down</span>
              <small>space</small>
            </PressButton>
          </div>
          {desk?.browser ? (
            <div className="remote-row browse-row">
              <PressButton label="Back" onPress={() => send({ op: "browse", action: "back" })}>Back</PressButton>
              <PressButton label="Forward" onPress={() => send({ op: "browse", action: "forward" })}>Forward</PressButton>
              <PressButton label="Reload" onPress={() => send({ op: "browse", action: "reload" })}>Reload</PressButton>
              <PressButton label="New tab" onPress={() => send({ op: "browse", action: "newtab" })}>New tab</PressButton>
            </div>
          ) : null}
          {desk?.browser && (desk.tabs.length > 0 || desk.tabError) ? (
            <div className="tab-row" data-scroll>
              {desk.tabError ? <p className="tab-note">{desk.tabError}</p> : null}
              {desk.tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  data-on={tab.active ? "true" : "false"}
                  onClick={() => focusTab(tab.index)}
                >
                  {tab.title}
                </button>
              ))}
            </div>
          ) : null}
          {pendingQuit ? (
            <div className="quit-confirm">
              <p>Force quit {pendingQuit.name}?</p>
              <button type="button" onClick={() => setPendingQuit(null)}>Cancel</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const id = pendingQuit.id;
                  setPendingQuit(null);
                  quitApp(id);
                }}
              >
                Force quit
              </button>
            </div>
          ) : null}
          {desk && desk.apps.length > 0 ? (
            <div className="dock" data-scroll aria-label="Open apps">
              {desk.apps.map((app) => (
                <DockButton
                  key={app.id}
                  name={app.name}
                  icon={app.icon || ""}
                  active={app.id === desk.front}
                  onOpen={() => focusApp(app.id)}
                  onAskQuit={() => setPendingQuit({ id: app.id, name: app.name })}
                />
              ))}
            </div>
          ) : null}
        </footer>
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

function ConnectionFields({
  agentUrl,
  token,
  onUrl,
  onToken,
}: {
  agentUrl: string;
  token: string;
  onUrl: (value: string) => void;
  onToken: (value: string) => void;
}) {
  return (
    <div className="fields">
      <label>
        <span>Mac agent</span>
        <input
          value={agentUrl}
          onChange={(event) => onUrl(event.target.value)}
          placeholder="ws://100.x.x.x:8787"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
      </label>
      <label>
        <span>Token</span>
        <input
          value={token}
          onChange={(event) => onToken(event.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
        />
      </label>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span>{label}</span>
      <strong>{value.toFixed(1)}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function DockButton({
  name,
  icon,
  active,
  onOpen,
  onAskQuit,
}: {
  name: string;
  icon: string;
  active: boolean;
  onOpen: () => void;
  onAskQuit: () => void;
}) {
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

  return (
    <button
      type="button"
      data-on={active ? "true" : "false"}
      data-holding={holding ? "true" : "false"}
      aria-label={holding ? `Force quit ${name}` : name}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        moved.current = false;
        held.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        timers.current.arm = window.setTimeout(() => setHolding(true), 280);
        timers.current.fire = window.setTimeout(() => {
          held.current = true;
          onAskQuit();
        }, 460);
      }}
      onPointerMove={(event) => {
        if (moved.current) return;
        if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) {
          moved.current = true;
          clear();
        }
      }}
      onPointerUp={clear}
      onPointerCancel={() => {
        moved.current = true;
        clear();
      }}
      onClick={() => {
        if (held.current || moved.current) return;
        onOpen();
      }}
    >
      {icon ? <img src={`data:image/png;base64,${icon}`} alt="" draggable={false} /> : <i>{name.slice(0, 1)}</i>}
      <span>{holding ? "Quit?" : name}</span>
    </button>
  );
}

function PressButton({
  children,
  onPress,
  pressed = false,
  repeat = false,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  pressed?: boolean;
  repeat?: boolean;
  label: string;
}) {
  const hold = useRef(0);
  const pulse = useRef(0);
  const repeated = useRef(false);
  const fromPointer = useRef(false);

  function clear() {
    window.clearTimeout(hold.current);
    window.clearInterval(pulse.current);
    hold.current = 0;
    pulse.current = 0;
  }

  function press(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    repeated.current = false;
    if (!repeat) return;
    hold.current = window.setTimeout(() => {
      repeated.current = true;
      onPress();
      pulse.current = window.setInterval(() => onPress(), 55);
    }, 380);
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-on={pressed ? "true" : "false"}
      onPointerDown={press}
      onPointerUp={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        clear();
        if (inside && !repeated.current) {
          fromPointer.current = true;
          onPress();
        }
        repeated.current = false;
      }}
      onPointerCancel={() => {
        clear();
        repeated.current = false;
      }}
      onClick={() => {
        if (fromPointer.current) {
          fromPointer.current = false;
          return;
        }
        onPress();
      }}
    >
      {children}
    </button>
  );
}
