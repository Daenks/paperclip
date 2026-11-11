import { useState } from "react";
import { PanelRight } from "lucide-react";
import { RadioCardGroup, type RadioCardOption } from "@/components/ui/radio-card";
import {
  readSidePaneDefaults,
  writeSidePaneDefaults,
  type SidePaneDefaultTab,
  type SidePaneDefaults,
} from "@/lib/side-pane-defaults";

const OPEN_OPTIONS: RadioCardOption[] = [
  { value: "open", title: "Open", description: "Show the side pane when you open a task or chat." },
  { value: "closed", title: "Closed", description: "Keep the side pane hidden until you open it." },
];

const TAB_OPTIONS: RadioCardOption[] = [
  { value: "properties", title: "Properties", description: "Status, assignee, and other task details." },
  { value: "tasks", title: "Tasks", description: "Subtasks, or the agent's tasks in a chat. Falls back to Properties when there are none." },
  { value: "artifacts", title: "Artifacts", description: "Files and work products." },
];

/**
 * Default side pane state for task and chat pages. Stored in this browser.
 * A task or chat you've visited before reopens the way you left it.
 */
export function SidePaneDefaultsControl() {
  const [defaults, setDefaults] = useState<SidePaneDefaults>(readSidePaneDefaults);

  const update = (next: SidePaneDefaults) => {
    setDefaults(next);
    writeSidePaneDefaults(next);
  };

  return (
    <section className="space-y-4" aria-label="Default pane settings">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <PanelRight className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Default pane settings</h2>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          How the side pane starts on a task or chat you haven&apos;t opened before. Tasks and chats you&apos;ve
          visited reopen the pane the way you left it. Saved in this browser.
        </p>
      </div>

      <RadioCardGroup
        ariaLabel="Side pane default visibility"
        value={defaults.open === null ? "" : defaults.open ? "open" : "closed"}
        onValueChange={(value) => update({ ...defaults, open: value === "open" })}
        options={OPEN_OPTIONS}
        className="max-w-2xl"
      />

      {defaults.open ? (
        <div className="max-w-2xl space-y-2">
          <div className="text-sm font-medium">Open on</div>
          <RadioCardGroup
            ariaLabel="Side pane default tab"
            value={defaults.tab}
            onValueChange={(value) => update({ ...defaults, tab: value as SidePaneDefaultTab })}
            options={TAB_OPTIONS}
          />
        </div>
      ) : null}
    </section>
  );
}
