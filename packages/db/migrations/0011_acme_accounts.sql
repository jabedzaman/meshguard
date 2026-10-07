CREATE TABLE "acme_accounts" (
	"directory_url" text PRIMARY KEY NOT NULL,
	"key_pem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
