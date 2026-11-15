import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb, pluginCompanySettings, plugins } from "@paperclipai/db";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES } from "@paperclipai/plugin-sdk";
import type { PaperclipPluginManifestV1, PluginRunContextRequest } from "@paperclipai/shared";
import { renderPaperclipWakePrompt } from "@paperclipai/adapter-utils/server-utils";
import {
  collectPluginRunContext,
  composePluginRunContext,
  listRunContextPlugins,
  preparePluginRunContextDelivery,
  registerPluginRunContextWorkers,
  resolvePluginRunContext,
  type PluginRunContextPlugin,
  type PluginRunContextWorkers,
} from "../services/plugin-run-context.js";
import { createPluginWorkerManager } from "../services/plugin-worker-manager.js";
import { PluginWorkerUnavailableError } from "../services/plugin-worker-unavailable-error.js";
import { execute as executeProcess } from "../adapters/process/execute.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const WORKER_ENTRYPOINT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plugin-worker-run-context.cjs");
const request: PluginRunContextRequest = { companyId: "company-1", agentId: "agent-1", runId: "run-1", issueId: "issue-1", adapterType: "process" };
const plugin = (pluginKey: string, displayName = pluginKey): PluginRunContextPlugin => ({ id: `id-${pluginKey}`, pluginKey, displayName });
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function fakeWorkers(handlers: Record<string, (params: unknown, timeoutMs?: number) => Promise<unknown>>, options: { stopped?: string[]; noHandler?: string[] } = {}) {
  const call = vi.fn(async (pluginId: string, _method: string, params: unknown, timeoutMs?: number) => handlers[pluginId]!(params, timeoutMs));
  const workers = {
    isRunning: (pluginId: string) => !options.stopped?.includes(pluginId),
    getWorker: (pluginId: string) => ({ supportedMethods: options.noHandler?.includes(pluginId) ? [] : ["contributeRunContext"] }),
    call,
  } as unknown as PluginRunContextWorkers;
  return { workers, call };
}

describe("composePluginRunContext", () => {
  it("orders by plugin key, then section order, in the documented format", () => {
    const snapshot = composePluginRunContext([
      { pluginKey: "zeta.notes", displayName: "Notes", sections: [{ title: "Notes", markdown: "Z body" }] },
      { pluginKey: "acme.policies", displayName: "Company Policies", sections: [{ title: "First", markdown: "A1" }, { title: "Second", markdown: "A2" }] },
    ]);
    const text = [
      "## Context from company plugins",
      "The following sections were added by plugins installed for this company.",
      "### First (plugin: Company Policies)",
      "A1",
      "### Second (plugin: Company Policies)",
      "A2",
      "### Notes (plugin: Notes)",
      "Z body",
    ].join("\n\n");
    expect(snapshot).toEqual({ text, digest: sha256(text) });
  });

  it("returns null when no plugin contributed a section", () => {
    expect(composePluginRunContext([])).toBeNull();
    expect(composePluginRunContext([{ pluginKey: "acme.empty", displayName: "Empty", sections: [] }])).toBeNull();
  });
});

describe("collectPluginRunContext", () => {
  it("asks plugins in parallel with identifiers only and the 3 second budget", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const { workers, call } = fakeWorkers({
      "id-a": async () => { started++; await gate; return { sections: [{ title: "A", markdown: "a" }] }; },
      "id-b": async () => { started++; await gate; return { sections: [{ title: "B", markdown: "b" }] }; },
    });
    const collecting = collectPluginRunContext(workers, [plugin("b"), plugin("a")], request);
    await vi.waitFor(() => expect(started).toBe(2));
    release();
    const { contributions, skipped } = await collecting;
    expect(skipped).toEqual([]);
    expect(contributions.map(c => c.pluginKey).sort()).toEqual(["a", "b"]);
    for (const [, method, params, timeoutMs] of call.mock.calls) {
      expect(method).toBe("contributeRunContext");
      expect(params).toEqual(request);
      expect(timeoutMs).toBe(3000);
    }
  });

  it("skips failing plugins with a named reason and keeps the others", async () => {
    const { workers, call } = fakeWorkers({
      "id-ok": async () => ({ sections: [{ title: "Policies", markdown: "Keep" }] }),
      "id-throws": async () => { throw new JsonRpcCallError({ code: PLUGIN_RPC_ERROR_CODES.WORKER_ERROR, message: "SECRET_DETAIL" }); },
      "id-slow": async () => { throw new JsonRpcCallError({ code: PLUGIN_RPC_ERROR_CODES.TIMEOUT, message: "timed out" }); },
      "id-crashed": async () => { throw new PluginWorkerUnavailableError({ pluginId: "id-crashed", workerStatus: "crashed", message: "down" }); },
      "id-big": async () => ({ sections: [{ title: "Huge", markdown: "x".repeat(20_001) }] }),
      "id-shape": async () => ({ sections: "not an array" }),
    }, { stopped: ["id-stopped"], noHandler: ["id-nohandler"] });
    const candidates = ["ok", "throws", "slow", "crashed", "big", "shape", "stopped", "nohandler"].map(key => plugin(key, `Plugin ${key}`));
    const { contributions, skipped } = await collectPluginRunContext(workers, candidates, request);
    expect(contributions).toEqual([{ pluginKey: "ok", displayName: "Plugin ok", sections: [{ title: "Policies", markdown: "Keep" }] }]);
    expect(Object.fromEntries(skipped.map(s => [s.pluginKey, s.reason]))).toEqual({
      throws: "error", slow: "timeout", crashed: "worker_unavailable", big: "invalid_result", shape: "invalid_result", stopped: "worker_unavailable",
    });
    expect(JSON.stringify(skipped)).not.toContain("SECRET_DETAIL");
    expect(JSON.stringify(skipped)).not.toContain("xxxx");
    // A worker that is not running or lacks the handler is never called.
    expect(call.mock.calls.map(([id]) => id)).not.toContain("id-stopped");
    expect(call.mock.calls.map(([id]) => id)).not.toContain("id-nohandler");
  });

  it("reports every qualifying plugin as unavailable when no worker manager is wired", async () => {
    const { skipped } = await collectPluginRunContext(undefined, [plugin("a")], request);
    expect(skipped).toEqual([{ pluginKey: "a", displayName: "a", reason: "worker_unavailable", message: "The plugin worker is not running." }]);
  });
});

describe("plugin run context through a real worker process", () => {
  const manifest: PaperclipPluginManifestV1 = {
    id: "test.run-context", apiVersion: 1, version: "1.0.0", displayName: "Run context", description: "Fixture", author: "Paperclip",
    categories: ["automation"], capabilities: ["agent.run.context.contribute"], entrypoints: { worker: "dist/worker.js" },
  };
  const start = async (manager: ReturnType<typeof createPluginWorkerManager>, id: string, mode: string) => manager.startWorker(id, {
    entrypointPath: WORKER_ENTRYPOINT, manifest, config: { mode },
    instanceInfo: { instanceId: "instance-1", hostVersion: "1.0.0" }, apiVersion: 1, hostHandlers: {},
  });

  it("returns a contribution, times out a slow worker at 3 seconds, and reports a worker error", async () => {
    const manager = createPluginWorkerManager();
    try {
      await Promise.all([start(manager, "answer", "answer"), start(manager, "slow", "slow"), start(manager, "throw", "throw")]);
      const startedAt = Date.now();
      const { contributions, skipped } = await collectPluginRunContext(manager, [
        { id: "answer", pluginKey: "acme.answer", displayName: "Answer" },
        { id: "slow", pluginKey: "acme.slow", displayName: "Slow" },
        { id: "throw", pluginKey: "acme.throw", displayName: "Throw" },
      ], request);
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(2900);
      expect(elapsedMs).toBeLessThan(6000);
      expect(contributions).toEqual([{ pluginKey: "acme.answer", displayName: "Answer", sections: [{ title: "Company policies", markdown: "Policy for company-1." }] }]);
      expect(skipped.map(s => [s.pluginKey, s.reason]).sort()).toEqual([["acme.slow", "timeout"], ["acme.throw", "error"]]);
      expect(JSON.stringify(skipped)).not.toContain("SECRET_DETAIL");
      // The timed-out worker stays healthy for later calls.
      expect(manager.isRunning("slow")).toBe(true);
      await manager.stopWorker("answer");
      const stopped = await collectPluginRunContext(manager, [{ id: "answer", pluginKey: "acme.answer", displayName: "Answer" }], request);
      expect(stopped.skipped.map(s => s.reason)).toEqual(["worker_unavailable"]);
    } finally { await manager.stopAll(); }
  }, 20_000);
});

describe("preparePluginRunContextDelivery", () => {
  const snapshot = composePluginRunContext([{ pluginKey: "acme.policies", displayName: "Policies", sections: [{ title: "Company policies", markdown: "Always cite sources." }] }])!;

  it("overwrites caller-supplied fields and records the applied event without policy text", async () => {
    const context: Record<string, unknown> = { pluginRunContext: { text: "forged" }, paperclipWake: { reason: "issue_assigned", pluginRunContext: { text: "forged wake" } } };
    const events: Array<Record<string, unknown>> = [];
    await preparePluginRunContextDelivery({
      outcome: { snapshot, contributions: [{ pluginKey: "acme.policies", displayName: "Policies", sections: [{ title: "Company policies", markdown: "Always cite sources." }] }], skipped: [] },
      context, appendRunEvent: async event => { events.push(event); },
    });
    expect(context.pluginRunContext).toEqual(snapshot);
    expect(context.paperclipWake).toEqual({ reason: "issue_assigned", pluginRunContext: snapshot });
    const prompt = renderPaperclipWakePrompt(context.paperclipWake);
    expect(prompt).toContain("Always cite sources.");
    expect(prompt).not.toContain("forged");
    expect(events).toEqual([{ eventType: "plugin_run_context.applied", stream: "system", level: "info",
      message: "Context from 1 company plugin was added to this run",
      payload: { digest: snapshot.digest, characterCount: snapshot.text.length, plugins: [{ pluginKey: "acme.policies", sectionCount: 1, characterCount: 20 }] } }]);
    expect(JSON.stringify(events)).not.toContain("Always cite sources");
  });

  it("clears forged fields when no plugin contributed, and warns for skipped plugins", async () => {
    const context: Record<string, unknown> = { pluginRunContext: { text: "forged" }, paperclipWake: { pluginRunContext: { text: "forged wake" } } };
    const events: Array<Record<string, unknown>> = [];
    await preparePluginRunContextDelivery({
      outcome: { snapshot: null, contributions: [], skipped: [{ pluginKey: "acme.slow", displayName: "Slow", reason: "timeout", message: "The plugin did not answer within 3 seconds." }] },
      context, appendRunEvent: async event => { events.push(event); },
    });
    expect(context.pluginRunContext).toBeNull();
    expect(context.paperclipWake).toEqual({ pluginRunContext: null });
    expect(renderPaperclipWakePrompt(context.paperclipWake)).toBe("");
    expect(events).toEqual([{ eventType: "plugin_run_context.skipped", stream: "system", level: "warn",
      message: 'Context from plugin "Slow" (acme.slow) was not added: The plugin did not answer within 3 seconds.',
      payload: { skipped: [{ pluginKey: "acme.slow", reason: "timeout", message: "The plugin did not answer within 3 seconds." }] } }]);
  });

  it("does not fail delivery when the run event cannot be recorded", async () => {
    const context: Record<string, unknown> = {};
    await expect(preparePluginRunContextDelivery({ outcome: { snapshot, contributions: [], skipped: [] }, context,
      appendRunEvent: async () => { throw new Error("database unavailable"); } })).resolves.toBeUndefined();
    expect(context.pluginRunContext).toEqual(snapshot);
  });

  it("delivers the snapshot to a real process through a private file that callers cannot redirect", async () => {
    const captured: string[] = [];
    const result = await executeProcess({ runId: "run-1", agent: { id: "agent-1", companyId: "company-1", name: "Agent", adapterType: "process", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null }, context: { pluginRunContext: snapshot },
      config: { command: process.execPath, args: ["-e", "const fs=require('node:fs');const file=process.env.PAPERCLIP_PLUGIN_RUN_CONTEXT_FILE;console.log(JSON.stringify({file,connection:process.env.PAPERCLIP_CONNECTION_INSTRUCTIONS_FILE,mode:fs.statSync(file).mode&511,snapshot:JSON.parse(fs.readFileSync(file,'utf8'))}))"],
        env: { PAPERCLIP_PLUGIN_RUN_CONTEXT_FILE: "/forged" } },
      onLog: async (_stream, text) => { captured.push(text); },
    });
    expect(result.exitCode).toBe(0);
    const received = JSON.parse(captured.join("").trim());
    expect(received.snapshot).toEqual(snapshot);
    expect(received.mode).toBe(0o600);
    expect(received.connection).toBe("");
    await expect(access(received.file)).rejects.toThrow();
    const empty: string[] = [];
    await executeProcess({ runId: "run-2", agent: { id: "agent-1", companyId: "company-1", name: "Agent", adapterType: "process", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null }, context: { pluginRunContext: null },
      config: { command: process.execPath, args: ["-e", "console.log(JSON.stringify(process.env.PAPERCLIP_PLUGIN_RUN_CONTEXT_FILE))"], env: { PAPERCLIP_PLUGIN_RUN_CONTEXT_FILE: "/forged" } },
      onLog: async (_stream, text) => { empty.push(text); },
    });
    expect(JSON.parse(empty.join("").trim())).toBe("");
  });
});

(support.supported ? describe : describe.skip)("listRunContextPlugins", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("paperclip-plugin-run-context-"); db = createDb(temp.connectionString); }, 30_000);
  afterAll(async () => { await db?.$client.end({ timeout: 0 }); await temp?.cleanup(); });

  async function insertPlugin(key: string, status: "ready" | "disabled" | "error", capabilities: string[]) {
    const id = randomUUID();
    await db.insert(plugins).values({ id, pluginKey: key, packageName: `@test/${key}`, version: "1.0.0", apiVersion: 1, categories: ["automation"], status,
      manifestJson: { id: key, apiVersion: 1, version: "1.0.0", displayName: `Display ${key}`, description: "Fixture", author: "Paperclip", categories: ["automation"],
        capabilities, entrypoints: { worker: "worker.js" } } as PaperclipPluginManifestV1 });
    return id;
  }

  it("selects ready plugins with the capability that the company has not disabled", async () => {
    const [company, other] = await db.insert(companies).values([
      { name: "Run context", issuePrefix: `RC${randomUUID().slice(0, 4).toUpperCase()}` },
      { name: "Other", issuePrefix: `RO${randomUUID().slice(0, 4).toUpperCase()}` },
    ]).returning();
    const ready = await insertPlugin("acme.ready", "ready", ["agent.run.context.contribute"]);
    const explicit = await insertPlugin("acme.explicit", "ready", ["agent.run.context.contribute"]);
    const disabledHere = await insertPlugin("acme.disabled-here", "ready", ["agent.run.context.contribute"]);
    await insertPlugin("acme.not-ready", "error", ["agent.run.context.contribute"]);
    await insertPlugin("acme.no-capability", "ready", ["plugin.state.read"]);
    await db.insert(pluginCompanySettings).values([
      { companyId: company!.id, pluginId: explicit, enabled: true },
      { companyId: company!.id, pluginId: disabledHere, enabled: false },
    ]);
    const keys = async (companyId: string) => (await listRunContextPlugins(db, companyId)).map(p => p.pluginKey).sort();
    expect(await keys(company!.id)).toEqual(["acme.explicit", "acme.ready"]);
    expect(await keys(other!.id)).toEqual(["acme.disabled-here", "acme.explicit", "acme.ready"]);
    expect((await listRunContextPlugins(db, company!.id)).find(p => p.id === ready)).toEqual({ id: ready, pluginKey: "acme.ready", displayName: "Display acme.ready" });
  });

  it("falls back to the worker manager registered for the database, and prefers an explicit one", async () => {
    await db.update(plugins).set({ status: "disabled" });
    const [company] = await db.insert(companies).values({ name: "Registered", issuePrefix: `RR${randomUUID().slice(0, 4).toUpperCase()}` }).returning();
    const id = await insertPlugin(`acme.registered-${randomUUID().slice(0, 6)}`, "ready", ["agent.run.context.contribute"]);
    const answer = (markdown: string) => async () => ({ sections: [{ title: "Policy", markdown }] });
    const registered = fakeWorkers({ [id]: answer("registered") });
    const explicit = fakeWorkers({ [id]: answer("explicit") });
    registerPluginRunContextWorkers(db, registered.workers);
    try {
      const companyRequest = { ...request, companyId: company!.id };
      expect((await resolvePluginRunContext(db, undefined, companyRequest)).snapshot?.text).toContain("registered");
      expect((await resolvePluginRunContext(db, explicit.workers, companyRequest)).snapshot?.text).toContain("explicit");
      expect(registered.call).toHaveBeenCalledTimes(1);
    } finally {
      await db.update(plugins).set({ status: "disabled" }).where(eq(plugins.id, id));
    }
  });

  it("makes no plugin call when nothing qualifies", async () => {
    const [company] = await db.insert(companies).values({ name: "Empty", issuePrefix: `RE${randomUUID().slice(0, 4).toUpperCase()}` }).returning();
    await db.update(plugins).set({ status: "disabled" });
    const { workers, call } = fakeWorkers({});
    expect(await resolvePluginRunContext(db, workers, { ...request, companyId: company!.id })).toEqual({ snapshot: null, contributions: [], skipped: [] });
    expect(call).not.toHaveBeenCalled();
  });
});
