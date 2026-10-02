-- Device names become DNS labels, unique per network (`<name>.internal`).
UPDATE "devices" SET "name" = coalesce(
  nullif(trim(both '-' from left(regexp_replace(lower(split_part("name", '.', 1)), '[^a-z0-9-]+', '-', 'g'), 63)), ''),
  'device'
);--> statement-breakpoint
UPDATE "devices" AS d SET "name" = trim(trailing '-' from left(d."name", 62 - length(r.n::text))) || '-' || r.n
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "network_id", "name" ORDER BY "created_at", "id") AS n FROM "devices"
) AS r
WHERE d."id" = r."id" AND r.n > 1;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_network_id_name_unique" UNIQUE("network_id","name");
