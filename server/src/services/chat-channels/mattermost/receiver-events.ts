import { notifyChatReceiver } from "../runtime/receiver-work-notifications.js";
import type { EndpointRow, DbTransaction, RuntimeContext, LifecycleRuntimeFence, InternalSetupState } from "../runtime-types.js";

import { notifyChatEndpointWork } from "../../chat-work-notifications.js";

import { eq } from "drizzle-orm";

import type { Db } from "@paperclipai/db";

import {
  chatEndpoints,
  toolConnections,
} from "@paperclipai/db";
import type {
  ChatEndpointSetupState,
} from "@paperclipai/shared";

import type { MattermostReceiverCallbackEvent } from "../../chat-sdk-runtime.js";

type MattermostReceiverEventsOptions = {
  ensureReceiverRuntimeIsCurrent: (endpointId: string, context: RuntimeContext) => Promise<boolean>;
  receiverRuntimeIsCurrent: (endpointId: string, context: RuntimeContext) => boolean;
  runtimeCallbackEndpoint: (tx: DbTransaction, endpointId: string, context: LifecycleRuntimeFence, statuses: EndpointRow["status"][]) => Promise<EndpointRow | null>;
  runtimeGeneration: (setup: ChatEndpointSetupState) => number;
};

const HEALTH_PREFIX = "Mattermost ";

function failureDetail(event: MattermostReceiverCallbackEvent["event"]): string {
  if (event.type === "disconnected") {
    return event.fatal
      ? "Mattermost rejected the bot token; reconnect the bot"
      : `Mattermost WebSocket disconnected${event.code === undefined ? "" : ` (code ${event.code})`}; reconnecting`;
  }
  if (event.type === "failure") {
    const status = event.error.status === undefined ? "" : ` (${event.error.status})`;
    return event.fatal
      ? `Mattermost rejected the bot token${status}; reconnect the bot`
      : `Mattermost connection failed${status}; reconnecting`;
  }
  return "Mattermost connection needs attention";
}

/**
 * Mirrors WebSocket health into the endpoint, like Discord's Gateway events.
 * A transient disconnect only degrades connection health; a rejected token
 * moves the endpoint to attention and disables the connection.
 */
export function createMattermostReceiverEvents(db: Db, options: MattermostReceiverEventsOptions) {
  const { ensureReceiverRuntimeIsCurrent, receiverRuntimeIsCurrent, runtimeCallbackEndpoint, runtimeGeneration } = options;

  function handleMattermostReceiverEvent(
    callback: MattermostReceiverCallbackEvent,
    context: RuntimeContext,
  ): Promise<void> {
    // Reuse the per-runtime serial queue so health updates apply in order.
    const pending = (context.discordGatewayEventQueue ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => processEvent(callback, context));
    context.discordGatewayEventQueue = pending;
    return pending;
  }

  async function processEvent(
    callback: MattermostReceiverCallbackEvent,
    context: RuntimeContext,
  ): Promise<void> {
    if (!(await ensureReceiverRuntimeIsCurrent(callback.endpointId, context))) return;
    const event = callback.event;
    await db.transaction(async (tx) => {
      const current = await runtimeCallbackEndpoint(tx, callback.endpointId, context, ["verifying", "active", "attention"]);
      if (!current || current.provider !== "mattermost" || !receiverRuntimeIsCurrent(callback.endpointId, context)) return;
      const now = new Date();
      if (event.type === "connecting") {
        await tx
          .update(chatEndpoints)
          .set({ lastEventAt: now, updatedAt: now })
          .where(eq(chatEndpoints.id, current.id));
        return;
      }
      if (event.type === "ready") {
        const receiverOwnedAttention =
          current.status === "attention" && current.healthMessage?.startsWith(HEALTH_PREFIX) === true;
        if (current.status === "attention" && !receiverOwnedAttention) return;
        const status = current.setup.step === "complete" ? "active" : "verifying";
        await notifyChatReceiver(tx, current);
        if (status !== current.status) await notifyChatEndpointWork(tx, current.connectionId, current.companyId);
        await tx
          .update(chatEndpoints)
          .set({
            status,
            healthMessage: status === "active" ? "Connected" : "Waiting for a test conversation",
            lastError: null,
            lastEventAt: now,
            updatedAt: now,
          })
          .where(eq(chatEndpoints.id, current.id));
        await tx
          .update(toolConnections)
          .set({
            status: "active",
            enabled: true,
            healthStatus: "healthy",
            healthMessage: "Connected",
            lastError: null,
            healthCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(toolConnections.id, current.connectionId));
        return;
      }
      const detail = failureDetail(event);
      const fatal = event.fatal;
      await notifyChatReceiver(tx, current);
      await tx
        .update(chatEndpoints)
        .set({
          status: fatal ? "attention" : current.status,
          healthMessage: detail,
          lastError: detail,
          lastEventAt: now,
          ...(fatal
            ? {
                setup: {
                  ...current.setup,
                  runtimeGeneration: runtimeGeneration(current.setup) + 1,
                } as InternalSetupState,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(chatEndpoints.id, current.id));
      await tx
        .update(toolConnections)
        .set({
          status: fatal ? "disabled" : "active",
          enabled: !fatal,
          healthStatus: fatal ? "failed" : "degraded",
          healthMessage: detail,
          lastError: detail,
          healthCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(toolConnections.id, current.connectionId));
    });
  }

  return { handleMattermostReceiverEvent };
}
