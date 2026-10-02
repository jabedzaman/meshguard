CREATE TYPE "public"."acl_default_action" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."acl_protocol" AS ENUM('any', 'tcp', 'udp', 'icmp');--> statement-breakpoint
CREATE TABLE "acl_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"source_device_id" uuid,
	"destination_device_id" uuid,
	"protocol" "acl_protocol" DEFAULT 'any' NOT NULL,
	"port_from" integer,
	"port_to" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "acl_default_action" "acl_default_action" DEFAULT 'allow' NOT NULL;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_source_device_id_devices_id_fk" FOREIGN KEY ("source_device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_destination_device_id_devices_id_fk" FOREIGN KEY ("destination_device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acl_rules_network_id_idx" ON "acl_rules" USING btree ("network_id");