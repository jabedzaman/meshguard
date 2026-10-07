CREATE TYPE "public"."acl_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "source_tag" text;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "source_user_id" text;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "source_role" "acl_role";--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "destination_tag" text;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "destination_user_id" text;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "destination_role" "acl_role";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_source_user_id_user_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_destination_user_id_user_id_fk" FOREIGN KEY ("destination_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_one_source" CHECK (num_nonnulls("acl_rules"."source_device_id", "acl_rules"."source_tag", "acl_rules"."source_user_id", "acl_rules"."source_role") <= 1);--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_one_destination" CHECK (num_nonnulls("acl_rules"."destination_device_id", "acl_rules"."destination_tag", "acl_rules"."destination_user_id", "acl_rules"."destination_role") <= 1);