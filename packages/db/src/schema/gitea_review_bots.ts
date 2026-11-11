import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { routines, routineTriggers } from "./routines.js";

/**
 * A Gitea review bot: Gitea webhooks for selected repositories feed a routine whose
 * issues are assigned to the reviewing agent. The bot's Gitea identity is the identity of
 * the chosen Gitea connection. `repositories` records where Paperclip registered a webhook
 * (`hookId`) or where the administrator must add it by hand (`hookId: null`).
 */
export const giteaReviewBots = pgTable(
  "gitea_review_bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id").notNull().references(() => routines.id, { onDelete: "cascade" }),
    triggerId: uuid("trigger_id").notNull().references(() => routineTriggers.id, { onDelete: "cascade" }),
    hostOrigin: text("host_origin").notNull(),
    botLogin: text("bot_login").notNull(),
    statusContext: text("status_context").notNull().default("Paperclip Review"),
    repositories: jsonb("repositories").$type<Array<{ fullName: string; hookId: number | null; error?: string | null }>>().notNull().default([]),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("gitea_review_bots_company_idx").on(table.companyId),
    triggerUq: uniqueIndex("gitea_review_bots_trigger_uq").on(table.triggerId),
  }),
);
