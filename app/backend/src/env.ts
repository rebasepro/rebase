import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "@rebasepro/server-core";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        SMTP_SECURE: z.enum(["true", "false", ""]).default("false").transform((v: string) => v === "true"),
        SMTP_USER: z.string().optional(),
        SMTP_PASS: z.string().optional(),
        SMTP_FROM: z.string().optional(),
        SMTP_NAME: z.string().optional(),
        APP_NAME: z.string().default("Rebase")
    })
});
