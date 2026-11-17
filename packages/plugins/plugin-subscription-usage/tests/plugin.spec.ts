import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent, Company, ProviderQuotaResult, ToolResult } from "@paperclipai/plugin-sdk";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest, { PLUGIN_ID } from "../src/manifest.js";
import {
  ALERTS_STATE_KEY,
  POLL_JOB_KEY,
  SNAPSHOT_STATE_KEY,
  USAGE_SKILL_KEY,
  USAGE_TOOL_NAME,
  buildSnapshot,
  describeSnapshot,
  planAlerts,
  readThresholds,
  type UsageSnapshot,
} from "../src/usage.js";
import plugin from "../src/worker.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const HOUR = 3_600_000;
const THRESHOLDS = readThresholds({});

function account(windows: ProviderQuotaResult["windows"], overrides: Partial<ProviderQuotaResult> = {}): ProviderQuotaResult {
  return { provider: "openai", ok: true, accountLabel: "Team", capturedAt: new Date(NOW).toISOString(), windows, ...overrides };
}

function window(label: string, usedPercent: number | null, resetsInHours: number | null, valueLabel: string | null = null) {
  return { label, usedPercent, resetsAt: resetsInHours === null ? null : new Date(NOW + resetsInHours * HOUR).toISOString(), valueLabel };
}

async function setup(results: ProviderQuotaResult[], config: Record<string, unknown> = {}) {
  const harness = createTestHarness({ manifest });
  harness.seed({
    companies: [{ id: COMPANY_ID, name: "Acme" } as Company],
    agents: [{ id: AGENT_ID, companyId: COMPANY_ID, status: "idle" } as Agent],
    quotaWindows: [{ companyId: COMPANY_ID, results }],
  });
  harness.setConfig(config);
  await plugin.definition.setup(harness.ctx);
  return harness;
}

function storedSnapshot(harness: Awaited<ReturnType<typeof setup>>) {
  return harness.getState({ scopeKind: "company", scopeId: COMPANY_ID, stateKey: SNAPSHOT_STATE_KEY }) as UsageSnapshot | undefined;
}

describe("subscription usage levels", () => {
  it("rates each window by percent left and the account by its worst limit window", () => {
    const snapshot = buildSnapshot(COMPANY_ID, [account([
      window("5h limit", 40, 2),
      window("Weekly limit", 95, 72),
      window("Credits", null, null, "$4.20 remaining"),
    ])], THRESHOLDS, NOW);
    expect(snapshot.level).toBe("critical");
    expect(snapshot.accounts[0].windows.map((w) => [w.label, w.kind, w.remainingPercent, w.level])).toEqual([
      ["5h limit", "limit", 60, "ok"],
      ["Weekly limit", "limit", 5, "critical"],
      ["Credits", "credit", null, "unknown"],
    ]);
  });

  it("compares use with the share of the window that has passed", () => {
    const [fast, slow, steady] = buildSnapshot(COMPANY_ID, [account([
      window("5h limit", 80, 4),
      window("Weekly limit", 20, 24),
      window("Current session", 50, 2.5),
    ])], THRESHOLDS, NOW).accounts[0].windows;
    expect([fast.elapsedPercent, fast.pace]).toEqual([20, "over"]);
    expect([slow.elapsedPercent, slow.pace]).toEqual([85.7, "under"]);
    expect([steady.elapsedPercent, steady.pace]).toEqual([50, "on"]);
  });

  it("does not let a single-model window or paid extras set the level", () => {
    const snapshot = buildSnapshot(COMPANY_ID, [account([
      window("Current week (all models)", 30, 100),
      window("Current week (Sonnet only)", 100, 100),
      window("Extra usage", 99, null),
    ], { provider: "anthropic" })], THRESHOLDS, NOW);
    expect(snapshot.level).toBe("ok");
    expect(snapshot.accounts[0].windows.map((w) => w.kind)).toEqual(["limit", "model", "credit"]);
  });

  it("reports unknown when no account can be read", () => {
    const snapshot = buildSnapshot(COMPANY_ID, [
      { provider: "openai", ok: false, errorFamily: "credentials_unavailable", error: "private detail", windows: [] },
    ], THRESHOLDS, NOW);
    expect(snapshot.level).toBe("unknown");
    expect(snapshot.accounts[0]).toMatchObject({ ok: false, errorFamily: "credentials_unavailable", windows: [] });
    const text = describeSnapshot(snapshot, NOW);
    expect(text).toContain("not available (credentials_unavailable)");
    expect(text).not.toContain("private detail");
  });

  it("uses configured thresholds and never puts critical above warn", () => {
    expect(readThresholds({ warnRemainingPercent: 50, criticalRemainingPercent: 20 }))
      .toEqual({ warnRemainingPercent: 50, criticalRemainingPercent: 20 });
    expect(readThresholds({ warnRemainingPercent: 5, criticalRemainingPercent: 20 }))
      .toEqual({ warnRemainingPercent: 20, criticalRemainingPercent: 20 });
    expect(readThresholds({ warnRemainingPercent: "x", criticalRemainingPercent: 500 })).toEqual(THRESHOLDS);
  });
});

describe("subscription usage alerts", () => {
  const snapshotAt = (used: number, resetsInHours = 72) =>
    buildSnapshot(COMPANY_ID, [account([window("Weekly limit", used, resetsInHours)])], THRESHOLDS, NOW);

  it("alerts once per level, again when it gets worse, and again in a later window", () => {
    const first = planAlerts(snapshotAt(80), {});
    expect(first.alerts.map((a) => a.window.level)).toEqual(["warn"]);
    expect(planAlerts(snapshotAt(85), first.records).alerts).toEqual([]);
    const worse = planAlerts(snapshotAt(95), first.records);
    expect(worse.alerts.map((a) => a.window.level)).toEqual(["critical"]);
    expect(planAlerts(snapshotAt(96), worse.records).alerts).toEqual([]);
    expect(planAlerts(snapshotAt(96, 72 + 168), worse.records).alerts).toHaveLength(1);
  });

  it("forgets a window that is back at ok and keeps records while an account is unreadable", () => {
    const low = planAlerts(snapshotAt(95), {});
    expect(planAlerts(snapshotAt(10), low.records).records).toEqual({});
    const unreadable = buildSnapshot(COMPANY_ID, [account([], { ok: false, errorFamily: "provider_unavailable" })], THRESHOLDS, NOW);
    expect(planAlerts(unreadable, low.records)).toEqual({ alerts: [], records: low.records });
  });
});

describe("subscription usage plugin", () => {
  it("declares a valid manifest with only the capabilities it uses", () => {
    expect(pluginManifestV1Schema.parse(manifest)).toMatchObject({ id: PLUGIN_ID, displayName: "Subscription Usage" });
    expect([...manifest.capabilities].sort()).toEqual([
      "agent.tools.register",
      "agents.invoke",
      "agents.read",
      "companies.read",
      "costs.read",
      "jobs.schedule",
      "plugin.state.read",
      "plugin.state.write",
      "skills.managed",
    ]);
    expect(manifest.tools?.map((tool) => tool.name)).toEqual([USAGE_TOOL_NAME]);
    expect(manifest.jobs?.map((job) => job.jobKey)).toEqual([POLL_JOB_KEY]);
    expect(manifest.skills?.map((skill) => skill.skillKey)).toEqual([USAGE_SKILL_KEY]);
    expect(manifest.skills?.[0].markdown).toContain(USAGE_TOOL_NAME);
  });

  it("answers the agent tool for the run's company and stores the status", async () => {
    const harness = await setup([account([window("5h limit", 95, 1), window("Weekly limit", 40, 100)])]);
    const result = await harness.executeTool<ToolResult>(USAGE_TOOL_NAME, {}, { companyId: COMPANY_ID, agentId: AGENT_ID });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain("Shared subscription quota: critical.");
    expect(result.content).toContain("5h limit: 5% left");
    expect(result.data).toMatchObject({ companyId: COMPANY_ID, level: "critical" });
    expect(storedSnapshot(harness)).toMatchObject({ level: "critical" });
  });

  it("returns a plain error to the agent when the quota cannot be read", async () => {
    const harness = await setup([]);
    vi.spyOn(harness.ctx.costs, "quotaWindows").mockRejectedValue(new Error("upstream detail"));
    const result = await harness.executeTool<ToolResult>(USAGE_TOOL_NAME, {}, { companyId: COMPANY_ID, agentId: AGENT_ID });
    expect(result.error).toContain("could not be read");
    expect(result.error).not.toContain("upstream detail");
  });

  it("stores the status on each check and wakes the alert agent once per level", async () => {
    const harness = await setup([account([window("Weekly limit", 95, 72)])], { alertAgentId: AGENT_ID });
    const invoke = vi.spyOn(harness.ctx.agents, "invoke");
    await harness.runJob(POLL_JOB_KEY);
    expect(storedSnapshot(harness)).toMatchObject({ level: "critical" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe(AGENT_ID);
    expect(invoke.mock.calls[0][2].prompt).toContain("Team (openai), Weekly limit: critical, 5% left");
    await harness.runJob(POLL_JOB_KEY);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not wake anyone when no alert agent is configured or quota is healthy", async () => {
    const low = await setup([account([window("Weekly limit", 95, 72)])]);
    const lowInvoke = vi.spyOn(low.ctx.agents, "invoke");
    await low.runJob(POLL_JOB_KEY);
    expect(lowInvoke).not.toHaveBeenCalled();

    const healthy = await setup([account([window("Weekly limit", 10, 72)])], { alertAgentId: AGENT_ID });
    const healthyInvoke = vi.spyOn(healthy.ctx.agents, "invoke");
    await healthy.runJob(POLL_JOB_KEY);
    expect(healthyInvoke).not.toHaveBeenCalled();
  });

  it("tries the alert again on the next check when the agent could not be woken", async () => {
    const harness = await setup([account([window("Weekly limit", 95, 72)])], { alertAgentId: AGENT_ID });
    const invoke = vi.spyOn(harness.ctx.agents, "invoke").mockRejectedValueOnce(new Error("agent is paused"));
    await harness.runJob(POLL_JOB_KEY);
    expect(harness.getState({ scopeKind: "company", scopeId: COMPANY_ID, stateKey: ALERTS_STATE_KEY })).toBeUndefined();
    await harness.runJob(POLL_JOB_KEY);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("installs its skill for the company once", async () => {
    const harness = await setup([account([window("Weekly limit", 10, 72)])]);
    const reconcile = vi.spyOn(harness.ctx.skills.managed, "reconcile");
    await harness.runJob(POLL_JOB_KEY);
    await harness.runJob(POLL_JOB_KEY);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(USAGE_SKILL_KEY, COMPANY_ID);
  });
});
