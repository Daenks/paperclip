import { createHmac, timingSafeEqual } from "node:crypto";

export interface GiteaClientOptions {
  baseUrl: string;
  token: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export class GiteaApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Gitea API ${path} returned HTTP ${status}`);
    this.name = "GiteaApiError";
  }
}

export type CommitState = "pending" | "success" | "failure" | "error";

export interface GiteaPullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  user: { login: string };
  head: { ref: string; sha: string };
  base: { ref: string };
}

/** Gitea signs the raw body with HMAC-SHA256 and sends the hex digest in X-Gitea-Signature. */
export function verifyGiteaSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const received = Buffer.from(signature.trim().toLowerCase());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const segment = (value: string) => encodeURIComponent(value);

export function createGiteaClient(options: GiteaClientOptions) {
  const base = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await options.fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `token ${options.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new GiteaApiError(response.status, path);
    }
    return response;
  }
  const json = async <T>(method: string, path: string, body?: unknown) => (await (await send(method, path, body)).json()) as T;
  const repoPath = (owner: string, repo: string) => `/repos/${segment(owner)}/${segment(repo)}`;

  return {
    getCurrentUser: () => json<{ login: string }>("GET", "/user"),
    listRepositories: (limit = 50) =>
      json<Array<{ full_name: string; private: boolean; html_url: string; default_branch: string }>>(
        "GET",
        `/user/repos?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`,
      ),
    listPullRequests: (owner: string, repo: string, state: "open" | "closed" | "all" = "open") =>
      json<GiteaPullRequest[]>("GET", `${repoPath(owner, repo)}/pulls?state=${state}`),
    getPullRequest: (owner: string, repo: string, index: number) =>
      json<GiteaPullRequest>("GET", `${repoPath(owner, repo)}/pulls/${index}`),
    getPullRequestDiff: async (owner: string, repo: string, index: number) =>
      (await send("GET", `${repoPath(owner, repo)}/pulls/${index}.diff`)).text(),
    createComment: (owner: string, repo: string, index: number, body: string) =>
      json<{ id: number; html_url: string }>("POST", `${repoPath(owner, repo)}/issues/${index}/comments`, { body }),
    editComment: (owner: string, repo: string, commentId: number, body: string) =>
      json<{ id: number }>("PATCH", `${repoPath(owner, repo)}/issues/comments/${commentId}`, { body }),
    setCommitStatus: (
      owner: string,
      repo: string,
      sha: string,
      status: { state: CommitState; context: string; description?: string; targetUrl?: string },
    ) =>
      json<{ id: number }>("POST", `${repoPath(owner, repo)}/statuses/${segment(sha)}`, {
        state: status.state,
        context: status.context,
        ...(status.description ? { description: status.description } : {}),
        ...(status.targetUrl ? { target_url: status.targetUrl } : {}),
      }),
  };
}

export type GiteaClient = ReturnType<typeof createGiteaClient>;
