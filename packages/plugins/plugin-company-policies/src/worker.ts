import {
  definePlugin,
  PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS,
  runWorker,
  type PluginContext,
  type PluginPerformActionContext,
} from "@paperclipai/plugin-sdk";
import {
  POLICY_ACTIVITY_ENTITY_TYPE,
  POLICY_ACTIVITY_TYPE,
  POLICY_DATA_KEY,
  POLICY_SECTION_TITLE,
  POLICY_STATE_KEY,
  SAVE_POLICY_ACTION_KEY,
  policyCharacterCount,
  readStoredPolicy,
  type CompanyPolicy,
  type CompanyPolicyView,
} from "./policy.js";

function requireCompanyId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("A company is required.");
  return value.trim();
}

function policyScope(companyId: string) {
  return { scopeKind: "company" as const, scopeId: companyId, stateKey: POLICY_STATE_KEY };
}

async function loadPolicy(ctx: PluginContext, companyId: string): Promise<CompanyPolicy> {
  return readStoredPolicy(await ctx.state.get(policyScope(companyId)));
}

/**
 * Only a board user may change the policy, and only for the company the host
 * authorized for this call. The host's action routes also accept agent API keys
 * for the agent's own company, so the actor type is checked here.
 */
function authorizeSave(context: PluginPerformActionContext): { companyId: string; userId: string } {
  if (context.actor.type !== "user" || !context.actor.userId) {
    throw new Error("Only a board user can change company policies.");
  }
  if (!context.companyId) throw new Error("A company is required.");
  return { companyId: context.companyId, userId: context.actor.userId };
}

let activeContext: PluginContext | null = null;

// Tail of the pending saves per company. This orders saves within this worker
// process only; several servers sharing one database would need a host-side
// compare-and-set on plugin state.
const saveQueues = new Map<string, Promise<unknown>>();

async function serializeForCompany<T>(companyId: string, work: () => Promise<T>): Promise<T> {
  const previous = saveQueues.get(companyId) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => undefined);
  saveQueues.set(companyId, tail);
  try {
    return await run;
  } finally {
    if (saveQueues.get(companyId) === tail) saveQueues.delete(companyId);
  }
}

/** Records the save in the company's activity log. The policy text is never logged. */
async function logPolicySaved(ctx: PluginContext, companyId: string, policy: CompanyPolicy): Promise<void> {
  try {
    await ctx.activity.log({
      companyId,
      message: "Updated company policies",
      entityType: POLICY_ACTIVITY_ENTITY_TYPE,
      entityId: companyId,
      metadata: {
        type: POLICY_ACTIVITY_TYPE,
        revision: policy.revision,
        enabled: policy.enabled,
        characterCount: policyCharacterCount(policy.markdown),
        userId: policy.updatedBy,
      },
    });
  } catch (error) {
    // The policy is already saved; failing the save now would make the next save stale.
    ctx.logger.warn("Company policies were saved but the activity entry could not be written", {
      companyId,
      revision: policy.revision,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    activeContext = ctx;

    // Reads go through the host's board-only data route; the host injects the authorized company.
    ctx.data.register(POLICY_DATA_KEY, async (params): Promise<CompanyPolicyView> => {
      const companyId = requireCompanyId(params.companyId);
      const policy = await loadPolicy(ctx, companyId);
      return { ...policy, companyId, maxCharacters: PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS };
    });

    ctx.actions.register(SAVE_POLICY_ACTION_KEY, async (params, context): Promise<CompanyPolicyView> => {
      const { companyId, userId } = authorizeSave(context);
      if (typeof params.markdown !== "string") throw new Error("markdown must be a string.");
      if (typeof params.enabled !== "boolean") throw new Error("enabled must be true or false.");
      if (!Number.isSafeInteger(params.baseRevision) || (params.baseRevision as number) < 0) {
        throw new Error("baseRevision must be the revision of the policy being edited.");
      }
      const characters = policyCharacterCount(params.markdown);
      if (characters > PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS) {
        throw new Error(
          `The policy is ${characters.toLocaleString("en-US")} characters; the limit is ${PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS.toLocaleString("en-US")}. Shorten it and save again.`,
        );
      }
      // The revision check and the write must not interleave with another save
      // for the same company, or one of two concurrent saves is lost silently.
      const next = await serializeForCompany(companyId, async () => {
        const current = await loadPolicy(ctx, companyId);
        if (params.baseRevision !== current.revision) {
          throw new Error("Someone else saved these policies after you opened them. Reload the page to see their version, then make your change again.");
        }
        const saved: CompanyPolicy = {
          markdown: params.markdown as string,
          enabled: params.enabled as boolean,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
          revision: current.revision + 1,
        };
        await ctx.state.set(policyScope(companyId), saved);
        return saved;
      });
      await logPolicySaved(ctx, companyId, next);
      return { ...next, companyId, maxCharacters: PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS };
    });
  },

  async onContributeRunContext(request) {
    if (!activeContext) throw new Error("The plugin is not set up yet.");
    const policy = await loadPolicy(activeContext, requireCompanyId(request.companyId));
    const markdown = policy.markdown.trim();
    if (!policy.enabled || !markdown) return { sections: [] };
    return { sections: [{ title: POLICY_SECTION_TITLE, markdown }] };
  },

  // No timers, sockets or background work: an idle worker never blocks instance sleep.
  async onIdleDrain() {
    return "none";
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
