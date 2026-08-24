/**
 * Example Rebase Script
 *
 * Scripts run OUTSIDE the server and need explicit authentication.
 * Use a Service Key (set in .env as REBASE_SERVICE_KEY) to get admin
 * access — similar to a Service Account credential.
 *
 * Usage:
 *   # With local dev server running (`pnpm dev` in another terminal):
 *   npx tsx tooling/scripts/example.ts
 *
 *   # With remote backend:
 *   REBASE_URL=https://api.yourdomain.com npx tsx tooling/scripts/example.ts
 *
 *   # Service key can also be passed as env var:
 *   REBASE_SERVICE_KEY=<key> REBASE_URL=https://api.yourdomain.com npx tsx tooling/scripts/example.ts
 *
 * Generate a service key:
 *   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
 */

import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import { createRebaseClient } from "@rebasepro/client";
// import type { Database } from "../config/database.types"; // Optional: For fully typed collections

// Load .env from project root (same file the backend uses)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ─── Resolve Backend URL ─────────────────────────────────────────────
let baseUrl = process.env.REBASE_URL;

if (!baseUrl) {
    try {
        // Try to read the URL from the local dev server
        const urlFile = path.join(process.cwd(), ".rebase-dev-url");
        if (fs.existsSync(urlFile)) {
            baseUrl = fs.readFileSync(urlFile, "utf-8").trim();
            console.log(`Found local dev server running at: ${baseUrl}`);
        }
    } catch (e) {
        // Ignore errors reading the file
    }
}

if (!baseUrl) {
    console.error("❌ No backend URL found!");
    console.error("");
    console.error("Please make sure you have either:");
    console.error("1. Started the local dev server in another terminal (`pnpm dev`)");
    console.error("2. Set the REBASE_URL environment variable (e.g. `REBASE_URL=https://api.yourdomain.com npx tsx tooling/scripts/example.ts`)");
    process.exit(1);
}

// ─── Resolve Service Key ─────────────────────────────────────────────
const serviceKey = process.env.REBASE_SERVICE_KEY;

if (!serviceKey) {
    console.warn("⚠️  No REBASE_SERVICE_KEY found — requests will be unauthenticated.");
    console.warn("   Set REBASE_SERVICE_KEY in your .env to get admin access.");
    console.warn("   Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\"");
    console.warn("");
}

// ─── Initialize the SDK client ───────────────────────────────────────
const rebase = createRebaseClient({
    baseUrl,
    // The service key is sent as a Bearer token for admin access
    token: serviceKey
});

async function run() {
    console.log("🚀 Starting script...");

    try {
        // Example: Check backend health
        const res = await fetch(`${baseUrl}/health`);
        const health = res.headers.get("content-type")?.includes("application/json")
            ? await res.json()
            : { status: res.status, text: await res.text() };
        console.log("✅ Backend health:", health);

        // Example: Fetch some data (requires auth if backend is secure-by-default)
        // const items = await rebase.data.collection("users").find({ limit: 5 });
        // console.log("Items:", items);

        console.log("✨ Script finished successfully.");
    } catch (error) {
        console.error("❌ Script failed:", error);
    }
}

run();
