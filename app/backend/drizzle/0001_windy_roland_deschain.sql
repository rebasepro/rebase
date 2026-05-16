CREATE TYPE "public"."exercises_category" AS ENUM('strength', 'cardio', 'flexibility', 'balance', 'plyometrics', 'calisthenics');--> statement-breakpoint
CREATE TYPE "public"."exercises_difficulty" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."exercises_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"images" jsonb,
	"video_url" varchar,
	"difficulty" "exercises_difficulty" NOT NULL,
	"category" "exercises_category" NOT NULL,
	"equipment" jsonb,
	"body_parts" jsonb,
	"instructions" varchar,
	"default_reps" numeric,
	"default_sets" numeric,
	"rest_seconds" numeric,
	"calories_per_minute" numeric,
	"is_compound" boolean,
	"is_featured" boolean,
	"status" "exercises_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "exercises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
CREATE POLICY "test_policy" ON "exercises" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);