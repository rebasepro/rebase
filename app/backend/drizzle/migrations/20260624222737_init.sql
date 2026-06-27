-- Add new schema named "rebase"
CREATE SCHEMA IF NOT EXISTS "rebase";
-- Create enum type "exercises_difficulty"
CREATE TYPE "public"."exercises_difficulty" AS ENUM ('beginner', 'intermediate', 'advanced');
-- Create enum type "exercises_category"
CREATE TYPE "public"."exercises_category" AS ENUM ('strength', 'cardio', 'flexibility', 'balance', 'plyometrics', 'calisthenics');
-- Create enum type "exercises_status"
CREATE TYPE "public"."exercises_status" AS ENUM ('draft', 'published', 'archived');
-- Create enum type "orders_status"
CREATE TYPE "public"."orders_status" AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
-- Create enum type "orders_payment_status"
CREATE TYPE "public"."orders_payment_status" AS ENUM ('unpaid', 'paid', 'partially_refunded', 'refunded');
-- Create enum type "orders_currency"
CREATE TYPE "public"."orders_currency" AS ENUM ('USD', 'EUR', 'GBP', 'CAD', 'AUD');
-- Create enum type "posts_status"
CREATE TYPE "public"."posts_status" AS ENUM ('draft', 'needs_review', 'published', 'archived');
-- Create enum type "products_category"
CREATE TYPE "public"."products_category" AS ENUM ('electronics', 'clothing', 'home_garden', 'sports', 'books', 'food_beverage', 'health_beauty', 'toys');
-- Create enum type "products_status"
CREATE TYPE "public"."products_status" AS ENUM ('draft', 'active', 'archived');
-- Create enum type "tickets_status"
CREATE TYPE "public"."tickets_status" AS ENUM ('open', 'in_progress', 'waiting', 'resolved', 'closed');
-- Create enum type "tickets_priority"
CREATE TYPE "public"."tickets_priority" AS ENUM ('low', 'medium', 'high', 'urgent');
-- Create enum type "tickets_category"
CREATE TYPE "public"."tickets_category" AS ENUM ('bug', 'feature_request', 'question', 'billing', 'account', 'other');
-- Create "customers" table
CREATE TABLE "public"."customers" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "first_name" character varying(255) NOT NULL,
  "last_name" character varying(255) NOT NULL,
  "email" character varying(255) NOT NULL,
  "phone" character varying(255) NULL,
  "avatar" character varying(255) NULL,
  "company" character varying(255) NULL,
  "is_vip" boolean NULL,
  "lifetime_value" numeric NULL,
  "total_orders" numeric NULL,
  "shipping_address" text NULL,
  "billing_address" text NULL,
  "notes" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "customers_email_key" UNIQUE ("email")
);
-- Create "exercises" table
CREATE TABLE "public"."exercises" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" character varying(255) NOT NULL,
  "description" text NULL,
  "images" text[] NULL,
  "video_url" character varying(255) NULL,
  "difficulty" "public"."exercises_difficulty" NOT NULL,
  "category" "public"."exercises_category" NOT NULL,
  "equipment" text[] NULL,
  "body_parts" text[] NULL,
  "instructions" text NULL,
  "default_reps" numeric NULL,
  "default_sets" numeric NULL,
  "rest_seconds" numeric NULL,
  "calories_per_minute" numeric NULL,
  "is_compound" boolean NULL,
  "is_featured" boolean NULL,
  "status" "public"."exercises_status" NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
-- Create "users" table
CREATE TABLE "rebase"."users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" character varying(255) NOT NULL,
  "display_name" character varying(255) NULL,
  "photo_url" character varying(255) NULL,
  "roles" text[] NULL,
  "password_hash" character varying(255) NULL,
  "email_verified" boolean NULL,
  "email_verification_token" character varying(255) NULL,
  "email_verification_sent_at" timestamptz NULL,
  "metadata" jsonb NULL,
  "created_at" timestamptz NULL,
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "users_email_key" UNIQUE ("email")
);
-- Create "orders" table
CREATE TABLE "public"."orders" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "order_number" character varying(255) NOT NULL,
  "customer_id" uuid NOT NULL,
  "status" "public"."orders_status" NOT NULL,
  "payment_status" "public"."orders_payment_status" NOT NULL,
  "subtotal" numeric NULL,
  "tax_amount" numeric NULL,
  "shipping_cost" numeric NULL,
  "discount_amount" numeric NULL,
  "total" numeric NULL,
  "currency" "public"."orders_currency" NULL,
  "shipping_address" text NULL,
  "tracking_number" character varying(255) NULL,
  "notes" text NULL,
  "order_date" timestamptz NOT NULL,
  "shipped_date" timestamptz NULL,
  "delivered_date" timestamptz NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "orders_order_number_key" UNIQUE ("order_number"),
  CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "products" table
CREATE TABLE "public"."products" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" character varying(255) NOT NULL,
  "sku" character varying(255) NOT NULL,
  "description" text NULL,
  "images" text[] NULL,
  "available_locales" text[] NULL,
  "brand" character varying(255) NULL,
  "category" "public"."products_category" NOT NULL,
  "price" numeric NOT NULL,
  "compare_at_price" numeric NULL,
  "cost" numeric NULL,
  "stock_quantity" numeric NOT NULL,
  "low_stock_threshold" numeric NULL,
  "weight_grams" numeric NULL,
  "rating" numeric NULL,
  "review_count" numeric NULL,
  "status" "public"."products_status" NOT NULL,
  "is_featured" boolean NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "products_sku_key" UNIQUE ("sku")
);
-- Create "order_items" table
CREATE TABLE "public"."order_items" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "order_id" uuid NULL,
  "product_id" uuid NULL,
  "product_name" character varying(255) NULL,
  "sku" character varying(255) NULL,
  "quantity" numeric NOT NULL,
  "unit_price" numeric NULL,
  "line_total" numeric NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);
-- Create "authors" table
CREATE TABLE "public"."authors" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" character varying(255) NOT NULL,
  "email" character varying(255) NOT NULL,
  "picture" character varying(255) NULL,
  "bio" text NULL,
  "twitter" character varying(255) NULL,
  "github" character varying(255) NULL,
  "website" character varying(255) NULL,
  "user_id" character varying(255) NULL,
  PRIMARY KEY ("id")
);
-- Create "posts" table
CREATE TABLE "public"."posts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "title" character varying(255) NOT NULL,
  "slug" character varying(255) NOT NULL,
  "hero_image" character varying(255) NULL,
  "excerpt" text NULL,
  "content" jsonb NULL,
  "status" "public"."posts_status" NOT NULL,
  "publish_date" timestamptz NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "author_id" uuid NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "posts_slug_key" UNIQUE ("slug"),
  CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."authors" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);
-- Create "tags" table
CREATE TABLE "public"."tags" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" character varying(255) NOT NULL,
  PRIMARY KEY ("id")
);
-- Create "posts_tags" table
CREATE TABLE "public"."posts_tags" (
  "post_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  PRIMARY KEY ("post_id", "tag_id"),
  CONSTRAINT "posts_tags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "posts_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "product_locales" table
CREATE TABLE "public"."product_locales" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "product_id" uuid NULL,
  "locale" character varying(255) NOT NULL,
  "name" character varying(255) NULL,
  "description" text NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "product_locales_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);
-- Create "tickets" table
CREATE TABLE "public"."tickets" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "ticket_number" character varying(255) NOT NULL,
  "subject" character varying(255) NOT NULL,
  "description" text NULL,
  "resolution_notes" text NULL,
  "status" "public"."tickets_status" NOT NULL,
  "priority" "public"."tickets_priority" NOT NULL,
  "category" "public"."tickets_category" NULL,
  "customer_id" uuid NULL,
  "assigned_to" character varying(255) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "order" character varying(255) NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "tickets_ticket_number_key" UNIQUE ("ticket_number"),
  CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);


-- This file contains RLS policies generated by Rebase. Applied separately from migrations.

ALTER TABLE "public"."authors" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authors_public_access" ON "public"."authors";
CREATE POLICY "authors_public_access" ON "public"."authors" AS PERMISSIVE FOR ALL TO "public" USING (true) WITH CHECK (true);

ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."customers";
CREATE POLICY "test_policy" ON "public"."customers" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."exercises";
CREATE POLICY "test_policy" ON "public"."exercises" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."order_items";
CREATE POLICY "test_policy" ON "public"."order_items" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."orders";
CREATE POLICY "test_policy" ON "public"."orders" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."posts";
CREATE POLICY "test_policy" ON "public"."posts" AS PERMISSIVE FOR ALL TO "public" USING (true) WITH CHECK (true);

ALTER TABLE "public"."product_locales" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_locales_public_access" ON "public"."product_locales";
CREATE POLICY "product_locales_public_access" ON "public"."product_locales" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."products";
CREATE POLICY "test_policy" ON "public"."products" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tags_public_access" ON "public"."tags";
CREATE POLICY "tags_public_access" ON "public"."tags" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."tickets";
CREATE POLICY "test_policy" ON "public"."tickets" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "rebase"."users" ENABLE ROW LEVEL SECURITY;



-- This file contains RLS policies generated by Rebase. Applied separately from migrations.

ALTER TABLE "public"."authors" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authors_public_access" ON "public"."authors";
CREATE POLICY "authors_public_access" ON "public"."authors" AS PERMISSIVE FOR ALL TO "public" USING (true) WITH CHECK (true);

ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."customers";
CREATE POLICY "test_policy" ON "public"."customers" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."exercises";
CREATE POLICY "test_policy" ON "public"."exercises" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."order_items";
CREATE POLICY "test_policy" ON "public"."order_items" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."orders";
CREATE POLICY "test_policy" ON "public"."orders" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."posts";
CREATE POLICY "test_policy" ON "public"."posts" AS PERMISSIVE FOR ALL TO "public" USING (true) WITH CHECK (true);

ALTER TABLE "public"."product_locales" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_locales_public_access" ON "public"."product_locales";
CREATE POLICY "product_locales_public_access" ON "public"."product_locales" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."products";
CREATE POLICY "test_policy" ON "public"."products" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tags_public_access" ON "public"."tags";
CREATE POLICY "tags_public_access" ON "public"."tags" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_policy" ON "public"."tickets";
CREATE POLICY "test_policy" ON "public"."tickets" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);

ALTER TABLE "rebase"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rebase"."users" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_policy" ON "rebase"."users";
CREATE POLICY "users_read_policy" ON "rebase"."users" AS PERMISSIVE FOR SELECT TO "public" USING (auth.uid() IS NULL OR id = auth.uid() OR string_to_array(auth.roles(), ',') && ARRAY['admin']);
DROP POLICY IF EXISTS "users_write_policy_insert" ON "rebase"."users";
CREATE POLICY "users_write_policy_insert" ON "rebase"."users" AS PERMISSIVE FOR INSERT TO "public" WITH CHECK (auth.uid() IS NULL OR string_to_array(auth.roles(), ',') && ARRAY['admin']);
DROP POLICY IF EXISTS "users_write_policy_update" ON "rebase"."users";
CREATE POLICY "users_write_policy_update" ON "rebase"."users" AS PERMISSIVE FOR UPDATE TO "public" USING (auth.uid() IS NULL OR string_to_array(auth.roles(), ',') && ARRAY['admin']) WITH CHECK (auth.uid() IS NULL OR string_to_array(auth.roles(), ',') && ARRAY['admin']);
DROP POLICY IF EXISTS "users_write_policy_delete" ON "rebase"."users";
CREATE POLICY "users_write_policy_delete" ON "rebase"."users" AS PERMISSIVE FOR DELETE TO "public" USING (auth.uid() IS NULL OR string_to_array(auth.roles(), ',') && ARRAY['admin']);

