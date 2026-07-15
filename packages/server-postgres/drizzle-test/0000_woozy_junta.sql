CREATE TABLE "test" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "old_policy" ON "test" AS PERMISSIVE FOR SELECT TO public;