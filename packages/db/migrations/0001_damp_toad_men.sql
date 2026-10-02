ALTER TABLE "devices" ADD CONSTRAINT "devices_network_id_mesh_ipv4_unique" UNIQUE("network_id","mesh_ipv4");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_network_id_mesh_ipv6_unique" UNIQUE("network_id","mesh_ipv6");--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_ipv6_cidr_unique" UNIQUE("ipv6_cidr");--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_organization_id_name_unique" UNIQUE("organization_id","name");