"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export function PressButton({
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
