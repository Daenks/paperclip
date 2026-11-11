import type { Forge } from "@paperclipai/shared";
import { GiteaIcon } from "./gitea-icon";
import { GithubIcon } from "./github-icon";

export const FORGE_LABELS: Record<Forge, string> = { github: "GitHub", gitea: "Gitea" };

export function ForgeIcon({ forge, className }: { forge: Forge; className?: string }) {
  return forge === "gitea" ? <GiteaIcon className={className} /> : <GithubIcon className={className} />;
}
