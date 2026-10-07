-- Devices resolve as <device>.<dns_label>.<DNS_BASE_DOMAIN> instead of <device>.internal.
ALTER TABLE "networks" ADD COLUMN "dns_label" text;--> statement-breakpoint
-- New networks get two random words from the API; existing ones a random hex label.
UPDATE "networks" SET "dns_label" = 'mesh-' || substr(md5(random()::text || "id"::text), 1, 8);--> statement-breakpoint
ALTER TABLE "networks" ALTER COLUMN "dns_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_dns_label_unique" UNIQUE("dns_label");
