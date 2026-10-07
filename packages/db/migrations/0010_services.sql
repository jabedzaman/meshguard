CREATE TABLE "service_hosts" (
	"service_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	CONSTRAINT "service_hosts_service_id_device_id_pk" PRIMARY KEY("service_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"name" text NOT NULL,
	"vip" "inet" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_network_id_name_unique" UNIQUE("network_id","name"),
	CONSTRAINT "services_network_id_vip_unique" UNIQUE("network_id","vip")
);
--> statement-breakpoint
ALTER TABLE "acl_rules" DROP CONSTRAINT "acl_rules_one_source";--> statement-breakpoint
ALTER TABLE "acl_rules" DROP CONSTRAINT "acl_rules_one_destination";--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "source_service" text;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD COLUMN "destination_service" text;--> statement-breakpoint
ALTER TABLE "service_hosts" ADD CONSTRAINT "service_hosts_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_hosts" ADD CONSTRAINT "service_hosts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_one_source" CHECK (num_nonnulls("acl_rules"."source_device_id", "acl_rules"."source_tag", "acl_rules"."source_user_id", "acl_rules"."source_role", "acl_rules"."source_service") <= 1);--> statement-breakpoint
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_one_destination" CHECK (num_nonnulls("acl_rules"."destination_device_id", "acl_rules"."destination_tag", "acl_rules"."destination_user_id", "acl_rules"."destination_role", "acl_rules"."destination_service") <= 1);