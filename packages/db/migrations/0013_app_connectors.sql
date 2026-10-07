CREATE TABLE "app_connector_hosts" (
	"connector_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	CONSTRAINT "app_connector_hosts_connector_id_device_id_pk" PRIMARY KEY("connector_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "app_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_connectors_network_id_name_unique" UNIQUE("network_id","name")
);
--> statement-breakpoint
ALTER TABLE "app_connector_hosts" ADD CONSTRAINT "app_connector_hosts_connector_id_app_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."app_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_connector_hosts" ADD CONSTRAINT "app_connector_hosts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_connectors" ADD CONSTRAINT "app_connectors_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;