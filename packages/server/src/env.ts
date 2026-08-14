import { z } from "zod";
import * as crypto from "crypto";
import { logger } from "./utils/logger";

/**
 * Generate a cryptographically secure random secret (hex-encoded).
 * Used as a fallback when secrets are not explicitly configured —
 * avoids the need for hardcoded dev secrets.
 */
function generateSecret(bytes = 48): string {
    return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Zod coercion helper: transforms `"true"` → `true`, everything else → `false`.
 */
const boolString = z.enum(["true", "false", ""]).default("false").transform(v => v === "true");

/**
 * Zod coercion helper for optional boolean strings.
 */
const optionalBoolString = z.enum(["true", "false", ""]).optional().transform(v => v === "true");

/**
 * Helper to determine if a string is a localhost or loopback address/URL.
 */
function isLocalhostOrLoopback(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;

    // 1. Try parsing as URL
    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        if (
            host === "localhost" ||
            host === "127.0.0.1" ||
            host === "::1" ||
            host.startsWith("127.")
        ) {
            return true;
        }
    } catch {
        // Not a standard URL, or custom protocol that URL class fails to parse
    }

    // 2. Custom protocol parser fallback (e.g. postgres://, mongodb://, etc.)
    const protocolMatch = trimmed.match(/^[a-zA-Z0-9+-.]+:\/\/(?:[^@/]+@)?(?:\[([^\]]+)\]|([^:/]+))/);
    if (protocolMatch) {
        const host = (protocolMatch[1] || protocolMatch[2] || "").toLowerCase();
        if (
            host === "localhost" ||
            host === "127.0.0.1" ||
            host === "::1" ||
            host.startsWith("127.")
        ) {
            return true;
        }
    }

    // 3. Plain hostname / host:port checker (e.g. "localhost", "127.0.0.1:5432", "[::1]:6379")
    let plainHost = trimmed.toLowerCase();
    if (plainHost.startsWith("[") && plainHost.includes("]")) {
        const endBracket = plainHost.indexOf("]");
        plainHost = plainHost.slice(1, endBracket);
    } else {
        const colonIndex = plainHost.lastIndexOf(":");
        if (colonIndex !== -1 && plainHost.indexOf(":") === colonIndex) {
            plainHost = plainHost.substring(0, colonIndex);
        }
    }

    if (
        plainHost === "localhost" ||
        plainHost === "127.0.0.1" ||
        plainHost === "::1" ||
        plainHost.startsWith("127.")
    ) {
        return true;
    }

    return false;
}

/**
 * The full set of environment variables recognized by a Rebase backend.
 */
const rebaseEnvSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().default("3001").transform(Number),
    DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
    ADMIN_CONNECTION_STRING: z.string().url().optional(),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long"),
    /**
     * PEM private key for signing access tokens asymmetrically, so anything
     * holding the JWKS can verify a session without being able to mint one.
     * Optional — without it, tokens stay HS256 and nothing changes.
     *
     * Accepts a PEM with real newlines, a PEM with `\n` escapes (how most
     * secret managers and `.env` files carry a multi-line value), or base64 of
     * the whole PEM.
     */
    JWT_PRIVATE_KEY: z.string().optional(),
    /**
     * Names {@link rebaseEnvSchema.JWT_PRIVATE_KEY} in the token header and in
     * the JWKS. Rotation depends on the old and new keys being
     * distinguishable, so change this whenever the key changes.
     */
    JWT_KEY_ID: z.string().default("default"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("1h"),
    // Sliding: every rotation re-ups it, so this governs how long a session
    // survives INACTIVITY, not how long it survives. 400d is the ceiling any
    // browser will honour on the cookie that carries it.
    JWT_REFRESH_EXPIRES_IN: z.string().default("400d"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    REBASE_SERVICE_KEY: z.string().optional(),
    ALLOW_REGISTRATION: boolString,
    // The kill switch, which also closes the empty-database bootstrap window
    // that ALLOW_REGISTRATION=false deliberately leaves open. Optional so an
    // unset variable means "not configured" rather than an explicit false.
    DISABLE_SELF_REGISTRATION: optionalBoolString,
    // Anonymous sign-in, off unless asked for. Optional for the same reason as
    // the line above: unset must read as "not configured", not as an explicit
    // false that would override a value set in code.
    ALLOW_ANONYMOUS: optionalBoolString,
    ALLOW_LOCALHOST_IN_PRODUCTION: optionalBoolString,
    CORS_ORIGINS: z.string().optional(),
    FRONTEND_URL: z.string().optional(),
    DB_POOL_MAX: z.string().default("20").transform(Number),
    DB_POOL_IDLE_TIMEOUT: z.string().default("30000").transform(Number),
    DB_POOL_CONNECT_TIMEOUT: z.string().default("10000").transform(Number),
    DATABASE_DIRECT_URL: z.string().url().optional(),
    DATABASE_READ_URL: z.string().url().optional(),
    FORCE_LOCAL_STORAGE: optionalBoolString,
    // `gcs` is a first-class storage backend (GCSStorageController) and a valid
    // `type` in BackendStorageConfig, so it must validate here too — otherwise
    // an app that selects GCS from this variable dies in loadEnv before its own
    // config code ever runs.
    STORAGE_TYPE: z.enum(["local", "s3", "gcs"]).default("local"),
    STORAGE_PATH: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: optionalBoolString,
    // The GCS counterparts of the S3 set above. Without them `STORAGE_TYPE=gcs`
    // validated but there was no way to say *which* bucket, so an app whose
    // config only branched on "s3" fell through to local disk — i.e. straight
    // into the ephemeral-storage trap. Credentials stay optional: on GKE
    // Workload Identity supplies them through ADC and a key file is the
    // exception, not the rule.
    GCS_BUCKET: z.string().optional(),
    GCS_PROJECT_ID: z.string().optional(),
    GCS_KEY_FILENAME: z.string().optional()
});

/** Inferred type of the validated environment. */
export type RebaseEnv = z.infer<typeof rebaseEnvSchema>;

/**
 * Load and validate the Rebase environment configuration from `process.env`.
 *
 * Call this **after** your `.env` file has been loaded (via `dotenv`, `--env-file`,
 * container injection, etc.). This function does not load `.env` files itself —
 * that is a deployment concern, not a framework concern.
 *
 * Behavior:
 * - Auto-generates ephemeral `JWT_SECRET` and `REBASE_SERVICE_KEY` in
 *   non-production mode so developers can start without manual setup.
 * - Blocks auto-generated secrets in production.
 * - Returns a fully typed, validated env object.
 *
 * Use `extend` to add your own typed env variables on top of the base Rebase schema:
 *
 * @example
 * ```ts
 * import dotenv from "dotenv";
 * import { z } from "zod";
 * import { loadEnv } from "@rebasepro/server";
 *
 * dotenv.config({ path: "../../.env" });
 *
 * // Basic — just Rebase env vars:
 * export const env = loadEnv();
 *
 * // Extended — add your own typed vars:
 * export const env = loadEnv({
 *     extend: z.object({
 *         SMTP_HOST: z.string().optional(),
 *         SMTP_PORT: z.string().default("587").transform(Number),
 *         STRIPE_SECRET_KEY: z.string(),
 *     })
 * });
 * // env.SMTP_HOST  → string | undefined  (fully typed)
 * // env.STRIPE_SECRET_KEY → string        (validated, required)
 * ```
 */
export function loadEnv(): RebaseEnv;
export function loadEnv<E extends z.ZodObject<z.ZodRawShape>>(options: { extend: E }): RebaseEnv & z.infer<E>;
export function loadEnv(options?: { extend?: z.ZodObject<z.ZodRawShape> }): Record<string, unknown> {
    // Auto-generate dev secrets before validation so the Zod schema sees valid values.
    const isProduction = process.env.NODE_ENV === "production";
    const autoGeneratedSecrets: string[] = [];

    if (!isProduction) {
        if (!process.env.JWT_SECRET) {
            process.env.JWT_SECRET = generateSecret();
            autoGeneratedSecrets.push("JWT_SECRET");
        }
        if (!process.env.REBASE_SERVICE_KEY) {
            process.env.REBASE_SERVICE_KEY = generateSecret();
            autoGeneratedSecrets.push("REBASE_SERVICE_KEY");
        }
    }

    // Merge base schema with user extensions (if provided).
    const combinedSchema = options?.extend
        ? rebaseEnvSchema.merge(options.extend)
        : rebaseEnvSchema;

    // Validate with production-specific refinements.
    const schema = combinedSchema.superRefine((data, ctx) => {
        const d = data as RebaseEnv & Record<string, unknown>;
        if (d.NODE_ENV === "production" && !d.CORS_ORIGINS && !d.FRONTEND_URL) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "CORS_ORIGINS or FRONTEND_URL must be set in production to secure the API.",
                path: ["CORS_ORIGINS"]
            });
        }
        if (d.NODE_ENV === "production" && autoGeneratedSecrets.length > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${autoGeneratedSecrets.join(", ")} must be explicitly set in production. ` +
                    "Do not rely on auto-generated secrets outside development.",
                path: [autoGeneratedSecrets[0]]
            });
        }
        if (d.NODE_ENV === "production" && !d.ALLOW_LOCALHOST_IN_PRODUCTION) {
            for (const [key, value] of Object.entries(data)) {
                if (key === "CORS_ORIGINS") continue;
                if (typeof value === "string" && isLocalhostOrLoopback(value)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        // The value is deliberately not echoed: these variables
                        // routinely carry credentials (DATABASE_URL, SMTP_PASS,
                        // OAuth secrets), and a failed production boot is logged
                        // wherever the container's stdout goes.
                        message: `Environment variable ${key} points at a local/loopback host. Deployed instances must not connect to localhost.`,
                        path: [key]
                    });
                }
            }
        }
    });

    const env = schema.parse(process.env);

    // Warn after successful parse so the server still starts in dev.
    if (autoGeneratedSecrets.length > 0) {
        logger.warn(
            `⚠️  Auto-generated secrets for: ${autoGeneratedSecrets.join(", ")}. ` +
            "These are ephemeral — existing tokens will be invalidated on restart. " +
            "Set them explicitly in .env for persistent sessions."
        );
    }

    return env as Record<string, unknown>;
}
