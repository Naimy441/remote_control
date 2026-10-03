"use client";

import { useEffect, useState } from "react";

/** Keeps an element mounted while its exit animation plays. */
export function usePresence(open: boolean, ms = 220) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, mounted, ms]);
  return { mounted, state: open ? "open" : "closed" } as const;
}

/** The last non-empty value, so content stays readable while it animates out. */
export function useLast<T>(value: T | null | "") {
  const [last, setLast] = useState<T | null>(value || null);
  if (value && value !== last) setLast(value);
  return last;
}
