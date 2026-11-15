import { createHash } from "node:crypto";
import { and, eq, exists, not } from "drizzle-orm";
import { pluginCompanySettings, plugins, type Db } from "@paperclipai/db";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES } from "@paperclipai/plugin-sdk";
import {
  PLUGIN_RUN_CONTEXT_TIMEOUT_MS,
  validatePluginRunContextResult,
  type PluginRunContextRequest,
  type PluginRunContextSection,
  type PluginRunContextSnapshot,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";
import { findPluginWorkerUnavailableError } from "./plugin-worker-unavailable-error.js";

export const PLUGIN_RUN_CONTEXT_CAPABILITY = "agent.run.context.contribute" as const;
export const PLUGIN_RUN_CONTEXT_METHOD = "contributeRunContext" as const;

export type PluginRunContextWorkers = Pick<PluginWorkerManager, "call" | "getWorker" | "isRunning">;
export interface PluginRunContextPlugin { id: string; pluginKey: string; displayName: string }
export interface PluginRunContextContribution { pluginKey: string; displayName: string; sections: PluginRunContextSection[] }
export type PluginRunContextSkipReason = "timeout" | "worker_unavailable" | "error" | "invalid_result";
export interface PluginRunContextSkip { pluginKey: string; displayName: string; reason: PluginRunContextSkipReason; message: string }
export interface PluginRunContextOutcome {
  snapshot: PluginRunContextSnapshot | null;
  contributions: PluginRunContextContribution[];
  skipped: PluginRunContextSkip[];
}

type RunEvent = { eventType: string; stream: "system"; level: "info" | "warn"; message: string; payload: Record<string, unknown> };

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Routes and services also build heartbeatService(db) without a worker manager,
// and those instances execute runs (wakeup and cancelRun start queued runs
// in-process). The process has one manager; resolve it so their runs still ask plugins.
const registeredWorkers = new WeakMap<Db, PluginRunContextWorkers>();
export function registerPluginRunContextWorkers(db: Db, workers: PluginRunContextWorkers): void {
  registeredWorkers.set(db, workers);
}
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Ready plugins with the capability that the company has not disabled. */
export async function listRunContextPlugins(db: Db, companyId: string): Promise<PluginRunContextPlugin[]> {
  const rows = await db.select({ id: plugins.id, pluginKey: plugins.pluginKey, manifestJson: plugins.manifestJson }).from(plugins)
    .where(and(eq(plugins.status, "ready"), not(exists(db.select({ id: pluginCompanySettings.id }).from(pluginCompanySettings).where(and(
      eq(pluginCompanySettings.pluginId, plugins.id),
      eq(pluginCompanySettings.companyId, companyId),
      eq(pluginCompanySettings.enabled, false),
    ))))));
  return rows.filter((row) => row.manifestJson.capabilities.includes(PLUGIN_RUN_CONTEXT_CAPABILITY))
    .map((row) => ({ id: row.id, pluginKey: row.pluginKey, displayName: oneLine(row.manifestJson.displayName || row.pluginKey) || row.pluginKey }));
}

function skipFor(plugin: PluginRunContextPlugin, error: unknown): PluginRunContextSkip {
  const skip = (reason: PluginRunContextSkipReason, message: string) => ({ pluginKey: plugin.pluginKey, displayName: plugin.displayName, reason, message });
  if (findPluginWorkerUnavailableError(error)) return skip("worker_unavailable", "The plugin worker is not running.");
  if (error instanceof JsonRpcCallError && error.code === PLUGIN_RPC_ERROR_CODES.TIMEOUT) {
    return skip("timeout", `The plugin did not answer within ${PLUGIN_RUN_CONTEXT_TIMEOUT_MS / 1000} seconds.`);
  }
  if (error instanceof JsonRpcCallError && error.code === PLUGIN_RPC_ERROR_CODES.WORKER_UNAVAILABLE) {
    return skip("worker_unavailable", "The plugin worker is not available.");
  }
  return skip("error", "The plugin reported an error.");
}

/** Asks every plugin in parallel; a plugin that fails is skipped, never thrown. */
export async function collectPluginRunContext(
  workers: PluginRunContextWorkers | undefined,
  candidates: readonly PluginRunContextPlugin[],
  request: PluginRunContextRequest,
): Promise<Omit<PluginRunContextOutcome, "snapshot">> {
  const results = await Promise.all(candidates.map(async (plugin): Promise<PluginRunContextContribution | PluginRunContextSkip | null> => {
    if (!workers?.isRunning(plugin.id)) {
      return { pluginKey: plugin.pluginKey, displayName: plugin.displayName, reason: "worker_unavailable", message: "The plugin worker is not running." };
    }
    if (!workers.getWorker(plugin.id)?.supportedMethods.includes(PLUGIN_RUN_CONTEXT_METHOD)) return null;
    try {
      const result = await workers.call(plugin.id, PLUGIN_RUN_CONTEXT_METHOD, { ...request }, PLUGIN_RUN_CONTEXT_TIMEOUT_MS);
      const validation = validatePluginRunContextResult(result);
      if (!validation.ok) {
        return { pluginKey: plugin.pluginKey, displayName: plugin.displayName, reason: "invalid_result", message: validation.message };
      }
      return { pluginKey: plugin.pluginKey, displayName: plugin.displayName, sections: validation.sections };
    } catch (error) {
      logger.warn({ err: error, runId: request.runId, pluginKey: plugin.pluginKey }, "Plugin run context was not added");
      return skipFor(plugin, error);
    }
  }));
  const contributions: PluginRunContextContribution[] = [];
  const skipped: PluginRunContextSkip[] = [];
  for (const result of results) {
    if (!result) continue;
    if ("sections" in result) contributions.push(result);
    else skipped.push(result);
  }
  return { contributions, skipped };
}

/** Deterministic order: plugin key, then the plugin's section order. */
export function composePluginRunContext(contributions: readonly PluginRunContextContribution[]): PluginRunContextSnapshot | null {
  const blocks = contributions.toSorted((a, b) => byKey(a.pluginKey, b.pluginKey))
    .flatMap(({ displayName, sections }) => sections.map(({ title, markdown }) => `### ${title} (plugin: ${displayName})\n\n${markdown}`));
  if (!blocks.length) return null;
  const text = `## Context from company plugins\n\nThe following sections were added by plugins installed for this company.\n\n${blocks.join("\n\n")}`;
  return { text, digest: createHash("sha256").update(text).digest("hex") };
}

/** Never rejects: listing or calling failures leave the run without plugin context. */
export async function resolvePluginRunContext(
  db: Db,
  workers: PluginRunContextWorkers | undefined,
  request: PluginRunContextRequest,
): Promise<PluginRunContextOutcome> {
  try {
    const candidates = await listRunContextPlugins(db, request.companyId);
    if (!candidates.length) return { snapshot: null, contributions: [], skipped: [] };
    const { contributions, skipped } = await collectPluginRunContext(workers ?? registeredWorkers.get(db), candidates, request);
    return { snapshot: composePluginRunContext(contributions), contributions, skipped };
  } catch (error) {
    logger.warn({ err: error, runId: request.runId }, "Plugin run context could not be prepared; the run continues without it");
    return { snapshot: null, contributions: [], skipped: [] };
  }
}

/** Freeze server-owned delivery for this turn, overwriting untrusted wake/context fields. */
export async function preparePluginRunContextDelivery(input: {
  outcome: PluginRunContextOutcome;
  context: Record<string, unknown>;
  appendRunEvent: (event: RunEvent) => Promise<unknown>;
}): Promise<void> {
  const { outcome, context } = input;
  const wake = context.paperclipWake;
  context.pluginRunContext = outcome.snapshot;
  context.paperclipWake = {
    ...(wake && typeof wake === "object" && !Array.isArray(wake) ? wake : {}),
    pluginRunContext: outcome.snapshot,
  };
  // Diagnostics must not fail the run.
  const record = (event: RunEvent) => input.appendRunEvent(event).catch((error) => {
    logger.warn({ err: error, eventType: event.eventType }, "Could not record the plugin run context event");
  });
  if (outcome.skipped.length) {
    await record({ eventType: "plugin_run_context.skipped", stream: "system", level: "warn",
      message: outcome.skipped.map(({ displayName, pluginKey, message }) => `Context from plugin "${displayName}" (${pluginKey}) was not added: ${message}`).join("\n"),
      payload: { skipped: outcome.skipped.map(({ pluginKey, reason, message }) => ({ pluginKey, reason, message })) } });
  }
  if (outcome.snapshot) {
    const contributing = outcome.contributions.filter((contribution) => contribution.sections.length > 0)
      .toSorted((a, b) => byKey(a.pluginKey, b.pluginKey));
    await record({ eventType: "plugin_run_context.applied", stream: "system", level: "info",
      message: `Context from ${contributing.length === 1 ? "1 company plugin" : `${contributing.length} company plugins`} was added to this run`,
      payload: {
        digest: outcome.snapshot.digest,
        characterCount: outcome.snapshot.text.length,
        plugins: contributing.map(({ pluginKey, sections }) => ({
          pluginKey, sectionCount: sections.length, characterCount: sections.reduce((sum, section) => sum + section.markdown.length, 0),
        })),
      } });
  }
}
