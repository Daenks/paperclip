import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "community.mattermost";
export const WEBHOOK_OUTGOING = "outgoing";
export const TOOL_POST_MESSAGE = "post_message";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Mattermost",
  description:
    "Talk to a Paperclip agent from Mattermost. A message with the trigger word starts or continues an agent session, and the answer is posted in the thread.",
  author: "Daenks",
  categories: ["connector"],
  capabilities: [
    "agents.read",
    "agent.sessions.create",
    "agent.sessions.send",
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
        title: "Mattermost URL",
        description: "Base URL of the Mattermost server, for example https://chat.example.com",
      },
      botTokenRef: {
        type: "string",
        title: "Bot token (secret reference)",
        description: "Secret reference for the access token of the Mattermost bot account.",
      },
      outgoingWebhookTokenRef: {
        type: "string",
        title: "Outgoing webhook token (secret reference)",
        description: "Secret reference for the token Mattermost sends with each outgoing webhook request.",
      },
      companyId: {
        type: "string",
        title: "Company ID",
        description: "The Paperclip company whose agent answers.",
      },
      agentId: {
        type: "string",
        title: "Agent ID",
        description: "The agent that answers messages from Mattermost.",
      },
    },
    required: ["baseUrl", "botTokenRef", "outgoingWebhookTokenRef", "companyId", "agentId"],
  },
  webhooks: [
    {
      endpointKey: WEBHOOK_OUTGOING,
      displayName: "Mattermost outgoing webhook",
      description:
        "Target for a Mattermost outgoing webhook. Each delivery carries one channel message that contains the trigger word.",
    },
  ],
  tools: [
    {
      name: TOOL_POST_MESSAGE,
      displayName: "Post to Mattermost",
      description: "Posts a message to a Mattermost channel as the bot. Pass rootId to reply in a thread.",
      parametersSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Mattermost channel ID" },
          message: { type: "string", description: "Message text (Markdown)" },
          rootId: { type: "string", description: "Post ID of the thread root, to reply in that thread" },
        },
        required: ["channelId", "message"],
      },
    },
  ],
};

export default manifest;
