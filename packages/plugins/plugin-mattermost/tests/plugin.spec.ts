import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent } from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin, { parseOutgoingWebhook, readConfig, settleForTests } from "../src/worker.js";
import { splitMessage } from "../src/mattermost-client.js";

const COMPANY = "company-1";
const AGENT = "agent-1";
const CONFIG = {
  baseUrl: "https://chat.example.test/",
  botTokenRef: "bot-token",
  outgoingWebhookTokenRef: "hook-token",
  companyId: COMPANY,
  agentId: AGENT,
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

function fakeMattermost(posts: Record<string, { root_id: string }>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname.replace("/api/v4", "");
    const call: Call = {
      method: init?.method ?? "GET",
      path,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      authorization: new Headers(init?.headers).get("authorization"),
    };
    calls.push(call);
    if (path === "/users/me") return Response.json({ id: "bot-user", username: "paperclip" });
    if (path.startsWith("/posts/")) {
      const id = path.slice("/posts/".length);
      return Response.json({ id, channel_id: "chan-1", user_id: "user-1", message: "", root_id: posts[id]?.root_id ?? "" });
    }
    if (path === "/posts") return Response.json({ id: `reply-${calls.length}`, channel_id: "chan-1", root_id: "", user_id: "bot-user", message: "" });
    if (path === "/reactions") return Response.json({});
    return new Response("not found", { status: 404 });
  });
  return calls;
}

function delivery(fields: Record<string, string>, json = false) {
  const body = { token: "resolved:hook-token", channel_id: "chan-1", user_id: "user-1", user_name: "daniel", trigger_word: "@paperclip", ...fields };
  return {
    endpointKey: "outgoing",
    headers: {},
    rawBody: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    parsedBody: json ? body : undefined,
    requestId: "req-1",
  };
}

async function setup() {
  const harness = createTestHarness({ manifest, config: CONFIG });
  harness.seed({ agents: [{ id: AGENT, companyId: COMPANY, name: "Assistant", status: "idle" } as Agent] });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

/** Answers every prompt sent to an agent session with the given text. */
function answerWith(harness: Awaited<ReturnType<typeof setup>>, text: string) {
  const original = harness.ctx.agents.sessions.sendMessage.bind(harness.ctx.agents.sessions);
  const prompts: Array<{ sessionId: string; prompt: string }> = [];
  harness.ctx.agents.sessions.sendMessage = async (sessionId, companyId, opts) => {
    prompts.push({ sessionId, prompt: opts.prompt });
    const result = await original(sessionId, companyId, opts);
    queueMicrotask(() => {
      harness.simulateSessionEvent(sessionId, { runId: result.runId, seq: 1, eventType: "chunk", stream: "stdout", message: text, payload: null });
      harness.simulateSessionEvent(sessionId, { runId: result.runId, seq: 2, eventType: "done", stream: null, message: null, payload: null });
    });
    return result;
  };
  return prompts;
}

describe("Mattermost plugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("answers a channel message in its thread", async () => {
    const calls = fakeMattermost({});
    const harness = await setup();
    const prompts = answerWith(harness, "Deploy finished at noon.");

    await plugin.definition.onWebhook!(delivery({ post_id: "post-1", text: "@paperclip when did the deploy finish?" }));
    await settleForTests();

    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("daniel wrote in Mattermost");
    expect(prompts[0].prompt).toContain("when did the deploy finish?");
    expect(prompts[0].prompt).not.toContain("@paperclip");
    expect(calls.find((call) => call.path === "/reactions")?.body).toEqual({ user_id: "bot-user", post_id: "post-1", emoji_name: "eyes" });
    const reply = calls.find((call) => call.method === "POST" && call.path === "/posts");
    expect(reply?.body).toEqual({ channel_id: "chan-1", root_id: "post-1", message: "Deploy finished at noon." });
    expect(reply?.authorization).toBe("Bearer resolved:bot-token");
  });

  it("keeps one agent session per thread", async () => {
    fakeMattermost({ "post-2": { root_id: "post-1" } });
    const harness = await setup();
    const prompts = answerWith(harness, "ok");

    await plugin.definition.onWebhook!(delivery({ post_id: "post-1", text: "@paperclip first" }));
    await settleForTests();
    await plugin.definition.onWebhook!(delivery({ post_id: "post-2", text: "@paperclip second" }, true));
    await settleForTests();
    await plugin.definition.onWebhook!(delivery({ post_id: "post-9", text: "@paperclip other thread" }));
    await settleForTests();

    expect(prompts).toHaveLength(3);
    expect(prompts[1].sessionId).toBe(prompts[0].sessionId);
    expect(prompts[2].sessionId).not.toBe(prompts[0].sessionId);
  });

  it("rejects a delivery with the wrong token and does not call the agent", async () => {
    const calls = fakeMattermost({});
    const harness = await setup();
    const prompts = answerWith(harness, "ok");

    await expect(plugin.definition.onWebhook!(delivery({ post_id: "post-1", text: "hi", token: "wrong" }))).rejects.toThrow(/token/);
    await settleForTests();

    expect(prompts).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("ignores the bot's own posts", async () => {
    const calls = fakeMattermost({});
    const harness = await setup();
    const prompts = answerWith(harness, "ok");

    await plugin.definition.onWebhook!(delivery({ post_id: "post-1", text: "@paperclip loop", user_id: "bot-user" }));
    await settleForTests();

    expect(prompts).toHaveLength(0);
    expect(calls.some((call) => call.path === "/posts")).toBe(false);
  });

  it("tells the thread when the agent run fails", async () => {
    const calls = fakeMattermost({});
    const harness = await setup();
    const original = harness.ctx.agents.sessions.sendMessage.bind(harness.ctx.agents.sessions);
    harness.ctx.agents.sessions.sendMessage = async (sessionId, companyId, opts) => {
      const result = await original(sessionId, companyId, opts);
      queueMicrotask(() => harness.simulateSessionEvent(sessionId, { runId: result.runId, seq: 1, eventType: "error", stream: null, message: "boom", payload: null }));
      return result;
    };

    await plugin.definition.onWebhook!(delivery({ post_id: "post-1", text: "@paperclip hi" }));
    await settleForTests();

    const reply = calls.find((call) => call.method === "POST" && call.path === "/posts");
    expect(String(reply?.body?.message)).toContain("could not answer");
    expect(String(reply?.body?.message)).not.toContain("boom");
  });

  it("lets an agent post a message with the tool", async () => {
    const calls = fakeMattermost({});
    const harness = await setup();

    const result = await harness.executeTool("post_message", { channelId: "chan-7", message: "Build is green.", rootId: "post-5" });

    expect(result.error).toBeUndefined();
    expect(calls.find((call) => call.path === "/posts")?.body).toEqual({ channel_id: "chan-7", root_id: "post-5", message: "Build is green." });
  });

  it("validates configuration", async () => {
    expect(readConfig(CONFIG).errors).toEqual([]);
    expect(readConfig({ ...CONFIG, baseUrl: "ftp://chat.example.test" }).errors).toContain("baseUrl must be an http or https URL");
    expect(readConfig({ baseUrl: "https://chat.example.test" }).errors).toContain("agentId is required");
    expect(await plugin.definition.onValidateConfig!({})).toMatchObject({ ok: false });
  });

  it("parses form and JSON deliveries and splits long answers", () => {
    expect(parseOutgoingWebhook({ rawBody: "token=t&channel_id=c&post_id=p&text=hello+there", parsedBody: undefined })?.text).toBe("hello there");
    expect(parseOutgoingWebhook({ rawBody: "", parsedBody: { token: "t", channel_id: "c", post_id: "p" } })?.post_id).toBe("p");
    expect(parseOutgoingWebhook({ rawBody: "token=t", parsedBody: undefined })).toBeNull();
    const parts = splitMessage(`${"a".repeat(30)}\n${"b".repeat(30)}`, 40);
    expect(parts).toEqual(["a".repeat(30), "b".repeat(30)]);
  });
});
