import { LegacyProjectRepository } from "./LegacyProjectRepository";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Forge, Project, ProjectRepository } from "@paperclipai/shared";
import { useEffectiveForge } from "@/hooks/useForge";
import { NativeSelect } from "./ui/select";
import { projectsApi } from "@/api/projects";
import { describeError } from "@/api/errors";
import { queryKeys } from "@/lib/queryKeys";
import { ConnectionSetupFlow } from "@/features/connections/ConnectionSetupFlow";
import { ProjectRepositoryInput, repositoryOptionsKey } from "./ProjectRepositoryInput";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

export function ProjectRepositories({ project }: { project: Project }) {
  const client = useQueryClient();
  const saved: ProjectRepository[] = project.workspaces.flatMap((workspace) => {
    const id = workspace.metadata?.githubRepositoryId;
    return typeof id === "string" && workspace.repoUrl ? [{ id, fullName: workspace.name, url: workspace.repoUrl, connections: [],
      ...(workspace.metadata?.repositoryProvider === "gitea" ? { provider: "gitea" as const } : {}) }] : [];
  });
  const { forge, giteaEnabled, companyDefault } = useEffectiveForge(project);
  const setForge = useMutation({
    mutationFn: (next: Forge) => projectsApi.update(project.id, { sourceForge: next === companyDefault ? null : next }, project.companyId),
    onSuccess: (updated) => {
      for (const ref of new Set([project.id, project.urlKey])) client.setQueriesData({ queryKey: queryKeys.projects.detail(ref) }, updated);
      void client.invalidateQueries({ queryKey: queryKeys.projects.all(project.companyId) });
    },
  });
  const [draft, setDraft] = useState<ProjectRepository[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const save = useMutation({
    mutationFn: () => projectsApi.setRepositories(project.id, (draft ?? saved).map((repo) => repo.id)),
    onSuccess: (updated) => {
      for (const ref of new Set([project.id, project.urlKey])) {
        client.setQueriesData({ queryKey: queryKeys.projects.detail(ref) }, updated);
        void client.invalidateQueries({ queryKey: queryKeys.projects.detail(ref) });
      }
      void client.invalidateQueries({ queryKey: queryKeys.projects.all(project.companyId) });
      void client.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
      setDraft(null);
    },
  });
  return <section aria-label="Repositories" className="flex min-w-0 flex-col gap-4 py-4">
    {giteaEnabled && <div className="flex flex-col gap-2">
      <label htmlFor="project-source-forge" className="text-sm font-medium">Source forge</label>
      <NativeSelect id="project-source-forge" value={forge} disabled={setForge.isPending || save.isPending}
        onChange={(event) => setForge.mutate(event.target.value as Forge)}>
        <option value="github">GitHub{companyDefault === "github" ? " (company default)" : ""}</option>
        <option value="gitea">Gitea{companyDefault === "gitea" ? " (company default)" : ""}</option>
      </NativeSelect>
      {setForge.status === "error" && <p role="alert" className="text-sm text-destructive">{describeError(setForge.error).body}</p>}
    </div>}
    <ProjectRepositoryInput companyId={project.companyId} selected={draft ?? saved} onChange={(repos) => { setDraft(repos); save.reset(); }} onConnect={() => setConnecting(true)} disabled={save.isPending} forge={forge} />
    {project.workspaces.filter((workspace) => workspace.repoUrl && !workspace.metadata?.githubRepositoryId).map((workspace) => <LegacyProjectRepository key={workspace.id} workspace={workspace} projectRef={project.urlKey} />)}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
      {save.status === "error" && <p role="alert" className="mr-auto text-sm text-destructive">{describeError(save.error).body}</p>}
      {save.isSuccess && <span role="status" className="mr-auto text-sm text-muted-foreground">Changes saved</span>}
      {draft && <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => { setDraft(null); save.reset(); }}>Discard changes</Button>}
      <Button type="button" disabled={!draft || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
    </div>
    <Dialog open={connecting} onOpenChange={setConnecting}><DialogContent showCloseButton={false} aria-describedby={undefined} className="max-h-(--sz-calc-18) overflow-y-auto sm:max-w-2xl">
      <DialogTitle className="sr-only">Connect {forge === "gitea" ? "Gitea" : "GitHub"}</DialogTitle>
      <ConnectionSetupFlow host="dialog" serviceSlug={forge} forceNewConnection onCancel={() => setConnecting(false)} onComplete={() => {
        void client.invalidateQueries({ queryKey: repositoryOptionsKey(project.companyId) });
        setConnecting(false);
      }} />
    </DialogContent></Dialog>
  </section>;
}
