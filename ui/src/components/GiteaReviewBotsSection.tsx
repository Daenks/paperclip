import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import { describeError } from "@/api/errors";
import { giteaApi, type GiteaReviewBotManualSetup } from "@/api/gitea";
import { projectsApi } from "@/api/projects";
import { toolsApi } from "@/api/tools";
import { useGiteaEnabled } from "@/hooks/useForge";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/select";

const botsKey = (companyId: string) => ["gitea-review-bots", companyId] as const;

/** Company settings panel for Gitea review bots; shown only when the instance enables Gitea. */
export function GiteaReviewBotsSection({ companyId }: { companyId: string }) {
  const giteaEnabled = useGiteaEnabled();
  const client = useQueryClient();
  const bots = useQuery({ queryKey: botsKey(companyId), queryFn: () => giteaApi.listReviewBots(companyId), enabled: giteaEnabled });
  const connections = useQuery({ queryKey: ["tool-connections", companyId], queryFn: () => toolsApi.listConnections(companyId), enabled: giteaEnabled });
  const agents = useQuery({ queryKey: ["agents", companyId], queryFn: () => agentsApi.list(companyId), enabled: giteaEnabled });
  const repos = useQuery({ queryKey: ["project-repositories", companyId, "gitea"], queryFn: () => projectsApi.repositoryOptions(companyId, "gitea"), enabled: giteaEnabled });
  const [connectionId, setConnectionId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [manual, setManual] = useState<GiteaReviewBotManualSetup | null>(null);
  const create = useMutation({
    mutationFn: () => giteaApi.createReviewBot(companyId, { connectionId, agentId, repositories: selected }),
    onSuccess: (result) => {
      setManual(result.manualSetup);
      setSelected([]);
      void client.invalidateQueries({ queryKey: botsKey(companyId) });
    },
  });
  const remove = useMutation({
    mutationFn: (botId: string) => giteaApi.removeReviewBot(companyId, botId),
    onSuccess: () => void client.invalidateQueries({ queryKey: botsKey(companyId) }),
  });
  if (!giteaEnabled) return null;
  const giteaConnections = (connections.data?.connections ?? []).filter((connection) => connection.config?.sourceTemplateKey === "gitea");
  const giteaRepos = repos.data?.repositories ?? [];
  return (
    <div className="max-w-2xl space-y-4" data-testid="company-settings-gitea-review-bots">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gitea review bots</div>
      <p className="text-sm text-muted-foreground">
        A review bot asks an agent to review pull requests on the repositories you pick. It acts as the Gitea identity of the chosen connection, posts a "Paperclip Review" status and a summary comment, and reviews when a pull request opens, gets new commits, or mentions the bot.
      </p>
      {bots.error && <p role="alert" className="text-sm text-destructive">{describeError(bots.error).body}</p>}
      {(bots.data ?? []).map((bot) => (
        <div key={bot.id} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">@{bot.botLogin} on {bot.hostOrigin}</span>
            <Button type="button" variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(bot.id)}>Remove</Button>
          </div>
          <ul className="text-xs text-muted-foreground">
            {bot.repositories.map((repo) => <li key={repo.fullName}>{repo.fullName}{repo.hookId === null ? ` (webhook not registered${repo.error ? `: ${repo.error}` : ""})` : ""}</li>)}
          </ul>
        </div>
      ))}
      <form className="flex flex-col gap-3 rounded-md border border-border px-3 py-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <div className="space-y-1">
          <label htmlFor="gitea-bot-connection" className="text-sm font-medium">Gitea connection (bot identity)</label>
          <NativeSelect id="gitea-bot-connection" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
            <option value="">Choose a connection</option>
            {giteaConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor="gitea-bot-agent" className="text-sm font-medium">Reviewing agent</label>
          <NativeSelect id="gitea-bot-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">Choose an agent</option>
            {(agents.data ?? []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </NativeSelect>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Repositories</legend>
          {repos.isLoading && <p className="text-xs text-muted-foreground">Loading Gitea repositories…</p>}
          {repos.error && <p role="alert" className="text-xs text-destructive">Couldn’t load Gitea repositories: {describeError(repos.error).body}</p>}
          {repos.data && repos.data.failedConnectionCount > 0 && (
            <p role="alert" className="text-xs text-destructive">
              {repos.data.failedConnectionCount === 1 ? "A Gitea connection" : `${repos.data.failedConnectionCount} Gitea connections`} couldn’t list repositories. Check the connection’s host and token scopes; the server log has the reason.
            </p>
          )}
          {repos.data && repos.data.connectionCount === 0 && (
            <p className="text-xs text-muted-foreground">No Gitea connection you can use lists repositories yet. Connect Gitea in Apps first.</p>
          )}
          {repos.data && repos.data.connectionCount > 0 && repos.data.failedConnectionCount === 0 && giteaRepos.length === 0 && (
            <p className="text-xs text-muted-foreground">The Gitea connection returned no repositories its identity can access.</p>
          )}
          {giteaRepos.map((repo) => (
            <label key={repo.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(repo.fullName)}
                onChange={(event) => setSelected(event.target.checked ? [...selected, repo.fullName] : selected.filter((name) => name !== repo.fullName))} />
              {repo.fullName}
            </label>
          ))}
        </fieldset>
        {create.error && <p role="alert" className="text-sm text-destructive">{describeError(create.error).body}</p>}
        {selected.length === 0 && connectionId && agentId && giteaRepos.length > 0 && (
          <p className="text-xs text-muted-foreground">Pick at least one repository.</p>
        )}
        <Button type="submit" className="self-start" disabled={!connectionId || !agentId || selected.length === 0 || create.isPending}>
          {create.isPending ? "Creating…" : "Create review bot"}
        </Button>
      </form>
      {manual && (
        <div role="status" className="space-y-2 rounded-md border border-border px-3 py-3 text-sm">
          <p className="font-medium">Add this webhook in Gitea for: {manual.repositories.join(", ")}</p>
          <p className="text-xs text-muted-foreground">Paperclip could not register it there. The secret is shown only now.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt>Target URL</dt><dd className="break-all font-mono">{manual.url}</dd>
            <dt>Content type</dt><dd className="font-mono">{manual.contentType}</dd>
            <dt>Secret</dt><dd className="break-all font-mono">{manual.secret}</dd>
            <dt>Events</dt><dd>Pull request, pull request synchronized, pull request comment</dd>
          </dl>
          <Button type="button" variant="ghost" size="sm" onClick={() => setManual(null)}>Done</Button>
        </div>
      )}
    </div>
  );
}
