/**
 * One database per `db push | generate | migrate`.
 *
 * A project with `database("analytics")` declares tables for two databases in
 * one schema directory. The schema commands used to read every table and
 * apply them all to `DATABASE_URL`, so a push created the analytics tables in
 * the default database. Now each run targets one database — the default unless
 * `--database <key>` names another — and every step reads that database's
 * connection string, migration directory and tables.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { database, DEFAULT_RESOURCE_KEY, resetDeclaredResources } from "@rebasepro/types";

import {
    DEFAULT_MIGRATIONS_DIR,
    declaredDatabaseKeys,
    migrationsDirFor,
    migrationsDirUrl,
    resolveDatabaseTarget,
    scopedDatabaseTarget,
    storedByDatabase,
    UnknownDatabaseTargetError,
    withDatabaseTarget,
    type DatabaseTarget
} from "../src/database-target";
import { defaultDatabaseSchemaVersion, loadTableSchema, loadTables } from "../src/schema/load-tables";
import { writePostgresDdl } from "../src/schema/generate-files";
import { migrateApplyArgs } from "../src/schema/atlas-argv";
import { baselineVersionProblem } from "../src/schema/migrate-baseline";
import { nextStepAfterDbGenerate } from "../src/schema/generate-next-step";
import { provisionedWithoutHistoryProblem } from "../src/schema/migrate-path-guard";

const SPECIFIER = "@rebasepro/types";

const scratch: string[] = [];

afterEach(() => resetDeclaredResources());
afterAll(() => {
    for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A backend with `posts` on the default database and `events` on `analytics`. Returns its schema directory. */
function twoDatabaseProject(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-database-target-"));
    scratch.push(root);
    const dir = path.join(root, "backend", "schema");
    fs.mkdirSync(dir, { recursive: true });
    const table = (name: string, extra = ""): string =>
        `import { col, defineTable } from "${SPECIFIER}";\n\n` +
        `export const ${name} = defineTable("${name}", {\n` +
        "    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },\n" +
        `    rls: "admin-only"${extra ? `,\n    ${extra}` : ""}\n});\n`;
    fs.writeFileSync(path.join(dir, "posts.ts"), table("posts"));
    fs.writeFileSync(path.join(dir, "events.ts"), table("events", 'database: "analytics"'));
    fs.writeFileSync(path.join(dir, "index.ts"), 'export { posts } from "./posts";\nexport { events } from "./events";\n');
    return dir;
}

function targetFor(key: string, configDir = "/project/backend"): DatabaseTarget {
    return resolveDatabaseTarget({
        requested: key,
        env: { DATABASE_URL: "postgres://main", DATABASE_URL__ANALYTICS: "postgres://analytics" },
        configDir,
        cwd: configDir
    });
}

describe("resolveDatabaseTarget", () => {
    beforeEach(() => {
        database("analytics");
    });

    it("is the default database at DATABASE_URL, in drizzle/migrations, when no --database is given", () => {
        const target = resolveDatabaseTarget({
            env: { DATABASE_URL: "postgres://main", DATABASE_URL__ANALYTICS: "postgres://analytics" },
            configDir: "/project/backend",
            cwd: "/project/backend"
        });
        expect(target).toEqual({
            key: DEFAULT_RESOURCE_KEY,
            isDefault: true,
            url: "postgres://main",
            urlSource: "DATABASE_URL",
            migrationsDir: DEFAULT_MIGRATIONS_DIR,
            commandSuffix: ""
        });
        expect(targetFor(DEFAULT_RESOURCE_KEY)).toEqual(target);
    });

    it("is a named database at DATABASE_URL__<KEY>, with migrations of its own", () => {
        expect(targetFor("analytics")).toEqual({
            key: "analytics",
            isDefault: false,
            url: "postgres://analytics",
            urlSource: "DATABASE_URL__ANALYTICS",
            migrationsDir: "drizzle/migrations/analytics",
            commandSuffix: " --database analytics"
        });
    });

    it("takes --database-url over the variable", () => {
        const target = resolveDatabaseTarget({
            requested: "analytics",
            databaseUrlFlag: "postgres://elsewhere",
            env: { DATABASE_URL__ANALYTICS: "postgres://analytics" },
            configDir: "/project/backend"
        });
        expect(target.url).toBe("postgres://elsewhere");
        expect(target.urlSource).toBe("--database-url");
    });

    it("leaves the url undefined when nothing binds a named database", () => {
        const target = resolveDatabaseTarget({ requested: "analytics", env: {}, configDir: "/project/backend" });
        expect(target.url).toBeUndefined();
        expect(target.urlSource).toBe("DATABASE_URL__ANALYTICS");
    });

    // Read as the default before: `--database analytcs` would have pushed the
    // default database's tables wherever DATABASE_URL pointed.
    it("refuses a key the project does not declare, listing the declared ones", () => {
        let thrown: unknown;
        try {
            targetFor("analytcs");
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(UnknownDatabaseTargetError);
        const error = thrown as UnknownDatabaseTargetError;
        expect(error.declared).toEqual([DEFAULT_RESOURCE_KEY, "analytics"]);
        expect(error.message).toContain('No database "analytcs" is declared');
        expect(error.message).toContain('"(default)", "analytics"');
        expect(error.message).toContain('database("analytcs")');
    });

    it("lists the default first, then the declared databases in order", () => {
        database("warehouse");
        expect(declaredDatabaseKeys()).toEqual([DEFAULT_RESOURCE_KEY, "analytics", "warehouse"]);
    });
});

describe("the migration directory", () => {
    it("is drizzle/migrations for the default and drizzle/migrations/<key> for another", () => {
        expect(migrationsDirFor(DEFAULT_RESOURCE_KEY, "/p/backend", "/p/backend")).toBe("drizzle/migrations");
        expect(migrationsDirFor("analytics", "/p/backend", "/p/backend")).toBe("drizzle/migrations/analytics");
        expect(migrationsDirUrl("drizzle/migrations/analytics")).toBe("file://drizzle/migrations/analytics");
    });

    it("is the declaration's `migrations`, relative to the directory resources.ts is in", () => {
        database("analytics", { migrations: "db/analytics" });
        database({ migrations: "db/main" });
        expect(migrationsDirFor("analytics", "/p/backend", "/p/backend")).toBe("db/analytics");
        expect(migrationsDirFor(DEFAULT_RESOURCE_KEY, "/p/backend", "/p/backend")).toBe("db/main");
        // Atlas resolves the URL against the command's directory, so the path is made relative to it.
        expect(migrationsDirFor("analytics", "/p/backend", "/p")).toBe("backend/db/analytics");
    });

    it("reaches Atlas, the baseline refusal and the printed commands", () => {
        expect(migrateApplyArgs([], undefined, "file://drizzle/migrations/analytics"))
            .toEqual(["apply", "--dir", "file://drizzle/migrations/analytics"]);
        expect(migrateApplyArgs([], undefined)).toEqual(["apply", "--dir", "file://drizzle/migrations"]);
        expect(baselineVersionProblem("1", [], "drizzle/migrations/analytics"))
            .toContain("no migrations in drizzle/migrations/analytics");
        expect(nextStepAfterDbGenerate({ newestVersion: "2", wrote: true, first: true, commandSuffix: " --database analytics" }).join("\n"))
            .toContain("rebase db migrate --database analytics --baseline 2");
        expect(provisionedWithoutHistoryProblem({
            latestRecorded: null,
            existing: [{ schema: "public", table: "events" }],
            newestVersion: "2",
            commandSuffix: " --database analytics"
        })).toContain("rebase db migrate --database analytics --baseline 2");
    });
});

describe("the tables a run reads", () => {
    it("are every table outside a db command", async () => {
        const dir = twoDatabaseProject();
        expect(scopedDatabaseTarget()).toBeUndefined();
        expect((await loadTables(dir)).map(t => t.descriptor.slug)).toEqual(["events", "posts"]);
    });

    it("are the default database's inside a run on it — never another database's", async () => {
        const dir = twoDatabaseProject();
        const slugs = await withDatabaseTarget(targetFor(DEFAULT_RESOURCE_KEY), async () =>
            (await loadTables(dir)).map(t => t.descriptor.slug));
        expect(slugs).toEqual(["posts"]);
    });

    it("are the named database's inside a run on it", async () => {
        database("analytics");
        const dir = twoDatabaseProject();
        const loaded = await withDatabaseTarget(targetFor("analytics"), () => loadTableSchema(dir));
        expect(loaded.tables.map(t => t.descriptor.slug)).toEqual(["events"]);
        expect(loaded.descriptors.map(d => d.slug)).toEqual(["events"]);
    });

    // The Drizzle schema is one file the server reads for every database.
    it("are every table for the Drizzle schema, even inside a run", async () => {
        const dir = twoDatabaseProject();
        const slugs = await withDatabaseTarget(targetFor(DEFAULT_RESOURCE_KEY), async () =>
            (await loadTables(dir, { allDatabases: true })).map(t => t.descriptor.slug));
        expect(slugs).toEqual(["events", "posts"]);
    });

    it("stamp the default database's version whichever scope they were read in", async () => {
        const dir = twoDatabaseProject();
        const everything = await loadTableSchema(dir);
        const inDefault = await withDatabaseTarget(targetFor(DEFAULT_RESOURCE_KEY), () => loadTableSchema(dir));
        expect(defaultDatabaseSchemaVersion(inDefault)).toBe(defaultDatabaseSchemaVersion(everything));
    });

    it("are filtered on the same rule boot provisions by", () => {
        const descriptors = [{ slug: "a" }, { slug: "b", database: DEFAULT_RESOURCE_KEY }, { slug: "c", database: "analytics" }];
        expect(storedByDatabase(descriptors, DEFAULT_RESOURCE_KEY).map(d => d.slug)).toEqual(["a", "b"]);
        expect(storedByDatabase(descriptors, "analytics").map(d => d.slug)).toEqual(["c"]);
    });
});

describe("the DDL a push applies", () => {
    const write = async (dir: string, run: (outputPath: string) => Promise<void>): Promise<string> => {
        const out = path.join(path.dirname(dir), ".rebase", "sql", "schema.sql");
        await run(out);
        return fs.readFileSync(out, "utf-8");
    };

    it("creates only the default database's tables in a run on the default", async () => {
        const dir = twoDatabaseProject();
        const sql = await write(dir, outputPath =>
            withDatabaseTarget(targetFor(DEFAULT_RESOURCE_KEY), () => writePostgresDdl({ schemaDir: dir, outputPath })));
        expect(sql).toMatch(/CREATE TABLE[^;]*"posts"/);
        expect(sql).not.toMatch(/CREATE TABLE[^;]*"events"/);
    });

    it("creates only the named database's tables when the generator is told which (the child-process path)", async () => {
        const dir = twoDatabaseProject();
        const sql = await write(dir, outputPath => writePostgresDdl({ schemaDir: dir, outputPath, database: "analytics" }));
        expect(sql).toMatch(/CREATE TABLE[^;]*"events"/);
        expect(sql).not.toMatch(/CREATE TABLE[^;]*"posts"/);
    });
});
