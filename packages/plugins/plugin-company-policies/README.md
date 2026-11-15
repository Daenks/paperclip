# Company Policies

Company-wide policies written by the board and added to every agent run in the company.

## Scope

The board writes one Markdown policy per company on a company settings page.
While **Apply to all agents** is on and the text is not blank, every run of every
agent in that company receives it as a section titled "Company policies", through
the host's `agent.run.context.contribute` hook. No agent's instructions or skills
change.

This package requires the plugin run-context hook in Paperclip core
(`agent.run.context.contribute`, `onContributeRunContext`). It does not build
against a Paperclip without that hook.

The surface is:

- a `companySettingsPage` slot at `/:companyPrefix/company/settings/policies`
  ("Company policies" in the company settings sidebar) with a Markdown text
  area, the **Apply to all agents** switch, a character counter against the
  host's per-plugin limit (`PLUGIN_RUN_CONTEXT_MAX_MARKDOWN_CHARS`, 20,000),
  last-saved information, and Save
- one policy document per company in plugin state (`scopeKind: "company"`,
  `stateKey: "policy"`): `{ markdown, enabled, updatedAt, updatedBy, revision }`
- the `policy` data key (read) and the `save-policy` action (write)
- `onContributeRunContext`, which returns the one section or nothing

Capabilities: `agent.run.context.contribute`, `plugin.state.read`,
`plugin.state.write`, `instance.settings.register` (required by the
`companySettingsPage` slot). The plugin registers no agent tools, API routes,
jobs or event subscriptions.

### Who can change the policy

`save-policy` accepts only a board user (`actor.type === "user"`) and writes only
to the company the host authorized for the call. The host's action route checks
company access (active, non-viewer membership for board users) before the call
reaches the worker. That route also accepts an agent API key for the agent's own
company, so the worker refuses every actor that is not a board user. A save must
name the revision it edits, so a save over someone else's newer save is refused.
A save over the character limit is refused with the counts in the message; the
host would otherwise drop the whole contribution from every run.

### Seeing what an agent received

Each run that receives the policy records a `plugin_run_context.applied` run
event with the digest and per-plugin character counts (no policy text). A run
whose plugin context could not be added records `plugin_run_context.skipped`.

## Development

From the Paperclip repo root:

```bash
pnpm --filter @paperclipai/plugin-company-policies typecheck
pnpm --filter @paperclipai/plugin-company-policies test
pnpm --filter @paperclipai/plugin-company-policies build
```

The tests run on the SDK test harness and cover save and load, company
isolation, board-only saves, the over-limit refusal, stale-revision refusal, the
switch, an empty policy, and the shape of the run-context contribution.
