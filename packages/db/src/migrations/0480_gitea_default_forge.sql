ALTER TABLE "companies" ADD COLUMN "default_forge" text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_forge" text;