import { describe, expect, it } from "vitest";
import { PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest, { PLUGIN_ID, SETTINGS_PAGE_ROUTE_PATH } from "../src/manifest.js";
import {
  POLICY_DATA_KEY,
  POLICY_SECTION_TITLE,
  POLICY_STATE_KEY,
  SAVE_POLICY_ACTION_KEY,
  type CompanyPolicyView,
} from "../src/policy.js";
import plugin from "../src/worker.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_ID = "99999999-9999-4999-8999-999999999999";
const BOARD_USER = { type: "user" as const, userId: "user-1" };

async function setup() {
  const harness = createTestHarness({ manifest });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

type Harness = Awaited<ReturnType<typeof setup>>;

function save(
  harness: Harness,
  companyId: string,
  params: Record<string, unknown>,
  actor: Record<string, unknown> = BOARD_USER,
) {
  return harness.performAction<CompanyPolicyView>(
    SAVE_POLICY_ACTION_KEY,
    { enabled: true, baseRevision: 0, ...params },
    { companyId, actor: { ...actor, companyId } },
  );
}

function load(harness: Harness, companyId: string) {
  return harness.getData<CompanyPolicyView>(POLICY_DATA_KEY, { companyId });
}

describe("company policies plugin", () => {
  it("declares a valid manifest with only the capabilities it uses", () => {
    expect(pluginManifestV1Schema.parse(manifest)).toMatchObject({ id: PLUGIN_ID, displayName: "Company Policies" });
    expect([...manifest.capabilities].sort()).toEqual([
      "agent.run.context.contribute",
      "instance.settings.register",
      "plugin.state.read",
      "plugin.state.write",
    ]);
    expect(manifest.ui?.slots).toEqual([
      expect.objectContaining({
        type: "companySettingsPage",
        routePath: SETTINGS_PAGE_ROUTE_PATH,
        exportName: "CompanyPoliciesSettingsPage",
      }),
    ]);
    expect(manifest.tools).toBeUndefined();
    expect(manifest.apiRoutes).toBeUndefined();
  });

  it("starts with an empty, enabled policy and the host's limit", async () => {
    const harness = await setup();
    await expect(load(harness, COMPANY_ID)).resolves.toEqual({
      markdown: "",
      enabled: true,
      updatedAt: null,
      updatedBy: null,
      revision: 0,
      maxCharacters: PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS,
    });
  });

  it("saves and loads a policy in company-scoped state", async () => {
    const harness = await setup();
    const saved = await save(harness, COMPANY_ID, { markdown: "Be kind." });
    expect(saved).toMatchObject({ markdown: "Be kind.", enabled: true, updatedBy: "user-1", revision: 1 });
    expect(Date.parse(saved.updatedAt!)).not.toBeNaN();
    await expect(load(harness, COMPANY_ID)).resolves.toEqual(saved);
    expect(harness.getState({ scopeKind: "company", scopeId: COMPANY_ID, stateKey: POLICY_STATE_KEY }))
      .toMatchObject({ markdown: "Be kind.", revision: 1 });
  });

  it("keeps each company's policy separate", async () => {
    const harness = await setup();
    await save(harness, COMPANY_ID, { markdown: "Company A rules." });
    await expect(load(harness, OTHER_COMPANY_ID)).resolves.toMatchObject({ markdown: "", revision: 0 });
    await expect(harness.contributeRunContext(plugin, { companyId: OTHER_COMPANY_ID })).resolves.toEqual({ sections: [] });

    await save(harness, OTHER_COMPANY_ID, { markdown: "Company B rules." });
    await expect(load(harness, COMPANY_ID)).resolves.toMatchObject({ markdown: "Company A rules.", revision: 1 });
    await expect(harness.contributeRunContext(plugin, { companyId: COMPANY_ID })).resolves.toEqual({
      sections: [{ title: POLICY_SECTION_TITLE, markdown: "Company A rules." }],
    });
  });

  it("writes to the host-authorized company, not a company named in the params", async () => {
    const harness = await setup();
    await harness.performAction(
      SAVE_POLICY_ACTION_KEY,
      { markdown: "Spoofed.", enabled: true, baseRevision: 0, companyId: OTHER_COMPANY_ID },
      { companyId: COMPANY_ID, actor: { ...BOARD_USER, companyId: COMPANY_ID } },
    );
    await expect(load(harness, COMPANY_ID)).resolves.toMatchObject({ markdown: "Spoofed." });
    await expect(load(harness, OTHER_COMPANY_ID)).resolves.toMatchObject({ markdown: "" });
  });

  it("refuses a save from an agent or a system actor", async () => {
    const harness = await setup();
    await expect(save(harness, COMPANY_ID, { markdown: "Agent edit." }, { type: "agent", agentId: "agent-1" }))
      .rejects.toThrow("Only a board user can change company policies.");
    await expect(save(harness, COMPANY_ID, { markdown: "System edit." }, { type: "system" }))
      .rejects.toThrow("Only a board user can change company policies.");
    await expect(load(harness, COMPANY_ID)).resolves.toMatchObject({ markdown: "", revision: 0 });
  });

  it("refuses a save without a host-authorized company", async () => {
    const harness = await setup();
    await expect(harness.performAction(
      SAVE_POLICY_ACTION_KEY,
      { markdown: "No company.", enabled: true, baseRevision: 0 },
      { actor: BOARD_USER },
    )).rejects.toThrow("A company is required.");
  });

  it("refuses a save over the host's limit and keeps the stored policy", async () => {
    const harness = await setup();
    await save(harness, COMPANY_ID, { markdown: "Short." });
    const atLimit = "x".repeat(PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS);
    await expect(save(harness, COMPANY_ID, { markdown: `${atLimit}y`, baseRevision: 1 }))
      .rejects.toThrow("the limit is 20,000");
    await expect(load(harness, COMPANY_ID)).resolves.toMatchObject({ markdown: "Short.", revision: 1 });

    // Surrounding whitespace is not delivered, so it does not count.
    await save(harness, COMPANY_ID, { markdown: `\n${atLimit}\n\n`, baseRevision: 1 });
    await expect(harness.contributeRunContext(plugin, { companyId: COMPANY_ID })).resolves.toEqual({
      sections: [{ title: POLICY_SECTION_TITLE, markdown: atLimit }],
    });
  });

  it("refuses a save based on an older revision", async () => {
    const harness = await setup();
    await save(harness, COMPANY_ID, { markdown: "First." });
    await expect(save(harness, COMPANY_ID, { markdown: "Stale edit.", baseRevision: 0 }))
      .rejects.toThrow("Someone else saved these policies");
    await expect(save(harness, COMPANY_ID, { markdown: "Second.", baseRevision: 1 }))
      .resolves.toMatchObject({ markdown: "Second.", revision: 2 });
  });

  it("refuses malformed save params", async () => {
    const harness = await setup();
    await expect(save(harness, COMPANY_ID, { markdown: 42 })).rejects.toThrow("markdown must be a string.");
    await expect(save(harness, COMPANY_ID, { markdown: "x", enabled: "yes" })).rejects.toThrow("enabled must be true or false.");
    await expect(save(harness, COMPANY_ID, { markdown: "x", baseRevision: undefined })).rejects.toThrow("baseRevision");
  });

  it("contributes one 'Company policies' section when enabled and non-blank", async () => {
    const harness = await setup();
    await save(harness, COMPANY_ID, { markdown: "  ## Rules\n\n- Ask before deleting data.\n" });
    await expect(harness.contributeRunContext(plugin, { companyId: COMPANY_ID, agentId: "agent-1", issueId: "issue-1" }))
      .resolves.toEqual({ sections: [{ title: "Company policies", markdown: "## Rules\n\n- Ask before deleting data." }] });
  });

  it("contributes nothing when switched off, and again when switched back on", async () => {
    const harness = await setup();
    await save(harness, COMPANY_ID, { markdown: "Rules.", enabled: false });
    await expect(harness.contributeRunContext(plugin, { companyId: COMPANY_ID })).resolves.toEqual({ sections: [] });
    await expect(load(harness, COMPANY_ID)).resolves.toMatchObject({ markdown: "Rules.", enabled: false });

    await save(harness, COMPANY_ID, { markdown: "Rules.", enabled: true, baseRevision: 1 });
    await expect(harness.contributeRunContext(plugin, { companyId: COMPANY_ID }))
      .resolves.toEqual({ sections: [{ title: POLICY_SECTION_TITLE, markdown: "Rules." }] });
  });

  it("contributes nothing for an empty or blank policy", async () => {
    const harness = await setup();
    await expect(harness.contributeRunContext(plugin, { companyId: COMPANY_ID })).resolves.toEqual({ sections: [] });
    await save(harness, COMPANY_ID, { markdown: " \n\t\n" });
    await expect(harness.contributeRunContext(plugin, { companyId: COMPANY_ID })).resolves.toEqual({ sections: [] });
  });

  it("reports no background work to the idle-sleep handshake", async () => {
    await expect(plugin.definition.onIdleDrain!(new AbortController().signal)).resolves.toBe("none");
  });
});
