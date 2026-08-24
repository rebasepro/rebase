-- Retrofit derived RLS onto the posts_tags junction in an existing database.
--
-- This is the exact output of the DDL generator for the demo's posts/tags
-- collections after the junction-RLS change, validated end-to-end against a
-- scratch Postgres (caller matrix: server/anonymous/user/admin, plus the
-- delegation proof — making posts private hides the edges with no junction
-- change). New databases get these from `rebase db push` automatically; this
-- file exists to close the hole on databases pushed before the fix.
--
-- The policies call `rebase.uid()` / `rebase.roles()`, which a boot or a
-- `rebase db push` creates. On a database still carrying only the pre-1.0
-- `auth` helpers, start the backend once before applying this — otherwise
-- CREATE POLICY fails with "function rebase.uid() does not exist".
--
-- Apply:   psql "$DATABASE_URL" -f scripts/apply-posts-tags-rls.sql
-- Revert:  ALTER TABLE "public"."posts_tags" DISABLE ROW LEVEL SECURITY;
--          (and DROP the five policies below if you want them gone)

BEGIN;

ALTER TABLE "public"."posts_tags" ENABLE ROW LEVEL SECURITY;

-- Locked baseline: the server context and admins can always operate.
DROP POLICY IF EXISTS "posts_tags_default_admin_read" ON "public"."posts_tags";
CREATE POLICY "posts_tags_default_admin_read" ON "public"."posts_tags" AS PERMISSIVE FOR SELECT TO "public"
    USING ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']));

DROP POLICY IF EXISTS "posts_tags_default_admin_write_insert" ON "public"."posts_tags";
CREATE POLICY "posts_tags_default_admin_write_insert" ON "public"."posts_tags" AS PERMISSIVE FOR INSERT TO "public"
    WITH CHECK ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']));

DROP POLICY IF EXISTS "posts_tags_default_admin_write_update" ON "public"."posts_tags";
CREATE POLICY "posts_tags_default_admin_write_update" ON "public"."posts_tags" AS PERMISSIVE FOR UPDATE TO "public"
    USING ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
    WITH CHECK ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']));

DROP POLICY IF EXISTS "posts_tags_default_admin_write_delete" ON "public"."posts_tags";
CREATE POLICY "posts_tags_default_admin_write_delete" ON "public"."posts_tags" AS PERMISSIVE FOR DELETE TO "public"
    USING ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']));

-- Reads follow the endpoints: an edge is visible iff both rows are. The
-- subqueries run under the caller's role, so posts' and tags' own RLS filters
-- them — visibility is delegated, not copied. The demo blog keeps rendering
-- its tags because posts and tags are publicly readable.
DROP POLICY IF EXISTS "posts_tags_default_edge_read" ON "public"."posts_tags";
CREATE POLICY "posts_tags_default_edge_read" ON "public"."posts_tags" AS PERMISSIVE FOR SELECT TO "public"
    USING ((EXISTS (SELECT 1 FROM "public"."posts" "_ex0" WHERE "_ex0".id = "public"."posts_tags".post_id))
       AND (EXISTS (SELECT 1 FROM "public"."tags" "_ex1" WHERE "_ex1".id = "public"."posts_tags".tag_id)));

COMMIT;
