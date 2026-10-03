// Quick buttons: the user-chosen shortcuts shown on the side of the trackpad.
export type QuickId =
  | "keyboard" | "dictate" | "enter" | "backspace"
  | "arrowLeft" | "arrowUp" | "arrowDown" | "arrowRight"
  | "scroll" | "leftClick" | "rightClick" | "dragLock"
  | "mission" | "fullscreen" | "pageUp" | "pageDown" | "playPause"
  | "back" | "forward" | "reload" | "newTab";

export type QuickGroup = "Keys" | "Pointer" | "Windows" | "Browser";

export const quickMeta: Record<QuickId, { label: string; group: QuickGroup }> = {
  keyboard: { label: "Keyboard", group: "Keys" },
  dictate: { label: "Dictate", group: "Keys" },
  enter: { label: "Enter", group: "Keys" },
  backspace: { label: "Backspace", group: "Keys" },
  arrowLeft: { label: "Left arrow", group: "Keys" },
  arrowUp: { label: "Up arrow", group: "Keys" },
  arrowDown: { label: "Down arrow", group: "Keys" },
  arrowRight: { label: "Right arrow", group: "Keys" },
  scroll: { label: "Scroll lock", group: "Pointer" },
  leftClick: { label: "Left click", group: "Pointer" },
  rightClick: { label: "Right click", group: "Pointer" },
  dragLock: { label: "Drag lock", group: "Pointer" },
  mission: { label: "Mission Control", group: "Windows" },
  fullscreen: { label: "Full screen", group: "Windows" },
  pageUp: { label: "Page up", group: "Windows" },
  pageDown: { label: "Page down", group: "Windows" },
  playPause: { label: "Play / pause", group: "Windows" },
  back: { label: "Back", group: "Browser" },
  forward: { label: "Forward", group: "Browser" },
  reload: { label: "Reload", group: "Browser" },
  newTab: { label: "New tab", group: "Browser" },
};

export const quickGroups: QuickGroup[] = ["Keys", "Pointer", "Windows", "Browser"];

export const defaultQuick: QuickId[] = ["keyboard", "dictate", "enter", "scroll"];

export const quickStorageKey = "remote.quick";

export function parseQuick(raw: string | null): QuickId[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    const seen = new Set<string>();
    const ids: QuickId[] = [];
    for (const item of value) {
      if (typeof item === "string" && item in quickMeta && !seen.has(item)) {
        seen.add(item);
        ids.push(item as QuickId);
      }
    }
    return ids;
  } catch {
    return null;
  }
}
