import { unprocessable } from "../../../errors.js";
import {
  listMattermostBotChannels,
  normalizeMattermostBaseUrl,
  verifyMattermostBot,
} from "../../chat-mattermost.js";

import type { PreparedProviderInventory, VerifiedProviderIdentity } from "../runtime-types.js";

/** Canonicalizes the server URL before it is verified and stored. */
export function normalizeMattermostCredentials(values: Record<string, string>): Record<string, string> {
  if (!values.baseUrl) return values;
  try {
    return { ...values, baseUrl: normalizeMattermostBaseUrl(values.baseUrl) };
  } catch (error) {
    throw unprocessable(error instanceof Error ? error.message : "Mattermost URL is invalid", {
      code: "chat_provider_credentials_invalid",
      provider: "mattermost",
    });
  }
}

export async function verifyMattermostCredentials(
  credentials: Record<string, string>,
  fetchImpl: typeof fetch,
  redactError: (error: unknown) => string,
): Promise<VerifiedProviderIdentity> {
  return await verifyMattermostBot({
    baseUrl: credentials.baseUrl,
    botToken: credentials.botToken,
    teamId: credentials.teamId,
    fetch: fetchImpl,
  }).catch((error) => {
    throw unprocessable(redactError(error), {
      code: "chat_provider_permissions_missing",
      provider: "mattermost",
    });
  });
}

export async function prepareMattermostInventory(
  credentials: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<PreparedProviderInventory> {
  return {
    credentials,
    inventory: await listMattermostBotChannels({
      baseUrl: credentials.baseUrl,
      botToken: credentials.botToken,
      teamId: credentials.teamId,
      fetch: fetchImpl,
    }),
  };
}
