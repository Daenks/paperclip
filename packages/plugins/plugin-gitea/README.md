# Gitea plugin for Paperclip

Community plugin. It gives agents tools for a self-hosted Gitea, and it runs a pull request review bot.

## What it does

**Agent tools** (need only the Gitea URL and an access token):

| Tool | Does |
| --- | --- |
| `list_repositories` | Lists the repositories the token can access |
| `list_pull_requests` | Lists the pull requests of a repository |
| `get_pull_request` | Returns one pull request, with its diff on request |
| `comment_on_pull_request` | Adds a comment to a pull request |
| `set_commit_status` | Sets a commit status |

**Review bot** (also needs the webhook secret, a company and a review agent):

- A Gitea webhook delivers pull request events to `/api/plugins/community.gitea/webhooks/events`. The plugin checks the `X-Gitea-Signature` header.
- A new pull request becomes a Paperclip task assigned to the review agent. The plugin sets a pending "Paperclip Review" commit status and posts one summary comment.
- New commits on the pull request add a note to the same task, move the status to the new commit, and update the same comment.
- When the task is done or cancelled, the plugin sets the final status and updates the comment.
- Events caused by the bot's own Gitea account are ignored.

## Setup

1. In Gitea, create an access token for the bot account with repository and issue write access.
2. In Paperclip, store the token as a secret. For the review bot, also store a webhook secret.
3. Install the plugin and set the Gitea URL and the token reference. For the review bot, also set the webhook secret reference, the company ID and the review agent ID.
4. For the review bot, add a webhook in Gitea (repository or organization settings): target `https://<your paperclip>/api/plugins/community.gitea/webhooks/events`, content type JSON, the same secret, trigger "Pull request".

## Limits

These come from what a plugin can do today. See `doc/plans/2026-11-13-community-plugin-hooks.md`.

- Paperclip's own project screens still know only GitHub: the repository picker, the default forge, and the Apps catalog do not show Gitea.
- The plugin does not supply git credentials. Paperclip's server clone and the agent's `git` need their own access to private Gitea repositories.
- The webhook is added by hand. The plugin cannot learn Paperclip's public URL, so it cannot register the webhook or link the commit status to the review task.
- Skills cannot be imported from Gitea repositories.

## Development

```sh
pnpm --filter @daenks/paperclip-plugin-gitea typecheck
pnpm --filter @daenks/paperclip-plugin-gitea test
```
