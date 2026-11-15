import { describe, expect, it } from "vitest";
import {
  PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS,
  PLUGIN_RUN_CONTEXT_MAX_SECTIONS,
  PLUGIN_RUN_CONTEXT_MAX_TITLE_CHARS,
  validatePluginRunContextResult,
} from "./plugin-run-context.js";

describe("validatePluginRunContextResult", () => {
  it("accepts an empty or omitted contribution", () => {
    expect(validatePluginRunContextResult({})).toEqual({ ok: true, sections: [] });
    expect(validatePluginRunContextResult({ sections: [] })).toEqual({ ok: true, sections: [] });
  });

  it("accepts sections at the limits and trims surrounding whitespace", () => {
    const sections = Array.from({ length: PLUGIN_RUN_CONTEXT_MAX_SECTIONS }, (_, index) => ({
      title: index === 0 ? "t".repeat(PLUGIN_RUN_CONTEXT_MAX_TITLE_CHARS) : ` Title ${index} `,
      markdown: index === 0 ? "m".repeat(PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS - 7) : "x",
    }));
    const result = validatePluginRunContextResult({ sections });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sections[1]).toEqual({ title: "Title 1", markdown: "x" });
  });

  it.each([
    ["a non-object result", null],
    ["an array result", []],
    ["sections that are not an array", { sections: "text" }],
    ["null sections", { sections: null }],
    ["too many sections", { sections: Array.from({ length: PLUGIN_RUN_CONTEXT_MAX_SECTIONS + 1 }, () => ({ title: "T", markdown: "M" })) }],
    ["a non-object section", { sections: ["text"] }],
    ["a missing title", { sections: [{ markdown: "M" }] }],
    ["a blank title", { sections: [{ title: "  ", markdown: "M" }] }],
    ["a multi-line title", { sections: [{ title: "One\nTwo", markdown: "M" }] }],
    ["a long title", { sections: [{ title: "t".repeat(PLUGIN_RUN_CONTEXT_MAX_TITLE_CHARS + 1), markdown: "M" }] }],
    ["missing markdown", { sections: [{ title: "T" }] }],
    ["blank markdown", { sections: [{ title: "T", markdown: " \n" }] }],
    ["markdown over the per-plugin limit", { sections: [
      { title: "A", markdown: "a".repeat(PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS / 2) },
      { title: "B", markdown: "b".repeat(PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS / 2 + 1) },
    ] }],
  ])("rejects %s whole", (_name, value) => {
    const result = validatePluginRunContextResult(value);
    expect(result.ok).toBe(false);
  });

  it("never echoes plugin text in a rejection message", () => {
    const result = validatePluginRunContextResult({ sections: [{ title: "secret policy\nline", markdown: "secret body" }] });
    expect(result).toEqual({ ok: false, message: "Section 1 has a title longer than one line." });
  });
});
