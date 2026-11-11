/**
 * Source forges a project repository can come from. GitHub is the default; Gitea is
 * available when the instance enables it (`experimental.enableGitea`).
 */
export const FORGES = ["github", "gitea"] as const;
export type Forge = (typeof FORGES)[number];

/** The forge a project's sources use: its own setting, else the company default. */
export function effectiveProjectForge(
  company: { defaultForge?: Forge | string | null } | null | undefined,
  project: { sourceForge?: Forge | string | null } | null | undefined,
  options: { giteaEnabled: boolean },
): Forge {
  const candidate = project?.sourceForge ?? company?.defaultForge ?? "github";
  if (candidate === "gitea" && options.giteaEnabled) return "gitea";
  return "github";
}

/**
 * A project repository catalog id: a GitHub repository id (digits) or a Gitea catalog id
 * (`gitea:<origin>:<repository id>`).
 */
export const PROJECT_REPOSITORY_ID_PATTERN = /^(?:\d+|gitea:https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?:\d+)$/;
