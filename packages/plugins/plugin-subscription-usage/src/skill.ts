import { USAGE_TOOL_NAME } from "./usage.js";

export const USAGE_SKILL_MARKDOWN = `---
name: subscription-usage-pacing
description: Use before starting large or optional work, and when planning or assigning work, to check how much of the company's shared AI subscription quota is left and pace work to it.
---

# Subscription usage pacing

The company's agents share AI subscription accounts. Each account has usage
windows (for example a 5-hour window and a weekly window). When a window is
used up, runs on that account fail until it resets.

## When to check

Call the \`${USAGE_TOOL_NAME}\` tool:

- before you start work that is large, optional, or easy to postpone
- when you plan, prioritize or hand out work to other agents
- when a run fails with a usage-limit error

Do not call it before every small step. One check per task is enough unless
the task runs for a long time.

## How to read the result

The tool reports a level for the company and for each account:

- \`ok\`: work normally.
- \`warn\`: finish what is in progress, prefer high-priority work, and do not
  start large optional work before the reset.
- \`critical\`: do only urgent or high-priority work. Leave the rest for after
  the reset, and say on the task that you deferred it and until when.
- \`unknown\`: the quota could not be read. Work normally, but do not assume
  there is plenty left.

Each window also shows the percent left, when it resets, and its pace. A
window that is low but resets in a few minutes matters less than one that is
low with days to go. A window marked as applying to one model only does not
limit work on other models.

## What not to do

- Do not stop work that the board or your manager marked urgent because quota
  is low. Do it, and report the quota level.
- Do not pause other agents or change budgets because of this tool. Report to
  your manager instead.
- Do not treat the numbers as money. They are percentages of a subscription
  window, not spend.
`;
