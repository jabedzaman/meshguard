ALTER TABLE "devices" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
-- Existing devices belong to whoever created the token that enrolled them.
UPDATE "devices" SET "user_id" = "enrollment_tokens"."created_by" FROM "enrollment_tokens" WHERE "enrollment_tokens"."used_by_device_id" = "devices"."id";
