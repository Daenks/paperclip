/**
 * Per-browser side pane preferences for task and chat pages.
 *
 * - Defaults (Settings > Profile): whether the pane starts open, and which tab
 *   it opens on. `open: null` means "not set" and keeps Paperclip's built-in
 *   behavior.
 * - Per-task memory: whether the pane was open or closed when the user last
 *   left a task or chat, restored on return. Takes precedence over the default.
 */

export type SidePaneDefaultTab = "properties" | "tasks" | "artifacts";

export interface SidePaneDefaults {
  open: boolean | null;
  tab: SidePaneDefaultTab;
}

export interface TaskPaneMemoryKey {
  accountScope: string;
  companyId: string;
  issueId: string;
}

const DEFAULTS_KEY = "paperclip.sidePane.defaults";
const VISIBILITY_KEY_PREFIX = "paperclip.sidePane.taskVisibility";
const MAX_REMEMBERED_TASKS = 200;
const TABS: readonly SidePaneDefaultTab[] = ["properties", "tasks", "artifacts"];

export const SIDE_PANE_DEFAULTS_FALLBACK: SidePaneDefaults = { open: null, tab: "properties" };

export function readSidePaneDefaults(): SidePaneDefaults {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEFAULTS_KEY) ?? "null") as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return SIDE_PANE_DEFAULTS_FALLBACK;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : null,
      tab: TABS.includes(parsed.tab as SidePaneDefaultTab) ? parsed.tab as SidePaneDefaultTab : "properties",
    };
  } catch {
    return SIDE_PANE_DEFAULTS_FALLBACK;
  }
}

export function writeSidePaneDefaults(defaults: SidePaneDefaults) {
  try {
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
  } catch {
    // Storage unavailable: the setting just doesn't stick.
  }
}

/** The tab a fresh pane should open on, or null when no default is set. */
export function sidePaneDefaultTab(): SidePaneDefaultTab | null {
  const defaults = readSidePaneDefaults();
  return defaults.open === true ? defaults.tab : null;
}

export function taskPaneMemoryKeyId(key: TaskPaneMemoryKey | null): string | null {
  return key ? `${key.accountScope}|${key.companyId}|${key.issueId}` : null;
}

type VisibilityStore = Record<string, { open: boolean; at: number }>;

function visibilityStorageKey(key: TaskPaneMemoryKey) {
  return `${VISIBILITY_KEY_PREFIX}:${key.accountScope}:${key.companyId}`;
}

function readVisibilityStore(key: TaskPaneMemoryKey): VisibilityStore {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(visibilityStorageKey(key)) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as VisibilityStore : {};
  } catch {
    return {};
  }
}

export function readTaskPaneVisibility(key: TaskPaneMemoryKey): boolean | null {
  const entry = readVisibilityStore(key)[key.issueId];
  return entry && typeof entry.open === "boolean" ? entry.open : null;
}

export function writeTaskPaneVisibility(key: TaskPaneMemoryKey, open: boolean) {
  try {
    const store = { ...readVisibilityStore(key), [key.issueId]: { open, at: Date.now() } };
    const retained = Object.entries(store)
      .filter(([, entry]) => entry && typeof entry.open === "boolean")
      .sort((left, right) => (right[1].at ?? 0) - (left[1].at ?? 0))
      .slice(0, MAX_REMEMBERED_TASKS);
    window.localStorage.setItem(visibilityStorageKey(key), JSON.stringify(Object.fromEntries(retained)));
  } catch {
    // Storage unavailable: the pane still works, it just isn't remembered.
  }
}

/** Remembered state for this task, else the user's default, else null (no opinion). */
export function resolveTaskPaneVisibility(key: TaskPaneMemoryKey): boolean | null {
  return readTaskPaneVisibility(key) ?? readSidePaneDefaults().open;
}
