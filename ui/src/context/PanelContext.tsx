import { useCoordinatorWorkspaceEnabled } from "@/hooks/useCoordinatorWorkspaceEnabled";
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SidePanelContentMode } from "@/components/side-panel";
import {
  resolveTaskPaneVisibility,
  taskPaneMemoryKeyId,
  writeTaskPaneVisibility,
  type TaskPaneMemoryKey,
} from "@/lib/side-pane-defaults";

const STORAGE_KEY = "paperclip:panel-visible";

interface PanelContextValue {
  panelContent: ReactNode | null;
  panelContentMode: SidePanelContentMode;
  panelVisible: boolean;
  openPanel: (content: ReactNode, options?: { contentMode?: SidePanelContentMode }) => void;
  closePanel: () => void;
  setPanelVisible: (visible: boolean) => void;
  togglePanelVisible: () => void;
  /**
   * One-shot maximize request (LOOA-2181): deep links with `viewer=full` ask
   * the resizable panel host to open maximized. The request stays pending
   * until the host consumes it (the panel may not be mounted yet when the
   * deep link routes), so consumers must clear it after acting.
   */
  panelMaximizeRequested: boolean;
  requestPanelMaximize: () => void;
  clearPanelMaximizeRequest: () => void;
  /**
   * The task or chat whose pane visibility should be remembered. While set,
   * the pane opens as it was left on that task (else the user's default), and
   * open/close changes are saved for it. Pass null when leaving the page.
   */
  setPanelVisibilityMemoryKey: (key: TaskPaneMemoryKey | null) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

function readPreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function writePreference(visible: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(visible));
  } catch {
    // Ignore storage failures.
  }
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panelContent, setPanelContent] = useState<ReactNode | null>(null);
  const [panelContentMode, setPanelContentMode] = useState<SidePanelContentMode>("padded");
  const [classicPanelVisible, setPanelVisibleState] = useState(readPreference);
  const [coordinatorPanelVisible, setCoordinatorPanelVisible] = useState(false);
  const { enabled: coordinatorWorkspaceEnabled, userId } = useCoordinatorWorkspaceEnabled();
  // The experiment has an on-demand panel. Its visibility never overwrites
  // the classic workspace preference, including when the experiment is off.
  const panelVisible = coordinatorWorkspaceEnabled ? coordinatorPanelVisible : classicPanelVisible;
  const [memoryKey, setMemoryKey] = useState<TaskPaneMemoryKey | null>(null);
  const memoryKeyRef = useRef<TaskPaneMemoryKey | null>(null);
  const memoryKeyId = taskPaneMemoryKeyId(memoryKey);
  const setPanelVisibilityMemoryKey = useCallback((key: TaskPaneMemoryKey | null) => {
    memoryKeyRef.current = key;
    setMemoryKey(previous => taskPaneMemoryKeyId(previous) === taskPaneMemoryKeyId(key) ? previous : key);
  }, []);
  const rememberVisibility = useCallback((visible: boolean) => {
    if (memoryKeyRef.current) writeTaskPaneVisibility(memoryKeyRef.current, visible);
  }, []);
  // On entering a task/chat, restore how its pane was left, else the user's
  // default. Without either, keep the built-in behavior: the experiment's
  // on-demand pane starts closed, the classic pane keeps its global preference.
  useLayoutEffect(() => {
    const target = memoryKey ? resolveTaskPaneVisibility(memoryKey) : null;
    if (coordinatorWorkspaceEnabled) setCoordinatorPanelVisible(target ?? false);
    else if (target !== null) setPanelVisibleState(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinatorWorkspaceEnabled, userId, memoryKeyId]);
  const [panelMaximizeRequested, setPanelMaximizeRequested] = useState(false);

  const requestPanelMaximize = useCallback(() => {
    setPanelMaximizeRequested(true);
  }, []);

  const clearPanelMaximizeRequest = useCallback(() => {
    setPanelMaximizeRequested(false);
  }, []);

  const openPanel = useCallback((content: ReactNode, options?: { contentMode?: SidePanelContentMode }) => {
    setPanelContent(content);
    setPanelContentMode(options?.contentMode ?? "padded");
  }, []);

  const closePanel = useCallback(() => {
    setPanelContent(null);
    setPanelContentMode("padded");
  }, []);

  const setPanelVisible = useCallback((visible: boolean) => {
    rememberVisibility(visible);
    if (coordinatorWorkspaceEnabled) setCoordinatorPanelVisible(visible);
    else { setPanelVisibleState(visible); writePreference(visible); }
  }, [coordinatorWorkspaceEnabled, rememberVisibility]);

  const togglePanelVisible = useCallback(() => {
    if (coordinatorWorkspaceEnabled) {
      setCoordinatorPanelVisible(previous => {
        rememberVisibility(!previous);
        return !previous;
      });
      return;
    }
    setPanelVisibleState((prev) => {
      const next = !prev;
      writePreference(next);
      rememberVisibility(next);
      return next;
    });
  }, [coordinatorWorkspaceEnabled, rememberVisibility]);

  return (
    <PanelContext.Provider
      value={{
        panelContent,
        panelContentMode,
        panelVisible,
        openPanel,
        closePanel,
        setPanelVisible,
        togglePanelVisible,
        panelMaximizeRequested,
        requestPanelMaximize,
        clearPanelMaximizeRequest,
        setPanelVisibilityMemoryKey,
      }}
    >
      {children}
    </PanelContext.Provider>
  );
}

export function usePanel() {
  const ctx = useContext(PanelContext);
  if (!ctx) {
    throw new Error("usePanel must be used within PanelProvider");
  }
  return ctx;
}
