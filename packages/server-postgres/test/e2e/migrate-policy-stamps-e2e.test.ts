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
import { loadTables } from "../../src/schema/load-tables.js";
import { ensureTablePolicies } from "../../src/schema/ensure-policies.js";
import { pinSearchPath } from "../../src/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");
const cliScript = path.join(pkgRoot, "src", "cli.ts");
const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");

const TABLES: Record<string, string> = {
    "posts.ts": `import { col, defineTable, rel } from "@rebasepro/types";
import { tags } from "./tags";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text()
    },
    relations: {
        tags: rel.manyToMany(() => tags)
    },
    // The scaffold's rules: reads for everyone, writes for admins.
    rls: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ]
});
`,
    "tags.ts": `import { col, defineTable } from "@rebasepro/types";

export const tags = defineTable("tags", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text()
    },
    rls: [
        { operation: "select", access: "public" }
    ]
});
`,
    "index.ts": `export { posts } from "./posts";\nexport { tags } from "./tags";\n`
};

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    // The schema modules import `@rebasepro/types` from outside the workspace;
    // the typecheck config maps every `@rebasepro/*` onto source.
    env.TSX_TSCONFIG_PATH = path.join(monorepoRoot, "tsconfig.typecheck.json");
    return env;
}

describe("db migrate stamps the policies it applies", () => {
    let container: PgContainer;
    let backend: string;
    let schemaDir: string;

    beforeAll(async () => {
        container = await startPgContainer();
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-migrate-stamps-"));
        backend = path.join(base, "backend");
        // backend/schema: the directory `db generate` and `db migrate` read by default.
        schemaDir = path.join(backend, "schema");
        fs.mkdirSync(schemaDir, { recursive: true });
        fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: "stamps-backend", type: "module" }));
        for (const [file, source] of Object.entries(TABLES)) fs.writeFileSync(path.join(schemaDir, file), source);
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
            const collections = await loadTables(schemaDir);
            return await ensureTablePolicies(client, collections);
        } finally {
            await client.end();
        }
    }

    it("the first boot after a migrate re-applies nothing", async () => {
        const generated = await cli(["db", "generate", "init"]);
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
