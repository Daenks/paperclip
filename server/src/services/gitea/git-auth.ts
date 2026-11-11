import { giteaCredentialHost, type GiteaHost } from "./hosts.js";

/**
 * Git authentication for Gitea remotes over HTTPS.
 *
 * Tokens travel only in environment variables (`PAPERCLIP_GITEA_TOKEN_<n>`), never in argv,
 * URLs or files. Each configured host gets a URL-scoped credential helper
 * (`credential.<origin>.helper`) that additionally re-checks the protocol and host from
 * git's credential request, the same two gates the GitHub helper uses. Gitea accepts any
 * username together with an access token or OAuth2 access token as the password.
 */

export type GiteaGitCredential = {
  host: GiteaHost;
  token: string;
  /** Gitea login, used as the credential username when known. */
  login: string | null;
  source: "managed_connection" | "company_secret" | "server_env";
  secretName: string | null;
  connectionId?: string;
  grantId?: string;
};

export const GITEA_TOKEN_ENV_PREFIX = "PAPERCLIP_GITEA_TOKEN_";
/** Env keys a launcher may accept from the credential broker for Gitea. */
export const GITEA_BROKER_ENV_KEY_PATTERN = /^PAPERCLIP_GITEA_TOKEN_\d+$/;

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function credentialHelper(host: GiteaHost, tokenEnvKey: string, username: string) {
  const expectedHost = `host=${giteaCredentialHost(host)}`;
  const expectedProtocol = `protocol=${host.protocol}`;
  // `!`-prefixed helpers run via `sh -c` with the action appended as "$1". Only `get`
  // answers; store/erase drain stdin and exit 0.
  return `!f() { ok=; proto=; while IFS= read -r l && [ -n "$l" ]; do case "$l" in ${shellSingleQuote(expectedHost)}) ok=1;; ${shellSingleQuote(expectedProtocol)}) proto=1;; esac; done; if [ "$1" = get ] && [ -n "$ok" ] && [ -n "$proto" ]; then printf 'username=%s\\npassword=%s\\n' ${shellSingleQuote(username)} "$${tokenEnvKey}"; fi; }; f`;
}

export type GitConfigEntry = [key: string, value: string];

/**
 * Config entries and env for a set of Gitea credentials. `startIndex` numbers the token
 * env keys so several hosts can coexist in one environment.
 */
export function buildGiteaGitAuth(credentials: GiteaGitCredential[]): {
  entries: GitConfigEntry[];
  env: Record<string, string>;
} {
  const entries: GitConfigEntry[] = [];
  const env: Record<string, string> = {};
  credentials.forEach((credential, index) => {
    const tokenEnvKey = `${GITEA_TOKEN_ENV_PREFIX}${index}`;
    env[tokenEnvKey] = credential.token;
    const username = credential.login && /^[A-Za-z0-9_.-]+$/.test(credential.login) ? credential.login : "oauth2";
    entries.push([`credential.${credential.host.origin}.helper`, credentialHelper(credential.host, tokenEnvKey, username)]);
  });
  return { entries, env };
}

/**
 * Append config entries to an environment that may already carry `GIT_CONFIG_COUNT`
 * entries (for example the GitHub credential entries). Existing entries keep their
 * indices; new entries follow them.
 */
export function appendGitConfigEntries(
  env: Record<string, string>,
  entries: GitConfigEntry[],
): Record<string, string> {
  if (entries.length === 0) return env;
  const parsed = Number.parseInt(env.GIT_CONFIG_COUNT ?? "", 10);
  const start = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const next: Record<string, string> = { ...env };
  entries.forEach(([key, value], offset) => {
    next[`GIT_CONFIG_KEY_${start + offset}`] = key;
    next[`GIT_CONFIG_VALUE_${start + offset}`] = value;
  });
  next.GIT_CONFIG_COUNT = String(start + entries.length);
  return next;
}

/** `-c` arguments for a direct git invocation (server-side clones and fetches). */
export function giteaGitConfigArgs(entries: GitConfigEntry[]): string[] {
  return entries.flatMap(([key, value]) => ["-c", `${key}=${value}`]);
}
