"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { PressButton } from "@/components/PressButton";

export type QuickItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  repeat?: boolean;
  onPress: () => void;
};

const VISIBLE = 5;

/** A side dock built into the trackpad's right edge. Shows five buttons, the outer ones faded; swipe to flip through the rest. */
export function QuickRail({ items }: { items: QuickItem[] }) {
  // Icons rest small and calm, then grow while the rail is being touched or scrolled.
  const [awake, setAwake] = useState(false);
  const sleepTimer = useRef(0);
  const pressing = useRef(false);
  const lastTouch = useRef(0);

  // Stay open for a few seconds after the last touch or scroll, and never close under a finger.
  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(sleepTimer.current);
    const arm = () => {
      sleepTimer.current = window.setTimeout(() => {
        if (pressing.current) arm();
        else setAwake(false);
      }, 4000);
    };
    arm();
  }, []);

  useEffect(() => () => window.clearTimeout(sleepTimer.current), []);

  // Soft fades only where more buttons are hidden, so a resting first button is never dimmed.
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop > 4;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    setFade((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [items.length, measure]);

  if (!items.length) return null;

  return (
    <div className="quick-rail" data-awake={awake ? "true" : "false"} role="toolbar" aria-label="Quick buttons" aria-orientation="vertical">
      <div className="quick-surface" aria-hidden="true" />
      <div
        className="quick-scroll"
        ref={scroller}
        style={{ "--ft": fade.top ? "38px" : "0px", "--fb": fade.bottom ? "46px" : "0px" } as CSSProperties}
        data-scroll
        data-fit={items.length <= VISIBLE ? "true" : "false"}
        onPointerDown={() => {
          pressing.current = true;
          lastTouch.current = Date.now();
          wake();
        }}
        onPointerMove={(event) => {
          if (!event.buttons) return;
          lastTouch.current = Date.now();
          wake();
        }}
        onPointerUp={() => {
          pressing.current = false;
          lastTouch.current = Date.now();
          wake();
        }}
        onPointerCancel={() => {
          pressing.current = false;
          lastTouch.current = Date.now();
          wake();
        }}
        onScroll={() => {
          measure();
          // Only scrolling the user caused (a drag, or its momentum) keeps the rail open. Scroll events from
          // the snap re-settling after the rail shrinks must not wake it again.
          if (pressing.current || Date.now() - lastTouch.current < 2500) wake();
        }}
      >
        {items.map(({ id, label, icon: Icon, active, repeat, onPress }) => (
          <PressButton key={id} label={label} pressed={active} repeat={repeat} onPress={onPress}>
            <Icon />
          </PressButton>
        ))}
      </div>
    </div>
  );
}
