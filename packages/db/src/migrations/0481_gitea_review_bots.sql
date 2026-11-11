CREATE TABLE "gitea_review_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"host_origin" text NOT NULL,
	"bot_login" text NOT NULL,
	"status_context" text DEFAULT 'Paperclip Review' NOT NULL,
	"repositories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gitea_review_bots" ADD CONSTRAINT "gitea_review_bots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitea_review_bots" ADD CONSTRAINT "gitea_review_bots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitea_review_bots" ADD CONSTRAINT "gitea_review_bots_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitea_review_bots" ADD CONSTRAINT "gitea_review_bots_trigger_id_routine_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."routine_triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gitea_review_bots_company_idx" ON "gitea_review_bots" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gitea_review_bots_trigger_uq" ON "gitea_review_bots" USING btree ("trigger_id");