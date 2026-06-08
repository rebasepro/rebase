import type { CronJobDefinition } from "@rebasepro/types";

const DEMO_EMAIL = "demo@rebase.pro";
const DEMO_PASSWORD = "DemoRebase2026!";
const DEMO_DISPLAY_NAME = "Demo User";

const collectionTables = [
    "posts_tags",
    "order_items",
    "posts",
    "orders",
    "products",
    "customers",
    "tickets",
    "exercises",
    "authors",
    "tags"
];

const job: CronJobDefinition = {
    schedule: "0 * * * *",
    name: "Reset Demo Data",
    description: "Wipes and re-seeds all data and users every hour for the demo environment.",

    async handler(ctx) {
        ctx.log("🔄 Starting demo data reset...");

        // ── Step 1: Delete all data from each collection ─────────────
        ctx.log("Deleting collection data...");
        for (const table of collectionTables) {
            try {
                const col = ctx.client.data.collection(table);
                if (col.deleteAll) {
                    await col.deleteAll();
                    ctx.log(`  ✓ Deleted all from ${table}`);
                } else {
                    ctx.log(`  ⚠ deleteAll not available for ${table}`);
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                ctx.log(`  ⚠ Failed to delete ${table}: ${msg}`);
            }
        }

        // ── Step 2: Reset users ──────────────────────────────────────
        ctx.log("Resetting users...");
        if (ctx.client.admin) {
            try {
                const { users } = await ctx.client.admin.listUsers();
                for (const user of users) {
                    try {
                        await ctx.client.admin!.deleteUser(user.uid);
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

            try {
                await ctx.client.admin.createUser({
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

        // ── Step 3: Re-seed data ─────────────────────────────────────
        ctx.log("Re-seeding demo data...");
        try {
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
