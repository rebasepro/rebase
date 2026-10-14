/**
 * The first boot after `rebase db migrate` leaves the policies migrate applied
 * alone.
 *
 * A boot re-applies a table's policies — a DROP and a CREATE each, an ACCESS
 * EXCLUSIVE lock per table — unless every policy carries the stamp a boot or a
 * push writes (`COMMENT ON POLICY … IS 'rebase:<hash>'`). `db push` stamps what
 * it applies; `db migrate` ran the migration's `policies.sql` and stamped
 * nothing, so the first boot after every migrate re-applied every policy once.
 *
 * Migrate now stamps each policy whose stored definition is what its rule
 * would create — asked of Postgres the way the dry run asks it — and nothing
 * else: a policy that differs keeps no stamp, and the boot re-applies it.
 *
 * Runs the real `db generate` and `db migrate`, then the boot's own policy step,
 * against a real Postgres. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { ensureCollectionPolicies } from "../../src/schema/ensure-collection-policies.js";
import { pinSearchPath } from "../../src/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");
const cliScript = path.join(pkgRoot, "src", "cli.ts");
const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");

const COLLECTIONS: Record<string, string> = {
    "posts.js": `
import tags from "./tags.js";
export default {
    name: "Posts", slug: "posts", table: "posts",
    // The scaffold's rules: reads for everyone, writes for admins.
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
};`,
    "tags.js": `
export default {
    name: "Tags", slug: "tags", table: "tags",
    securityRules: [{ operation: "select", access: "public" }],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" }
    }
};`
};

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

describe("db migrate stamps the policies it applies", () => {
    let container: PgContainer;
    let backend: string;
    let collectionsDir: string;

    beforeAll(async () => {
        container = await startPgContainer();
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-migrate-stamps-"));
        backend = path.join(base, "backend");
        collectionsDir = path.join(base, "config", "collections");
        fs.mkdirSync(backend, { recursive: true });
        fs.mkdirSync(collectionsDir, { recursive: true });
        fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: "stamps-backend", type: "module" }));
        fs.writeFileSync(path.join(collectionsDir, "package.json"), JSON.stringify({ type: "module" }));
        for (const [file, source] of Object.entries(COLLECTIONS)) fs.writeFileSync(path.join(collectionsDir, file), source);
    }, 120_000);

    afterAll(async () => {
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    const cli = (args: string[]) =>
        execa(tsxBin, [cliScript, ...args], { cwd: backend, env: cleanEnv(container.connectionString), reject: false, stdin: "ignore", all: true });

    /** The boot's policy step, on a connection pinned the way the boot pins its own. */
    async function boot() {
        const client = new pg.Client({ connectionString: pinSearchPath(container.connectionString) });
        await client.connect();
        try {
            const collections = await loadCollectionsFromDirectory(collectionsDir);
            return await ensureCollectionPolicies(client, collections);
        } finally {
            await client.end();
        }
    }

    it("the first boot after a migrate re-applies nothing", async () => {
        const generated = await cli(["db", "generate", "--collections", collectionsDir, "init"]);
        expect(generated.exitCode, generated.all).toBe(0);
        const migrated = await cli(["db", "migrate"]);
        expect(migrated.exitCode, migrated.all).toBe(0);

        const first = await boot();
        expect(first.failures).toEqual([]);
        expect(first.policiesApplied).toBe(0);
        // posts, tags and their junction: every table left alone.
        expect(first.unchanged).toBe(3);
    }, 300_000);

    it("a policy changed after the migrate keeps no stamp, and the boot re-applies it", async () => {
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        try {
            // By hand, as a later migration or an operator might: same name, other rule.
            await admin.query(`ALTER POLICY "tags_default_admin_read" ON public.tags USING (false)`);
            await admin.query(`COMMENT ON POLICY "tags_default_admin_read" ON public.tags IS NULL`);
        } finally {
            await admin.end();
        }
        const migrated = await cli(["db", "migrate"]);
        expect(migrated.exitCode, migrated.all).toBe(0);

        const next = await boot();
        expect(next.failures).toEqual([]);
        // Only `tags`: the one policy that differs is not stamped, so its table is re-applied.
        expect(next.unchanged).toBe(2);
        expect(next.policiesApplied).toBeGreaterThan(0);
    }, 300_000);
});
