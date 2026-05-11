import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server-core";

const DEMO_EMAIL = "demo@rebase.pro";
const DEMO_PASSWORD = "DemoRebase2026!";
const DEMO_DISPLAY_NAME = "Demo User";

/**
 * Hourly cron job that resets the demo environment.
 *
 * 1. Wipes all collection data (TRUNCATE CASCADE)
 * 2. Deletes all users except re-creates the demo user
 * 3. Re-runs the seed data
 */
const job: CronJobDefinition = {
    schedule: "0 * * * *",
    name: "Reset Demo Data",
    description: "Wipes and re-seeds all data and users every hour for the demo environment.",

    async handler(ctx) {
        ctx.log("🔄 Starting demo data reset...");

        // ── Step 1: Truncate all collection tables ────────────────────
        const collectionTables = [
            "posts_tags",
            "order_items",
            "posts",
            "orders",
            "products",
            "customers",
            "tickets",
            "authors",
            "tags"
        ];

        ctx.log("Truncating collection tables...");
        for (const table of collectionTables) {
            try {
                await rebase.data.collection(table).find({ limit: 0 });
                // Use raw SQL via the data layer workaround
            } catch {
                // Table might not exist yet, skip
            }
        }

        // Use the server singleton to access the driver for raw SQL
        const driver = (rebase as any)._driver ?? (rebase as any).driver;
        if (driver?.executeSql) {
            // Truncate in dependency order
            for (const table of collectionTables) {
                try {
                    await driver.executeSql(`TRUNCATE TABLE "${table}" CASCADE`);
                    ctx.log(`  ✓ Truncated ${table}`);
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    ctx.log(`  ⚠ Failed to truncate ${table}: ${msg}`);
                }
            }
        } else {
            ctx.log("⚠ No executeSql available — skipping table truncation");
        }

        // ── Step 2: Reset users ───────────────────────────────────────
        ctx.log("Resetting users...");
        if (rebase.admin) {
            try {
                const { users } = await rebase.admin.listUsers();
                for (const user of users) {
                    try {
                        await rebase.admin.deleteUser(user.uid);
                        ctx.log(`  ✓ Deleted user ${user.email}`);
                    } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : String(e);
                        ctx.log(`  ⚠ Failed to delete user ${user.email}: ${msg}`);
                    }
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                ctx.log(`  ⚠ Failed to list users: ${msg}`);
            }

            // Re-create demo user
            try {
                await rebase.admin.createUser({
                    email: DEMO_EMAIL,
                    displayName: DEMO_DISPLAY_NAME,
                    password: DEMO_PASSWORD,
                    roles: ["admin"]
                });
                ctx.log(`  ✓ Created demo user ${DEMO_EMAIL}`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                ctx.log(`  ⚠ Failed to create demo user: ${msg}`);
            }
        } else {
            ctx.log("⚠ Admin API not available — skipping user reset");
        }

        // ── Step 3: Re-seed data ──────────────────────────────────────
        ctx.log("Re-seeding demo data...");
        try {
            // Dynamic import so the seed module is only loaded when needed
            const seedModule = await import("../src/seed.js");
            if (typeof seedModule.runSeed === "function") {
                await seedModule.runSeed();
                ctx.log("  ✓ Seed completed");
            } else {
                ctx.log("  ⚠ seed.ts does not export runSeed() — skipping data seed");
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            ctx.log(`  ⚠ Seed failed: ${msg}`);
        }

        ctx.log("✅ Demo data reset complete");
        return { success: true, timestamp: new Date().toISOString() };
    }
};

export default job;
