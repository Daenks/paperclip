import { api } from "./client";

export type GiteaReviewBot = {
  id: string;
  companyId: string;
  connectionId: string;
  agentId: string;
  routineId: string;
  hostOrigin: string;
  botLogin: string;
  statusContext: string;
  repositories: Array<{ fullName: string; hookId: number | null; error?: string | null }>;
  createdAt: string;
};

export type GiteaReviewBotManualSetup = {
  url: string;
  secret: string;
  contentType: string;
  events: string[];
  repositories: string[];
};

export const giteaApi = {
  listReviewBots: (companyId: string) => api.get<GiteaReviewBot[]>(`/companies/${companyId}/gitea/review-bots`),
  createReviewBot: (companyId: string, input: { connectionId: string; agentId: string; repositories: string[]; statusContext?: string }) =>
    api.post<{ bot: GiteaReviewBot; manualSetup: GiteaReviewBotManualSetup | null }>(`/companies/${companyId}/gitea/review-bots`, input),
  removeReviewBot: (companyId: string, botId: string) =>
    api.delete<{ removedHooks: string[] }>(`/companies/${companyId}/gitea/review-bots/${botId}`),
};
