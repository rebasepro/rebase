ALTER TABLE "tags_test_entities" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "tags_test_entities" CASCADE;--> statement-breakpoint
DROP TABLE "test_entities" CASCADE;--> statement-breakpoint
CREATE POLICY "test_policy" ON "posts" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "admin_bypass" ON "private_notes" AS PERMISSIVE FOR ALL TO public USING ((true) AND (string_to_array(auth.roles(), ',') @> ARRAY['admin'])) WITH CHECK ((true) AND (string_to_array(auth.roles(), ',') @> ARRAY['admin']));--> statement-breakpoint
CREATE POLICY "owner_access" ON "private_notes" AS PERMISSIVE FOR ALL TO public USING ("private_notes"."user_id" = auth.uid()) WITH CHECK ("private_notes"."user_id" = auth.uid());--> statement-breakpoint
CREATE POLICY "no_update_locked" ON "private_notes" AS RESTRICTIVE FOR UPDATE TO public USING ("private_notes"."is_locked" = false) WITH CHECK ("private_notes"."is_locked" = false);--> statement-breakpoint
DROP TYPE "public"."test_entities_number_enum";--> statement-breakpoint
DROP TYPE "public"."test_entities_string_enum";