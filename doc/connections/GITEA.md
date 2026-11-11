# Gitea

Gitea can stand in for GitHub as a source forge: project repositories, agent Git access,
repository tools (gitea-mcp), the review bot and skill sources. GitHub keeps working beside it.

Status: local fork (`Daenks/paperclip`, branch `local/gitea`). Verified against Gitea 1.25.1 and
gitea-mcp v1.13.0. Forgejo is not claimed.

## Turn it on

1. **Instance:** Settings → Experimental → **Gitea** (`experimental.enableGitea`). Every Gitea path
   is off without it, including the Apps entry.
2. **Company:** Company settings → **Source forge** → default forge **Gitea**. New projects pick
   repositories from Gitea. A project can choose the other forge in its Repositories tab.
3. **Connection:** Apps → **Gitea**. Every method asks for the Gitea host (hostname only) and its
   HTTPS port. The host is what repositories, agent Git and the review bot use.

## Connection methods

| Method | When | Notes |
|---|---|---|
| Use an access token (`mcp-access-token`) | You run `gitea-mcp -t http` | Paperclip calls `https://<mcpHost>:<mcpPort>/mcp` with `Authorization: Bearer <token>`. |
| Use your own Gitea OAuth2 app (`mcp-own-oauth`) | You run `gitea-mcp -t http -oauth -oauth-public-url …` | Register an OAuth2 app in Gitea (Settings → Applications) with Paperclip's callback URL, then enter the client ID and secret. A person signs in once; Paperclip refreshes the token. Not run end to end yet (needs a browser sign-in). |
| Run gitea-mcp on the Paperclip server (`local-stdio`) | `gitea-mcp` is on the server's PATH | Approved template `paperclip.gitea-mcp`: `gitea-mcp -t stdio` with `GITEA_HOST` from the connection and `GITEA_ACCESS_TOKEN` from its credential. |

The token (or OAuth token) is the identity for repository tools **and** for Git over HTTPS on
that host.

**gitea-mcp behind a reverse proxy:** gitea-mcp rejects requests whose `Host` header it does not
expect (`Forbidden: invalid Host header`). Have the proxy send the upstream host (nginx's default
`proxy_set_header Host $proxy_host`), or, with `-oauth`, set `-oauth-public-url` to the public URL.

## Agent Git

Gitea remotes are authenticated over HTTPS only. No SSH (deferred).

Token used for a run, in order:

1. A Gitea connection for that host installed for the company or the agent: the agent's own
   grant, else the responsible user's, else the organization's. If a connection exists but has
   no usable identity, the run fails closed for that host.
2. Only for hosts listed in `PAPERCLIP_GITEA_HOSTS`: the `GITEA_TOKEN` (or
   `PAPERCLIP_GITEA_TOKEN`) company secret, then the server's `GITEA_TOKEN` env.

How it reaches git:

- **Server clones** (managed project checkouts, workspace refreshes): URL-scoped credential
  helpers passed as `-c` arguments; the token stays in the environment.
- **Agent runs with Paperclip's git launcher** (a managed GitHub identity exists, or sandboxes):
  the runtime credential broker returns a `gitea` block next to GitHub's; the launcher appends
  its helpers after GitHub's entries.
- **Agent runs with host credentials** (no managed GitHub identity, local or SSH environment):
  the helpers go straight into the run environment, each preceded by an empty URL-scoped
  helper so the host's own credential helper does not answer first for that Gitea host. Other
  hosts keep the host's credentials.

Low-trust (quarantined) issues get no Gitea credential. Token env keys are redacted from run logs.

## Project repositories

The repository picker lists repositories the Gitea connection's identity can see
(`/api/v1/user/repos`). Catalog ids are `gitea:<origin>:<repository id>`, for example
`gitea:https://gitea.example.org:42` (repository 42) or `gitea:https://gitea.example.org:8443:42`. Workspaces
record `repositoryProvider: "gitea"`; the existing `githubRepository*` metadata keys are reused
for the catalog id, URL and visibility (naming debt, kept so existing UI and services work).
Gitea URLs pasted by hand are accepted on configured hosts.

## Review bot

Company settings → **Gitea review bots** → choose the Gitea connection (the bot's identity), the
reviewing agent and repositories.

- Paperclip creates a routine (issues assigned to the agent) with a webhook trigger in
  `github_hmac` mode; Gitea sends `X-Hub-Signature-256`.
- It registers repository webhooks (pull request, pull request synchronized, pull request
  comment) with the bot identity. Where it cannot, it shows the URL, secret and events once so
  you add the webhook by hand.
- Webhook URL: `<public Paperclip URL>/api/gitea/review-bots/<id>/webhook`. Gitea must reach it.
  Set `PAPERCLIP_API_URL` (or the public URL) so the URL is right.
- Reviews start when a pull request opens, reopens or gets new commits (not drafts), or when a
  pull request comment mentions the bot. The bot's own events never trigger it. Re-deliveries of
  the same head commit are deduplicated.
- On queueing, Paperclip posts a pending **Paperclip Review** commit status linking to the issue,
  and one summary comment (`<!-- paperclip-review -->`) that it edits in place on later reviews.
- The agent reviews with gitea-mcp tools, then updates the summary comment and sets the status
  to success or failure (instructions are in the routine).

## Skill sources

Skill import accepts Gitea URLs (`https://host/owner/repo`,
`…/src/branch/<ref>/<path>`, `…/src/commit/<sha>/<path>`) on configured hosts, pins to a
commit and tracks updates. Private repositories need the host in `PAPERCLIP_GITEA_HOSTS` and a
server `GITEA_TOKEN`; connection tokens are company data and are not used for these shared
fetches.

## Not done

- Link previews and external objects for Gitea URLs.
- Gitea in company export/import (portability) beyond what the GitHub helpers already handle.
- OAuth2 method end to end with a real browser sign-in.
- SSH transport for agent Git (deferred by decision).
