/**
 * Per-browser preference: open the agents index (/agents/all) in the org
 * chart view instead of the list view.
 */
export const AGENTS_DEFAULT_ORG_VIEW_KEY = "paperclip.agents.defaultOrgView";

export function readAgentsDefaultOrgView(): boolean {
  try {
    return window.localStorage.getItem(AGENTS_DEFAULT_ORG_VIEW_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeAgentsDefaultOrgView(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(AGENTS_DEFAULT_ORG_VIEW_KEY, "true");
    else window.localStorage.removeItem(AGENTS_DEFAULT_ORG_VIEW_KEY);
  } catch {
    // Storage unavailable: the toggle still applies for this page visit.
  }
}
