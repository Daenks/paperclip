import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
  extractCard,
  extractFiles,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  defaultEmojiResolver,
  Message,
  parseMarkdown,
  stringifyMarkdown,
} from "chat";
import type {
  ActionsElement,
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  ButtonElement,
  CardChild,
  CardElement,
  ChannelInfo,
  ChannelVisibility,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  LinkButtonElement,
  Logger,
  RawMessage,
  Root,
  ThreadInfo,
  UserInfo,
  WebhookOptions,
} from "chat";
import type {
  ChatProviderInventoryResult,
  ChatProviderResourceInventoryItem,
} from "./chat-provider-inventory.js";

/**
 * Mattermost adapter for the pinned Chat SDK.
 *
 * Inbound messages, edits, deletes and reactions arrive over the bot's
 * authenticated WebSocket, so Mattermost never has to reach Paperclip for
 * ordinary chat. Interactive message buttons are the exception: Mattermost
 * POSTs a click to the integration URL stored on the post. That URL is the
 * endpoint's public chat webhook, and the integration context carries an
 * HMAC over the action so a forged POST cannot name an arbitrary action.
 */

const ADAPTER_NAME = "mattermost";
const REQUEST_TIMEOUT_MS = 25_000;
/** Mattermost's default MaxPostSize is 16383 runes; keep headroom for markup. */
export const MATTERMOST_MAX_POST_CHARACTERS = 16_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MATTERMOST_ID = /^[a-z0-9]{26}$/;
const WEBSOCKET_HEARTBEAT_MS = 30_000;
const WEBSOCKET_STALE_MS = 90_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const HEALTHY_SESSION_MS = 60_000;

export type MattermostChannelKind = "c" | "d" | "g";

export interface MattermostThreadId {
  kind: MattermostChannelKind;
  channelId: string;
  /** Root post id; empty for the top level of a DM or group chat. */
  rootId: string;
}

export interface MattermostFileInfo {
  id: string;
  name?: string;
  extension?: string;
  mime_type?: string;
  size?: number;
  width?: number;
  height?: number;
}

export interface MattermostPost {
  id: string;
  create_at: number;
  update_at?: number;
  edit_at?: number;
  delete_at?: number;
  user_id: string;
  channel_id: string;
  root_id?: string;
  message: string;
  type?: string;
  props?: Record<string, unknown>;
  file_ids?: string[];
  metadata?: { files?: MattermostFileInfo[] };
}

/** The raw shape Paperclip keeps: the post plus the event's channel scope. */
export interface MattermostRawMessage extends MattermostPost {
  paperclip_channel_kind: MattermostChannelKind;
  paperclip_team_id: string;
}

export interface MattermostUser {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  email?: string;
  is_bot?: boolean;
  delete_at?: number;
}

interface MattermostChannel {
  id: string;
  type: "O" | "P" | "D" | "G";
  team_id: string;
  name: string;
  display_name: string;
}

interface MattermostTeam {
  id: string;
  name: string;
  display_name: string;
}

export type MattermostReceiverEvent =
  | { type: "connecting" }
  | { type: "ready"; botUserId?: string }
  | { type: "disconnected"; fatal: boolean; code?: number; reason?: string }
  | { type: "failure"; fatal: boolean; error: { name: string; status?: number } };

export interface MattermostAdapterConfig {
  /** Mattermost site URL, e.g. https://chat.example.com (a sub-path is allowed). */
  baseUrl: string;
  botToken: string;
  /** The one team this endpoint serves. DMs and group chats are team-less. */
  teamId: string;
  userName: string;
  /** Public URL Mattermost POSTs button clicks to. Without it, cards post as text. */
  callbackUrl?: string;
  /** Random secret used to sign button context. Required with callbackUrl. */
  callbackSecret?: string;
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
  maxDownloadBytes?: number;
  onReceiverEvent?: (event: MattermostReceiverEvent) => void | Promise<void>;
  /** Test seam; defaults to the runtime's global WebSocket. */
  webSocketFactory?: (url: string) => WebSocket;
}

/** Readable destination label: the display name, else the URL name. */
export function mattermostChannelLabel(channel: Pick<MattermostChannel, "name" | "display_name">): string {
  return channel.display_name?.trim() || `~${channel.name}`;
}

export class MattermostApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "MattermostApiError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeMattermostBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Mattermost URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Mattermost URL must use https:// or http://");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Mattermost URL must not include credentials, a query, or a fragment");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

export function mattermostId(value: string | undefined, label: string): string {
  const id = value?.trim() ?? "";
  if (!MATTERMOST_ID.test(id)) throw new Error(`${label} must be a 26-character Mattermost ID`);
  return id;
}

async function mattermostRequest<T>(
  fetchImpl: typeof globalThis.fetch,
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit & { description?: string } = {},
): Promise<T> {
  const { description, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (requestInit.body && typeof requestInit.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/v4${path}`, {
      ...requestInit,
      headers,
      signal: requestInit.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new NetworkError(
      ADAPTER_NAME,
      `Mattermost ${description ?? "request"} failed to reach the server`,
      error instanceof Error ? error : undefined,
    );
  }
  if (!response.ok) {
    let detail = "";
    let code: string | undefined;
    try {
      const body = (await response.json()) as { message?: string; id?: string };
      detail = typeof body.message === "string" ? body.message : "";
      code = typeof body.id === "string" ? body.id : undefined;
    } catch {
      // Non-JSON error bodies carry no extra detail worth surfacing.
    }
    const what = `Mattermost ${description ?? "request"} failed (${response.status})${detail ? `: ${detail}` : ""}`;
    if (response.status === 401) throw new AuthenticationError(ADAPTER_NAME, what);
    if (response.status === 403) throw new PermissionError(ADAPTER_NAME, description ?? "request");
    if (response.status === 404) throw new ResourceNotFoundError(ADAPTER_NAME, description ?? "resource");
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset"));
      throw new AdapterRateLimitError(ADAPTER_NAME, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    throw new MattermostApiError(what, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface MattermostBotIdentity {
  providerAccountId: string;
  providerAccountLabel: string;
  botExternalId: string;
  botUsername: string;
  botLabel: string;
  botAvatarUrl?: string;
}

/** Confirms the token is a bot account and that the bot belongs to the team. */
export async function verifyMattermostBot(input: {
  baseUrl: string;
  botToken: string;
  teamId: string;
  fetch: typeof globalThis.fetch;
}): Promise<MattermostBotIdentity> {
  const baseUrl = normalizeMattermostBaseUrl(input.baseUrl);
  const teamId = mattermostId(input.teamId, "Mattermost Team ID");
  const me = await mattermostRequest<MattermostUser>(input.fetch, baseUrl, input.botToken, "/users/me", {
    description: "bot identity lookup",
  });
  if (!me?.id || !me.username) throw new Error("Mattermost token did not identify a user");
  if (me.is_bot !== true) {
    throw new Error("Mattermost token belongs to a regular user. Create a bot account (System Console > Integrations > Bot Accounts) and use its token.");
  }
  const team = await mattermostRequest<MattermostTeam>(input.fetch, baseUrl, input.botToken, `/teams/${teamId}`, {
    description: "team lookup",
  }).catch((error) => {
    if (error instanceof ResourceNotFoundError || error instanceof PermissionError) {
      throw new Error("Mattermost bot is not a member of the selected team");
    }
    throw error;
  });
  await mattermostRequest(input.fetch, baseUrl, input.botToken, `/teams/${teamId}/members/${me.id}`, {
    description: "team membership lookup",
  }).catch((error) => {
    if (error instanceof ResourceNotFoundError || error instanceof PermissionError) {
      throw new Error("Mattermost bot is not a member of the selected team");
    }
    throw error;
  });
  const displayName = [me.first_name, me.last_name].filter(Boolean).join(" ").trim();
  return {
    providerAccountId: team.id,
    providerAccountLabel: team.display_name || team.name || team.id,
    botExternalId: me.id,
    botUsername: me.username,
    botLabel: me.nickname || displayName || me.username,
    botAvatarUrl: `${baseUrl}/api/v4/users/${me.id}/image`,
  };
}

/** Lists the team's channels the bot belongs to, for per-channel enablement. */
export async function listMattermostBotChannels(input: {
  baseUrl: string;
  botToken: string;
  teamId: string;
  fetch: typeof globalThis.fetch;
}): Promise<ChatProviderInventoryResult> {
  const baseUrl = normalizeMattermostBaseUrl(input.baseUrl);
  const teamId = mattermostId(input.teamId, "Mattermost Team ID");
  const [team, channels] = await Promise.all([
    mattermostRequest<MattermostTeam>(input.fetch, baseUrl, input.botToken, `/teams/${teamId}`, {
      description: "team lookup",
    }),
    mattermostRequest<MattermostChannel[]>(
      input.fetch,
      baseUrl,
      input.botToken,
      `/users/me/teams/${teamId}/channels`,
      { description: "channel membership lookup" },
    ),
  ]);
  const resources: ChatProviderResourceInventoryItem[] = (channels ?? [])
    .filter((channel) => channel.type === "O" || channel.type === "P")
    .sort((left, right) => (left.display_name || left.name).localeCompare(right.display_name || right.name))
    .map((channel) => ({
      providerResourceId: channel.id,
      parentProviderResourceId: teamId,
      type: "channel",
      label: mattermostChannelLabel(channel),
      providerUrl: `${baseUrl}/${encodeURIComponent(team.name)}/channels/${encodeURIComponent(channel.name)}`,
      metadata: { source: "provider_inventory", private: channel.type === "P" },
    }));
  if (resources.length === 0) {
    throw new Error("Add the Mattermost bot to at least one channel in the team, then retry");
  }
  return { provider: "mattermost", resources };
}

/**
 * Mattermost renders Markdown natively, so Markdown passes through as-is.
 * Deliberately not a BaseFormatConverter subclass: extending a class at
 * module load would break callers that mock the "chat" module.
 */
export class MattermostFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast).trim();
  }
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }
  renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") return message;
    if ("raw" in message && typeof message.raw === "string") return message.raw;
    if ("markdown" in message && typeof message.markdown === "string") return message.markdown;
    if ("ast" in message && message.ast) return this.fromAst(message.ast);
    return "";
  }
}

export function encodeMattermostThreadId(thread: MattermostThreadId): string {
  return `mattermost:${thread.kind}:${thread.channelId}:${thread.rootId}`;
}

export function decodeMattermostThreadId(threadId: string): MattermostThreadId {
  const match = /^mattermost:([cdg]):([a-z0-9]{26}):([a-z0-9]{26})?$/.exec(threadId);
  if (!match) throw new ValidationError(ADAPTER_NAME, `Invalid Mattermost thread ID: ${threadId}`);
  return { kind: match[1] as MattermostChannelKind, channelId: match[2]!, rootId: match[3] ?? "" };
}

function channelKind(channelType: string | undefined): MattermostChannelKind {
  if (channelType === "D") return "d";
  if (channelType === "G") return "g";
  return "c";
}

function parseJsonField<T>(value: unknown): T | null {
  if (typeof value !== "string") return (value && typeof value === "object" ? (value as T) : null);
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function attachmentType(mimeType: string | undefined): Attachment["type"] {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  return "file";
}

interface SignedActionContext {
  /** Chat SDK action id. */
  a: string;
  /** Chat SDK action value, when the button has one. */
  v?: string;
  /** Channel the post was published to. */
  c: string;
  n: string;
  s: string;
}

type MattermostAction = {
  id: string;
  name: string;
  type: "button";
  style?: string;
  integration: { url: string; context: SignedActionContext };
};

type MattermostMessageAttachment = {
  fallback: string;
  title?: string;
  text?: string;
  actions?: MattermostAction[];
};

export class MattermostAdapter implements Adapter<MattermostThreadId, MattermostRawMessage> {
  readonly name = ADAPTER_NAME;
  readonly lockScope = "thread" as const;
  readonly baseUrl: string;
  readonly teamId: string;
  private readonly botToken: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly callbackUrl: string | null;
  private readonly callbackSecret: string | null;
  private readonly maxDownloadBytes: number;
  private readonly logger?: Logger;
  private readonly onReceiverEvent?: MattermostAdapterConfig["onReceiverEvent"];
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly formatConverter = new MattermostFormatConverter();
  private chat: ChatInstance | null = null;
  userName: string;
  private _botUserId: string | undefined;
  private readonly userCache = new Map<string, MattermostUser>();
  private eventChain: Promise<void> = Promise.resolve();

  constructor(config: MattermostAdapterConfig) {
    this.baseUrl = normalizeMattermostBaseUrl(config.baseUrl);
    this.teamId = mattermostId(config.teamId, "Mattermost Team ID");
    this.botToken = config.botToken;
    this.userName = config.userName;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    if (config.callbackUrl && (!config.callbackSecret || config.callbackSecret.length < 32)) {
      throw new ValidationError(ADAPTER_NAME, "A Mattermost callback URL needs a signing secret of at least 32 characters");
    }
    this.callbackUrl = config.callbackUrl ?? null;
    this.callbackSecret = config.callbackUrl ? config.callbackSecret! : null;
    this.maxDownloadBytes = config.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
    this.logger = config.logger;
    this.onReceiverEvent = config.onReceiverEvent;
    this.webSocketFactory =
      config.webSocketFactory ??
      ((url) => {
        if (typeof globalThis.WebSocket !== "function") {
          throw new Error("This Node.js runtime has no global WebSocket; Node 22 or later is required for Mattermost");
        }
        return new globalThis.WebSocket(url);
      });
  }

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    const chatUserName = chat.getUserName?.();
    if (typeof chatUserName === "string" && chatUserName.trim()) this.userName = chatUserName.trim();
    await this.ensureBotIdentity();
  }

  private async ensureBotIdentity(): Promise<string> {
    if (this._botUserId) return this._botUserId;
    const me = await this.api<MattermostUser>("/users/me", { description: "bot identity lookup" });
    this._botUserId = me.id;
    if (me.username) this.userName = me.username;
    return me.id;
  }

  private api<T>(path: string, init?: RequestInit & { description?: string }): Promise<T> {
    return mattermostRequest<T>(this.fetchImpl, this.baseUrl, this.botToken, path, init);
  }

  // ---------------------------------------------------------------------------
  // Thread identity
  // ---------------------------------------------------------------------------

  encodeThreadId(platformData: MattermostThreadId): string {
    return encodeMattermostThreadId(platformData);
  }

  decodeThreadId(threadId: string): MattermostThreadId {
    return decodeMattermostThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    const thread = decodeMattermostThreadId(threadId);
    return `mattermost:${thread.kind}:${thread.channelId}`;
  }

  isDM(threadId: string): boolean {
    return decodeMattermostThreadId(threadId).kind === "d";
  }

  getChannelVisibility(threadId: string): ChannelVisibility {
    const kind = decodeMattermostThreadId(threadId).kind;
    return kind === "c" ? "workspace" : "private";
  }

  private threadIdForPost(post: MattermostPost, kind: MattermostChannelKind): string {
    // A channel message always lives in a thread rooted at itself or its
    // parent, so the bot's reply threads under the mention. A top-level DM or
    // group message continues the conversation at the top level.
    const rootId = post.root_id || (kind === "c" ? post.id : "");
    return encodeMattermostThreadId({ kind, channelId: post.channel_id, rootId });
  }

  // ---------------------------------------------------------------------------
  // Inbound parsing
  // ---------------------------------------------------------------------------

  parseMessage(raw: MattermostRawMessage): Message<MattermostRawMessage> {
    const threadId = this.threadIdForPost(raw, raw.paperclip_channel_kind);
    return this.messageFromRaw(raw, threadId, false);
  }

  private messageFromRaw(
    raw: MattermostRawMessage,
    threadId: string,
    mentioned: boolean,
  ): Message<MattermostRawMessage> {
    const text = raw.message ?? "";
    const cached = this.userCache.get(raw.user_id);
    const isMe = raw.user_id === this._botUserId;
    const author: Author = {
      userId: raw.user_id,
      userName: cached?.username ?? raw.user_id,
      fullName: cached ? [cached.first_name, cached.last_name].filter(Boolean).join(" ") || cached.username : raw.user_id,
      isBot: cached ? cached.is_bot === true : raw.props?.from_bot === "true" || raw.props?.from_bot === true ? true : "unknown",
      isMe,
      ...(cached?.email ? { email: cached.email } : {}),
    };
    const mentionPattern = this.userName
      ? new RegExp(`(^|[^\\w.-])@${this.userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i")
      : null;
    return new Message<MattermostRawMessage>({
      id: raw.id,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author,
      metadata: {
        dateSent: new Date(raw.create_at),
        edited: Boolean(raw.edit_at && raw.edit_at > 0),
        ...(raw.edit_at && raw.edit_at > 0 ? { editedAt: new Date(raw.edit_at) } : {}),
      },
      attachments: (raw.metadata?.files ?? []).map((file) => this.attachmentFor(file)),
      isMention: mentioned || Boolean(mentionPattern?.test(text)),
    });
  }

  private attachmentFor(file: MattermostFileInfo): Attachment {
    const attachment: Attachment = {
      type: attachmentType(file.mime_type),
      ...(file.name ? { name: file.name } : {}),
      ...(file.mime_type ? { mimeType: file.mime_type } : {}),
      ...(typeof file.size === "number" ? { size: file.size } : {}),
      ...(typeof file.width === "number" && file.width > 0 ? { width: file.width } : {}),
      ...(typeof file.height === "number" && file.height > 0 ? { height: file.height } : {}),
      fetchMetadata: { fileId: file.id },
    };
    return this.rehydrateAttachment(attachment);
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    const fileId = attachment.fetchMetadata?.fileId;
    if (!fileId || !MATTERMOST_ID.test(fileId)) return attachment;
    return { ...attachment, fetchData: () => this.downloadFile(fileId) };
  }

  private async downloadFile(fileId: string): Promise<Buffer> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v4/files/${fileId}`, {
      headers: { Authorization: `Bearer ${this.botToken}`, "X-Requested-With": "XMLHttpRequest" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new MattermostApiError(`Mattermost file download failed (${response.status})`, response.status);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxDownloadBytes) {
      throw new ValidationError(ADAPTER_NAME, "Mattermost file exceeds the download limit");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > this.maxDownloadBytes) {
      throw new ValidationError(ADAPTER_NAME, "Mattermost file exceeds the download limit");
    }
    return buffer;
  }

  private async rememberUser(userId: string): Promise<MattermostUser | null> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    try {
      const user = await this.api<MattermostUser>(`/users/${userId}`, { description: "user lookup" });
      if (user?.id) this.userCache.set(user.id, user);
      return user ?? null;
    } catch (error) {
      this.logger?.warn?.("Mattermost user lookup failed", { error: String(error) });
      return null;
    }
  }

  /** True when the post belongs to this endpoint's team (DMs and group chats are team-less). */
  acceptsScope(raw: Pick<MattermostRawMessage, "paperclip_channel_kind" | "paperclip_team_id">): boolean {
    if (raw.paperclip_channel_kind !== "c") return true;
    return raw.paperclip_team_id === this.teamId;
  }

  // ---------------------------------------------------------------------------
  // WebSocket receiver
  // ---------------------------------------------------------------------------

  /**
   * Runs the WebSocket until `signal` aborts, reconnecting with backoff.
   * Paperclip starts this only on the instance that holds the endpoint's
   * receiver lease, so one Paperclip cluster never opens two sockets.
   */
  async runReceiver(signal: AbortSignal): Promise<void> {
    let rapidRestarts = 0;
    while (!signal.aborted) {
      const startedAt = Date.now();
      let fatal = false;
      try {
        await this.emitReceiverEvent({ type: "connecting" });
        fatal = await this.runSocketSession(signal);
      } catch (error) {
        const status = error instanceof MattermostApiError ? error.status : undefined;
        fatal = error instanceof AuthenticationError;
        await this.emitReceiverEvent({
          type: "failure",
          fatal,
          error: { name: error instanceof Error ? error.name : "Error", ...(status ? { status } : {}) },
        });
      }
      if (signal.aborted || fatal) return;
      rapidRestarts = Date.now() - startedAt >= HEALTHY_SESSION_MS ? 0 : Math.min(rapidRestarts + 1, 16);
      const delay = Math.min(1_000 * 2 ** Math.max(0, rapidRestarts - 1), RECONNECT_MAX_DELAY_MS);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, delay);
        timer.unref?.();
        signal.addEventListener("abort", done, { once: true });
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
      });
    }
  }

  private async emitReceiverEvent(event: MattermostReceiverEvent): Promise<void> {
    try {
      await this.onReceiverEvent?.(event);
    } catch (error) {
      this.logger?.warn?.("Mattermost receiver event callback failed", { error: String(error) });
    }
  }

  /** Resolves when the socket closes; true means do not reconnect. */
  private async runSocketSession(signal: AbortSignal): Promise<boolean> {
    await this.ensureBotIdentity();
    const url = new URL(`${this.baseUrl}/api/v4/websocket`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = this.webSocketFactory(url.toString());
    let seq = 1;
    let lastFrameAt = Date.now();
    let authenticated = false;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const heartbeat = setInterval(() => {
        if (Date.now() - lastFrameAt > WEBSOCKET_STALE_MS) {
          socket.close(4000, "stale");
          return;
        }
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ seq: seq++, action: "get_statuses_by_ids", data: { user_ids: [this._botUserId] } }));
        }
      }, WEBSOCKET_HEARTBEAT_MS);
      heartbeat.unref?.();
      const finish = (fatal: boolean, code?: number, reason?: string) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        signal.removeEventListener("abort", abort);
        if (socket.readyState === 0 || socket.readyState === 1) {
          try {
            socket.close(1000, "closing");
          } catch {
            // Already closing.
          }
        }
        void this.emitReceiverEvent({ type: "disconnected", fatal, ...(code !== undefined ? { code } : {}), ...(reason ? { reason } : {}) })
          .finally(() => resolve(fatal));
      };
      const abort = () => finish(false, 1000, "stopped");
      signal.addEventListener("abort", abort, { once: true });
      socket.addEventListener("open", () => {
        lastFrameAt = Date.now();
        socket.send(JSON.stringify({ seq: seq++, action: "authentication_challenge", data: { token: this.botToken } }));
      });
      socket.addEventListener("message", (frame) => {
        lastFrameAt = Date.now();
        const payload = parseJsonField<Record<string, unknown>>(typeof frame.data === "string" ? frame.data : String(frame.data));
        if (!payload) return;
        if (payload.status === "FAIL" && !authenticated) {
          // A rejected challenge is an invalid or revoked token.
          finish(true, 4001, "authentication failed");
          return;
        }
        if (payload.status === "OK" && !authenticated) {
          authenticated = true;
          return;
        }
        if (payload.event === "hello") {
          authenticated = true;
          void this.emitReceiverEvent({ type: "ready", botUserId: this._botUserId });
          return;
        }
        // Handle events one at a time so lookups can't reorder a burst.
        this.eventChain = this.eventChain
          .then(() => this.handleSocketEvent(payload))
          .catch((error) => {
            this.logger?.error?.("Mattermost event handling failed", { error: String(error) });
          });
      });
      socket.addEventListener("close", (event) => finish(false, event.code, event.reason || undefined));
      socket.addEventListener("error", () => {
        // A close event always follows an error; let it decide.
      });
    });
  }

  /** Exposed for tests: routes one decoded WebSocket event into Chat SDK. */
  async handleSocketEvent(payload: Record<string, unknown>): Promise<void> {
    const chat = this.chat;
    if (!chat) return;
    const event = payload.event;
    const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
    const broadcast = (payload.broadcast && typeof payload.broadcast === "object" ? payload.broadcast : {}) as Record<string, unknown>;
    if (event === "posted" || event === "post_edited" || event === "post_deleted") {
      const post = parseJsonField<MattermostPost>(data.post);
      if (!post?.id || !post.channel_id || !post.user_id) return;
      if (post.type && post.type.startsWith("system_")) return;
      const channel = await this.channelScope(post.channel_id, data, broadcast);
      if (!channel) return;
      const raw: MattermostRawMessage = {
        ...post,
        paperclip_channel_kind: channel.kind,
        paperclip_team_id: channel.teamId,
      };
      if (!this.acceptsScope(raw)) return;
      const threadId = this.threadIdForPost(raw, channel.kind);
      if (event === "post_deleted") {
        await chat.processMessageDeleted({
          adapter: this,
          platform: ADAPTER_NAME,
          channelId: this.channelIdFromThreadId(threadId),
          messageId: post.id,
          threadId,
          raw,
          ...(post.delete_at ? { deletedAt: new Date(post.delete_at) } : {}),
        });
        return;
      }
      if (post.user_id === this._botUserId) return;
      await this.rememberUser(post.user_id);
      const mentions = parseJsonField<string[]>(data.mentions) ?? [];
      const mentioned = Boolean(this._botUserId && mentions.includes(this._botUserId));
      const message = this.messageFromRaw(raw, threadId, mentioned);
      if (event === "post_edited") {
        await chat.processMessageUpdated({ adapter: this, threadId, message });
        return;
      }
      await chat.processMessage(this, threadId, message);
      return;
    }
    if (event === "reaction_added" || event === "reaction_removed") {
      const reaction = parseJsonField<{ user_id: string; post_id: string; emoji_name: string }>(data.reaction);
      if (!reaction?.post_id || !reaction.user_id || !reaction.emoji_name) return;
      if (reaction.user_id === this._botUserId) return;
      const post = await this.api<MattermostPost>(`/posts/${reaction.post_id}`, { description: "reaction post lookup" }).catch(() => null);
      if (!post) return;
      const channel = await this.channelScope(post.channel_id, data, broadcast);
      if (!channel) return;
      const raw: MattermostRawMessage = { ...post, paperclip_channel_kind: channel.kind, paperclip_team_id: channel.teamId };
      if (!this.acceptsScope(raw)) return;
      const threadId = this.threadIdForPost(raw, channel.kind);
      const user = await this.rememberUser(reaction.user_id);
      chat.processReaction({
        adapter: this,
        added: event === "reaction_added",
        emoji: defaultEmojiResolver.fromSlack(reaction.emoji_name),
        rawEmoji: reaction.emoji_name,
        messageId: reaction.post_id,
        threadId,
        raw: { ...reaction, paperclip_channel_kind: channel.kind, paperclip_team_id: channel.teamId },
        user: this.authorFor(reaction.user_id, user),
      });
    }
  }

  private authorFor(userId: string, user: MattermostUser | null): Author {
    return {
      userId,
      userName: user?.username ?? userId,
      fullName: user ? [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username : userId,
      isBot: user ? user.is_bot === true : "unknown",
      isMe: userId === this._botUserId,
    };
  }

  private readonly channelCache = new Map<string, { kind: MattermostChannelKind; teamId: string }>();

  private async channelScope(
    channelId: string,
    data: Record<string, unknown>,
    broadcast: Record<string, unknown>,
  ): Promise<{ kind: MattermostChannelKind; teamId: string } | null> {
    const cached = this.channelCache.get(channelId);
    if (cached) return cached;
    let scope: { kind: MattermostChannelKind; teamId: string } | null = null;
    if (typeof data.channel_type === "string") {
      const teamId = typeof data.team_id === "string" ? data.team_id : typeof broadcast.team_id === "string" ? broadcast.team_id : "";
      scope = { kind: channelKind(data.channel_type), teamId };
      // A channel post event can omit team_id; only trust an empty team for DMs/groups.
      if (scope.kind === "c" && !scope.teamId) scope = null;
    }
    if (!scope) {
      const channel = await this.api<MattermostChannel>(`/channels/${channelId}`, { description: "channel lookup" }).catch(() => null);
      if (!channel) return null;
      scope = { kind: channelKind(channel.type), teamId: channel.team_id ?? "" };
    }
    this.channelCache.set(channelId, scope);
    return scope;
  }

  // ---------------------------------------------------------------------------
  // Interactive buttons
  // ---------------------------------------------------------------------------

  private signContext(context: Omit<SignedActionContext, "s">): string {
    return createHmac("sha256", this.callbackSecret!)
      .update(JSON.stringify([ADAPTER_NAME, this.teamId, context.c, context.a, context.v ?? null, context.n]))
      .digest("hex");
  }

  private verifyContext(value: unknown, channelId: string): SignedActionContext | null {
    if (!this.callbackSecret || !value || typeof value !== "object") return null;
    const context = value as Record<string, unknown>;
    if (
      typeof context.a !== "string" || !context.a ||
      (context.v !== undefined && typeof context.v !== "string") ||
      context.c !== channelId ||
      typeof context.n !== "string" || !/^[a-f0-9]{32}$/.test(context.n) ||
      typeof context.s !== "string" || !/^[a-f0-9]{64}$/.test(context.s)
    ) {
      return null;
    }
    const expected = Buffer.from(
      this.signContext({ a: context.a, c: context.c, n: context.n, ...(context.v !== undefined ? { v: context.v as string } : {}) }),
      "hex",
    );
    const supplied = Buffer.from(context.s, "hex");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    return context as unknown as SignedActionContext;
  }

  /** Button clicks: Mattermost POSTs the integration request here. */
  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
    const postId = typeof body.post_id === "string" ? body.post_id : "";
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const context = MATTERMOST_ID.test(channelId) ? this.verifyContext(body.context, channelId) : null;
    if (!context || !MATTERMOST_ID.test(postId) || !MATTERMOST_ID.test(userId)) {
      return new Response("Unauthorized", { status: 401 });
    }
    await this.ensureBotIdentity();
    // The signed context proves which action was issued; the post itself
    // proves where it lives. Fetch it so the thread can't be spoofed.
    const post = await this.api<MattermostPost>(`/posts/${postId}`, { description: "action post lookup" }).catch(() => null);
    if (!post || post.channel_id !== channelId || post.user_id !== this._botUserId) {
      return new Response("Unauthorized", { status: 401 });
    }
    const channel = await this.channelScope(channelId, {}, {});
    if (!channel || !this.acceptsScope({ paperclip_channel_kind: channel.kind, paperclip_team_id: channel.teamId })) {
      return new Response("Unauthorized", { status: 401 });
    }
    const threadId = this.threadIdForPost(post, channel.kind);
    const user = await this.rememberUser(userId);
    if (!this.chat) return new Response("Not initialized", { status: 503 });
    await this.chat.processAction(
      {
        adapter: this,
        actionId: context.a,
        ...(context.v !== undefined ? { value: context.v } : {}),
        messageId: postId,
        threadId,
        ...(typeof body.trigger_id === "string" ? { triggerId: body.trigger_id } : {}),
        user: this.authorFor(userId, user),
        raw: { ...body, paperclip_channel_kind: channel.kind, paperclip_team_id: channel.teamId },
      },
      options,
    );
    // An empty response leaves the post unchanged; Paperclip edits it itself.
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }

  private actionsFromCard(card: CardElement, channelId: string): MattermostAction[] {
    if (!this.callbackUrl) return [];
    const actions: MattermostAction[] = [];
    const visit = (children: CardChild[]) => {
      for (const child of children) {
        if (child.type === "section") visit(child.children);
        if (child.type !== "actions") continue;
        for (const element of (child as ActionsElement).children) {
          if (element.type !== "button") continue;
          const button = element as ButtonElement;
          if (button.disabled || button.actionType === "modal") continue;
          const unsigned = {
            a: button.id,
            c: channelId,
            n: randomBytes(16).toString("hex"),
            ...(button.value !== undefined ? { v: button.value } : {}),
          };
          actions.push({
            // Mattermost routes clicks by this id; it must be alphanumeric.
            id: `pc${actions.length}`,
            name: button.label,
            type: "button",
            ...(button.style === "primary" ? { style: "primary" } : button.style === "danger" ? { style: "danger" } : {}),
            integration: { url: this.callbackUrl!, context: { ...unsigned, s: this.signContext(unsigned) } },
          });
        }
      }
    };
    visit(card.children);
    return actions;
  }

  private hasCallbackButtons(card: CardElement): boolean {
    const visit = (children: CardChild[]): boolean =>
      children.some((child) =>
        child.type === "section"
          ? visit(child.children)
          : child.type === "actions" &&
            (child as ActionsElement).children.some((element) => element.type === "button"),
      );
    return visit(card.children);
  }

  private linkButtons(card: CardElement): LinkButtonElement[] {
    const links: LinkButtonElement[] = [];
    const visit = (children: CardChild[]) => {
      for (const child of children) {
        if (child.type === "section") visit(child.children);
        if (child.type !== "actions") continue;
        for (const element of (child as ActionsElement).children) {
          if (element.type === "link-button") links.push(element as LinkButtonElement);
        }
      }
    };
    visit(card.children);
    return links;
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private postBody(message: AdapterPostableMessage, channelId: string): {
    message: string;
    props?: { attachments: MattermostMessageAttachment[] };
  } {
    const card = extractCard(message);
    if (!card) return { message: this.formatConverter.renderPostable(message) };
    const actions = this.actionsFromCard(card, channelId);
    const links = this.linkButtons(card);
    // The fallback carries title, body and link buttons as Markdown; only the
    // callback buttons need Mattermost's interactive attachment.
    let text = cardToFallbackText(card, { boldFormat: "**" }).trim();
    const fallbackText =
      typeof message === "object" && message && "fallbackText" in message && typeof message.fallbackText === "string"
        ? message.fallbackText
        : "";
    if (!text) text = fallbackText;
    // Without a callback URL the buttons can't be shown; Paperclip's fallback
    // text says where to respond instead.
    if (!this.callbackUrl && fallbackText && this.hasCallbackButtons(card)) text = fallbackText;
    for (const link of links) {
      if (!text.includes(link.url)) text += `\n[${link.label}](${link.url})`;
    }
    if (actions.length === 0) return { message: text };
    return {
      message: text,
      props: { attachments: [{ fallback: fallbackText || text, actions }] },
    };
  }

  private async uploadFiles(channelId: string, files: FileUpload[]): Promise<string[]> {
    if (files.length === 0) return [];
    if (files.length > 10) throw new ValidationError(ADAPTER_NAME, "Mattermost accepts at most 10 files per post");
    const form = new FormData();
    form.append("channel_id", channelId);
    for (const file of files) {
      const data = file.data instanceof Blob
        ? file.data
        : new Blob([file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : new Uint8Array(file.data)], {
            type: file.mimeType ?? "application/octet-stream",
          });
      form.append("files", data, file.filename);
    }
    const result = await this.api<{ file_infos: MattermostFileInfo[] }>("/files", {
      method: "POST",
      body: form,
      description: "file upload",
    });
    return (result.file_infos ?? []).map((file) => file.id);
  }

  private oversizedTextAsFile(text: string, files: FileUpload[]): { text: string; files: FileUpload[] } {
    if (text.length <= MATTERMOST_MAX_POST_CHARACTERS) return { text, files };
    return {
      text: "Paperclip attached the complete response because it exceeds Mattermost's message limit.",
      files: [...files, { data: Buffer.from(text, "utf8"), filename: "response.md", mimeType: "text/markdown" }],
    };
  }

  async postMessage(threadId: string, message: AdapterPostableMessage): Promise<RawMessage<MattermostRawMessage>> {
    const thread = decodeMattermostThreadId(threadId);
    const body = this.postBody(message, thread.channelId);
    const { text, files } = this.oversizedTextAsFile(body.message, extractFiles(message));
    const fileIds = await this.uploadFiles(thread.channelId, files);
    const post = await this.api<MattermostPost>("/posts", {
      method: "POST",
      body: JSON.stringify({
        channel_id: thread.channelId,
        ...(thread.rootId ? { root_id: thread.rootId } : {}),
        message: text,
        ...(fileIds.length ? { file_ids: fileIds } : {}),
        ...(body.props ? { props: body.props } : {}),
      }),
      description: "post message",
    });
    return { id: post.id, threadId, raw: this.rawFor(post, thread) };
  }

  async postChannelMessage(channelId: string, message: AdapterPostableMessage): Promise<RawMessage<MattermostRawMessage>> {
    const match = /^mattermost:([cdg]):([a-z0-9]{26})$/.exec(channelId);
    if (!match) throw new ValidationError(ADAPTER_NAME, `Invalid Mattermost channel ID: ${channelId}`);
    const kind = match[1] as MattermostChannelKind;
    const posted = await this.postMessage(encodeMattermostThreadId({ kind, channelId: match[2]!, rootId: "" }), message);
    if (kind !== "c") return posted;
    // A new channel post starts its own thread.
    const threadId = encodeMattermostThreadId({ kind, channelId: match[2]!, rootId: posted.id });
    return { ...posted, threadId };
  }

  async editMessage(threadId: string, messageId: string, message: AdapterPostableMessage): Promise<RawMessage<MattermostRawMessage>> {
    const thread = decodeMattermostThreadId(threadId);
    const body = this.postBody(message, thread.channelId);
    if (extractFiles(message).length > 0) {
      throw new ValidationError(ADAPTER_NAME, "Mattermost cannot add files when editing a post");
    }
    const text = body.message.length > MATTERMOST_MAX_POST_CHARACTERS
      ? `${body.message.slice(0, MATTERMOST_MAX_POST_CHARACTERS - 40)}\n\n_(truncated)_`
      : body.message;
    const post = await this.api<MattermostPost>(`/posts/${messageId}/patch`, {
      method: "PUT",
      // Always send props so stale buttons are removed when a card resolves.
      body: JSON.stringify({ message: text, props: body.props ?? { attachments: [] } }),
      description: "edit message",
    });
    return { id: post.id, threadId, raw: this.rawFor(post, thread) };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.api(`/posts/${messageId}`, { method: "DELETE", description: "delete message" });
  }

  private rawFor(post: MattermostPost, thread: MattermostThreadId): MattermostRawMessage {
    return {
      ...post,
      paperclip_channel_kind: thread.kind,
      paperclip_team_id: thread.kind === "c" ? this.teamId : "",
    };
  }

  private emojiName(emoji: EmojiValue | string): string {
    return defaultEmojiResolver.toSlack(emoji).replace(/^:|:$/g, "");
  }

  async addReaction(_threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    const botUserId = await this.ensureBotIdentity();
    await this.api("/reactions", {
      method: "POST",
      body: JSON.stringify({ user_id: botUserId, post_id: messageId, emoji_name: this.emojiName(emoji) }),
      description: "add reaction",
    });
  }

  async removeReaction(_threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    const botUserId = await this.ensureBotIdentity();
    await this.api(`/users/${botUserId}/posts/${messageId}/reactions/${encodeURIComponent(this.emojiName(emoji))}`, {
      method: "DELETE",
      description: "remove reaction",
    });
  }

  async startTyping(threadId: string): Promise<void> {
    const thread = decodeMattermostThreadId(threadId);
    const botUserId = await this.ensureBotIdentity();
    await this.api(`/users/${botUserId}/typing`, {
      method: "POST",
      body: JSON.stringify({ channel_id: thread.channelId, ...(thread.rootId ? { parent_id: thread.rootId } : {}) }),
      description: "typing indicator",
    }).catch(() => undefined);
  }

  async openDM(userId: string): Promise<string> {
    const botUserId = await this.ensureBotIdentity();
    const channel = await this.api<MattermostChannel>("/channels/direct", {
      method: "POST",
      body: JSON.stringify([botUserId, mattermostId(userId, "Mattermost user ID")]),
      description: "open direct message",
    });
    return encodeMattermostThreadId({ kind: "d", channelId: channel.id, rootId: "" });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async fetchMessage(threadId: string, messageId: string): Promise<Message<MattermostRawMessage> | null> {
    const thread = decodeMattermostThreadId(threadId);
    const post = await this.api<MattermostPost>(`/posts/${messageId}`, { description: "message lookup" }).catch((error) => {
      if (error instanceof ResourceNotFoundError) return null;
      throw error;
    });
    if (!post || post.channel_id !== thread.channelId) return null;
    await this.rememberUser(post.user_id);
    return this.messageFromRaw(this.rawFor(post, thread), threadId, false);
  }

  async fetchMessages(threadId: string, options: FetchOptions = {}): Promise<FetchResult<MattermostRawMessage>> {
    const thread = decodeMattermostThreadId(threadId);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    let posts: MattermostPost[];
    if (thread.rootId) {
      const result = await this.api<{ order: string[]; posts: Record<string, MattermostPost> }>(
        `/posts/${thread.rootId}/thread`,
        { description: "thread history" },
      );
      posts = Object.values(result.posts ?? {});
    } else {
      const result = await this.api<{ order: string[]; posts: Record<string, MattermostPost> }>(
        `/channels/${thread.channelId}/posts?per_page=${limit}`,
        { description: "channel history" },
      );
      posts = Object.values(result.posts ?? {}).filter((post) => !post.root_id);
    }
    posts.sort((left, right) => left.create_at - right.create_at);
    const forward = options.direction === "forward";
    const cursor = options.cursor ? Number(options.cursor) : null;
    if (cursor !== null && Number.isFinite(cursor)) {
      posts = posts.filter((post) => (forward ? post.create_at > cursor : post.create_at < cursor));
    }
    const page = forward ? posts.slice(0, limit) : posts.slice(-limit);
    const messages = page
      .filter((post) => !(post.type && post.type.startsWith("system_")))
      .map((post) => this.messageFromRaw(this.rawFor(post, thread), threadId, false));
    const more = posts.length > page.length;
    const edge = forward ? page.at(-1) : page[0];
    return { messages, ...(more && edge ? { nextCursor: String(edge.create_at) } : {}) };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const thread = decodeMattermostThreadId(threadId);
    const channel = await this.api<MattermostChannel>(`/channels/${thread.channelId}`, { description: "channel lookup" });
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      channelName: channel.display_name || channel.name,
      channelVisibility: this.getChannelVisibility(threadId),
      isDM: thread.kind === "d",
      metadata: { teamId: channel.team_id, type: channel.type },
    };
  }

  private readonly channelInfoCache = new Map<string, { info: ChannelInfo; expiresAt: number }>();

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const match = /^mattermost:([cdg]):([a-z0-9]{26})$/.exec(channelId);
    if (!match) throw new ValidationError(ADAPTER_NAME, `Invalid Mattermost channel ID: ${channelId}`);
    const cached = this.channelInfoCache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) return cached.info;
    const channel = await this.api<MattermostChannel>(`/channels/${match[2]}`, { description: "channel lookup" });
    let name = mattermostChannelLabel(channel);
    if (channel.type === "D") {
      // A DM's channel name is "<userId>__<userId>"; name it after the other person.
      const otherId = channel.name.split("__").find((id) => id && id !== this._botUserId);
      const other = otherId ? await this.rememberUser(otherId) : null;
      name = other ? `@${other.username}` : "Direct message";
    }
    const info: ChannelInfo = {
      id: channelId,
      name,
      isDM: channel.type === "D",
      channelVisibility: channel.type === "O" ? "workspace" : "private",
      metadata: { teamId: channel.team_id, type: channel.type },
    };
    // Renames show up within five minutes.
    this.channelInfoCache.set(channelId, { info, expiresAt: Date.now() + 5 * 60_000 });
    return info;
  }

  async getUser(userId: string): Promise<UserInfo | null> {
    const user = await this.rememberUser(userId);
    if (!user) return null;
    return {
      userId: user.id,
      userName: user.username,
      fullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username,
      isBot: user.is_bot === true,
      ...(user.email ? { email: user.email } : {}),
      avatarUrl: `${this.baseUrl}/api/v4/users/${user.id}/image`,
    };
  }
}

export function createMattermostAdapter(config: MattermostAdapterConfig): MattermostAdapter {
  return new MattermostAdapter(config);
}
