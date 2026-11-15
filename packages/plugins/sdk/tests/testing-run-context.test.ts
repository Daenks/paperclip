import { describe, expect, it } from "vitest";

import { definePlugin } from "../src/define-plugin.js";
import { createTestHarness } from "../src/testing.js";
import type { PaperclipPluginManifestV1 } from "../src/types.js";

const manifest = {
  id: "paperclip.test-run-context",
  apiVersion: 1,
  version: "1.0.0",
  displayName: "Test Run Context",
  description: "Test plugin",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: ["agent.run.context.contribute", "plugin.state.read"],
  entrypoints: { worker: "./worker.js" },
} satisfies PaperclipPluginManifestV1;

describe("createTestHarness run context contributions", () => {
  it("invokes the handler with a full request and returns the sections the host would accept", async () => {
    const received: unknown[] = [];
    const plugin = definePlugin({
      async setup() {},
      async onContributeRunContext(params) {
        received.push(params);
        return { sections: [{ title: " Company policies ", markdown: "Use the handbook.\n" }] };
      },
    });
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    await expect(harness.contributeRunContext(plugin, { companyId: "company-1", issueId: "issue-1" }))
      .resolves.toEqual({ sections: [{ title: "Company policies", markdown: "Use the handbook." }] });
    expect(received).toEqual([{ companyId: "company-1", agentId: "agent-test", runId: expect.any(String), issueId: "issue-1", adapterType: "process" }]);
  });

  it("lets the handler read company-scoped state captured during setup", async () => {
    let read: ((companyId: string) => Promise<unknown>) | undefined;
    const plugin = definePlugin({
      async setup(ctx) { read = companyId => ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: "policy" }); },
      async onContributeRunContext(params) {
        const markdown = await read!(params.companyId);
        return typeof markdown === "string" ? { sections: [{ title: "Policy", markdown }] } : {};
      },
    });
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities, "plugin.state.write"] });
    await plugin.definition.setup(harness.ctx);
    await harness.ctx.state.set({ scopeKind: "company", scopeId: "company-a", stateKey: "policy" }, "A only");
    await expect(harness.contributeRunContext(plugin, { companyId: "company-a" })).resolves.toEqual({ sections: [{ title: "Policy", markdown: "A only" }] });
    await expect(harness.contributeRunContext(plugin, { companyId: "company-b" })).resolves.toEqual({ sections: [] });
  });

  it("throws the host's reason for a result the host would drop", async () => {
    const plugin = definePlugin({
      async setup() {},
      async onContributeRunContext() { return { sections: [{ title: "Too long", markdown: "x".repeat(20_001) }] }; },
    });
    const harness = createTestHarness({ manifest });
    await expect(harness.contributeRunContext(plugin)).rejects.toThrow(
      "The host would drop this run context contribution: 20001 characters of markdown were returned; the limit is 20000.",
    );
  });

  it("requires the capability and the handler", async () => {
    const plugin = definePlugin({ async setup() {}, async onContributeRunContext() { return {}; } });
    await expect(createTestHarness({ manifest, capabilities: [] }).contributeRunContext(plugin))
      .rejects.toThrow("missing required capability 'agent.run.context.contribute'");
    await expect(createTestHarness({ manifest }).contributeRunContext(definePlugin({ async setup() {} })))
      .rejects.toThrow("does not implement onContributeRunContext");
  });
});
