import { describe, expect, it } from "vitest";
import { PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest, { PLUGIN_ID, SETTINGS_PAGE_ROUTE_PATH } from "../src/manifest.js";
import {
  POLICY_ACTIVITY_ENTITY_TYPE,
  POLICY_ACTIVITY_TYPE,
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
      "activity.log.write",
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
      companyId: COMPANY_ID,
      maxCharacters: PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS,
    });
  });

  it("saves and loads a policy in company-scoped state", async () => {
    const harness = await setup();
    const saved = await save(harness, COMPANY_ID, { markdown: "Be kind." });
    expect(saved).toMatchObject({ markdown: "Be kind.", enabled: true, updatedBy: "user-1", revision: 1, companyId: COMPANY_ID });
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

  // The harness, like the host bridge, replaces params.companyId with the authorized company,
  // so this shows the end-to-end behavior rather than which value the worker reads.
  it("saves to the company the host authorized when the params name another company", async () => {
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

  it("serializes concurrent saves for a company so one is refused as stale instead of lost", async () => {
    const harness = await setup();
    // Slow writes: without serialization both saves read revision 0 before either write lands.
    const realSet = harness.ctx.state.set.bind(harness.ctx.state);
    harness.ctx.state.set = async (input, value) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return realSet(input, value);
    };
    const results = await Promise.allSettled([
      save(harness, COMPANY_ID, { markdown: "Edit A." }),
      save(harness, COMPANY_ID, { markdown: "Edit B." }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.reason)).toContain("Someone else saved these policies");
    const winner = (fulfilled[0] as PromiseFulfilledResult<CompanyPolicyView>).value;
    expect(winner.revision).toBe(1);
    await expect(load(harness, COMPANY_ID)).resolves.toMatchObject({ markdown: winner.markdown, revision: 1 });
  });

  it("does not hold one company's save behind another company's", async () => {
    const harness = await setup();
    const [a, b] = await Promise.all([
      save(harness, COMPANY_ID, { markdown: "A." }),
      save(harness, OTHER_COMPANY_ID, { markdown: "B." }),
    ]);
    expect(a).toMatchObject({ companyId: COMPANY_ID, revision: 1 });
    expect(b).toMatchObject({ companyId: OTHER_COMPANY_ID, revision: 1 });
  });

  it("records each save in the company's activity log without the policy text", async () => {
    const harness = await setup();
    await save(harness, COMPANY_ID, { markdown: "  Secret-ish internal rule.  ", enabled: false });
    expect(harness.activity).toEqual([
      {
        companyId: COMPANY_ID,
        message: "Updated company policies",
        entityType: POLICY_ACTIVITY_ENTITY_TYPE,
        entityId: COMPANY_ID,
        metadata: {
          type: POLICY_ACTIVITY_TYPE,
          revision: 1,
          enabled: false,
          characterCount: "Secret-ish internal rule.".length,
          userId: "user-1",
        },
      },
    ]);
    expect(JSON.stringify(harness.activity)).not.toContain("Secret-ish");
  });

  it("records no activity for a refused save", async () => {
    const harness = await setup();
    await expect(save(harness, COMPANY_ID, { markdown: "x" }, { type: "agent", agentId: "agent-1" })).rejects.toThrow();
    await expect(save(harness, COMPANY_ID, { markdown: "x".repeat(PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS + 1) })).rejects.toThrow();
    await expect(save(harness, COMPANY_ID, { markdown: "x", baseRevision: 5 })).rejects.toThrow();
    expect(harness.activity).toEqual([]);
  });

  it("keeps a save when the activity entry cannot be written", async () => {
    const harness = await setup();
    harness.ctx.activity.log = async () => {
      throw new Error("activity store down");
    };
    await expect(save(harness, COMPANY_ID, { markdown: "Kept." })).resolves.toMatchObject({ revision: 1 });
    await expect(load(harness, COMPANY_ID)).resolves.toMatchObject({ markdown: "Kept.", revision: 1 });
    expect(harness.logs).toContainEqual(expect.objectContaining({
      level: "warn",
      message: "Company policies were saved but the activity entry could not be written",
    }));
  });

  it("reports no background work to the idle-sleep handshake", async () => {
    await expect(plugin.definition.onIdleDrain!(new AbortController().signal)).resolves.toBe("none");
  });
});
