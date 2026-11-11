import { cn } from "@/lib/utils";

/** The Gitea logo from the Apps brand assets, sized like a lucide icon. */
export function GiteaIcon({ className }: { className?: string }) {
  return <img src="/brands/apps/gitea.svg" alt="" aria-hidden="true" className={cn("inline-block shrink-0", className)} />;
}
