ALTER TABLE "devices" ADD COLUMN "ephemeral" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN "reusable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN "ephemeral" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN "uses" integer DEFAULT 0 NOT NULL;