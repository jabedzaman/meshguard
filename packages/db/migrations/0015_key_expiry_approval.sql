ALTER TABLE "devices" ADD COLUMN "approved" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "key_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN "pre_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "device_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "key_expiry_days" integer DEFAULT 180;