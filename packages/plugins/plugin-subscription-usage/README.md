# Subscription Usage

Lets agents see how much of the company's shared AI subscription quota is left,
so they can pace their work.

## Scope

Paperclip already reads the usage windows of connected subscription accounts
(for example the 5-hour and weekly windows of a ChatGPT or Claude subscription)
and shows them to the board on the Costs page. Agents cannot see them, and core
only reacts after a limit is hit. This plugin gives agents the same numbers
ahead of time.

This package requires the plugin quota hook in Paperclip core
(`ctx.costs.quotaWindows`, capability `costs.read`). It does not build against
a Paperclip without that hook.

The surface is:

- the `subscription_usage` agent tool. It takes no parameters and reports, for
  the run's company, a level (`ok`, `warn`, `critical`, `unknown`) and, per
  account window, percent left, reset time and pace
- the `subscription-usage-pacing` managed skill, which tells an agent when to
  call the tool and what to do at each level
- the `poll-subscription-usage` job, every 10 minutes. It stores the latest
  status per company in plugin state (`scopeKind: "company"`, `stateKey:
  "usage-snapshot"`) and, when an alert agent is set, wakes that agent when a
  window reaches `warn` or `critical`

Capabilities: `costs.read`, `companies.read`, `agents.read`, `agents.invoke`,
`agent.tools.register`, `jobs.schedule`, `plugin.state.read`,
`plugin.state.write`, `skills.managed`. The plugin has no UI, API routes,
webhooks or event subscriptions. It makes no outbound requests and never sees
an account credential; the host reads the provider.

## Which accounts

Only company-shared subscription accounts are reported. That is the rule of the
host hook: a plugin has no user, so personal accounts are never returned. A
company whose agents run on a personal account gets the level `unknown`.

## Levels and pace

Percent left = 100 minus the percent used that the provider reports.

- `critical`: a window has `criticalRemainingPercent` or less left (default 10)
- `warn`: a window has `warnRemainingPercent` or less left (default 25)
- `ok`: every window has more than that left
- `unknown`: no account could be read

An account's level is the worst of its windows, and the company's level is the
worst of its accounts. Two kinds of window are listed but do not set the level:
a window for one model only (label contains "only"), and paid extras ("Credits",
"Extra usage").

Pace compares percent used with the share of the window's time that has passed.
The window length is read from the provider's label (`5h`, `7d`, "session",
"week"); pace is `unknown` when the label does not say. More than 10 points
ahead is `over`, more than 10 behind is `under`.

The plugin only informs. It does not pause agents, change budgets or block runs.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `warnRemainingPercent` | 25 | Warn at this percent left or less |
| `criticalRemainingPercent` | 10 | Critical at this percent left or less |
| `alertAgentId` | empty | Agent to wake on `warn` or `critical`. Empty means no one is woken |

Save the settings for each company that should be checked, even if nothing is
changed. The host lets a scheduled job act only on companies where the plugin
has saved settings. The agent tool works without that.

An alert is sent once when a window reaches a level, again if it gets worse,
and again in a later window. If the agent cannot be woken, the next check tries
again. Waking an agent uses quota, so only one agent is woken.

## Skill

The job installs the `subscription-usage-pacing` skill as a company skill the
first time it runs for a company. Assign it to the agents that should pace
their work.

## Development

```sh
pnpm --filter @paperclipai/plugin-subscription-usage typecheck
pnpm --filter @paperclipai/plugin-subscription-usage test
pnpm --filter @paperclipai/plugin-subscription-usage build
```
