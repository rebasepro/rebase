import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// `z` comes from the runtime, not from "zod": `loadEnv({ extend })` composes
// this schema with the framework's, and a schema built against a second copy
// of zod fails the framework's instanceof checks and is silently dropped.
import { loadEnv, z } from "@rebasepro/server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Locate the project's `.env` by walking up the directory tree.
 *
 * A fixed relative path can't work in both modes: in dev this file runs from
 * source at `backend/src/env.ts`, but the compiled output lives at
 * `backend/dist/backend/src/env.js` — two directories deeper — so
 * `../../.env` points at a file that doesn't exist in production. Walking up
 * finds the root `.env` from either location.
 */
function findEnvFile(startDir: string): string | undefined {
    let dir = startDir;
    while (true) {
        const candidate = path.join(dir, ".env");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

// `rebase start` sets DOTENV_CONFIG_PATH to the project's .env; honor it first,
// then fall back to searching up from this file. When neither is found (e.g. a
// production host that injects env vars directly), skip dotenv entirely and let
// the real process environment flow through.
const envPath = process.env.DOTENV_CONFIG_PATH || findEnvFile(__dirname);
if (envPath && fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        SMTP_SECURE: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
        SMTP_USER: z.string().optional(),
        SMTP_PASS: z.string().optional(),
        SMTP_FROM: z.string().optional(),
        SMTP_NAME: z.string().optional(),
        APP_NAME: z.string().default("Rebase")
    })
});
