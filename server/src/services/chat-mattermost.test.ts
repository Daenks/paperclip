import { describe, expect, it, vi } from "vitest";
import { Actions, Button, Card, CardText, LinkButton } from "chat";
import type { ChatInstance } from "chat";
import {
  decodeMattermostThreadId,
  encodeMattermostThreadId,
  MATTERMOST_MAX_POST_CHARACTERS,
  MattermostAdapter,
  normalizeMattermostBaseUrl,
  verifyMattermostBot,
} from "./chat-mattermost.js";

const BOT = "b".repeat(26);
const USER = "u".repeat(26);
const TEAM = "t".repeat(26);
const OTHER_TEAM = "o".repeat(26);
const CHANNEL = "c".repeat(26);
const DM = "d".repeat(26);
const POST = "p".repeat(26);
const ROOT = "r".repeat(26);
const SECRET = "s".repeat(64);
const BASE = "https://chat.example.com";

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const key = `${method} ${url.pathname}`;
    calls.push({
      method,
      path: url.pathname,
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    });
    const route = routes[key];
    if (!route) return json({ message: `no route ${key}` }, 404);
    return await route(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function fakeChat() {
  return {
    getUserName: () => "paperclip-bot",
    processMessage: vi.fn(async () => undefined),
    processMessageUpdated: vi.fn(async () => undefined),
    processMessageDeleted: vi.fn(async () => undefined),
    processReaction: vi.fn(() => undefined),
    processAction: vi.fn(async () => undefined),
  };
}

const identityRoutes: Record<string, Route> = {
  "GET /api/v4/users/me": () => json({ id: BOT, username: "paperclip-bot", is_bot: true }),
  [`GET /api/v4/users/${USER}`]: () => json({ id: USER, username: "daniel", first_name: "Daniel", is_bot: false }),
  [`GET /api/v4/channels/${CHANNEL}`]: () => json({ id: CHANNEL, type: "O", team_id: TEAM, name: "town-square", display_name: "Town Square" }),
  [`GET /api/v4/channels/${DM}`]: () => json({ id: DM, type: "D", team_id: "", name: `${BOT}__${USER}`, display_name: "" }),
};

async function adapterWith(routes: Record<string, Route> = {}, options: { callback?: boolean } = {}) {
  const { fetchImpl, calls } = fakeFetch({ ...identityRoutes, ...routes });
  const adapter = new MattermostAdapter({
    baseUrl: `${BASE}/`,
    botToken: "token",
    teamId: TEAM,
    userName: "paperclip-bot",
    fetch: fetchImpl,
    ...(options.callback !== false
      ? { callbackUrl: "https://paperclip.example.com/api/chat-webhooks/pub/mattermost", callbackSecret: SECRET }
      : {}),
  });
  const chat = fakeChat();
  await adapter.initialize(chat as unknown as ChatInstance);
  return { adapter, chat, calls };
}

function postedEvent(post: Record<string, unknown>, data: Record<string, unknown> = {}) {
  return {
    event: "posted",
    data: { post: JSON.stringify(post), channel_type: "O", team_id: TEAM, ...data },
    broadcast: { channel_id: post.channel_id },
    seq: 3,
  };
}

describe("Mattermost thread ids", () => {
  it("round-trips channel threads and top-level DMs", () => {
    const thread = { kind: "c" as const, channelId: CHANNEL, rootId: ROOT };
    expect(decodeMattermostThreadId(encodeMattermostThreadId(thread))).toEqual(thread);
    const dm = { kind: "d" as const, channelId: DM, rootId: "" };
    expect(encodeMattermostThreadId(dm)).toBe(`mattermost:d:${DM}:`);
    expect(decodeMattermostThreadId(`mattermost:d:${DM}:`)).toEqual(dm);
    expect(() => decodeMattermostThreadId("mattermost:x:abc:")).toThrow();
  });

  it("normalizes the server URL", () => {
    expect(normalizeMattermostBaseUrl("https://chat.example.com/mm/")).toBe("https://chat.example.com/mm");
    expect(() => normalizeMattermostBaseUrl("ftp://chat.example.com")).toThrow();
    expect(() => normalizeMattermostBaseUrl("https://user:pw@chat.example.com")).toThrow();
  });
});

describe("verifyMattermostBot", () => {
  it("returns the bot and team identity", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /api/v4/users/me": () => json({ id: BOT, username: "paperclip-bot", nickname: "Paperclip", is_bot: true }),
      [`GET /api/v4/teams/${TEAM}`]: () => json({ id: TEAM, name: "eng", display_name: "Engineering" }),
      [`GET /api/v4/teams/${TEAM}/members/${BOT}`]: () => json({ team_id: TEAM, user_id: BOT }),
    });
    await expect(verifyMattermostBot({ baseUrl: BASE, botToken: "token", teamId: TEAM, fetch: fetchImpl })).resolves.toMatchObject({
      providerAccountId: TEAM,
      providerAccountLabel: "Engineering",
      botExternalId: BOT,
      botUsername: "paperclip-bot",
      botLabel: "Paperclip",
    });
  });

  it("rejects a personal access token", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /api/v4/users/me": () => json({ id: USER, username: "daniel", is_bot: false }),
    });
    await expect(verifyMattermostBot({ baseUrl: BASE, botToken: "token", teamId: TEAM, fetch: fetchImpl })).rejects.toThrow(/bot account/);
  });

  it("rejects a bot outside the team", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /api/v4/users/me": () => json({ id: BOT, username: "paperclip-bot", is_bot: true }),
      [`GET /api/v4/teams/${TEAM}`]: () => json({ id: TEAM, name: "eng", display_name: "Engineering" }),
    });
    await expect(verifyMattermostBot({ baseUrl: BASE, botToken: "token", teamId: TEAM, fetch: fetchImpl })).rejects.toThrow(/not a member/);
  });
});

describe("MattermostAdapter inbound events", () => {
  it("threads a channel mention under the mentioned post", async () => {
    const { adapter, chat } = await adapterWith();
    await adapter.handleSocketEvent(
      postedEvent(
        { id: POST, create_at: 1_700_000_000_000, user_id: USER, channel_id: CHANNEL, root_id: "", message: "@paperclip-bot hi" },
        { mentions: JSON.stringify([BOT]) },
      ),
    );
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const [, threadId, message] = chat.processMessage.mock.calls[0] as unknown as [unknown, string, { isMention: boolean; author: { userName: string }; raw: Record<string, unknown> }];
    expect(threadId).toBe(`mattermost:c:${CHANNEL}:${POST}`);
    expect(message.isMention).toBe(true);
    expect(message.author.userName).toBe("daniel");
    expect(message.raw.paperclip_team_id).toBe(TEAM);
  });

  it("keeps a top-level DM at the top level", async () => {
    const { adapter, chat } = await adapterWith();
    await adapter.handleSocketEvent(
      postedEvent(
        { id: POST, create_at: 1, user_id: USER, channel_id: DM, message: "hello" },
        { channel_type: "D", team_id: "" },
      ),
    );
    const [, threadId] = chat.processMessage.mock.calls[0] as unknown as [unknown, string];
    expect(threadId).toBe(`mattermost:d:${DM}:`);
    expect(adapter.isDM(threadId)).toBe(true);
  });

  it("ignores its own posts, system posts, and other teams", async () => {
    const { adapter, chat } = await adapterWith();
    await adapter.handleSocketEvent(postedEvent({ id: POST, create_at: 1, user_id: BOT, channel_id: CHANNEL, message: "mine" }));
    await adapter.handleSocketEvent(postedEvent({ id: POST, create_at: 1, user_id: USER, channel_id: CHANNEL, message: "", type: "system_join_channel" }));
    await adapter.handleSocketEvent(
      postedEvent({ id: POST, create_at: 1, user_id: USER, channel_id: "x".repeat(26), message: "elsewhere" }, { team_id: OTHER_TEAM }),
    );
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("routes edits, deletes, and reactions", async () => {
    const { adapter, chat } = await adapterWith({
      [`GET /api/v4/posts/${POST}`]: () => json({ id: POST, create_at: 1, user_id: USER, channel_id: CHANNEL, root_id: ROOT, message: "x" }),
    });
    const post = { id: POST, create_at: 1, edit_at: 2, user_id: USER, channel_id: CHANNEL, root_id: ROOT, message: "edited" };
    await adapter.handleSocketEvent({ ...postedEvent(post), event: "post_edited" });
    await adapter.handleSocketEvent({ ...postedEvent(post), event: "post_deleted" });
    await adapter.handleSocketEvent({
      event: "reaction_added",
      data: { reaction: JSON.stringify({ user_id: USER, post_id: POST, emoji_name: "thumbsup" }) },
      broadcast: { channel_id: CHANNEL },
    });
    expect(chat.processMessageUpdated).toHaveBeenCalledWith(expect.objectContaining({ threadId: `mattermost:c:${CHANNEL}:${ROOT}` }));
    expect(chat.processMessageDeleted).toHaveBeenCalledWith(expect.objectContaining({ messageId: POST }));
    expect(chat.processReaction).toHaveBeenCalledWith(
      expect.objectContaining({ added: true, rawEmoji: "thumbsup", threadId: `mattermost:c:${CHANNEL}:${ROOT}` }),
    );
  });

  it("downloads attachments with the bot token", async () => {
    const fileId = "f".repeat(26);
    const { adapter, chat } = await adapterWith({
      [`GET /api/v4/files/${fileId}`]: (_url, init) => {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
        return new Response("hello");
      },
    });
    await adapter.handleSocketEvent(
      postedEvent({
        id: POST,
        create_at: 1,
        user_id: USER,
        channel_id: CHANNEL,
        message: "file",
        metadata: { files: [{ id: fileId, name: "a.txt", mime_type: "text/plain", size: 5 }] },
      }),
    );
    const message = (chat.processMessage.mock.calls[0] as unknown as [unknown, string, { attachments: Array<{ fetchData: () => Promise<Buffer>; fetchMetadata: Record<string, string> }> }])[2];
    expect(message.attachments[0]!.fetchMetadata.fileId).toBe(fileId);
    expect((await message.attachments[0]!.fetchData()).toString()).toBe("hello");
  });
});

describe("MattermostAdapter channel names", () => {
  it("labels channels by display name and DMs by the other person, with caching", async () => {
    const { adapter, calls } = await adapterWith({
      [`GET /api/v4/channels/${DM}`]: () => json({ id: DM, type: "D", team_id: "", name: `${BOT}__${USER}`, display_name: "" }),
    });
    await expect(adapter.fetchChannelInfo(`mattermost:c:${CHANNEL}`)).resolves.toMatchObject({ name: "Town Square", isDM: false });
    await expect(adapter.fetchChannelInfo(`mattermost:d:${DM}`)).resolves.toMatchObject({ name: "@daniel", isDM: true });
    const lookups = calls.filter((call) => call.path === `/api/v4/channels/${CHANNEL}`).length;
    await adapter.fetchChannelInfo(`mattermost:c:${CHANNEL}`);
    expect(calls.filter((call) => call.path === `/api/v4/channels/${CHANNEL}`)).toHaveLength(lookups);
  });
});

describe("MattermostAdapter outbound", () => {
  it("posts replies into the thread and returns the post id", async () => {
    const { adapter, calls } = await adapterWith({
      "POST /api/v4/posts": (_url, init) => json({ id: "n".repeat(26), create_at: 1, user_id: BOT, ...JSON.parse(String(init.body)) }),
    });
    const sent = await adapter.postMessage(`mattermost:c:${CHANNEL}:${ROOT}`, { markdown: "**done**" });
    expect(sent.id).toBe("n".repeat(26));
    expect(calls.at(-1)?.body).toMatchObject({ channel_id: CHANNEL, root_id: ROOT, message: "**done**" });
  });

  it("moves oversized text into a Markdown file", async () => {
    const { adapter, calls } = await adapterWith({
      "POST /api/v4/files": () => json({ file_infos: [{ id: "f".repeat(26) }] }),
      "POST /api/v4/posts": (_url, init) => json({ id: "n".repeat(26), create_at: 1, user_id: BOT, ...JSON.parse(String(init.body)) }),
    });
    await adapter.postMessage(`mattermost:d:${DM}:`, "x".repeat(MATTERMOST_MAX_POST_CHARACTERS + 1));
    const post = calls.at(-1)?.body as { file_ids: string[]; message: string; root_id?: string };
    expect(post.file_ids).toEqual(["f".repeat(26)]);
    expect(post.message).toMatch(/complete response/);
    expect(post.root_id).toBeUndefined();
  });

  it("signs button context and accepts only the matching callback", async () => {
    let posted: Record<string, unknown> = {};
    const { adapter, chat } = await adapterWith({
      "POST /api/v4/posts": (_url, init) => {
        posted = { id: POST, create_at: 1, user_id: BOT, ...JSON.parse(String(init.body)) };
        return json(posted);
      },
      [`GET /api/v4/posts/${POST}`]: () => json(posted),
    });
    await adapter.postMessage(`mattermost:c:${CHANNEL}:${ROOT}`, {
      card: Card({
        title: "Approve deploy?",
        children: [
          CardText("Ship it to production."),
          Actions([
            Button({ id: "pcc:accept", label: "Accept", style: "primary", value: "interaction-1" }),
            LinkButton({ label: "Open in Paperclip", url: "https://paperclip.example.com/issues/1" }),
          ]),
        ],
      }),
      fallbackText: "Approve deploy?",
    });
    const props = posted.props as { attachments: Array<{ actions: Array<{ id: string; integration: { url: string; context: Record<string, string> } }> }> };
    const action = props.attachments[0]!.actions[0]!;
    expect(action.id).toMatch(/^[a-z0-9]+$/);
    expect(action.integration.url).toBe("https://paperclip.example.com/api/chat-webhooks/pub/mattermost");
    expect(String(posted.message)).toContain("Open in Paperclip");

    const click = (context: Record<string, string>) =>
      adapter.handleWebhook(
        new Request("https://paperclip.example.com/api/chat-webhooks/pub/mattermost", {
          method: "POST",
          body: JSON.stringify({ user_id: USER, channel_id: CHANNEL, post_id: POST, context }),
        }),
      );
    const accepted = await click(action.integration.context);
    expect(accepted.status).toBe(200);
    expect(chat.processAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "pcc:accept", value: "interaction-1", messageId: POST, threadId: `mattermost:c:${CHANNEL}:${ROOT}` }),
      undefined,
    );
    const tampered = await click({ ...action.integration.context, a: "pcc:reject" });
    expect(tampered.status).toBe(401);
    expect(chat.processAction).toHaveBeenCalledTimes(1);
  });

  it("posts cards as text when no callback URL is configured", async () => {
    let posted: Record<string, unknown> = {};
    const { adapter } = await adapterWith(
      {
        "POST /api/v4/posts": (_url, init) => {
          posted = { id: POST, create_at: 1, user_id: BOT, ...JSON.parse(String(init.body)) };
          return json(posted);
        },
      },
      { callback: false },
    );
    await adapter.postMessage(`mattermost:c:${CHANNEL}:${ROOT}`, {
      card: Card({ title: "Question", children: [Actions([Button({ id: "a", label: "Yes" })])] }),
      fallbackText: "Question\n\nOpen the task in Paperclip to respond: https://paperclip.example.com/issues/1",
    });
    expect(posted.props).toBeUndefined();
    expect(String(posted.message)).toContain("Open the task in Paperclip to respond");
  });
});

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason: "" }));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  frame(payload: unknown) {
    this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(payload) }));
  }
}

describe("MattermostAdapter WebSocket receiver", () => {
  it("authenticates, reports ready, and dispatches events until stopped", async () => {
    const { fetchImpl } = fakeFetch(identityRoutes);
    const sockets: FakeSocket[] = [];
    const events: string[] = [];
    const adapter = new MattermostAdapter({
      baseUrl: BASE,
      botToken: "token",
      teamId: TEAM,
      userName: "paperclip-bot",
      fetch: fetchImpl,
      webSocketFactory: (url) => {
        expect(url).toBe("wss://chat.example.com/api/v4/websocket");
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onReceiverEvent: (event) => {
        events.push(event.type);
      },
    });
    const chat = fakeChat();
    await adapter.initialize(chat as unknown as ChatInstance);
    const stop = new AbortController();
    const running = adapter.runReceiver(stop.signal);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0]!;
    socket.open();
    expect(socket.sent[0]).toMatchObject({ action: "authentication_challenge", data: { token: "token" } });
    socket.frame({ status: "OK", seq_reply: 1 });
    socket.frame({ event: "hello", data: { server_version: "10.0.0" } });
    socket.frame(
      postedEvent(
        { id: POST, create_at: 1, user_id: USER, channel_id: CHANNEL, message: "@paperclip-bot ping" },
        { mentions: JSON.stringify([BOT]) },
      ),
    );
    await vi.waitFor(() => expect(chat.processMessage).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["connecting", "ready"]);
    stop.abort();
    await running;
    expect(events.at(-1)).toBe("disconnected");
  });
});
