/**
 * E2E test for `rebase db push`'s destructive-change safety gate.
 *
 * The highest silent-data-loss risk in the product was `db push` running
 * `atlas schema apply --auto-approve` with no confirmation — a removed field
 * compiles to `DROP COLUMN` and the column (and its data) vanish. This proves
 * the gate end-to-end against a real Postgres:
 *
 *   1. push a table WITH a `note` column             → column created
 *   2. remove the field, push non-interactively      → REFUSED, column survives
 *   3. push again with --allow-destructive            → column dropped
 *
 * Requires Docker. Spins up a throwaway Postgres container and tears it down.
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
const pkgRoot = path.resolve(__dirname, "../..");     // packages/server-postgres
const monorepoRoot = path.resolve(pkgRoot, "../..");  // repo root

/** The `tasks` table; `withNote` toggles the destructive column. */
function tasksTableTs(withNote: boolean): string {
    const note = withNote ? "        note: col.text(),\n" : "";
    return `import { col, defineTable } from "@rebasepro/types";

export const tasks = defineTable("tasks", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
${note}        done: col.boolean()
    },
    rls: "admin-only"
});
`;
}

/** `backend/schema/index.ts` exporting the named tables. */
function schemaIndex(...names: string[]): string {
    return names.map(n => `export { ${n} } from "./${n}";`).join("\n") + "\n";
}

/**
 * A table whose column TYPES move between pushes. `rating` is
 * `numeric(precision, scale)`; `nickname` is a `varchar(max)` that a search
 * block reads, so retyping it collides with the generated search column.
 */
function pricesTableTs(opts: { precision: number; scale: number; nicknameMax: number; ratingRequired?: boolean }): string {
    return `import { col, defineTable } from "@rebasepro/types";

export const prices = defineTable("prices", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        nickname: col.varchar({ length: ${opts.nicknameMax} }),
        rating: col.numeric({ precision: ${opts.precision}, scale: ${opts.scale} })${opts.ratingRequired ? ".notNull()" : ""}
    },
    rls: "admin-only",
    search: { fields: [{ path: "nickname", weight: "A" }] }
});
`;
}

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    env.PTAH_DEV_SERVER_DISPOSABLE = "1";
    // The schema modules import `@rebasepro/types` from outside the workspace;
    // the typecheck config maps every `@rebasepro/*` onto source, so the driver
    // and the modules share one copy of the builders.
    env.TSX_TSCONFIG_PATH = path.join(monorepoRoot, "tsconfig.typecheck.json");
    return env;
}

describe("db push destructive-change gate E2E", () => {
    let container: PgContainer;
    let dbClient: pg.Client;
    let workDir: string;
    let schemaDir: string;
    let env: Record<string, string>;
    const cliScript = path.join(pkgRoot, "src", "cli.ts");

    beforeAll(async () => {
        container = await startPgContainer();

        let attempts = 0;
        while (attempts < 10) {
            try {
                dbClient = new pg.Client({ connectionString: container.connectionString });
                await dbClient.connect();
                break;
            } catch {
                if (++attempts === 10) throw new Error("Could not connect to Postgres after retries");
                await new Promise((r) => setTimeout(r, 1000));
            }
        }

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-push-safety-"));
        workDir = path.join(base, "backend");
        schemaDir = path.join(workDir, "schema");
        fs.mkdirSync(schemaDir, { recursive: true });
        fs.writeFileSync(
            path.join(workDir, "package.json"),
            JSON.stringify({ name: "e2e-push-safety-backend", type: "module" }),
            "utf-8"
        );
        fs.writeFileSync(path.join(schemaDir, "index.ts"), schemaIndex("tasks"));

        env = cleanEnv(container.connectionString);
    }, 60_000);

    afterAll(async () => {
        if (dbClient) try { await dbClient.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    /** Run without a TTY and capture the complete plan or error. */
    function runDb(command: "push" | "generate", extra: string[] = []) {
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        return execa(
            tsxBin,
            [cliScript, "db", command, "--schema-dir", schemaDir, ...extra],
            { cwd: workDir, env, reject: false, stdin: "ignore", all: true }
        );
    }

    function runPush(extra: string[] = []) {
        return runDb("push", extra);
    }

    /** {@link runPush} against another connection string. */
    function runPushAt(databaseUrl: string, extra: string[] = [], overrides: Record<string, string> = {}) {
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        return execa(
            tsxBin,
            [cliScript, "db", "push", "--schema-dir", schemaDir, ...extra],
            { cwd: workDir, env: { ...cleanEnv(databaseUrl), ...overrides }, reject: false, stdin: "ignore", all: true }
        );
    }

    /** Atlas scratch databases (`<db>_dev_diff`) left on the server. */
    async function scratchDatabases(): Promise<string[]> {
        const res = await dbClient.query(`SELECT datname FROM pg_database WHERE datname LIKE '%\\_dev\\_diff' ORDER BY datname`);
        return res.rows.map((row: { datname: string }) => row.datname);
    }

    /** What an earlier test's failed apply kept as its evidence, out of the way. */
    async function dropScratchDatabases(): Promise<void> {
        for (const name of await scratchDatabases()) await dbClient.query(`DROP DATABASE "${name}"`);
    }

    async function noteColumnExists(): Promise<boolean> {
        const res = await dbClient.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'note'`
        );
        return res.rows.length > 0;
    }

    it("refuses to drop a column non-interactively, then drops it with --allow-destructive", async () => {
        // ── 1. Push WITH the note column ─────────────────────────────────
        fs.writeFileSync(path.join(schemaDir, "tasks.ts"), tasksTableTs(true));
        const first = await runPush();
        expect(first.exitCode).toBe(0);
        expect(await noteColumnExists()).toBe(true);

        // ── 2. Remove the field and push non-interactively → MUST refuse ──
        fs.writeFileSync(path.join(schemaDir, "tasks.ts"), tasksTableTs(false));
        const refused = await runPush();

        expect(refused.exitCode).not.toBe(0); // aborted
        expect(refused.all ?? "").toMatch(/destructive/i);
        // The safety net's whole point: the column and its data survive.
        expect(await noteColumnExists()).toBe(true);
        // And the refusal cleans up after itself. It exited from inside the
        // command, past the drop, and a scratch database left once is never
        // dropped again: the next push takes it for one made by hand.
        expect(await scratchDatabases()).toEqual([]);

        // ── 2b. `--allow-destructive=false` keeps the gate shut ───────────
        // `arg` dropped the value and read it as the opt-in: written to keep
        // the gate shut, it opened it and the column went.
        const stillRefused = await runPush(["--allow-destructive=false"]);
        expect(stillRefused.exitCode, stillRefused.all).not.toBe(0);
        expect(stillRefused.all ?? "").toMatch(/destructive/i);
        expect(await noteColumnExists()).toBe(true);
        expect(await scratchDatabases()).toEqual([]);

        // ── 3. Opt in explicitly → the drop is applied ───────────────────
        const allowed = await runPush(["--allow-destructive"]);
        expect(allowed.exitCode, allowed.all).toBe(0);
        expect(await noteColumnExists()).toBe(false);
        expect(allowed.all).toContain('ALTER TABLE "public"."tasks" DROP COLUMN "note"');
        expect(allowed.all).toMatch(/Proceeding because --allow-destructive was passed/);
    }, 150_000);

    /**
     * The half of the gate that names no DROP. It once read every real Atlas
     * plan as safe: the `Planning migration statements (N in total):` heading
     * Atlas prints above the first statement was glued onto it, and the parse
     * that looks for `ALTER TABLE` found prose instead — so `numeric(5,2)` →
     * `numeric(4,1)` rounded 123.45 to 123.5 with no prompt, off a TTY. The
     * unit tests passed throughout, on a plan somebody typed. This one runs the
     * real binary against a real database.
     */
    it("refuses a narrowing type change non-interactively, and the value survives", async () => {
        for (const file of fs.readdirSync(schemaDir)) fs.rmSync(path.join(schemaDir, file));
        fs.writeFileSync(path.join(schemaDir, "index.ts"), schemaIndex("prices"));
        fs.writeFileSync(path.join(schemaDir, "prices.ts"),
            pricesTableTs({ precision: 5, scale: 2, nicknameMax: 40 }));
        // This fixture replaces the table from the preceding case.
        const created = await runPush(["--allow-destructive"]);
        expect(created.all ?? "").not.toMatch(/UNREADABLE PLAN/);
        expect(created.exitCode, created.all).toBe(0);
        await dbClient.query(`INSERT INTO prices (nickname, rating) VALUES ('first', 123.45)`);

        fs.writeFileSync(path.join(schemaDir, "prices.ts"),
            pricesTableTs({ precision: 4, scale: 1, nicknameMax: 40 }));

        // Named once, though Atlas prints every statement twice.
        const dry = await runPush(["--dry-run"]);
        expect(dry.exitCode).toBe(0);
        expect(dry.all ?? "").toMatch(/1 of those need confirming: 1 destroys data/);
        expect(dry.all ?? "").toMatch(/ALTER COLUMN TYPE \("rating" numeric\(5,2\) → numeric\(4,1\)\)/);

        const refused = await runPush();
        expect(refused.exitCode).not.toBe(0);
        expect(refused.all ?? "").toMatch(/This push includes 1 change\(s\) that need confirming: 1 destroys data/);
        expect(refused.all ?? "").not.toMatch(/UNREADABLE PLAN/);

        const row = await dbClient.query(`SELECT rating::text AS rating,
            (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
              WHERE attrelid = 'prices'::regclass AND attname = 'rating') AS type FROM prices`);
        expect(row.rows).toEqual([{ rating: "123.45", type: "numeric(5,2)" }]);
    }, 150_000);

    /** PostgreSQL requires the plan to rebuild search around the type change. */
    it("widens a column a search block reads, rebuilding the search column around it", async () => {
        fs.writeFileSync(path.join(schemaDir, "prices.ts"),
            pricesTableTs({ precision: 5, scale: 2, nicknameMax: 100 }));
        const pushed = await runPush();
        expect(pushed.all ?? "").not.toMatch(/cannot alter type of a column used by a generated column/);
        expect(pushed.exitCode, pushed.all).toBe(0);

        const columns = await dbClient.query(`SELECT attname, format_type(atttypid, atttypmod) AS type,
                attgenerated <> '' AS generated
            FROM pg_attribute WHERE attrelid = 'prices'::regclass AND attnum > 0 AND NOT attisdropped
            ORDER BY attname`);
        const byName = Object.fromEntries(columns.rows.map((r: { attname: string; type: string; generated: boolean }) => [r.attname, r]));
        expect(byName.nickname.type).toBe("character varying(100)");
        expect(Object.values(byName).some((c) => (c as { generated: boolean }).generated)).toBe(true);
    }, 150_000);

    it("keeps the search column when an apply with a rebuild fails", async () => {
        await dbClient.query(`INSERT INTO prices (nickname, rating) VALUES ('no rating', NULL)`);
        fs.writeFileSync(path.join(schemaDir, "prices.ts"),
            pricesTableTs({ precision: 5, scale: 2, nicknameMax: 200, ratingRequired: true }));
        const failed = await runPush();
        expect(failed.exitCode).not.toBe(0);
        expect(failed.all ?? "").toMatch(/contains null values/);

        const columns = await dbClient.query(`SELECT attname, format_type(atttypid, atttypmod) AS type,
                attgenerated <> '' AS generated
            FROM pg_attribute WHERE attrelid = 'prices'::regclass AND attnum > 0 AND NOT attisdropped`);
        const rows = columns.rows as { attname: string; type: string; generated: boolean }[];
        expect(rows.find(r => r.attname === "nickname")?.type).toBe("character varying(100)");
        expect(rows.some(r => r.generated)).toBe(true);
    }, 150_000);

    /**
     * A primary key is a row's address. Moving `translations` from `(id)` to
     * `(id, locale)` makes Atlas plan `DROP CONSTRAINT "translations_pkey", ADD
     * PRIMARY KEY ("id", "locale")` — no DROP of data in sight — and push
     * applied it unasked, off a TTY, changing the id of every row.
     */
    it("refuses to re-key a table non-interactively, then re-keys it with --allow-destructive", async () => {
        const translationsTs = (localeIsKey: boolean) => `import { col, defineTable } from "@rebasepro/types";

export const translations = defineTable("translations", {
    columns: {
        id: col.integer().primaryKey(),
        locale: col.text().${localeIsKey ? "primaryKey()" : "notNull()"},
        title: col.text()
    },
    rls: "admin-only"
});
`;
        const primaryKey = async (): Promise<string[]> => {
            const res = await dbClient.query<{ cols: string[] }>(`
                SELECT array_agg(a.attname::text ORDER BY k.ord) AS cols
                  FROM pg_constraint c
                 CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                 WHERE c.conrelid = 'public.translations'::regclass AND c.contype = 'p'`);
            return res.rows[0]?.cols ?? [];
        };

        // The index is the table set: the earlier tests' tables leave the
        // schema directory, and are left alone in the database as unmanaged.
        for (const file of fs.readdirSync(schemaDir)) fs.rmSync(path.join(schemaDir, file));
        fs.writeFileSync(path.join(schemaDir, "index.ts"), schemaIndex("translations"));
        fs.writeFileSync(path.join(schemaDir, "translations.ts"), translationsTs(false));
        // This fixture replaces the table from the preceding cases.
        const created = await runPush(["--allow-destructive"]);
        expect(created.all ?? "").toMatch(/completed successfully/);
        expect(created.exitCode).toBe(0);
        await dbClient.query(`INSERT INTO translations (id, locale, title) VALUES (1, 'en', 'Hello'), (2, 'en', 'Bye')`);
        expect(await primaryKey()).toEqual(["id"]);

        fs.writeFileSync(path.join(schemaDir, "translations.ts"), translationsTs(true));
        const refused = await runPush();
        expect(refused.exitCode).not.toBe(0);
        expect(refused.all ?? "").toMatch(/This push includes 1 change\(s\) that need confirming: 1 destroys data/);
        expect(refused.all ?? "").toMatch(
            /PRIMARY KEY CHANGE \("public"\."translations" is re-keyed on \("id", "locale"\): every row's id changes/
        );
        expect(await primaryKey()).toEqual(["id"]);

        const allowed = await runPush(["--allow-destructive"]);
        expect(allowed.exitCode).toBe(0);
        expect(await primaryKey()).toEqual(["id", "locale"]);
        const rows = await dbClient.query(`SELECT id, locale, title FROM translations ORDER BY id`);
        expect(rows.rows).toEqual([
            { id: 1, locale: "en", title: "Hello" },
            { id: 2, locale: "en", title: "Bye" }
        ]);
    }, 150_000);

    it("drops the scratch database when Ptah refuses untrusted replay on a shared server", async () => {
        await dbClient.query("CREATE DATABASE untrusted");
        const url = new URL(container.connectionString);
        url.pathname = "/untrusted";
        await dropScratchDatabases();
        for (const file of fs.readdirSync(schemaDir)) fs.rmSync(path.join(schemaDir, file));
        fs.writeFileSync(path.join(schemaDir, "index.ts"), schemaIndex("tasks"));
        fs.writeFileSync(path.join(schemaDir, "tasks.ts"), tasksTableTs(true));

        const failed = await runPushAt(url.href, ["--dry-run"], {
            PTAH_DEV_SERVER_DISPOSABLE: "0",
            PTAH_TRUST_REPLAY_SQL: "0"
        });
        expect(failed.exitCode, failed.all).toBe(1);
        expect(failed.all).toMatch(/postgres migration replay rejects CREATE (?:ROLE|routine)/);
        expect(await scratchDatabases()).toEqual([]);
    }, 150_000);

    // The same URL on this machine is the common case — a `.env` written by
    // hand, or by an older `init` — and Ptah is given the app's default.
    it("connects Ptah without SSL to a database on this machine whose URL names no sslmode", async () => {
        const url = container.connectionString.replace("?sslmode=disable", "");
        await dropScratchDatabases();
        for (const file of fs.readdirSync(schemaDir)) fs.rmSync(path.join(schemaDir, file));
        fs.writeFileSync(path.join(schemaDir, "index.ts"), schemaIndex("tasks"));
        fs.writeFileSync(path.join(schemaDir, "tasks.ts"), tasksTableTs(true));

        const planned = await runPushAt(url, ["--dry-run"]);
        expect(planned.exitCode, planned.all).toBe(0);
        expect(planned.all).not.toMatch(/SSL is not enabled/);
        expect(await scratchDatabases()).toEqual([]);
    }, 150_000);

    it("generates a search-column rebuild once when a varchar grows", async () => {
        for (const file of fs.readdirSync(schemaDir)) fs.rmSync(path.join(schemaDir, file));
        fs.writeFileSync(path.join(schemaDir, "index.ts"), schemaIndex("prices"));
        const pricesFile = path.join(schemaDir, "prices.ts");
        fs.writeFileSync(pricesFile, pricesTableTs({ precision: 5, scale: 2, nicknameMax: 40 }));
        const baseline = await runDb("generate", ["search_baseline"]);
        expect(baseline.exitCode, baseline.all).toBe(0);

        fs.writeFileSync(pricesFile, pricesTableTs({ precision: 5, scale: 2, nicknameMax: 100 }));
        const widened = await runDb("generate", ["widen_search_input"]);
        expect(widened.exitCode, widened.all).toBe(0);

        const migrations = path.join(workDir, "drizzle", "migrations");
        const before = fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort();
        expect(before).toHaveLength(2);
        const sql = fs.readFileSync(path.join(migrations, before[1]), "utf8");
        expect(sql).toMatch(/ALTER COLUMN "nickname" TYPE character varying\(100\)/i);
        expect(sql).toMatch(/ADD COLUMN "search_vector"[^;]+GENERATED ALWAYS AS/i);

        const repeated = await runDb("generate", ["unchanged_search"]);
        expect(repeated.exitCode, repeated.all).toBe(0);
        expect(fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()).toEqual(before);
    }, 150_000);
});
