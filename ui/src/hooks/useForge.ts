import { useQuery } from "@tanstack/react-query";
import { effectiveProjectForge, type Forge } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";

/** The instance switch for Gitea (`experimental.enableGitea`). */
export function useGiteaEnabled(): boolean {
  const query = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  return query.data?.enableGitea === true;
}

/** The forge a project's source repositories come from (its own setting, else the company default). */
export function useEffectiveForge(project?: { sourceForge?: Forge | null } | null): {
  forge: Forge;
  giteaEnabled: boolean;
  companyDefault: Forge;
} {
  const { selectedCompany } = useCompany();
  const giteaEnabled = useGiteaEnabled();
  const companyDefault = effectiveProjectForge(selectedCompany, null, { giteaEnabled });
  return { forge: effectiveProjectForge(selectedCompany, project ?? null, { giteaEnabled }), giteaEnabled, companyDefault };
}
