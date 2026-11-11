/**
 * Gitea host configuration shared by git credentials, project repositories, the review bot
 * and skill sources. A Gitea host is identified by its web origin (scheme, hostname, port).
 * Hosts come from Gitea connections (`host`/`port` connection settings) and from the
 * `PAPERCLIP_GITEA_HOSTS` server environment variable.
 */

export type GiteaHost = {
  /** `https://gitea.example.com` or `https://gitea.example.com:8443` (no trailing slash). */
  origin: string;
  protocol: "https" | "http";
  hostname: string;
  /** Explicit port, or null for the scheme default. */
  port: number | null;
};

const HOSTNAME_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/** `host[:port]` as git's credential protocol reports it (`host=` line). */
export function giteaCredentialHost(host: GiteaHost): string {
  return host.port ? `${host.hostname}:${host.port}` : host.hostname;
}

/**
 * Parse one host entry. Accepts `gitea.example.com`, `gitea.example.com:8443`,
 * `https://gitea.example.com[:port]` and, only when written explicitly, `http://…`.
 * Paths, credentials, queries and fragments are rejected so a host entry cannot smuggle
 * a different request target.
 */
export function parseGiteaHost(value: string): GiteaHost | null {
  const raw = value.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const hostname = url.hostname.toLowerCase();
  if (!HOSTNAME_PATTERN.test(hostname) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const protocol = url.protocol === "http:" ? "http" : "https";
  const port = url.port ? Number(url.port) : null;
  return {
    origin: `${protocol}://${hostname}${port ? `:${port}` : ""}`,
    protocol,
    hostname,
    port,
  };
}

/** Build a host from connection settings (`host` plus optional `port`). HTTPS only. */
export function giteaHostFromSettings(settings: Record<string, unknown> | null | undefined): GiteaHost | null {
  const hostValue = typeof settings?.host === "string" ? settings.host.trim() : "";
  if (!hostValue || /[/:@?#]/.test(hostValue)) return null;
  const portValue = typeof settings?.port === "string" ? settings.port.trim() : "";
  const port = portValue && portValue !== "443" ? Number(portValue) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
  return parseGiteaHost(`https://${hostValue}${port ? `:${port}` : ""}`);
}

/** Hosts listed in `PAPERCLIP_GITEA_HOSTS` (comma or whitespace separated). */
export function giteaHostsFromEnv(env: NodeJS.ProcessEnv = process.env): GiteaHost[] {
  return dedupeGiteaHosts((env.PAPERCLIP_GITEA_HOSTS ?? "")
    .split(/[\s,]+/)
    .map(parseGiteaHost)
    .filter((host): host is GiteaHost => host !== null));
}

export function dedupeGiteaHosts(hosts: GiteaHost[]): GiteaHost[] {
  const seen = new Map<string, GiteaHost>();
  for (const host of hosts) if (!seen.has(host.origin)) seen.set(host.origin, host);
  return [...seen.values()];
}

/** The configured host whose origin serves this HTTPS/HTTP remote URL, if any. */
export function matchGiteaHttpRemote(remoteUrl: string, hosts: GiteaHost[]): GiteaHost | null {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    return null;
  }
  // An operator's inline URL credential must never be overridden.
  if (url.username || url.password) return null;
  const candidate = parseGiteaHost(`${url.protocol}//${url.host}`);
  if (!candidate) return null;
  return hosts.find((host) => host.origin === candidate.origin) ?? null;
}

export type GiteaRepositoryRef = {
  host: GiteaHost;
  owner: string;
  name: string;
  fullName: string;
  /** Canonical clone URL: `<origin>/<owner>/<name>.git`. */
  cloneUrl: string;
  /** Canonical web URL: `<origin>/<owner>/<name>`. */
  webUrl: string;
};

const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** Parse a Gitea repository web or clone URL on a configured host. */
export function parseGiteaRepositoryUrl(value: string, hosts: GiteaHost[]): GiteaRepositoryRef | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const host = matchGiteaHttpRemote(`${url.protocol}//${url.host}/`, hosts);
  if (!host) return null;
  const parts = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (![owner, name].every((part) => REPOSITORY_SEGMENT.test(part) && part !== "." && part !== "..")) return null;
  return giteaRepositoryRef(host, owner, name);
}

export function giteaRepositoryRef(host: GiteaHost, owner: string, name: string): GiteaRepositoryRef {
  return {
    host,
    owner,
    name,
    fullName: `${owner}/${name}`,
    cloneUrl: `${host.origin}/${owner}/${name}.git`,
    webUrl: `${host.origin}/${owner}/${name}`,
  };
}

/** Stable catalog id for a Gitea repository: Gitea ids are only unique per host. */
export function giteaCatalogRepositoryId(host: GiteaHost, repositoryId: number | string): string {
  return `gitea:${host.origin}:${repositoryId}`;
}

export function isGiteaCatalogRepositoryId(id: string): boolean {
  return id.startsWith("gitea:");
}
