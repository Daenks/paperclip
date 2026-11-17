import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  ALERTS_STATE_KEY,
  POLL_JOB_KEY,
  SNAPSHOT_STATE_KEY,
  USAGE_SKILL_KEY,
  USAGE_TOOL_NAME,
  buildSnapshot,
  describeAlerts,
  describeSnapshot,
  planAlerts,
  readAlertAgentId,
  readAlertRecords,
  readThresholds,
  type UsageSnapshot,
} from "./usage.js";

function companyScope(companyId: string, stateKey: string) {
  return { scopeKind: "company" as const, scopeId: companyId, stateKey };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readSnapshot(ctx: PluginContext, companyId: string, config: Record<string, unknown>): Promise<UsageSnapshot> {
  const results = await ctx.costs.quotaWindows(companyId);
  const snapshot = buildSnapshot(companyId, results, readThresholds(config));
  await ctx.state.set(companyScope(companyId, SNAPSHOT_STATE_KEY), snapshot);
  return snapshot;
}

/** Wakes the configured agent for windows that newly reached warn or critical. */
async function sendAlerts(
  ctx: PluginContext,
  companyId: string,
  snapshot: UsageSnapshot,
  config: Record<string, unknown>,
): Promise<void> {
  const scope = companyScope(companyId, ALERTS_STATE_KEY);
  const { alerts, records } = planAlerts(snapshot, readAlertRecords(await ctx.state.get(scope)));
  const agentId = readAlertAgentId(config);
  if (alerts.length > 0 && agentId) {
    const agent = await ctx.agents.get(agentId, companyId);
    if (!agent) {
      ctx.logger.warn("Subscription usage alert agent was not found in this company", { companyId, agentId });
    } else {
      try {
        await ctx.agents.invoke(agentId, companyId, {
          prompt: describeAlerts(alerts, snapshot),
          reason: "Shared subscription quota is running low",
        });
      } catch (error) {
        // Leave the alert unrecorded so the next check tries again.
        ctx.logger.warn("Subscription usage alert could not be delivered", { companyId, agentId, error: errorMessage(error) });
        return;
      }
    }
  }
  await ctx.state.set(scope, records);
}

const reconciledSkillCompanies = new Set<string>();

async function ensureSkill(ctx: PluginContext, companyId: string): Promise<void> {
  if (reconciledSkillCompanies.has(companyId)) return;
  try {
    await ctx.skills.managed.reconcile(USAGE_SKILL_KEY, companyId);
    reconciledSkillCompanies.add(companyId);
  } catch (error) {
    ctx.logger.warn("Subscription usage skill could not be installed", { companyId, error: errorMessage(error) });
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    reconciledSkillCompanies.clear();

    ctx.jobs.register(POLL_JOB_KEY, async () => {
      for (const company of await ctx.companies.list()) {
        let config: Record<string, unknown>;
        try {
          config = await ctx.config.get(company.id);
        } catch {
          // The host only lets a job act on companies where the plugin is configured.
          continue;
        }
        try {
          await ensureSkill(ctx, company.id);
          const snapshot = await readSnapshot(ctx, company.id, config);
          await sendAlerts(ctx, company.id, snapshot, config);
        } catch (error) {
          ctx.logger.warn("Subscription usage check failed", { companyId: company.id, error: errorMessage(error) });
        }
      }
    });

    ctx.tools.register(
      USAGE_TOOL_NAME,
      {
        displayName: "Subscription Usage",
        description: "Report how much of the company's shared AI subscription quota is left.",
        parametersSchema: { type: "object", properties: {} },
      },
      async (_params, runCtx) => {
        const config = await ctx.config.get(runCtx.companyId);
        try {
          const snapshot = await readSnapshot(ctx, runCtx.companyId, config);
          return { content: describeSnapshot(snapshot), data: snapshot };
        } catch (error) {
          ctx.logger.warn("Subscription usage could not be read for a tool call", {
            companyId: runCtx.companyId,
            error: errorMessage(error),
          });
          return { error: "Subscription usage could not be read. Work normally, and do not assume there is plenty of quota left." };
        }
      },
    );
  },

  // The host schedules the job; the worker keeps no timers or sockets of its own.
  async onIdleDrain() {
    return "none";
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
