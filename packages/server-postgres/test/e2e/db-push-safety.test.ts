/**
 * E2E test for `rebase db push`'s destructive-change safety gate.
 *
 * The highest silent-data-loss risk in the product was `db push` running
 * `atlas schema apply --auto-approve` with no confirmation — a removed field
 * compiles to `DROP COLUMN` and the column (and its data) vanish. This proves
 * the gate end-to-end against a real Postgres:
 *
 *   1. push a collection WITH a `note` column        → column created
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

/** Tasks collection; `withNote` toggles the destructive field. */
function tasksCollectionJs(withNote: boolean): string {
    const noteProp = withNote ? `        note:  { name: "Note",  type: "string" },\n` : "";
    return `
const tasksCollection = {
    name: "Tasks",
    singularName: "Task",
    slug: "tasks",
    table: "tasks",
    admin: { icon: "CheckCircle", group: "Core" },
    properties: {
        id:    { name: "ID",    type: "string", isId: "uuid", validation: { required: true } },
        title: { name: "Title", type: "string", validation: { required: true } },
${noteProp}        done:  { name: "Done",  type: "boolean" }
    }
};
export default tasksCollection;
`;
}

function collectionsIndex(): string {
    return `import tasksCollection from "./tasks.js";\nexport default [tasksCollection];\n`;
}

/**
 * A collection whose column TYPES move between pushes. `rating` is
 * `numeric(precision, scale)`; `nickname` is a `varchar(max)` that a search
 * block reads, so retyping it collides with the generated search column.
 */
function pricesCollectionJs(opts: { precision: number; scale: number; nicknameMax: number; ratingRequired?: boolean }): string {
    return `
const pricesCollection = {
    name: "Prices",
    slug: "prices",
    table: "prices",
    search: { fields: [{ path: "nickname", weight: "A" }] },
    properties: {
        id:       { name: "ID", type: "string", isId: "uuid" },
        nickname: { name: "Nickname", type: "string", columnType: "varchar", validation: { max: ${opts.nicknameMax} } },
        rating:   { name: "Rating", type: "number", precision: ${opts.precision}, scale: ${opts.scale}${opts.ratingRequired ? ", validation: { required: true }" : ""} }
    }
};
export default pricesCollection;
`;
}

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

describe("db push destructive-change gate E2E", () => {
    let container: PgContainer;
    let dbClient: pg.Client;
    let workDir: string;
    let collectionsDir: string;
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
        collectionsDir = path.join(base, "config", "collections");
        fs.mkdirSync(workDir, { recursive: true });
        fs.mkdirSync(collectionsDir, { recursive: true });
        fs.writeFileSync(
            path.join(workDir, "package.json"),
            JSON.stringify({ name: "e2e-push-safety-backend", type: "module" }),
            "utf-8"
        );
        fs.writeFileSync(
            path.join(collectionsDir, "package.json"),
            JSON.stringify({ type: "module" }),
            "utf-8"
        );
        fs.writeFileSync(path.join(collectionsDir, "index.js"), collectionsIndex());

        env = cleanEnv(container.connectionString);
    }, 60_000);

    afterAll(async () => {
        if (dbClient) try { await dbClient.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    /**
     * Run `rebase db push` NON-INTERACTIVELY (stdin ignored ⇒ not a TTY) so
     * the gate's non-interactive branch is exercised. `reject: false` lets us
     * assert on the exit code; `all: true` merges stdout+stderr for message
     * checks.
     */
    function runPush(extra: string[] = []) {
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        return execa(
            tsxBin,
            [cliScript, "db", "push", "--collections", collectionsDir, ...extra],
            { cwd: workDir, env, reject: false, stdin: "ignore", all: true }
        );
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
        fs.writeFileSync(path.join(collectionsDir, "tasks.js"), tasksCollectionJs(true));
        const first = await runPush();
        expect(first.exitCode).toBe(0);
        expect(await noteColumnExists()).toBe(true);

        // ── 2. Remove the field and push non-interactively → MUST refuse ──
        fs.writeFileSync(path.join(collectionsDir, "tasks.js"), tasksCollectionJs(false));
        const refused = await runPush();

        expect(refused.exitCode).not.toBe(0); // aborted
        expect(refused.all ?? "").toMatch(/destructive/i);
        // The safety net's whole point: the column and its data survive.
        expect(await noteColumnExists()).toBe(true);

        // ── 3. Opt in explicitly → the drop is applied ───────────────────
        const allowed = await runPush(["--allow-destructive"]);
        expect(allowed.exitCode).toBe(0);
        expect(await noteColumnExists()).toBe(false);
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
        fs.writeFileSync(path.join(collectionsDir, "index.js"),
            `import pricesCollection from "./prices.js";\nexport default [pricesCollection];\n`);
        fs.writeFileSync(path.join(collectionsDir, "prices.js"),
            pricesCollectionJs({ precision: 5, scale: 2, nicknameMax: 40 }));
        const created = await runPush();
        expect(created.all ?? "").not.toMatch(/UNREADABLE PLAN/);
        expect(created.exitCode).toBe(0);
        await dbClient.query(`INSERT INTO prices (nickname, rating) VALUES ('first', 123.45)`);

        fs.writeFileSync(path.join(collectionsDir, "prices.js"),
            pricesCollectionJs({ precision: 4, scale: 1, nicknameMax: 40 }));

        // Named once, though Atlas prints every statement twice.
        const dry = await runPush(["--dry-run"]);
        expect(dry.exitCode).toBe(0);
        expect(dry.all ?? "").toMatch(/1 of those DESTROY data/);
        expect(dry.all ?? "").toMatch(/ALTER COLUMN TYPE \("rating" numeric\(5,2\) → numeric\(4,1\)\)/);

        const refused = await runPush();
        expect(refused.exitCode).not.toBe(0);
        expect(refused.all ?? "").toMatch(/This push includes 1 destructive change/);
        expect(refused.all ?? "").not.toMatch(/UNREADABLE PLAN/);

        const row = await dbClient.query(`SELECT rating::text AS rating,
            (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
              WHERE attrelid = 'prices'::regclass AND attname = 'rating') AS type FROM prices`);
        expect(row.rows).toEqual([{ rating: "123.45", type: "numeric(5,2)" }]);
    }, 150_000);

    /**
     * The same blindness, on the path that moves the search column out of the
     * way: Postgres refuses to retype a column a generated column reads, and
     * `db push` drops and rebuilds Rebase's own search column around the apply —
     * but only if it sees the retype in the plan. It did not, and every push
     * after widening a searched `varchar` failed with no hint.
     */
    it("widens a column a search block reads, rebuilding the search column around it", async () => {
        fs.writeFileSync(path.join(collectionsDir, "prices.js"),
            pricesCollectionJs({ precision: 5, scale: 2, nicknameMax: 100 }));
        const pushed = await runPush();
        expect(pushed.all ?? "").not.toMatch(/cannot alter type of a column used by a generated column/);
        expect(pushed.exitCode).toBe(0);

        const columns = await dbClient.query(`SELECT attname, format_type(atttypid, atttypmod) AS type,
                attgenerated <> '' AS generated
            FROM pg_attribute WHERE attrelid = 'prices'::regclass AND attnum > 0 AND NOT attisdropped
            ORDER BY attname`);
        const byName = Object.fromEntries(columns.rows.map((r: { attname: string; type: string; generated: boolean }) => [r.attname, r]));
        expect(byName.nickname.type).toBe("character varying(100)");
        expect(Object.values(byName).some((c) => (c as { generated: boolean }).generated)).toBe(true);
    }, 150_000);

    /**
     * The push drops the search column before the apply. If the apply then
     * fails for some other reason, the column must come back: Atlas rolled its
     * transaction back, so the old definition still fits. The rebuild was
     * written, and never ran — the failure exited from inside the Atlas runner,
     * past the `catch` that held it — so search was left gone.
     */
    it("puts the search column back when the apply it made room for fails", async () => {
        await dbClient.query(`INSERT INTO prices (nickname, rating) VALUES ('no rating', NULL)`);
        fs.writeFileSync(path.join(collectionsDir, "prices.js"),
            pricesCollectionJs({ precision: 5, scale: 2, nicknameMax: 200, ratingRequired: true }));
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
        const translationsJs = (localeIsKey: boolean) => `
const translationsCollection = {
    name: "Translations",
    slug: "translations",
    table: "translations",
    properties: {
        id:     { name: "ID",     type: "number", isId: true },
        locale: { name: "Locale", type: "string", ${localeIsKey ? "isId: true" : "validation: { required: true }"} },
        title:  { name: "Title",  type: "string" }
    }
};
export default translationsCollection;
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

        // The directory is the collection set, whatever `index.js` lists: the
        // earlier tests' tables leave it, and are left alone as unmanaged.
        for (const file of fs.readdirSync(collectionsDir)) {
            if (file.endsWith(".js")) fs.rmSync(path.join(collectionsDir, file));
        }
        fs.writeFileSync(path.join(collectionsDir, "index.js"),
            `import translationsCollection from "./translations.js";\nexport default [translationsCollection];\n`);
        fs.writeFileSync(path.join(collectionsDir, "translations.js"), translationsJs(false));
        const created = await runPush();
        expect(created.all ?? "").toMatch(/completed successfully/);
        expect(created.exitCode).toBe(0);
        await dbClient.query(`INSERT INTO translations (id, locale, title) VALUES (1, 'en', 'Hello'), (2, 'en', 'Bye')`);
        expect(await primaryKey()).toEqual(["id"]);

        fs.writeFileSync(path.join(collectionsDir, "translations.js"), translationsJs(true));
        const refused = await runPush();
        expect(refused.exitCode).not.toBe(0);
        expect(refused.all ?? "").toMatch(/This push includes 1 destructive change/);
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
});
