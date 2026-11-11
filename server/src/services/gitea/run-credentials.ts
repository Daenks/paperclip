import { and, eq } from "drizzle-orm";
import { isUuidLike } from "@paperclipai/shared";
import { heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { isLowTrustQuarantined } from "../source-trust.js";
import { toolAccessService } from "../tool-access.js";
import { resolveGiteaGitCredentials } from "./credentials.js";
import { buildGiteaGitAuth, type GitConfigEntry } from "./git-auth.js";

export type GiteaRunCredentials = {
  /** Config entries to append after the launcher's own GIT_CONFIG entries. */
  configEntries: GitConfigEntry[];
  /** Token env (`PAPERCLIP_GITEA_TOKEN_<n>`) referenced by the entries. */
  env: Record<string, string>;
  hosts: string[];
  errors: Array<{ host: string; error: string }>;
};

const EMPTY: GiteaRunCredentials = { configEntries: [], env: {}, hosts: [], errors: [] };

/**
 * Gitea git credentials for one heartbeat run, served to the run's git launcher through
 * the runtime credential broker. Runs on low-trust (quarantined) issues receive none, the
 * same boundary the GitHub broker applies to raw tokens.
 */
export async function resolveGiteaRunCredentials(
  db: Db,
  input: { companyId: string; agentId: string; runId: string },
): Promise<GiteaRunCredentials> {
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.agentId, input.agentId),
  ));
  if (!run) return EMPTY;
  const issueId = run.contextSnapshot?.issueId ?? run.contextSnapshot?.taskId ?? run.nativeIssueId ?? null;
  let responsibleUserId: string | null = null;
  if (issueId !== null) {
    if (typeof issueId !== "string" || !isUuidLike(issueId)) return EMPTY;
    const [issue] = await db.select({ responsibleUserId: issues.responsibleUserId, sourceTrust: issues.sourceTrust })
      .from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, input.companyId)));
    if (!issue || isLowTrustQuarantined(issue.sourceTrust)) return EMPTY;
    responsibleUserId = issue.responsibleUserId ?? null;
  }
  const resolution = await resolveGiteaGitCredentials(db, input.companyId, {
    agentId: input.agentId, responsibleUserId, issueId, heartbeatRunId: input.runId,
  }, {
    refreshOAuthGrant: (refresh) => toolAccessService(db).refreshOAuthGrantCredentials({
      ...refresh, actor: { actorType: "system", actorId: "workspace-git-credential" },
    }),
  });
  const auth = buildGiteaGitAuth(resolution.credentials);
  return {
    configEntries: auth.entries,
    env: auth.env,
    hosts: resolution.credentials.map((credential) => credential.host.origin),
    errors: resolution.errors.map((failure) => ({ host: failure.host.origin, error: failure.error })),
  };
}
