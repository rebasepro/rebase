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
    if (await hasRows("posts")) {
        console.log("ℹ️  posts already has rows; nothing seeded.");
        return;
    }
    const ada = await create("authors", { name: "Ada Lovelace", email: "ada@example.com" });
    const grace = await create("authors", { name: "Grace Hopper", email: "grace@example.com" });
    const guides = await create("tags", { name: "Guides" });
    const news = await create("tags", { name: "News" });
    const notes = await create("tags", { name: "Notes" });

    await create("posts", {
        title: "Welcome to your new blog",
        content: "This post was written by `scripts/seed.ts`. Edit it, or delete it, from the admin.",
        status: "published",
        authorId: ada,
        tags: [news]
    });
    await create("posts", {
        title: "How this admin is put together",
        content: "Each table lives in `backend/schema/`, and how it looks here in `frontend/src/cms/`.",
        status: "review",
        authorId: grace,
        tags: [guides, notes]
    });
    await create("posts", {
        title: "A draft nobody can read yet",
        content: "Only published posts are readable by everyone: see the `rls` rules in `backend/schema/posts.ts`.",
        status: "draft",
        authorId: ada,
        tags: [notes]
    });
    console.log("✅ Seeded 2 authors, 3 tags and 3 posts.");
}

seed().catch((error: unknown) => {
    console.error("❌ Seeding failed:", error);
    process.exitCode = 1;
});
