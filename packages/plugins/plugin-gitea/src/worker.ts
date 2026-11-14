import {
  definePlugin,
  type PluginContext,
  type PluginEvent,
  type PluginWebhookInput,
  type ToolResult,
} from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, REVIEW_STATUS_CONTEXT, TOOL_DECLARATIONS, TOOLS, WEBHOOK_EVENTS } from "./manifest.js";
import { createGiteaClient, verifyGiteaSignature, type CommitState, type GiteaClient } from "./gitea-client.js";

export interface GiteaPluginConfig {
  baseUrl: string;
  tokenRef: string;
  webhookSecretRef?: string;
  companyId?: string;
  reviewAgentId?: string;
  reviewProjectId?: string;
}

/** What the plugin remembers about one reviewed pull request. */
interface ReviewRecord {
  owner: string;
  repo: string;
  index: number;
  issueId: string;
  commentId: number;
  headSha: string;
  title: string;
}

interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    title: string;
    body: string;
    html_url: string;
    user: { login: string };
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  repository: { name: string; full_name: string; owner: { login: string } };
  sender: { login: string };
}

const REVIEWED_ACTIONS = new Set(["opened", "reopened", "synchronized"]);
const ORIGIN_KIND = `plugin:${PLUGIN_ID}:review` as const;

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

export function readConfig(raw: Record<string, unknown>): { config?: GiteaPluginConfig; errors: string[] } {
  const errors: string[] = [];
  const baseUrl = text(raw.baseUrl);
  if (!baseUrl) errors.push("baseUrl is required");
  else {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") errors.push("baseUrl must be an http or https URL");
    } catch {
      errors.push("baseUrl must be a URL");
    }
  }
  if (!text(raw.tokenRef)) errors.push("tokenRef is required");
  if (errors.length > 0) return { errors };
  return {
    config: {
      baseUrl: baseUrl!,
      tokenRef: text(raw.tokenRef)!,
      webhookSecretRef: text(raw.webhookSecretRef),
      companyId: text(raw.companyId),
      reviewAgentId: text(raw.reviewAgentId),
      reviewProjectId: text(raw.reviewProjectId),
    },
    errors,
  };
}

/** The review bot needs these in addition to the connection settings. */
function reviewBotGaps(config: GiteaPluginConfig): string[] {
  const missing: string[] = [];
  if (!config.webhookSecretRef) missing.push("webhookSecretRef");
  if (!config.companyId) missing.push("companyId");
  if (!config.reviewAgentId) missing.push("reviewAgentId");
  return missing;
}

function header(headers: PluginWebhookInput["headers"], name: string): string {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const prStateKey = (fullName: string, index: number) => ({ scopeKind: "instance" as const, stateKey: `pr:${fullName}#${index}` });
const issueStateKey = (issueId: string) => ({ scopeKind: "instance" as const, stateKey: `issue:${issueId}` });

function summaryComment(state: "pending" | "done" | "cancelled", record: Pick<ReviewRecord, "headSha">): string {
  const commit = `\`${record.headSha.slice(0, 10)}\``;
  if (state === "pending") return `**Paperclip Review**\n\nA review of commit ${commit} is in progress.`;
  if (state === "done") return `**Paperclip Review**\n\nThe review of commit ${commit} is finished. See the review comments on this pull request.`;
  return `**Paperclip Review**\n\nThe review of commit ${commit} was cancelled.`;
}

let ctxRef: PluginContext | null = null;
let botLogin: string | null = null;

async function clientFor(ctx: PluginContext, config: GiteaPluginConfig): Promise<GiteaClient> {
  const token = await ctx.secrets.resolve(config.tokenRef, config.companyId ? { companyId: config.companyId } : undefined);
  return createGiteaClient({ baseUrl: config.baseUrl, token, fetch: (url, init) => ctx.http.fetch(url, init) });
}

async function configuredClient(ctx: PluginContext): Promise<{ config: GiteaPluginConfig; client: GiteaClient }> {
  const { config, errors } = readConfig(await ctx.config.get());
  if (!config) throw new Error(`The Gitea plugin is not configured: ${errors.join("; ")}`);
  return { config, client: await clientFor(ctx, config) };
}

async function handlePullRequest(ctx: PluginContext, config: GiteaPluginConfig, event: PullRequestEvent) {
  const client = await clientFor(ctx, config);
  if (!botLogin) botLogin = (await client.getCurrentUser()).login;
  // Never review the bot's own pull requests or react to its own pushes.
  if (event.sender.login === botLogin || event.pull_request.user.login === botLogin) return;

  const companyId = config.companyId!;
  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const pr = event.pull_request;
  const saved = (await ctx.state.get(prStateKey(event.repository.full_name, event.number))) as ReviewRecord | null | undefined;

  if (saved) {
    if (saved.headSha === pr.head.sha && event.action !== "reopened") return;
    const record: ReviewRecord = { ...saved, headSha: pr.head.sha, title: pr.title };
    await ctx.issues.createComment(
      saved.issueId,
      `New commits were pushed to ${event.repository.full_name}#${event.number}. The head commit is now \`${pr.head.sha}\`. Review the pull request again.`,
      companyId,
    );
    await client.setCommitStatus(owner, repo, pr.head.sha, {
      state: "pending",
      context: REVIEW_STATUS_CONTEXT,
      description: "Review in progress",
    });
    await client.editComment(owner, repo, saved.commentId, summaryComment("pending", record));
    await ctx.state.set(prStateKey(event.repository.full_name, event.number), record);
    return;
  }

  const issue = await ctx.issues.create({
    companyId,
    ...(config.reviewProjectId ? { projectId: config.reviewProjectId } : {}),
    title: `Review ${event.repository.full_name}#${event.number}: ${pr.title}`,
    description: [
      `Review this Gitea pull request and post your findings on it with the Gitea tools.`,
      ``,
      `- Pull request: ${pr.html_url}`,
      `- Repository: ${event.repository.full_name} (owner \`${owner}\`, repo \`${repo}\`, number ${event.number})`,
      `- Branch: \`${pr.head.ref}\` into \`${pr.base.ref}\``,
      `- Head commit: \`${pr.head.sha}\``,
      `- Author: ${pr.user.login}`,
      ``,
      `Use \`get_pull_request\` with \`includeDiff\` to read the change and \`comment_on_pull_request\` to post the review. Mark this task done when the review is posted.`,
      ...(pr.body ? [``, `Description from the author:`, ``, pr.body] : []),
    ].join("\n"),
    assigneeAgentId: config.reviewAgentId,
    originKind: ORIGIN_KIND,
    originId: `${event.repository.full_name}#${event.number}`,
  });
  await client.setCommitStatus(owner, repo, pr.head.sha, {
    state: "pending",
    context: REVIEW_STATUS_CONTEXT,
    description: "Review in progress",
  });
  const comment = await client.createComment(owner, repo, event.number, summaryComment("pending", { headSha: pr.head.sha }));
  const record: ReviewRecord = {
    owner,
    repo,
    index: event.number,
    issueId: issue.id,
    commentId: comment.id,
    headSha: pr.head.sha,
    title: pr.title,
  };
  await ctx.state.set(prStateKey(event.repository.full_name, event.number), record);
  await ctx.state.set(issueStateKey(issue.id), `${event.repository.full_name}#${event.number}`);
}

/** When a review task finishes, report the result on the pull request. */
async function handleIssueUpdated(ctx: PluginContext, event: PluginEvent) {
  if (!event.entityId) return;
  const prKey = await ctx.state.get(issueStateKey(event.entityId));
  if (typeof prKey !== "string") return;
  const issue = await ctx.issues.get(event.entityId, event.companyId);
  if (!issue || (issue.status !== "done" && issue.status !== "cancelled")) return;
  const split = prKey.lastIndexOf("#");
  const record = (await ctx.state.get(prStateKey(prKey.slice(0, split), Number(prKey.slice(split + 1))))) as ReviewRecord | null | undefined;
  if (!record) return;

  const { client } = await configuredClient(ctx);
  const finished = issue.status === "done";
  await client.setCommitStatus(record.owner, record.repo, record.headSha, {
    state: finished ? "success" : "error",
    context: REVIEW_STATUS_CONTEXT,
    description: finished ? "Review finished" : "Review cancelled",
  });
  await client.editComment(record.owner, record.repo, record.commentId, summaryComment(finished ? "done" : "cancelled", record));
  await ctx.state.delete(issueStateKey(event.entityId));
  await ctx.state.delete(prStateKey(prKey.slice(0, split), record.index));
}

type ToolInput = Record<string, unknown>;
const need = (input: ToolInput, key: string): string => {
  const value = text(input[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
};
const needNumber = (input: ToolInput, key: string): number => {
  const value = Number(input[key]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive whole number`);
  return value;
};

const toolHandlers: Record<string, (client: GiteaClient, input: ToolInput) => Promise<ToolResult>> = {
  async [TOOLS.listRepositories](client, input) {
    const repos = await client.listRepositories(typeof input.limit === "number" ? input.limit : undefined);
    return { content: `${repos.length} repositories.`, data: repos.map(({ full_name, private: isPrivate, html_url, default_branch }) => ({ fullName: full_name, private: isPrivate, url: html_url, defaultBranch: default_branch })) };
  },
  async [TOOLS.listPullRequests](client, input) {
    const state = input.state === "closed" || input.state === "all" ? input.state : "open";
    const pulls = await client.listPullRequests(need(input, "owner"), need(input, "repo"), state);
    return { content: `${pulls.length} pull requests.`, data: pulls.map((pr) => ({ number: pr.number, title: pr.title, state: pr.state, author: pr.user.login, url: pr.html_url, head: pr.head.ref, base: pr.base.ref })) };
  },
  async [TOOLS.getPullRequest](client, input) {
    const owner = need(input, "owner");
    const repo = need(input, "repo");
    const index = needNumber(input, "index");
    const pr = await client.getPullRequest(owner, repo, index);
    const diff = input.includeDiff === true ? await client.getPullRequestDiff(owner, repo, index) : undefined;
    return {
      content: `${owner}/${repo}#${pr.number}: ${pr.title}`,
      data: { number: pr.number, title: pr.title, body: pr.body, state: pr.state, author: pr.user.login, url: pr.html_url, head: pr.head, base: pr.base.ref, ...(diff === undefined ? {} : { diff }) },
    };
  },
  async [TOOLS.commentOnPullRequest](client, input) {
    const comment = await client.createComment(need(input, "owner"), need(input, "repo"), needNumber(input, "index"), need(input, "body"));
    return { content: "Comment posted.", data: { commentId: comment.id, url: comment.html_url } };
  },
  async [TOOLS.setCommitStatus](client, input) {
    const state = need(input, "state");
    if (!["pending", "success", "failure", "error"].includes(state)) throw new Error("state must be pending, success, failure or error");
    await client.setCommitStatus(need(input, "owner"), need(input, "repo"), need(input, "sha"), {
      state: state as CommitState,
      context: text(input.context) ?? REVIEW_STATUS_CONTEXT,
      description: text(input.description),
    });
    return { content: `Commit status set to ${state}.` };
  },
};

const plugin = definePlugin({
  async setup(ctx) {
    ctxRef = ctx;
    botLogin = null;

    for (const declaration of TOOL_DECLARATIONS) {
      ctx.tools.register(declaration.name, declaration, async (params) => {
        try {
          const { client } = await configuredClient(ctx);
          return await toolHandlers[declaration.name](client, (params ?? {}) as ToolInput);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      });
    }

    ctx.events.on("issue.updated", async (event) => {
      await handleIssueUpdated(ctx, event);
    });
  },

  async onValidateConfig(raw) {
    const { config, errors } = readConfig(raw);
    const missing = config ? reviewBotGaps(config) : [];
    return {
      ok: errors.length === 0,
      errors,
      warnings: missing.length > 0 ? [`The review bot is off until these are set: ${missing.join(", ")}`] : [],
    };
  },

  async onHealth() {
    return { status: "ok" };
  },

  async onIdleDrain() {
    // The worker keeps no timers or sockets, and webhook work finishes inside the delivery.
    return "none";
  },

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== WEBHOOK_EVENTS) throw new Error(`Unknown webhook endpoint "${input.endpointKey}"`);
    const ctx = ctxRef;
    if (!ctx) throw new Error("The plugin is not set up");
    const { config, errors } = readConfig(await ctx.config.get());
    if (!config) throw new Error(`The Gitea plugin is not configured: ${errors.join("; ")}`);
    const missing = reviewBotGaps(config);
    if (missing.length > 0) throw new Error(`The review bot is not configured. Missing: ${missing.join(", ")}`);

    const secret = await ctx.secrets.resolve(config.webhookSecretRef!, { companyId: config.companyId });
    if (!verifyGiteaSignature(input.rawBody, header(input.headers, "x-gitea-signature"), secret)) {
      throw new Error("The Gitea webhook signature does not match");
    }
    if (header(input.headers, "x-gitea-event") !== "pull_request") return;

    const event = (input.parsedBody ?? JSON.parse(input.rawBody)) as PullRequestEvent;
    if (!event?.pull_request || !event.repository || !REVIEWED_ACTIONS.has(event.action)) return;
    await handlePullRequest(ctx, config, event);
  },
});

export default plugin;
