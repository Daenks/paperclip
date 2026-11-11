import {
  companySecrets,
  connectionGrants,
  toolConnectionInstalls,
  toolConnections,
  userSecretDefinitions,
  type Db,
} from "@paperclipai/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { secretService } from "../secrets.js";
import type { GiteaGitCredential } from "./git-auth.js";
import {
  dedupeGiteaHosts,
  giteaHostFromSettings,
  giteaHostsFromEnv,
  type GiteaHost,
} from "./hosts.js";

/** Company-secret names probed for a Gitea token on operator-configured hosts. */
export const DEFAULT_GITEA_TOKEN_SECRET_NAMES = ["GITEA_TOKEN", "PAPERCLIP_GITEA_TOKEN"] as const;
/** App-definition slug, stored on connections as `config.sourceTemplateKey`. */
export const GITEA_APP_SLUG = "gitea";

/** Credential config paths a Gitea connection grant may carry, in preference order. */
const GITEA_TOKEN_CONFIG_PATHS = ["oauth.access_token", "credentials.authorization", "env.GITEA_ACCESS_TOKEN"] as const;

type ConnectionRow = typeof toolConnections.$inferSelect;
type GrantRow = typeof connectionGrants.$inferSelect;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isGiteaConnection(connection: Pick<ConnectionRow, "config" | "transportConfig">): boolean {
  return asRecord(connection.config).sourceTemplateKey === GITEA_APP_SLUG
    || asRecord(connection.transportConfig).sourceTemplateKey === GITEA_APP_SLUG;
}

/** The Gitea web host a connection points at (from its `host`/`port` settings). */
export function giteaConnectionHost(connection: Pick<ConnectionRow, "config">): GiteaHost | null {
  return giteaHostFromSettings(asRecord(asRecord(connection.config).methodConfig));
}

export async function listGiteaConnections(db: Db, companyId: string): Promise<ConnectionRow[]> {
  const rows = await db.select().from(toolConnections).where(and(
    eq(toolConnections.companyId, companyId),
    sql`(${toolConnections.config}->'sourceTemplateKey' = '"gitea"'::jsonb or ${toolConnections.transportConfig}->'sourceTemplateKey' = '"gitea"'::jsonb)`,
  ));
  return rows.filter(isGiteaConnection);
}

/** Every Gitea host this company can reach: its active connections plus `PAPERCLIP_GITEA_HOSTS`. */
export async function resolveCompanyGiteaHosts(
  db: Db | null,
  companyId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GiteaHost[]> {
  const connectionHosts = db
    ? (await listGiteaConnections(db, companyId))
      .filter((connection) => connection.enabled && connection.status === "active")
      .map(giteaConnectionHost)
      .filter((host): host is GiteaHost => host !== null)
    : [];
  return dedupeGiteaHosts([...connectionHosts, ...giteaHostsFromEnv(env)]);
}

export type GiteaCredentialContext = {
  agentId?: string | null;
  responsibleUserId?: string | null;
  issueId?: string | null;
  heartbeatRunId?: string | null;
  /** Restrict to a specific connection (for example a project's selected connection). */
  connectionId?: string | null;
};

type SecretsDeps = Pick<ReturnType<typeof secretService>, "getByName" | "resolveSecretValue" | "resolveUserSecretValue">;

export type GiteaCredentialDeps = {
  secrets?: SecretsDeps;
  env?: NodeJS.ProcessEnv;
  secretNames?: readonly string[];
  /** Refresh an OAuth grant whose access token is near expiry. */
  refreshOAuthGrant?: (input: { companyId: string; connectionId: string; grantId: string; issueId?: string | null; heartbeatRunId?: string | null }) => Promise<GrantRow>;
};

function tokenRef(grant: Pick<GrantRow, "credentialSecretRefs">) {
  for (const path of GITEA_TOKEN_CONFIG_PATHS) {
    const ref = grant.credentialSecretRefs.find((candidate) => candidate.configPath === path);
    if (ref) return ref;
  }
  return null;
}

function stripAuthScheme(value: string) {
  return value.trim().replace(/^(?:bearer|token)\s+/i, "").trim();
}

/** Pick the grant for this principal: dedicated agent grant, then the responsible user's, then organization. */
export function selectGiteaGrant(
  grants: GrantRow[],
  context: Pick<GiteaCredentialContext, "agentId" | "responsibleUserId">,
): GrantRow | null {
  const usable = grants.filter((grant) => grant.status === "active" && tokenRef(grant));
  const newest = (rows: GrantRow[]) => [...rows].sort((a, b) =>
    b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))[0] ?? null;
  const dedicated = context.agentId ? usable.filter((grant) => grant.kind === "agent" && grant.subjectAgentId === context.agentId) : [];
  if (dedicated.length) return newest(dedicated);
  const personal = context.responsibleUserId
    ? usable.filter((grant) => grant.kind === "user" && grant.subjectUserId === context.responsibleUserId)
    : [];
  if (personal.length) return newest(personal);
  return newest(usable.filter((grant) => grant.kind === "organization"));
}

async function resolveGrantToken(
  db: Db,
  secrets: SecretsDeps,
  companyId: string,
  grant: GrantRow,
  context: GiteaCredentialContext,
): Promise<string | null> {
  const ref = tokenRef(grant);
  if (!ref) return null;
  const accessContext = {
    consumerType: "system" as const,
    consumerId: "workspace-git-credential",
    actorType: "system" as const,
    actorId: context.agentId ?? undefined,
    issueId: context.issueId ?? null,
    heartbeatRunId: context.heartbeatRunId ?? null,
    responsibleUserId: grant.kind === "user" ? grant.subjectUserId : context.responsibleUserId ?? null,
  };
  if (grant.kind === "user") {
    if (!grant.subjectUserId) return null;
    const [secret] = await db.select({ definitionId: companySecrets.userSecretDefinitionId })
      .from(companySecrets)
      .leftJoin(userSecretDefinitions, eq(userSecretDefinitions.id, companySecrets.userSecretDefinitionId))
      .where(and(
        eq(companySecrets.companyId, companyId),
        eq(companySecrets.id, ref.secretId),
        eq(companySecrets.ownerUserId, grant.subjectUserId),
      )).limit(1);
    if (!secret?.definitionId) return null;
    const resolved = await secrets.resolveUserSecretValue(companyId, {
      definitionId: secret.definitionId,
      responsibleUserId: grant.subjectUserId,
      version: ref.versionSelector ?? "latest",
      required: true,
    }, accessContext);
    return resolved ? stripAuthScheme(resolved.value) || null : null;
  }
  const value = await secrets.resolveSecretValue(companyId, ref.secretId, ref.versionSelector ?? "latest", { accessContext });
  return stripAuthScheme(value) || null;
}

function grantNeedsRefresh(grant: GrantRow) {
  if (!grant.credentialSecretRefs.some((ref) => ref.configPath === "oauth.access_token")) return false;
  const expiresAt = grant.providerTenant?.oauth?.accessTokenExpiresAt;
  const expiryMs = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  return Number.isFinite(expiryMs) && expiryMs <= Date.now() + 5 * 60_000;
}

function grantLogin(grant: GrantRow): string | null {
  const gitea = asRecord(asRecord(grant.providerTenant).gitea);
  return typeof gitea.login === "string" && gitea.login ? gitea.login : null;
}

/**
 * Resolve the managed Gitea credential for one host from Gitea connections installed for
 * this company or agent. Returns `configured: false` when no such connection targets the host.
 */
export async function resolveManagedGiteaCredential(
  db: Db,
  companyId: string,
  host: GiteaHost,
  context: GiteaCredentialContext,
  deps: GiteaCredentialDeps = {},
): Promise<{ configured: boolean; credential?: GiteaGitCredential; error?: string }> {
  const secrets = deps.secrets ?? secretService(db);
  const connections = (await listGiteaConnections(db, companyId)).filter((connection) =>
    connection.enabled && connection.status === "active"
    && giteaConnectionHost(connection)?.origin === host.origin
    && (!context.connectionId || connection.id === context.connectionId));
  if (connections.length === 0) return { configured: false };
  const installs = await db.select().from(toolConnectionInstalls).where(and(
    eq(toolConnectionInstalls.companyId, companyId),
    inArray(toolConnectionInstalls.connectionId, connections.map((connection) => connection.id)),
  ));
  const eligible = connections.filter((connection) => installs.some((install) =>
    install.connectionId === connection.id && (
      (install.targetType === "company" && install.targetId === companyId)
      || (install.targetType === "agent" && Boolean(context.agentId) && install.targetId === context.agentId)
    )));
  if (eligible.length === 0) return { configured: false };
  const grants = await db.select().from(connectionGrants).where(and(
    eq(connectionGrants.companyId, companyId),
    inArray(connectionGrants.connectionId, eligible.map((connection) => connection.id)),
  ));
  let grant = selectGiteaGrant(grants, context);
  if (!grant) return { configured: true, error: `No Gitea identity is available for this run on ${host.origin}` };
  try {
    if (grantNeedsRefresh(grant) && deps.refreshOAuthGrant) {
      grant = await deps.refreshOAuthGrant({
        companyId, connectionId: grant.connectionId, grantId: grant.id,
        issueId: context.issueId, heartbeatRunId: context.heartbeatRunId,
      });
    }
    const token = await resolveGrantToken(db, secrets, companyId, grant, context);
    if (!token) return { configured: true, error: `The Gitea credential for ${host.origin} is missing; reconnect it` };
    return {
      configured: true,
      credential: {
        host, token, login: grantLogin(grant), source: "managed_connection", secretName: null,
        connectionId: grant.connectionId, grantId: grant.id,
      },
    };
  } catch {
    return { configured: true, error: `Gitea credentials for ${host.origin} are temporarily unavailable` };
  }
}

/** Company-secret or server-environment token, only for hosts the operator listed in `PAPERCLIP_GITEA_HOSTS`. */
async function resolveFallbackGiteaToken(
  companyId: string,
  context: GiteaCredentialContext,
  deps: Required<Pick<GiteaCredentialDeps, "env">> & { secrets: SecretsDeps; secretNames: readonly string[] },
): Promise<Pick<GiteaGitCredential, "token" | "source" | "secretName"> | null> {
  for (const secretName of deps.secretNames) {
    const secret = await Promise.resolve(deps.secrets.getByName(companyId, secretName)).catch(() => null);
    if (!secret) continue;
    const token = await deps.secrets.resolveSecretValue(companyId, secret.id, "latest", {
      accessContext: {
        consumerType: "system",
        consumerId: "workspace-git-credential",
        actorType: "system",
        issueId: context.issueId ?? null,
        heartbeatRunId: context.heartbeatRunId ?? null,
        responsibleUserId: context.responsibleUserId ?? null,
      },
    }).then((value) => stripAuthScheme(value)).catch(() => "");
    if (token) return { token, source: "company_secret", secretName };
  }
  const envToken = deps.env.GITEA_TOKEN?.trim() || deps.env.PAPERCLIP_GITEA_TOKEN?.trim() || "";
  return envToken ? { token: envToken, source: "server_env", secretName: null } : null;
}

export type GiteaCredentialResolution = {
  credentials: GiteaGitCredential[];
  /** Hosts where a managed connection exists but could not supply a credential. */
  errors: Array<{ host: GiteaHost; error: string }>;
};

/**
 * Resolve git credentials for every Gitea host this company can reach. A managed
 * connection for a host wins and fails closed; operator-listed hosts without one fall back
 * to the `GITEA_TOKEN` company secret, then the server environment.
 */
export async function resolveGiteaGitCredentials(
  db: Db | null,
  companyId: string,
  context: GiteaCredentialContext = {},
  deps: GiteaCredentialDeps = {},
): Promise<GiteaCredentialResolution> {
  const env = deps.env ?? process.env;
  const secrets = deps.secrets ?? (db ? secretService(db) : null);
  const secretNames = deps.secretNames ?? DEFAULT_GITEA_TOKEN_SECRET_NAMES;
  const envHosts = new Set(giteaHostsFromEnv(env).map((host) => host.origin));
  const hosts = await resolveCompanyGiteaHosts(db, companyId, env);
  const result: GiteaCredentialResolution = { credentials: [], errors: [] };
  let fallback: Promise<Pick<GiteaGitCredential, "token" | "source" | "secretName"> | null> | null = null;
  for (const host of hosts) {
    if (db) {
      const managed = await resolveManagedGiteaCredential(db, companyId, host, context, deps);
      if (managed.configured) {
        if (managed.credential) result.credentials.push(managed.credential);
        else result.errors.push({ host, error: managed.error ?? `Gitea credentials for ${host.origin} are unavailable` });
        continue;
      }
    }
    if (!envHosts.has(host.origin) || !secrets) continue;
    fallback ??= resolveFallbackGiteaToken(companyId, context, { env, secrets, secretNames });
    const token = await fallback;
    if (token) result.credentials.push({ host, login: null, ...token });
  }
  return result;
}
