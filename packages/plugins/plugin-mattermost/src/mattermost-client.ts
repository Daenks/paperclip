/** Mattermost accepts posts up to 16383 characters. Stay below it. */
export const MAX_POST_LENGTH = 16000;

export interface MattermostPost {
  id: string;
  channel_id: string;
  root_id: string;
  user_id: string;
  message: string;
}

export interface MattermostClientOptions {
  baseUrl: string;
  token: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export class MattermostApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Mattermost API ${path} returned HTTP ${status}`);
    this.name = "MattermostApiError";
  }
}

/** Splits text into pieces Mattermost accepts, breaking on a line end where one is close. */
export function splitMessage(text: string, limit = MAX_POST_LENGTH): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const lineEnd = rest.lastIndexOf("\n", limit);
    const cut = lineEnd > limit / 2 ? lineEnd : limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length > 0 || parts.length === 0) parts.push(rest);
  return parts;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function createMattermostClient(options: MattermostClientOptions) {
  const base = `${normalizeBaseUrl(options.baseUrl)}/api/v4`;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await options.fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new MattermostApiError(response.status, path);
    }
    return (await response.json()) as T;
  }

  return {
    getMe: () => request<{ id: string; username: string }>("GET", "/users/me"),
    getPost: (postId: string) => request<MattermostPost>("GET", `/posts/${encodeURIComponent(postId)}`),
    createPost: (input: { channelId: string; message: string; rootId?: string }) =>
      request<MattermostPost>("POST", "/posts", {
        channel_id: input.channelId,
        message: input.message,
        ...(input.rootId ? { root_id: input.rootId } : {}),
      }),
    addReaction: (input: { userId: string; postId: string; emojiName: string }) =>
      request<unknown>("POST", "/reactions", {
        user_id: input.userId,
        post_id: input.postId,
        emoji_name: input.emojiName,
      }),
  };
}

export type MattermostClient = ReturnType<typeof createMattermostClient>;
