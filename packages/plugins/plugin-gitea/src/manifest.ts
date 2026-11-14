import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "community.gitea";
export const WEBHOOK_EVENTS = "events";
export const REVIEW_STATUS_CONTEXT = "Paperclip Review";

export const TOOLS = {
  listRepositories: "list_repositories",
  listPullRequests: "list_pull_requests",
  getPullRequest: "get_pull_request",
  commentOnPullRequest: "comment_on_pull_request",
  setCommitStatus: "set_commit_status",
} as const;

const repo = {
  owner: { type: "string", description: "Repository owner (user or organization)" },
  repo: { type: "string", description: "Repository name" },
} as const;

export const TOOL_DECLARATIONS = [
  {
    name: TOOLS.listRepositories,
    displayName: "List Gitea repositories",
    description: "Lists the repositories the Gitea account can access.",
    parametersSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Most repositories to return (default 50)" } },
    },
  },
  {
    name: TOOLS.listPullRequests,
    displayName: "List Gitea pull requests",
    description: "Lists the pull requests of a repository.",
    parametersSchema: {
      type: "object",
      properties: { ...repo, state: { type: "string", enum: ["open", "closed", "all"] } },
      required: ["owner", "repo"],
    },
  },
  {
    name: TOOLS.getPullRequest,
    displayName: "Get a Gitea pull request",
    description: "Returns one pull request. Set includeDiff to also get its diff.",
    parametersSchema: {
      type: "object",
      properties: { ...repo, index: { type: "number", description: "Pull request number" }, includeDiff: { type: "boolean" } },
      required: ["owner", "repo", "index"],
    },
  },
  {
    name: TOOLS.commentOnPullRequest,
    displayName: "Comment on a Gitea pull request",
    description: "Adds a comment to a pull request.",
    parametersSchema: {
      type: "object",
      properties: { ...repo, index: { type: "number", description: "Pull request number" }, body: { type: "string" } },
      required: ["owner", "repo", "index", "body"],
    },
  },
  {
    name: TOOLS.setCommitStatus,
    displayName: "Set a Gitea commit status",
    description: "Sets a commit status, for example the result of a review.",
    parametersSchema: {
      type: "object",
      properties: {
        ...repo,
        sha: { type: "string", description: "Commit SHA" },
        state: { type: "string", enum: ["pending", "success", "failure", "error"] },
        description: { type: "string" },
        context: { type: "string", description: `Status name (default "${REVIEW_STATUS_CONTEXT}")` },
      },
      required: ["owner", "repo", "sha", "state"],
    },
  },
] satisfies NonNullable<PaperclipPluginManifestV1["tools"]>;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Gitea",
  description:
    "Gitea tools for agents and a pull request review bot. A new pull request becomes a review task for an agent, with a commit status and a summary comment in Gitea.",
  author: "Daenks",
  categories: ["connector"],
  capabilities: [
    "issues.read",
    "issues.create",
    "issue.comments.create",
    "events.subscribe",
    "agent.tools.register",
    "plugin.state.read",
    "plugin.state.write",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      baseUrl: {
        type: "string",
        title: "Gitea URL",
        description: "Base URL of the Gitea server, for example https://git.example.com",
      },
      tokenRef: {
        type: "string",
        title: "Access token (secret reference)",
        description: "Secret reference for a Gitea access token with repository and issue write access.",
      },
      webhookSecretRef: {
        type: "string",
        title: "Webhook secret (secret reference)",
        description: "Secret reference for the secret set on the Gitea webhook. Needed for the review bot.",
      },
      companyId: {
        type: "string",
        title: "Company ID",
        description: "The Paperclip company that receives review tasks. Needed for the review bot.",
      },
      reviewAgentId: {
        type: "string",
        title: "Review agent ID",
        description: "The agent that reviews pull requests. Needed for the review bot.",
      },
      reviewProjectId: {
        type: "string",
        title: "Review project ID",
        description: "Optional project for the review tasks.",
      },
    },
    required: ["baseUrl", "tokenRef"],
  },
  webhooks: [
    {
      endpointKey: WEBHOOK_EVENTS,
      displayName: "Gitea webhook",
      description: "Target for a Gitea repository or organization webhook that sends pull request events.",
    },
  ],
  tools: TOOL_DECLARATIONS,
};

export default manifest;
