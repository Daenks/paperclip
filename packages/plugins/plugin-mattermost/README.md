# Mattermost plugin for Paperclip

Community plugin. A message in a Mattermost channel that starts with a trigger word goes to a Paperclip agent, and the agent's answer is posted in the thread.

## What it does

- Receives Mattermost **outgoing webhook** deliveries at `/api/plugins/community.mattermost/webhooks/outgoing`.
- Checks the webhook token, adds an 👀 reaction, and sends the message to the configured agent.
- Keeps one agent session per Mattermost thread, so follow-up messages in the thread continue the same conversation.
- Posts the answer as a reply in the thread. Long answers are split into several posts.
- Gives agents a `post_message` tool to post to a channel on their own.

## Setup

1. In Mattermost, create a bot account and copy its access token. Add the bot to the channels it should answer in.
2. In Mattermost, create an outgoing webhook (Integrations > Outgoing Webhooks). Set a trigger word, for example `@paperclip`, and set the callback URL to `https://<your paperclip>/api/plugins/community.mattermost/webhooks/outgoing`. Copy the webhook token.
3. In Paperclip, store the bot token and the webhook token as secrets.
4. Install the plugin and fill in its settings: Mattermost URL, the two secret references, the company ID and the agent ID.

Mattermost must be able to reach the Paperclip URL. If Paperclip is on a private network, list its host under System Console > Environment > Developer > "Allow untrusted internal connections to".

## Limits

These come from what a plugin can do today. See `doc/plans/2026-11-13-community-plugin-hooks.md`.

- Public channels only, and only messages with the trigger word. Outgoing webhooks do not fire for direct messages or private channels.
- One agent for the whole plugin. Every Mattermost user is treated the same; there is no link between a Mattermost user and a Paperclip user.
- No buttons for approvals or questions, no files, and no edits or deletes.
- The conversation is an agent session, not a Paperclip task bound to the thread.

## Development

```sh
pnpm --filter @daenks/paperclip-plugin-mattermost typecheck
pnpm --filter @daenks/paperclip-plugin-mattermost test
```
