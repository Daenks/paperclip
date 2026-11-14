import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent } from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin, { readConfig } from "../src/worker.js";
import { verifyGiteaSignature } from "../src/gitea-client.js";

const COMPANY = "company-1";
const AGENT = "agent-1";
const SECRET = "resolved:hook-secret";
const CONFIG = {
  baseUrl: "https://git.example.test",
  tokenRef: "gitea-token",
  webhookSecretRef: "hook-secret",
  companyId: COMPANY,
  reviewAgentId: AGENT,
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

function fakeGitea() {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname.replace("/api/v1", "") + parsed.search;
    calls.push({
      method: init?.method ?? "GET",
      path,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (path === "/user") return Response.json({ login: "paperclip-bot" });
    if (path.startsWith("/user/repos")) return Response.json([{ full_name: "acme/api", private: true, html_url: "https://git.example.test/acme/api", default_branch: "main" }]);
    if (path.endsWith(".diff")) return new Response("diff --git a/x b/x\n");
    if (/\/pulls\/\d+$/.test(path)) {
      return Response.json({ number: 7, title: "Add cache", body: "", state: "open", html_url: "https://git.example.test/acme/api/pulls/7", user: { login: "dana" }, head: { ref: "cache", sha: "a".repeat(40) }, base: { ref: "main" } });
    }
    if (/\/issues\/\d+\/comments$/.test(path)) return Response.json({ id: 501, html_url: "https://git.example.test/acme/api/pulls/7#issuecomment-501" });
    if (/\/issues\/comments\/\d+$/.test(path)) return Response.json({ id: 501 });
    if (path.includes("/statuses/")) return Response.json({ id: 1 });
    return new Response("not found", { status: 404 });
  });
  return calls;
}

function pullRequestDelivery(overrides: { action?: string; sha?: string; sender?: string; secret?: string; event?: string } = {}) {
  const sha = overrides.sha ?? "a".repeat(40);
  const body = {
    action: overrides.action ?? "opened",
    number: 7,
    pull_request: {
      title: "Add cache",
      body: "Speeds up reads.",
      html_url: "https://git.example.test/acme/api/pulls/7",
      user: { login: "dana" },
      head: { ref: "cache", sha },
      base: { ref: "main" },
    },
    repository: { name: "api", full_name: "acme/api", owner: { login: "acme" } },
    sender: { login: overrides.sender ?? "dana" },
  };
  const rawBody = JSON.stringify(body);
  return {
    endpointKey: "events",
    headers: {
      "X-Gitea-Event": overrides.event ?? "pull_request",
      "X-Gitea-Signature": createHmac("sha256", overrides.secret ?? SECRET).update(rawBody).digest("hex"),
    },
    rawBody,
    parsedBody: body,
    requestId: "req-1",
  };
}

/** `testCanUpdateIssues` lets a test move a task through its statuses; the plugin itself never does. */
async function setup(config: Record<string, unknown> = CONFIG, testCanUpdateIssues = false) {
  const harness = createTestHarness({
    manifest,
    config,
    ...(testCanUpdateIssues ? { capabilities: [...manifest.capabilities, "issues.update" as const] } : {}),
  });
  harness.seed({ agents: [{ id: AGENT, companyId: COMPANY, name: "Reviewer", status: "idle" } as Agent] });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

describe("Gitea plugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("turns a new pull request into a review task with a status and a comment", async () => {
    const calls = fakeGitea();
    const harness = await setup();

    await plugin.definition.onWebhook!(pullRequestDelivery());

    const issues = await harness.ctx.issues.list({ companyId: COMPANY });
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Review acme/api#7: Add cache");
    expect(issues[0].assigneeAgentId).toBe(AGENT);
    expect(issues[0].description).toContain("https://git.example.test/acme/api/pulls/7");
    const status = calls.find((call) => call.path.includes("/statuses/"));
    expect(status?.path).toBe(`/repos/acme/api/statuses/${"a".repeat(40)}`);
    expect(status?.body).toMatchObject({ state: "pending", context: "Paperclip Review" });
    expect(status?.authorization).toBe("token resolved:gitea-token");
    expect(calls.find((call) => call.path === "/repos/acme/api/issues/7/comments")?.body?.body).toContain("in progress");
  });

  it("reuses the task and the comment when new commits are pushed", async () => {
    const calls = fakeGitea();
    const harness = await setup();

    await plugin.definition.onWebhook!(pullRequestDelivery());
    await plugin.definition.onWebhook!(pullRequestDelivery({ action: "synchronized", sha: "b".repeat(40) }));
    await plugin.definition.onWebhook!(pullRequestDelivery({ action: "synchronized", sha: "b".repeat(40) }));

    expect(await harness.ctx.issues.list({ companyId: COMPANY })).toHaveLength(1);
    expect(calls.filter((call) => call.path === "/repos/acme/api/issues/7/comments")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "PATCH" && call.path === "/repos/acme/api/issues/comments/501")).toHaveLength(1);
    expect(calls.filter((call) => call.path === `/repos/acme/api/statuses/${"b".repeat(40)}`)).toHaveLength(1);
  });

  it("reports the result in Gitea when the review task is done", async () => {
    const calls = fakeGitea();
    const harness = await setup(CONFIG, true);
    await plugin.definition.onWebhook!(pullRequestDelivery());
    const [issue] = await harness.ctx.issues.list({ companyId: COMPANY });
    calls.length = 0;

    await harness.ctx.issues.update(issue.id, { status: "in_progress" }, COMPANY);
    await harness.emit("issue.updated", {}, { entityId: issue.id, entityType: "issue", companyId: COMPANY });
    expect(calls).toHaveLength(0);

    await harness.ctx.issues.update(issue.id, { status: "done" }, COMPANY);
    await harness.emit("issue.updated", {}, { entityId: issue.id, entityType: "issue", companyId: COMPANY });

    expect(calls.find((call) => call.path.includes("/statuses/"))?.body).toMatchObject({ state: "success", context: "Paperclip Review" });
    expect(calls.find((call) => call.method === "PATCH")?.body?.body).toContain("finished");

    calls.length = 0;
    await harness.emit("issue.updated", {}, { entityId: issue.id, entityType: "issue", companyId: COMPANY });
    expect(calls).toHaveLength(0);
  });

  it("rejects a delivery with a wrong signature", async () => {
    const calls = fakeGitea();
    const harness = await setup();

    await expect(plugin.definition.onWebhook!(pullRequestDelivery({ secret: "someone-else" }))).rejects.toThrow(/signature/);

    expect(await harness.ctx.issues.list({ companyId: COMPANY })).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("ignores the bot's own pull request events and other event types", async () => {
    fakeGitea();
    const harness = await setup();

    await plugin.definition.onWebhook!(pullRequestDelivery({ sender: "paperclip-bot" }));
    await plugin.definition.onWebhook!(pullRequestDelivery({ event: "push" }));
    await plugin.definition.onWebhook!(pullRequestDelivery({ action: "closed" }));

    expect(await harness.ctx.issues.list({ companyId: COMPANY })).toHaveLength(0);
  });

  it("refuses review webhooks until the review bot is configured", async () => {
    fakeGitea();
    await setup({ baseUrl: CONFIG.baseUrl, tokenRef: CONFIG.tokenRef });

    await expect(plugin.definition.onWebhook!(pullRequestDelivery())).rejects.toThrow(/review bot is not configured/);
    expect(await plugin.definition.onValidateConfig!({ baseUrl: CONFIG.baseUrl, tokenRef: CONFIG.tokenRef })).toMatchObject({ ok: true, warnings: [expect.stringContaining("reviewAgentId")] });
  });

  it("gives agents the Gitea tools", async () => {
    const calls = fakeGitea();
    const harness = await setup({ baseUrl: CONFIG.baseUrl, tokenRef: CONFIG.tokenRef });

    const repos = await harness.executeTool("list_repositories", {});
    expect(repos.data).toEqual([{ fullName: "acme/api", private: true, url: "https://git.example.test/acme/api", defaultBranch: "main" }]);

    const pr = await harness.executeTool("get_pull_request", { owner: "acme", repo: "api", index: 7, includeDiff: true });
    expect(pr.data).toMatchObject({ number: 7, title: "Add cache", diff: "diff --git a/x b/x\n" });

    const comment = await harness.executeTool("comment_on_pull_request", { owner: "acme", repo: "api", index: 7, body: "Looks good." });
    expect(comment.data).toMatchObject({ commentId: 501 });
    expect(calls.find((call) => call.path === "/repos/acme/api/issues/7/comments")?.body).toEqual({ body: "Looks good." });

    await harness.executeTool("set_commit_status", { owner: "acme", repo: "api", sha: "c".repeat(40), state: "failure", description: "Two problems" });
    expect(calls.find((call) => call.path.includes("/statuses/"))?.body).toEqual({ state: "failure", context: "Paperclip Review", description: "Two problems" });

    expect((await harness.executeTool("get_pull_request", { owner: "acme", repo: "api" })).error).toMatch(/index/);
    expect((await harness.executeTool("set_commit_status", { owner: "acme", repo: "api", sha: "c", state: "green" })).error).toMatch(/state/);
  });

  it("validates configuration and signatures", () => {
    expect(readConfig(CONFIG).errors).toEqual([]);
    expect(readConfig({ tokenRef: "t" }).errors).toContain("baseUrl is required");
    expect(readConfig({ baseUrl: "git.example.test", tokenRef: "t" }).errors).toContain("baseUrl must be a URL");
    const signature = createHmac("sha256", "s").update("body").digest("hex");
    expect(verifyGiteaSignature("body", signature, "s")).toBe(true);
    expect(verifyGiteaSignature("body!", signature, "s")).toBe(false);
    expect(verifyGiteaSignature("body", "", "s")).toBe(false);
  });
});
