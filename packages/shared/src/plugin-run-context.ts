/**
 * Plugin run-context contributions (`agent.run.context.contribute`).
 *
 * The host asks each qualifying plugin once per run and composes the returned
 * sections into one server-owned block. Limits are enforced by the host; a
 * contribution that breaks one is dropped whole, never truncated.
 */

/** Most sections one plugin may contribute to a run. */
export const PLUGIN_RUN_CONTEXT_MAX_SECTIONS = 8;
/** Longest section title, in characters (JavaScript string length) after trimming. */
export const PLUGIN_RUN_CONTEXT_MAX_TITLE_CHARS = 120;
/** Most markdown one plugin may contribute to a run, in characters after trimming, summed over its sections. */
export const PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS = 20_000;
/** Time the host waits for each plugin before continuing without it. */
export const PLUGIN_RUN_CONTEXT_TIMEOUT_MS = 3_000;

/** Identifiers only: no prompt text, secrets, or credentials. */
export interface PluginRunContextRequest {
  companyId: string;
  agentId: string;
  runId: string;
  /** Task the run is for, when there is one. */
  issueId: string | null;
  adapterType: string;
}

export interface PluginRunContextSection {
  /** Short heading shown to the agent. Plain text, one line. */
  title: string;
  /** Markdown body. */
  markdown: string;
}

export interface PluginRunContextResult {
  /** Empty array or omitted = nothing to contribute. */
  sections?: PluginRunContextSection[];
}

/** The composed block, frozen by the server for one run. */
export interface PluginRunContextSnapshot {
  text: string;
  /** SHA-256 hex of `text`. */
  digest: string;
}

export type PluginRunContextValidation =
  | { ok: true; sections: PluginRunContextSection[] }
  | { ok: false; message: string };

/** Host validation of one plugin's result. Messages never include plugin text. */
export function validatePluginRunContextResult(value: unknown): PluginRunContextValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "The result is not an object." };
  }
  const sections = (value as { sections?: unknown }).sections;
  if (sections === undefined) return { ok: true, sections: [] };
  if (!Array.isArray(sections)) return { ok: false, message: "sections is not an array." };
  if (sections.length > PLUGIN_RUN_CONTEXT_MAX_SECTIONS) {
    return { ok: false, message: `${sections.length} sections were returned; the limit is ${PLUGIN_RUN_CONTEXT_MAX_SECTIONS}.` };
  }
  const accepted: PluginRunContextSection[] = [];
  let markdownChars = 0;
  for (const [index, section] of sections.entries()) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return { ok: false, message: `Section ${index + 1} is not an object.` };
    }
    const { title: rawTitle, markdown: rawMarkdown } = section as { title?: unknown; markdown?: unknown };
    // Limits apply to the trimmed text, which is what the host delivers.
    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    if (!title) return { ok: false, message: `Section ${index + 1} has no title.` };
    if (/[\r\n]/.test(title)) return { ok: false, message: `Section ${index + 1} has a title longer than one line.` };
    if (title.length > PLUGIN_RUN_CONTEXT_MAX_TITLE_CHARS) {
      return { ok: false, message: `Section ${index + 1} has a ${title.length}-character title; the limit is ${PLUGIN_RUN_CONTEXT_MAX_TITLE_CHARS}.` };
    }
    const markdown = typeof rawMarkdown === "string" ? rawMarkdown.trim() : "";
    if (!markdown) return { ok: false, message: `Section ${index + 1} has no markdown.` };
    markdownChars += markdown.length;
    accepted.push({ title, markdown });
  }
  if (markdownChars > PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS) {
    return { ok: false, message: `${markdownChars} characters of markdown were returned; the limit is ${PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS}.` };
  }
  return { ok: true, sections: accepted };
}
