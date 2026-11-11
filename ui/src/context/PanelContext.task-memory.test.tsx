// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelProvider, usePanel } from "./PanelContext";
import { readTaskPaneVisibility, writeSidePaneDefaults } from "@/lib/side-pane-defaults";

const preference = vi.hoisted(() => ({ enabled: true, userId: "person-a" }));
vi.mock("@/hooks/useCoordinatorWorkspaceEnabled", () => ({ useCoordinatorWorkspaceEnabled: () => preference }));
let panel: ReturnType<typeof usePanel>;
function Probe() { panel = usePanel(); return null; }
const taskA = { accountScope: "coordinator:person-a", companyId: "co", issueId: "task-a" };
const taskB = { accountScope: "coordinator:person-a", companyId: "co", issueId: "task-b" };

describe("Per-task side pane memory", () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => { preference.enabled = true; localStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { flushSync(() => root.unmount()); container.remove(); });
  function render() { flushSync(() => root.render(<PanelProvider><Probe /></PanelProvider>)); }
  function enter(key: typeof taskA | null) { flushSync(() => panel.setPanelVisibilityMemoryKey(key)); }

  it("keeps the built-in closed start when no default or memory exists", () => {
    render(); enter(taskA);
    expect(panel.panelVisible).toBe(false);
    expect(readTaskPaneVisibility(taskA)).toBeNull();
  });

  it("opens new tasks per the user's default without recording it", () => {
    writeSidePaneDefaults({ open: true, tab: "properties" });
    render(); enter(taskA);
    expect(panel.panelVisible).toBe(true);
    expect(readTaskPaneVisibility(taskA)).toBeNull();
  });

  it("restores how each task's pane was left, over the default", () => {
    writeSidePaneDefaults({ open: true, tab: "properties" });
    render(); enter(taskA);
    flushSync(() => panel.setPanelVisible(false));
    enter(taskB); expect(panel.panelVisible).toBe(true);
    enter(null); expect(panel.panelVisible).toBe(false);
    enter(taskA); expect(panel.panelVisible).toBe(false);
    flushSync(() => panel.togglePanelVisible());
    enter(taskB); enter(taskA); expect(panel.panelVisible).toBe(true);
  });

  it("does not record visibility while no task is active", () => {
    render(); flushSync(() => panel.setPanelVisible(true));
    enter(taskA); expect(panel.panelVisible).toBe(false);
  });
});
