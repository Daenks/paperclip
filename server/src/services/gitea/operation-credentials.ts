import type { Db } from "@paperclipai/db";
import { resolveGitHubOperationCredentials } from "../github-operation-credentials.js";
import { resolveGiteaRunCredentials } from "./run-credentials.js";

/**
 * The runtime credential broker response: GitHub's operation credentials plus, when any
 * Gitea host has a credential for this run, a `gitea` block the git launcher appends.
 * A Gitea failure never blocks GitHub access.
 */
export async function resolveForgeOperationCredentials(
  db: Db,
  input: { companyId: string; agentId: string; runId: string },
) {
  const [github, gitea] = await Promise.all([
    resolveGitHubOperationCredentials(db, input),
    resolveGiteaRunCredentials(db, input).catch(() => null),
  ]);
  return gitea && gitea.configEntries.length > 0 ? { ...github, gitea } : github;
}
