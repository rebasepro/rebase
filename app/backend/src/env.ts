import { z } from "zod";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().default("3001").transform(Number),
    DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
    ADMIN_CONNECTION_STRING: z.string().url().optional(),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("1h"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    REBASE_SERVICE_KEY: z.string().optional(),
    ALLOW_REGISTRATION: z.enum(["true", "false", ""]).default("true").transform(v => v === "true"),
    CORS_ORIGINS: z.string().optional(),
    FRONTEND_URL: z.string().optional(),
    DB_POOL_MAX: z.string().default("20").transform(Number),
    DB_POOL_IDLE_TIMEOUT: z.string().default("30000").transform(Number),
    DB_POOL_CONNECT_TIMEOUT: z.string().default("10000").transform(Number),
    FORCE_LOCAL_STORAGE: z.enum(["true", "false", ""]).optional().transform(v => v === "true"),
    STORAGE_TYPE: z.enum(["local", "s3"]).default("local"),
    STORAGE_PATH: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false", ""]).optional().transform(v => v === "true")
}).superRefine((data, ctx) => {
    if (data.NODE_ENV === "production" && !data.CORS_ORIGINS && !data.FRONTEND_URL) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "CORS_ORIGINS or FRONTEND_URL must be set in production to secure the API.",
            path: ["CORS_ORIGINS"]
        });
    }
});

// Parse and export
export const env = envSchema.parse(process.env);
