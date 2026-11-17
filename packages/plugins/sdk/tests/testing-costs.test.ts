import { describe, expect, it } from "vitest";

import { createTestHarness } from "../src/testing.js";
import type { PaperclipPluginManifestV1 } from "../src/types.js";

const manifest = (capabilities: PaperclipPluginManifestV1["capabilities"]) => ({
  id: "paperclip.test-costs",
  apiVersion: 1,
  version: "1.0.0",
  displayName: "Test Costs",
  description: "Test plugin",
  author: "Paperclip",
  categories: ["automation"],
  capabilities,
  entrypoints: { worker: "./worker.js" },
} satisfies PaperclipPluginManifestV1);

const results = [{
  provider: "openai",
  ok: true,
  accountLabel: "Team subscription",
  windows: [{ label: "7d", usedPercent: 95, resetsAt: "2026-11-20T00:00:00.000Z", valueLabel: null }],
}];

describe("createTestHarness subscription quota", () => {
  it("returns the seeded quota windows of the requested company only", async () => {
    const harness = createTestHarness({ manifest: manifest(["costs.read"]) });
    harness.seed({ quotaWindows: [{ companyId: "company-a", results }] });
    expect(await harness.ctx.costs.quotaWindows("company-a")).toEqual(results);
    expect(await harness.ctx.costs.quotaWindows("company-b")).toEqual([]);
  });

  it("requires the costs.read capability", async () => {
    const harness = createTestHarness({ manifest: manifest([]) });
    await expect(harness.ctx.costs.quotaWindows("company-a")).rejects.toThrow(/costs\.read/);
  });
});
