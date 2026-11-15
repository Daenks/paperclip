/**
 * The stored policy and the rules shared by the worker and the settings page.
 * This module has no imports so the browser bundle can use it as is.
 */

/** Plugin state key of the one policy document per company (scope: company). */
export const POLICY_STATE_KEY = "policy";
/** `ctx.data` key the settings page reads. */
export const POLICY_DATA_KEY = "policy";
/** `ctx.actions` key the settings page saves through. */
export const SAVE_POLICY_ACTION_KEY = "save-policy";
/** Title of the run context section agents receive. */
export const POLICY_SECTION_TITLE = "Company policies";

export interface CompanyPolicy {
  markdown: string;
  /** "Apply to all agents". */
  enabled: boolean;
  /** ISO timestamp of the last save, or null before the first save. */
  updatedAt: string | null;
  /** Board user id of the last save, or null before the first save. */
  updatedBy: string | null;
  /** Number of saves; a save must name the revision it edits. */
  revision: number;
}

export const EMPTY_POLICY: CompanyPolicy = Object.freeze({
  markdown: "",
  enabled: true,
  updatedAt: null,
  updatedBy: null,
  revision: 0,
});

/**
 * Characters the agents receive: the host trims the markdown and counts its
 * JavaScript string length, so the limit applies to the trimmed text.
 */
export function policyCharacterCount(markdown: string): number {
  return markdown.trim().length;
}

/** Reads a stored value defensively; anything unexpected reads as no policy. */
export function readStoredPolicy(value: unknown): CompanyPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_POLICY };
  const record = value as Record<string, unknown>;
  return {
    markdown: typeof record.markdown === "string" ? record.markdown : "",
    enabled: typeof record.enabled === "boolean" ? record.enabled : EMPTY_POLICY.enabled,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : null,
    revision: Number.isSafeInteger(record.revision) && (record.revision as number) >= 0 ? record.revision as number : 0,
  };
}

/** What the settings page reads: the policy plus the limit it is saved against. */
export interface CompanyPolicyView extends CompanyPolicy {
  maxCharacters: number;
}
