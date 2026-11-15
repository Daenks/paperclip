import { useEffect, useId, useState } from "react";
import {
  useHostContext,
  usePluginAction,
  usePluginData,
  type PluginCompanySettingsPageProps,
} from "@paperclipai/plugin-sdk/ui";
import {
  POLICY_DATA_KEY,
  SAVE_POLICY_ACTION_KEY,
  policyCharacterCount,
  type CompanyPolicyView,
} from "../policy.js";

// Class strings match the host's Textarea, ToggleSwitch and Button primitives so the
// page uses the host's tokens; plugin UI cannot import host components directly.
const TEXTAREA_CLASS =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex min-w-0 w-full max-w-full resize-y rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-(--tp-color-box-shadow) outline-none focus-visible:ring-(length:--rad-3) disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";
const SWITCH_CLASS =
  "relative inline-flex h-5 w-11 shrink-0 items-center rounded-full border-2 transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";
const SWITCH_ON_CLASS = "border-(--status-task-done) bg-(--status-task-done)";
const SWITCH_OFF_CLASS = "border-transparent bg-input/90";
const THUMB_CLASS =
  "pointer-events-none inline-block h-4 w-6 rounded-full bg-background shadow-sm transition-transform not-dark:bg-clip-padding dark:bg-foreground";
const BUTTON_CLASS =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-(--tp-color-background-color-border-color-box-shadow-opacity) outline-none hover:bg-primary/90 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-(length:--rad-3) disabled:pointer-events-none disabled:opacity-50";

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function CompanyPoliciesSettingsPage({ context }: PluginCompanySettingsPageProps) {
  const companyId = context.companyId;
  if (!companyId) {
    return <div className="text-sm text-muted-foreground">Select a company to edit its policies.</div>;
  }
  // A new company gets a fresh form, so nothing typed or loaded for another company can be saved here.
  return <CompanyPoliciesForm key={companyId} companyId={companyId} />;
}

function CompanyPoliciesForm({ companyId }: { companyId: string }) {
  // The slot props carry only the company; the signed-in user is on the bridge host context.
  const { userId } = useHostContext();
  const policyQuery = usePluginData<CompanyPolicyView>(POLICY_DATA_KEY, { companyId });
  const savePolicy = usePluginAction(SAVE_POLICY_ACTION_KEY);
  const textareaId = useId();
  const counterId = useId();

  const [saved, setSaved] = useState<CompanyPolicyView | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Load the stored policy into the form once per company, and again after a save or reload.
  useEffect(() => {
    // Accept only this company's policy; Save stays disabled until it has loaded.
    if (!policyQuery.data || policyQuery.data.companyId !== companyId) return;
    setSaved(policyQuery.data);
    setMarkdown(policyQuery.data.markdown);
    setEnabled(policyQuery.data.enabled);
  }, [policyQuery.data, companyId]);

  if (policyQuery.error) {
    return (
      <div role="alert" className="max-w-2xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Company policies could not be loaded: {policyQuery.error.message}
      </div>
    );
  }
  if (!saved) {
    return <div className="text-sm text-muted-foreground">Loading company policies...</div>;
  }

  const limit = saved.maxCharacters;
  const characters = policyCharacterCount(markdown);
  const overLimit = characters > limit;
  const dirty = markdown !== saved.markdown || enabled !== saved.enabled;

  async function handleSave() {
    if (!saved || saved.companyId !== companyId || overLimit) return;
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const next = await savePolicy({ markdown, enabled, baseRevision: saved.revision }) as CompanyPolicyView;
      setSaved(next);
      setMarkdown(next.markdown);
      setEnabled(next.enabled);
      setJustSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Company policies</h1>
        <p className="text-sm text-muted-foreground">
          Rules every agent in this company follows. Agents receive this text at the start of every run, in a section titled "Company policies".
        </p>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium text-foreground">Apply to all agents</div>
          <p className="text-xs text-muted-foreground">
            When off, the text is kept here but no agent receives it.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Apply to all agents"
          disabled={saving}
          className={`${SWITCH_CLASS} ${enabled ? SWITCH_ON_CLASS : SWITCH_OFF_CLASS}`}
          onClick={() => {
            setEnabled(!enabled);
            setJustSaved(false);
          }}
        >
          <span className={`${THUMB_CLASS} ${enabled ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </div>

      <div className="space-y-1">
        <label htmlFor={textareaId} className="text-xs text-muted-foreground">
          Policies (Markdown)
        </label>
        <textarea
          id={textareaId}
          rows={18}
          value={markdown}
          disabled={saving}
          aria-invalid={overLimit || undefined}
          aria-describedby={counterId}
          placeholder={"## Communication\n\n- Write task updates in plain language."}
          className={TEXTAREA_CLASS}
          onChange={(event) => {
            setMarkdown(event.target.value);
            setJustSaved(false);
          }}
        />
      </div>

      {overLimit ? (
        <p role="alert" className="text-xs text-destructive">
          The policies are {formatCount(characters - limit)} {characters - limit === 1 ? "character" : "characters"} over the {formatCount(limit)}-character limit. Shorten them to save; a longer text would not reach the agents.
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-xs text-destructive">
          Not saved: {saveError}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
          <div id={counterId} className={`tabular-nums ${overLimit ? "text-destructive" : ""}`}>
            {formatCount(characters)} / {formatCount(limit)} characters
          </div>
          <div role="status">
            {justSaved
              ? "Saved"
              : saved.updatedAt
                ? `Last saved ${formatSavedAt(saved.updatedAt)}${saved.updatedBy && saved.updatedBy === userId ? " by you" : ""}`
                : "Not saved yet"}
          </div>
        </div>
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={saving || overLimit || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
