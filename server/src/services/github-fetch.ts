import { unprocessable } from "../errors.js";
import { giteaHostsFromEnv, type GiteaHost } from "./gitea/hosts.js";

/**
 * Gitea hosts these GitHub-shaped helpers recognize, keyed by hostname. Seeded from
 * `PAPERCLIP_GITEA_HOSTS` and extended whenever a company's Gitea connections are resolved
 * (`registerGiteaHosts`). A Gitea host gets Gitea's API base, raw-file URLs and commit path;
 * every other host keeps the GitHub / GitHub Enterprise behavior.
 */
const giteaHostsByName = new Map<string, GiteaHost>(giteaHostsFromEnv().map((host) => [host.hostname, host]));
const envGiteaOrigins = new Set(giteaHostsFromEnv().map((host) => host.origin));

export function registerGiteaHosts(hosts: GiteaHost[]) {
  for (const host of hosts) giteaHostsByName.set(host.hostname, host);
}

export function giteaHostFor(hostname: string): GiteaHost | null {
  return giteaHostsByName.get(hostname.toLowerCase()) ?? null;
}

export function isGitHubDotCom(hostname: string) {
  const h = hostname.toLowerCase();
  return h === "github.com" || h === "www.github.com";
}

export function gitHubApiBase(hostname: string) {
  const gitea = giteaHostFor(hostname);
  if (gitea) return `${gitea.origin}/api/v1`;
  return isGitHubDotCom(hostname) ? "https://api.github.com" : `https://${hostname}/api/v3`;
}

/** API path that resolves a ref to a commit (`sha` in the response) on this host. */
export function gitHubCommitApiPath(hostname: string, owner: string, repo: string, ref: string) {
  return giteaHostFor(hostname)
    ? `/repos/${owner}/${repo}/git/commits/${encodeURIComponent(ref)}`
    : `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
}

export function resolveRawGitHubUrl(hostname: string, owner: string, repo: string, ref: string, filePath: string) {
  const p = filePath.replace(/^\/+/, "");
  const gitea = giteaHostFor(hostname);
  if (gitea) {
    // Commit SHAs use the exact form; branch or tag names use Gitea's legacy ref route.
    const refPath = /^[0-9a-f]{40}$/i.test(ref) ? `commit/${ref}` : ref;
    return `${gitea.origin}/${owner}/${repo}/raw/${refPath}/${p}`;
  }
  return isGitHubDotCom(hostname)
    ? `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${p}`
    : `https://${hostname}/raw/${owner}/${repo}/${ref}/${p}`;
}

export async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, withGiteaServerToken(url, init));
  } catch {
    throw unprocessable(`Could not connect to ${new URL(url).hostname} — ensure the URL points to a GitHub or GitHub Enterprise instance`);
  }
}

/**
 * Operator-listed Gitea hosts (`PAPERCLIP_GITEA_HOSTS`) may use the server's `GITEA_TOKEN`
 * so private repositories can serve skills. Connection-scoped Gitea tokens are company data
 * and never reach these shared, company-less fetches.
 */
function withGiteaServerToken(url: string, init?: RequestInit): RequestInit | undefined {
  const token = process.env.GITEA_TOKEN?.trim() || process.env.PAPERCLIP_GITEA_TOKEN?.trim();
  if (!token) return init;
  let origin: string;
  try { origin = new URL(url).origin; } catch { return init; }
  if (!envGiteaOrigins.has(origin)) return init;
  const headers = new Headers(init?.headers);
  if (!headers.has("authorization")) headers.set("authorization", `token ${token}`);
  return { ...init, headers };
}
