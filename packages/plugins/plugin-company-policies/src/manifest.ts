import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclipai.plugin-company-policies";
export const SETTINGS_PAGE_SLOT_ID = "company-policies-settings";
export const SETTINGS_PAGE_ROUTE_PATH = "policies";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Company Policies",
  description: "Company-wide policies written by the board and added to every agent run in the company.",
  author: "Paperclip",
  categories: ["automation", "ui"],
  capabilities: [
    "agent.run.context.contribute",
    "plugin.state.read",
    "plugin.state.write",
    "instance.settings.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "companySettingsPage",
        id: SETTINGS_PAGE_SLOT_ID,
        displayName: "Company policies",
        exportName: "CompanyPoliciesSettingsPage",
        routePath: SETTINGS_PAGE_ROUTE_PATH,
      },
    ],
  },
};

export default manifest;
