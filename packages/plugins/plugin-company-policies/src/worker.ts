import {
  definePlugin,
  PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS,
  runWorker,
  type PluginContext,
  type PluginPerformActionContext,
} from "@paperclipai/plugin-sdk";
import {
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

const plugin = definePlugin({
  async setup(ctx) {
    activeContext = ctx;

    // Reads go through the host's board-only data route; the host injects the authorized company.
    ctx.data.register(POLICY_DATA_KEY, async (params): Promise<CompanyPolicyView> => {
      const policy = await loadPolicy(ctx, requireCompanyId(params.companyId));
      return { ...policy, maxCharacters: PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS };
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
      const current = await loadPolicy(ctx, companyId);
      if (params.baseRevision !== current.revision) {
        throw new Error("Someone else saved these policies after you opened them. Reload the page to see their version, then make your change again.");
      }
      const next: CompanyPolicy = {
        markdown: params.markdown,
        enabled: params.enabled,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
        revision: current.revision + 1,
      };
      await ctx.state.set(policyScope(companyId), next);
      return { ...next, maxCharacters: PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS };
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
