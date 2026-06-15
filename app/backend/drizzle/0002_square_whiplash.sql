-- We skip CREATE SCHEMA IF NOT EXISTS "rebase"; and CREATE TABLE "rebase"."users" because they already exist in the database.

-- Ensure roles exist in the database
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'admin') THEN
        CREATE ROLE admin;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viewer') THEN
        CREATE ROLE viewer;
    END IF;
EXCEPTION
    WHEN others THEN
        -- If we don't have permission to create roles, log a warning or ignore
        RAISE NOTICE 'Failed to create roles: %', SQLERRM;
END
$$;

-- Alter column types for exercises to text[]
ALTER TABLE "exercises" DROP COLUMN IF EXISTS "images";
ALTER TABLE "exercises" ADD COLUMN "images" text[];
ALTER TABLE "exercises" DROP COLUMN IF EXISTS "equipment";
ALTER TABLE "exercises" ADD COLUMN "equipment" text[];
ALTER TABLE "exercises" DROP COLUMN IF EXISTS "body_parts";
ALTER TABLE "exercises" ADD COLUMN "body_parts" text[];

-- Alter column types for products to text[]
ALTER TABLE "products" DROP COLUMN IF EXISTS "images";
ALTER TABLE "products" ADD COLUMN "images" text[];
ALTER TABLE "products" DROP COLUMN IF EXISTS "available_locales";
ALTER TABLE "products" ADD COLUMN "available_locales" text[];

-- Add unique constraint to users email (check if we can safely do it, since there's only 1 user)
ALTER TABLE "rebase"."users" DROP CONSTRAINT IF EXISTS "users_email_unique";
ALTER TABLE "rebase"."users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");

-- Enable RLS
ALTER TABLE "rebase"."users" ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "authors_public_access" ON "authors";
CREATE POLICY "authors_public_access" ON "authors" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "product_locales_public_access" ON "product_locales";
CREATE POLICY "product_locales_public_access" ON "product_locales" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tags_public_access" ON "tags";
CREATE POLICY "tags_public_access" ON "tags" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER POLICY "test_policy" ON "customers" TO authenticated USING (true) WITH CHECK (true);
ALTER POLICY "test_policy" ON "exercises" TO authenticated USING (true) WITH CHECK (true);
ALTER POLICY "test_policy" ON "order_items" TO authenticated USING (true) WITH CHECK (true);
ALTER POLICY "test_policy" ON "orders" TO authenticated USING (true) WITH CHECK (true);
ALTER POLICY "test_policy" ON "products" TO authenticated USING (true) WITH CHECK (true);
ALTER POLICY "test_policy" ON "tickets" TO authenticated USING (true) WITH CHECK (true);