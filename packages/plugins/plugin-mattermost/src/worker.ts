import { timingSafeEqual } from "node:crypto";
import {
  definePlugin,
  type AgentSessionEvent,
  type PluginContext,
  type PluginWebhookInput,
} from "@paperclipai/plugin-sdk";
import { TOOL_POST_MESSAGE, WEBHOOK_OUTGOING } from "./manifest.js";
import { createMattermostClient, splitMessage, type MattermostClient } from "./mattermost-client.js";

export interface MattermostPluginConfig {
  baseUrl: string;
  botTokenRef: string;
  outgoingWebhookTokenRef: string;
  companyId: string;
  agentId: string;
}

const REQUIRED_KEYS = ["baseUrl", "botTokenRef", "outgoingWebhookTokenRef", "companyId", "agentId"] as const;

/** Fields of a Mattermost outgoing webhook delivery that this plugin reads. */
interface OutgoingWebhookPayload {
  token: string;
  channel_id: string;
  post_id: string;
  user_id: string;
  user_name: string;
  text: string;
  trigger_word: string;
}

export function readConfig(raw: Record<string, unknown>): { config?: MattermostPluginConfig; errors: string[] } {
  const errors: string[] = [];
  for (const key of REQUIRED_KEYS) {
    if (typeof raw[key] !== "string" || raw[key].trim() === "") errors.push(`${key} is required`);
  }
  if (typeof raw.baseUrl === "string" && raw.baseUrl.trim() !== "") {
    try {
      const url = new URL(raw.baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") errors.push("baseUrl must be an http or https URL");
    } catch {
      errors.push("baseUrl must be a URL");
    }
  }
  if (errors.length > 0) return { errors };
  return { config: raw as unknown as MattermostPluginConfig, errors };
}

/** Outgoing webhooks are form-encoded unless the webhook is set to JSON. */
export function parseOutgoingWebhook(input: Pick<PluginWebhookInput, "rawBody" | "parsedBody">): OutgoingWebhookPayload | null {
  let fields: Record<string, unknown>;
  if (input.parsedBody && typeof input.parsedBody === "object" && !Array.isArray(input.parsedBody)) {
    fields = input.parsedBody as Record<string, unknown>;
  } else {
    fields = Object.fromEntries(new URLSearchParams(input.rawBody));
  }
  const text = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");
  const payload: OutgoingWebhookPayload = {
    token: text("token"),
    channel_id: text("channel_id"),
    post_id: text("post_id"),
    user_id: text("user_id"),
    user_name: text("user_name"),
    text: text("text"),
    trigger_word: text("trigger_word"),
  };
  if (!payload.token || !payload.channel_id || !payload.post_id) return null;
  return payload;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function stripTriggerWord(text: string, triggerWord: string): string {
  const trimmed = text.trim();
  if (triggerWord && trimmed.toLowerCase().startsWith(triggerWord.toLowerCase())) {
    return trimmed.slice(triggerWord.length).trim();
  }
  return trimmed;
}

let ctxRef: PluginContext | null = null;
let botUserId: string | null = null;
const inFlight = new Set<Promise<void>>();

async function clientFor(ctx: PluginContext, config: MattermostPluginConfig): Promise<MattermostClient> {
  const token = await ctx.secrets.resolve(config.botTokenRef, { companyId: config.companyId });
  return createMattermostClient({ baseUrl: config.baseUrl, token, fetch: (url, init) => ctx.http.fetch(url, init) });
}

function threadStateKey(threadRootId: string) {
  return { scopeKind: "instance" as const, stateKey: `thread:${threadRootId}` };
}

/** Sends one prompt to the agent session and resolves with the text of its answer. */
async function askAgent(ctx: PluginContext, config: MattermostPluginConfig, sessionId: string, prompt: string): Promise<string> {
  let answer = "";
  let finish: (value: string) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const done = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const onEvent = (event: AgentSessionEvent) => {
    if (event.eventType === "chunk" && event.stream !== "stderr" && event.message) answer += event.message;
    if (event.eventType === "done") finish(answer);
    if (event.eventType === "error") fail(new Error(event.message ?? "The agent run failed"));
  };
  await ctx.agents.sessions.sendMessage(sessionId, config.companyId, {
    prompt,
    reason: "Mattermost message",
    onEvent,
  });
  return done;
}

async function sessionForThread(ctx: PluginContext, config: MattermostPluginConfig, channelId: string, threadRootId: string, fresh: boolean) {
  const key = threadStateKey(threadRootId);
  if (!fresh) {
    const saved = await ctx.state.get(key);
    if (typeof saved === "string" && saved) return saved;
  }
  const session = await ctx.agents.sessions.create(config.agentId, config.companyId, {
    taskKey: `mattermost:${channelId}:${threadRootId}`,
    reason: "Mattermost thread",
  });
  await ctx.state.set(key, session.sessionId);
  return session.sessionId;
}

async function handleMessage(ctx: PluginContext, config: MattermostPluginConfig, payload: OutgoingWebhookPayload) {
  const client = await clientFor(ctx, config);
  if (!botUserId) botUserId = (await client.getMe()).id;
  // The bot's own posts can contain the trigger word. Never answer them.
  if (payload.user_id === botUserId) return;

  const post = await client.getPost(payload.post_id);
  const threadRootId = post.root_id || post.id;
  await client
    .addReaction({ userId: botUserId, postId: post.id, emojiName: "eyes" })
    .catch((error) => ctx.logger.warn("Could not add the reaction", { error: String(error) }));

  const question = stripTriggerWord(payload.text, payload.trigger_word);
  const prompt = `${payload.user_name || "A Mattermost user"} wrote in Mattermost:\n\n${question}`;

  let answer: string;
  try {
    let sessionId = await sessionForThread(ctx, config, payload.channel_id, threadRootId, false);
    try {
      answer = await askAgent(ctx, config, sessionId, prompt);
    } catch (error) {
      // A saved session can be closed on the host. Start a new one once.
      if (!/session not found|closed/i.test(String(error))) throw error;
      sessionId = await sessionForThread(ctx, config, payload.channel_id, threadRootId, true);
      answer = await askAgent(ctx, config, sessionId, prompt);
    }
  } catch (error) {
    ctx.logger.error("The agent did not answer a Mattermost message", { error: String(error), postId: post.id });
    await client.createPost({
      channelId: payload.channel_id,
      rootId: threadRootId,
      message: "The agent could not answer this message. See the Paperclip plugin log for the reason.",
    });
    return;
  }

  for (const part of splitMessage(answer.trim() || "(The agent finished without a text answer.)")) {
    await client.createPost({ channelId: payload.channel_id, rootId: threadRootId, message: part });
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    ctxRef = ctx;
    botUserId = null;

    ctx.tools.register(
      TOOL_POST_MESSAGE,
      {
        displayName: "Post to Mattermost",
        description: "Posts a message to a Mattermost channel as the bot. Pass rootId to reply in a thread.",
        parametersSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            message: { type: "string" },
            rootId: { type: "string" },
          },
          required: ["channelId", "message"],
        },
      },
      async (params) => {
        const input = (params ?? {}) as { channelId?: unknown; message?: unknown; rootId?: unknown };
        if (typeof input.channelId !== "string" || typeof input.message !== "string" || !input.channelId || !input.message) {
          return { error: "channelId and message are required" };
        }
        const { config, errors } = readConfig(await ctx.config.get());
        if (!config) return { error: `The Mattermost plugin is not configured: ${errors.join("; ")}` };
        const client = await clientFor(ctx, config);
        const postIds: string[] = [];
        for (const part of splitMessage(input.message)) {
          const post = await client.createPost({
            channelId: input.channelId,
            message: part,
            rootId: typeof input.rootId === "string" && input.rootId ? input.rootId : undefined,
          });
          postIds.push(post.id);
        }
        return { content: `Posted ${postIds.length} message(s) to Mattermost.`, data: { postIds } };
      },
    );
  },

  async onValidateConfig(config) {
    const { errors } = readConfig(config);
    return { ok: errors.length === 0, errors };
  },

  async onHealth() {
    return { status: "ok", details: { messagesInProgress: inFlight.size } };
  },

  async onIdleDrain() {
    return inFlight.size === 0 ? "none" : "present";
  },

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== WEBHOOK_OUTGOING) throw new Error(`Unknown webhook endpoint "${input.endpointKey}"`);
    const ctx = ctxRef;
    if (!ctx) throw new Error("The plugin is not set up");
    const { config, errors } = readConfig(await ctx.config.get());
    if (!config) throw new Error(`The Mattermost plugin is not configured: ${errors.join("; ")}`);

    const payload = parseOutgoingWebhook(input);
    if (!payload) throw new Error("Not a Mattermost outgoing webhook delivery");
    const expected = await ctx.secrets.resolve(config.outgoingWebhookTokenRef, { companyId: config.companyId });
    if (!sameSecret(payload.token, expected)) throw new Error("The outgoing webhook token does not match");

    // Mattermost waits only a few seconds for the webhook response, and an agent
    // run takes longer. Answer the delivery now and post the reply when it is ready.
    const work: Promise<void> = handleMessage(ctx, config, payload)
      .catch((error) => ctx.logger.error("Mattermost message handling failed", { error: String(error) }))
      .finally(() => inFlight.delete(work));
    inFlight.add(work);
  },
});

/** Test hook: resolves when every accepted message has been handled. */
export async function settleForTests(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

export default plugin;
