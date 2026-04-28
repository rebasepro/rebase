ALTER TABLE "test" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "new_policy" ON "test" AS PERMISSIVE FOR SELECT TO public USING (true);