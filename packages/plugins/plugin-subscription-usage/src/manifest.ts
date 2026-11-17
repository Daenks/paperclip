import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { USAGE_SKILL_MARKDOWN } from "./skill.js";
import {
  DEFAULT_CRITICAL_REMAINING_PERCENT,
  DEFAULT_WARN_REMAINING_PERCENT,
  POLL_JOB_KEY,
  USAGE_SKILL_KEY,
  USAGE_TOOL_NAME,
} from "./usage.js";

export const PLUGIN_ID = "paperclipai.plugin-subscription-usage";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Subscription Usage",
  description: "Lets agents see how much of the company's shared AI subscription quota is left, so they can pace their work.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: [
    "costs.read",
    "companies.read",
    "agents.read",
    "agents.invoke",
    "agent.tools.register",
    "jobs.schedule",
    "plugin.state.read",
    "plugin.state.write",
    "skills.managed",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      warnRemainingPercent: {
        type: "number",
        title: "Warn when a window has this percent left or less",
        minimum: 0,
        maximum: 100,
        default: DEFAULT_WARN_REMAINING_PERCENT,
      },
      criticalRemainingPercent: {
        type: "number",
        title: "Critical when a window has this percent left or less",
        minimum: 0,
        maximum: 100,
        default: DEFAULT_CRITICAL_REMAINING_PERCENT,
      },
      alertAgentId: {
        type: "string",
        title: "Agent to wake when a window reaches warn or critical (agent ID, optional)",
        default: "",
      },
    },
  },
  jobs: [
    {
      jobKey: POLL_JOB_KEY,
      displayName: "Check subscription usage",
      description: "Reads the shared subscription quota windows, stores the latest status and wakes the alert agent when a window gets low.",
      schedule: "*/10 * * * *",
    },
  ],
  skills: [
    {
      skillKey: USAGE_SKILL_KEY,
      displayName: "Subscription Usage Pacing",
      slug: USAGE_SKILL_KEY,
      description: "Check the company's shared AI subscription quota and pace work to it.",
      markdown: USAGE_SKILL_MARKDOWN,
    },
  ],
  tools: [
    {
      name: USAGE_TOOL_NAME,
      displayName: "Subscription Usage",
      description: "Report how much of the company's shared AI subscription quota is left: a level (ok, warn, critical, unknown) and, per account window, percent left, reset time and pace. Takes no parameters.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
};

export default manifest;
