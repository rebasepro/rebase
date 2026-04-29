/**
 * Example Rebase Script
 * 
 * To run this script against a local environment, you need to have your 
 * Rebase development server running (`pnpm dev` or `rebase dev`).
 * 
 * Alternatively, you can run this against a deployed environment by 
 * setting the REBASE_URL environment variable.
 */

import fs from "node:fs";
import path from "node:path";
import { createRebaseClient } from "@rebasepro/client";
// import type { Database } from "../shared/database.types"; // Optional: For fully typed collections

// Find the backend URL
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
    console.error("2. Set the REBASE_URL environment variable (e.g. `REBASE_URL=https://api.yourdomain.com npx tsx scripts/example.ts`)");
    process.exit(1);
}

// Initialize the SDK client.
// If your script requires authentication or admin privileges, provide the secret or token.
const rebase = createRebaseClient({
    baseUrl,
    // Provide a service key if your backend requires admin privileges for this script
    // token: process.env.REBASE_SERVICE_KEY 
});

async function run() {
    console.log("🚀 Starting script...");
    
    try {
        // Example: Check backend health
        const health = await fetch(`${baseUrl}/api/health`).then(res => res.json());
        console.log("✅ Backend health:", health);

        // Example: Fetch some data (assuming a collection exists)
        // const items = await rebase.data.collection("users").find({ limit: 5 });
        // console.log("Items:", items);

        console.log("✨ Script finished successfully.");
    } catch (error) {
        console.error("❌ Script failed:", error);
    }
}

run();
