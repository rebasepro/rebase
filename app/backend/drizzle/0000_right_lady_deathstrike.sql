CREATE TYPE "public"."orders_currency" AS ENUM('USD', 'EUR', 'GBP', 'CAD', 'AUD');--> statement-breakpoint
CREATE TYPE "public"."orders_payment_status" AS ENUM('unpaid', 'paid', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."orders_status" AS ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."posts_status" AS ENUM('draft', 'needs_review', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."products_category" AS ENUM('electronics', 'clothing', 'home_garden', 'sports', 'books', 'food_beverage', 'health_beauty', 'toys');--> statement-breakpoint
CREATE TYPE "public"."products_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tickets_category" AS ENUM('bug', 'feature_request', 'question', 'billing', 'account', 'other');--> statement-breakpoint
CREATE TYPE "public"."tickets_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."tickets_status" AS ENUM('open', 'in_progress', 'waiting', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"picture" varchar,
	"bio" varchar,
	"twitter" varchar,
	"github" varchar,
	"website" varchar,
	"user_id" varchar
);
--> statement-breakpoint
ALTER TABLE "authors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" varchar NOT NULL,
	"last_name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar,
	"avatar" varchar,
	"company" varchar,
	"is_vip" boolean,
	"lifetime_value" numeric,
	"total_orders" numeric,
	"shipping_address" varchar,
	"billing_address" varchar,
	"notes" varchar,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"product_id" uuid,
	"product_name" varchar NOT NULL,
	"sku" varchar,
	"quantity" numeric NOT NULL,
	"unit_price" numeric NOT NULL,
	"line_total" numeric
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "orders_status" NOT NULL,
	"payment_status" "orders_payment_status" NOT NULL,
	"subtotal" numeric,
	"tax_amount" numeric,
	"shipping_cost" numeric,
	"discount_amount" numeric,
	"total" numeric NOT NULL,
	"currency" "orders_currency",
	"shipping_address" varchar,
	"tracking_number" varchar,
	"notes" varchar,
	"order_date" timestamp with time zone NOT NULL,
	"shipped_date" timestamp with time zone,
	"delivered_date" timestamp with time zone,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"hero_image" varchar,
	"excerpt" varchar,
	"content" jsonb,
	"status" "posts_status" NOT NULL,
	"publish_date" timestamp with time zone,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"author_id" uuid,
	CONSTRAINT "posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "posts_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "product_locales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"locale" varchar NOT NULL,
	"name" varchar,
	"description" varchar
);
--> statement-breakpoint
ALTER TABLE "product_locales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"sku" varchar NOT NULL,
	"description" varchar,
	"images" jsonb,
	"available_locales" jsonb,
	"brand" varchar,
	"category" "products_category" NOT NULL,
	"price" numeric NOT NULL,
	"compare_at_price" numeric,
	"cost" numeric,
	"stock_quantity" numeric NOT NULL,
	"low_stock_threshold" numeric,
	"weight_grams" numeric,
	"rating" numeric,
	"review_count" numeric,
	"status" "products_status" NOT NULL,
	"is_featured" boolean,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" varchar NOT NULL,
	"subject" varchar NOT NULL,
	"description" varchar,
	"resolution_notes" varchar,
	"status" "tickets_status" NOT NULL,
	"priority" "tickets_priority" NOT NULL,
	"category" "tickets_category",
	"customer_id" uuid,
	"assigned_to" varchar,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"order" varchar,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_tags" ADD CONSTRAINT "posts_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_tags" ADD CONSTRAINT "posts_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_locales" ADD CONSTRAINT "product_locales_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "test_policy" ON "customers" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "test_policy" ON "order_items" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "test_policy" ON "orders" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "test_policy" ON "posts" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "test_policy" ON "products" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "test_policy" ON "tickets" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);