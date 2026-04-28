CREATE TABLE "users" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;