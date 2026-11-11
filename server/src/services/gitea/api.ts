import type { GiteaHost } from "./hosts.js";

/**
 * Minimal Gitea REST client (`/api/v1`). Callers supply the token; it is sent as
 * `Authorization: token <value>` and never placed in URLs. Redirects are refused so a
 * token cannot follow a redirect to another origin.
 */

export class GiteaApiError extends Error {
  constructor(readonly status: number, message: string, readonly code = "gitea_api_error") {
    super(message);
    this.name = "GiteaApiError";
  }
}

export type GiteaFetch = typeof fetch;

export type GiteaClient = {
  host: GiteaHost;
  request<T = unknown>(method: string, path: string, body?: unknown, options?: { accept404?: boolean }): Promise<T | null>;
  raw(path: string): Promise<Response>;
};

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export function giteaClient(host: GiteaHost, token: string | null, deps: { fetch?: GiteaFetch; timeoutMs?: number } = {}): GiteaClient {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const headers = (extra: Record<string, string> = {}) => ({
    Accept: "application/json",
    ...(token ? { Authorization: `token ${token}` } : {}),
    ...extra,
  });
  const url = (path: string) => {
    if (!path.startsWith("/")) throw new Error("Gitea API path must be absolute");
    return `${host.origin}/api/v1${path}`;
  };
  return {
    host,
    async request<T>(method: string, path: string, body?: unknown, options: { accept404?: boolean } = {}) {
      const response = await doFetch(url(path), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: headers(body === undefined ? {} : { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 404 && options.accept404) return null;
      const text = await readBounded(response);
      if (!response.ok) {
        throw new GiteaApiError(response.status, `Gitea API ${method} ${path.split("?")[0]} failed (HTTP ${response.status})`,
          response.status === 401 || response.status === 403 ? "gitea_unauthorized" : "gitea_api_error");
      }
      if (!text) return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new GiteaApiError(502, "Gitea API returned invalid JSON", "gitea_invalid_response");
      }
    },
    async raw(path: string) {
      return doFetch(url(path), { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: headers({ Accept: "*/*" }) });
    },
  };
}

async function readBounded(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_RESPONSE_BYTES) throw new GiteaApiError(502, "Gitea API response is too large", "gitea_response_too_large");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new GiteaApiError(502, "Gitea API response is too large", "gitea_response_too_large");
  return text;
}

export type GiteaRepository = {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch?: string;
  owner?: { login?: string; type?: string; username?: string };
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
};

/** Repositories the token's user can access (owned, collaborator, organization member). */
export async function listGiteaUserRepositories(client: GiteaClient, options: { maxPages?: number } = {}): Promise<GiteaRepository[]> {
  const out: GiteaRepository[] = [];
  const maxPages = options.maxPages ?? 20;
  for (let page = 1; page <= maxPages; page += 1) {
    const rows = await client.request<GiteaRepository[]>("GET", `/user/repos?limit=50&page=${page}`) ?? [];
    out.push(...rows);
    if (rows.length < 50) break;
  }
  return out;
}

export type GiteaUser = { id: number; login: string; username?: string; full_name?: string; avatar_url?: string };

export async function getGiteaCurrentUser(client: GiteaClient): Promise<GiteaUser> {
  const user = await client.request<GiteaUser>("GET", "/user");
  if (!user?.login) throw new GiteaApiError(502, "Gitea did not return the current user", "gitea_invalid_response");
  return user;
}

export async function getGiteaRepository(client: GiteaClient, owner: string, name: string): Promise<GiteaRepository | null> {
  return client.request<GiteaRepository>("GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, undefined, { accept404: true });
}

/** Organization (team) owners report `type` differently across Gitea versions; treat non-user as organization. */
export function giteaOwnerType(repo: GiteaRepository): "personal" | "organization" | undefined {
  const type = repo.owner?.type?.toLowerCase();
  if (!type) return undefined;
  return type === "user" ? "personal" : "organization";
}
