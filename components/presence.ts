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

/**
 * Like `items`, but an item that disappears stays in the list for a moment, flagged `leaving`, so it can play an
 * exit animation before it is removed. Pass a stable array (or constant) when there is nothing to show.
 */
export function useExiting<T>(items: T[], keyOf: (item: T) => string, ms = 340) {
  const [prev, setPrev] = useState(items);
  const [leaving, setLeaving] = useState<{ key: string; item: T; index: number }[]>([]);
  if (items !== prev) {
    setPrev(items);
    const keys = new Set(items.map(keyOf));
    const gone = prev.map((item, index) => ({ key: keyOf(item), item, index })).filter((entry) => !keys.has(entry.key));
    setLeaving((current) => [...current.filter((entry) => !keys.has(entry.key) && !gone.some((g) => g.key === entry.key)), ...gone]);
  }
  useEffect(() => {
    if (!leaving.length) return;
    const timer = window.setTimeout(() => setLeaving([]), ms);
    return () => window.clearTimeout(timer);
  }, [leaving, ms]);
  const shown = items.map((item) => ({ key: keyOf(item), item, leaving: false }));
  for (const entry of leaving) {
    shown.splice(Math.min(entry.index, shown.length), 0, { key: entry.key, item: entry.item, leaving: true });
  }
  return shown;
}
