CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "authenticated_access" ON "jobs" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "company_insert_pending" ON "jobs" AS PERMISSIVE FOR INSERT TO public;