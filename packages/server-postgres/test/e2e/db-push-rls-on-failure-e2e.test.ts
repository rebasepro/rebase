/**
 * A `rebase db push` that fails part-way must not leave a table open.
 *
 * Push runs Atlas first — which commits the new tables — and then a row of
 * steps that can each refuse: the vector DDL, the search DDL, the triggers, the
 * policies. `rebase_user`, the role every authenticated request runs as, holds
 * SELECT/INSERT/UPDATE/DELETE on a new table the moment it is created (the
 * schema's default privileges), and `schema.sql` cannot carry `ENABLE ROW LEVEL
 * SECURITY` because Atlas's free tier neither plans nor reads it. So RLS was
 * switched on by the policies step, last: when the search step refused, a new
 * `secrets` table stayed RLS-off with full DML for every caller until a later
 * push or boot — and with `REBASE_MIGRATE_ON_BOOT=none`, forever.
 *
 * The failure here is deterministic and is one push itself prescribes: a
 * `search` block edited after its column was built is refused by the search
 * step, after Atlas has created the new tables in the same push.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");

/** `people` reads `name` into its search column; `searchBio` widens the block. */
function peopleTs(searchBio: boolean): string {
    const fields = searchBio
        ? `[{ path: "name", weight: "A" }, { path: "bio", weight: "B" }]`
        : `[{ path: "name", weight: "A" }]`;
    return `import { col, defineTable } from "@rebasepro/types";

export const people = defineTable("people", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text(),
        bio: col.text()
    },
    rls: [
        { operation: "select", access: "public" }
    ],
    search: { fields: ${fields} }
});
`;
}

/** A table whose rows only an admin may read — and a junction to `tags`. */
const SECRETS_TS = `import { col, defineTable, rel } from "@rebasepro/types";
import { tags } from "./tags";

export const secrets = defineTable("secrets", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        value: col.text()
    },
    relations: {
        tags: rel.manyToMany(() => tags)
    },
    rls: [
        { operation: "select", roles: ["admin"] }
    ]
});
`;

const TAGS_TS = `import { col, defineTable } from "@rebasepro/types";

export const tags = defineTable("tags", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        label: col.text()
    },
    rls: "admin-only"
});
`;

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

describe("db push that fails after Atlas leaves every managed table RLS-on", () => {
    let container: PgContainer;
    let dbClient: pg.Client;
    let workDir: string;
    let schemaDir: string;
    let env: Record<string, string>;
    const cliScript = path.join(pkgRoot, "src", "cli.ts");

    beforeAll(async () => {
        container = await startPgContainer();
        dbClient = new pg.Client({ connectionString: container.connectionString });
        await dbClient.connect();

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-push-rls-"));
        workDir = path.join(base, "backend");
        schemaDir = path.join(workDir, "schema");
        fs.mkdirSync(schemaDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, "package.json"),
            JSON.stringify({ name: "e2e-push-rls-backend", type: "module" }));
        env = cleanEnv(container.connectionString);
    }, 60_000);

    afterAll(async () => {
        if (dbClient) try { await dbClient.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    function runPush() {
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        return execa(
            tsxBin,
            [cliScript, "db", "push", "--schema-dir", schemaDir],
            { cwd: workDir, env, reject: false, stdin: "ignore", all: true }
        );
    }

    /** `relrowsecurity` for every ordinary table in `public`. */
    async function rlsByTable(): Promise<Record<string, boolean>> {
        const res = await dbClient.query<{ relname: string; relrowsecurity: boolean }>(
            `SELECT c.relname, c.relrowsecurity FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`
        );
        return Object.fromEntries(res.rows.map(r => [r.relname, r.relrowsecurity]));
    }

    it("locks the tables Atlas created when the search step then refuses", async () => {
        // ── 1. A clean push: `people`, searched on `name` ────────────────
        fs.writeFileSync(path.join(schemaDir, "people.ts"), peopleTs(false));
        fs.writeFileSync(path.join(schemaDir, "index.ts"), `export { people } from "./people";\n`);
        const first = await runPush();
        expect(first.all ?? "").toMatch(/completed successfully/);
        expect(first.exitCode).toBe(0);

        // ── 2. New tables + an edited search block, in one push ──────────
        fs.writeFileSync(path.join(schemaDir, "people.ts"), peopleTs(true));
        fs.writeFileSync(path.join(schemaDir, "secrets.ts"), SECRETS_TS);
        fs.writeFileSync(path.join(schemaDir, "tags.ts"), TAGS_TS);
        fs.writeFileSync(path.join(schemaDir, "index.ts"),
            `export { people } from "./people";\nexport { secrets } from "./secrets";\nexport { tags } from "./tags";\n`);
        const failed = await runPush();

        // It failed where the scenario says it does: after Atlas, in search.
        expect(failed.exitCode).not.toBe(0);
        expect(failed.all ?? "").toMatch(/search block for public\.people changed/);

        const rls = await rlsByTable();
        // Atlas did create them — this is the state the failure leaves behind.
        expect(Object.keys(rls)).toEqual(expect.arrayContaining(["people", "secrets", "tags"]));
        const junction = Object.keys(rls).find(t => t !== "people" && t !== "secrets" && t !== "tags");
        expect(junction).toBeDefined();
        // Every one of them, the junction included, is RLS-on.
        expect(rls).toEqual(Object.fromEntries(Object.keys(rls).map(t => [t, true])));

        // And what that means to the role every authenticated request runs as:
        // a row the owner wrote is not reachable — RLS with no policy denies.
        await dbClient.query(`INSERT INTO secrets (value) VALUES ('the launch codes')`);
        await dbClient.query("BEGIN");
        try {
            await dbClient.query("SET LOCAL ROLE rebase_user");
            const seen = await dbClient.query(`SELECT value FROM secrets`);
            expect(seen.rows).toEqual([]);
        } finally {
            await dbClient.query("ROLLBACK");
        }
    }, 240_000);
});
