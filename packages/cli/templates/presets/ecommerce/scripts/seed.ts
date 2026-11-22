/**
 * Example rows for this project's tables, so the admin opens on something.
 *
 * Run it with the dev server up (`pnpm run dev` in another terminal):
 *   pnpm run seed        (or: npm run seed)
 *
 * It signs in with the project's service key (REBASE_SERVICE_KEY, which
 * `rebase init` wrote into .env), writes through the API like any other
 * client, and does nothing when the tables already hold rows. Edit it freely,
 * or delete it.
 */
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import { createRebaseClient } from "@rebasepro/client";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const urlFile = path.join(process.cwd(), ".rebase-dev-url");
const baseUrl = process.env.REBASE_URL ?? (fs.existsSync(urlFile) ? fs.readFileSync(urlFile, "utf-8").trim() : undefined);
if (!baseUrl) {
    console.error("❌ No backend to seed: start `rebase dev` in another terminal, or set REBASE_URL.");
    process.exit(1);
}
const serviceKey = process.env.REBASE_SERVICE_KEY;
if (!serviceKey) {
    console.error("❌ REBASE_SERVICE_KEY is not set in .env, so the API would refuse these writes.");
    process.exit(1);
}

const rebase = createRebaseClient({ baseUrl, token: serviceKey });

/** Whether a table already holds rows, so a second run adds nothing. */
async function hasRows(table: string): Promise<boolean> {
    const { data } = await rebase.data.table(table).find({ limit: 1 });
    return data.length > 0;
}

/** Create a row and return its id. */
async function create(table: string, values: Record<string, unknown>): Promise<unknown> {
    const row = await rebase.data.table(table).create(values);
    return (row as { id?: unknown }).id;
}

async function seed(): Promise<void> {
    if (await hasRows("products")) {
        console.log("ℹ️  products already has rows; nothing seeded.");
        return;
    }
    const mugs = await create("categories", { name: "Mugs", slug: "mugs", description: "Things to drink from.", icon: "Coffee" });
    const prints = await create("categories", { name: "Prints", slug: "prints", description: "Things to hang on a wall.", icon: "Image" });

    await create("products", { name: "Stoneware mug", description: "350 ml, dishwasher safe.", price: 18, status: "active", categoryId: mugs });
    await create("products", { name: "Travel mug", description: "Keeps coffee hot for four hours.", price: 26, status: "active", categoryId: mugs });
    await create("products", { name: "Harbour at dawn (A3)", description: "Giclée print on matte paper.", price: 40, status: "draft", categoryId: prints });

    await create("orders", { customerEmail: "sam@example.com", status: "pending", total: 44, notes: "Gift wrap, please." });
    await create("orders", { customerEmail: "lee@example.com", status: "shipped", total: 18 });
    console.log("✅ Seeded 2 categories, 3 products and 2 orders.");
}

seed().catch((error: unknown) => {
    console.error("❌ Seeding failed:", error);
    process.exitCode = 1;
});
