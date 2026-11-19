/**
 * `rebase db push` and `rebase db migrate` on the managed database while
 * `rebase dev` runs.
 *
 * The first push after `dev` started failed with a bare `Error: EOF` and
 * `✗ atlas schema apply … --dry-run failed`; the next ones passed. The managed
 * database is one PGlite session behind a socket server that accepts
 * {@link MANAGED_SERVER_MAX_CONNECTIONS} connections. A dev server holds some
 * (its pool's connection while warm, a LISTEN connection), the driver kept its
 * own open between steps, and `atlas schema apply` opens two, so Atlas's second
 * was over the limit and closed unanswered. The driver now lets its connection
 * go while Atlas runs.
 *
 * `db migrate` failed there every time. With the dev server up, Atlas's third
 * connection was closed unanswered (`Error: postgres: querying system
 * variables: EOF`); with it stopped, Atlas created its revisions table in
 * `public` — PGlite is one session, so the `search_path` a connection asks for
 * is never applied — read it from `rebase`, failed on 42P01, and from then on
 * every run, `--baseline` included, failed on 42P07 about that table.
 *
 * Built here as the daemon builds it (PGlite, the socket server with the same
 * limit, the notification proxy in front), with two connections held for the
 * dev server, and the driver's own CLI run from source.
 */
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAtlasDevDatabase, type AtlasDevDatabase } from "./atlas-dev-database";
import { MANAGED_SERVER_MAX_CONNECTIONS } from "./constraints";
import { managedUrl } from "./daemon";
import { NotificationProxy } from "./notification-proxy";
import { findFreePort } from "./state";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const DRIVER_CLI = path.join(REPO, "packages", "server-postgres", "src", "cli.ts");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const PTAH_COMPAT = path.join(REPO, "packages", "server-postgres", "node_modules", ".bin", "ptah-compat");

// From `@rebasepro/types`, which exports the builders and which the driver's
// tsx resolves to source through the repository's typecheck config.
const tasks = `
import { defineTable, col } from "@rebasepro/types";
export const tasks = defineTable("tasks", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        embedding: col.vector({ dimensions: 3, index: false })
    },
    rls: "admin-only"
});
`;
const publicTasks = tasks.replace('rls: "admin-only"', 'rls: [{ operation: "select", access: "public" }]');
const indexedTasks = publicTasks
    .replace(
        "embedding: col.vector({ dimensions: 3, index: false })",
        'embedding: col.vector({ dimensions: 3, index: { method: "hnsw", metric: "cosine" } }),\n' +
        '        updatedAt: col.timestamp({ withTimezone: true }).onUpdateNow()'
    )
    .replace('    rls:', '    search: { fields: ["title"] },\n    rls:');
const taskTitles = `
import { defineView, col } from "@rebasepro/types";
export const taskTitles = defineView("task_titles", {
    query: "SELECT id, title FROM public.tasks",
    columns: {
        id: col.uuid().primaryKey(),
        title: col.text()
    }
});
`;
const scratchNotes = `
import { defineTable, col } from "@rebasepro/types";
export const scratchNotes = defineTable("scratch_notes", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        updatedAt: col.timestamp({ withTimezone: true }).onUpdateNow()
    },
    rls: "admin-only"
});
`;

describe("db push against the managed database while a dev server holds connections", () => {
    let db: { close(): Promise<void> };
    let server: { stop(): Promise<void> };
    let proxy: NotificationProxy;
    let dev: AtlasDevDatabase;
    let url: string;
    let project: string;
    const held: pg.Client[] = [];

    beforeAll(async () => {
        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<{ close(): Promise<void> }> };
        };
        const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
            PGLiteSocketServer: new (options: unknown) => { start(): Promise<void>; stop(): Promise<void> };
        };
        const { vector } = await import("@electric-sql/pglite-pgvector");
        db = await PGlite.create({ extensions: { vector } });
        const upstreamPort = await findFreePort();
        const socketServer = new PGLiteSocketServer({
            db, port: upstreamPort, host: "127.0.0.1", maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
        });
        await socketServer.start();
        server = socketServer;
        const listenPort = await findFreePort();
        proxy = new NotificationProxy({ listenPort, upstreamPort });
        await proxy.start();
        url = managedUrl(listenPort);

        // A running `rebase dev`: its pool's connection and a LISTEN one.
        for (let i = 0; i < 2; i++) {
            const client = new pg.Client({ connectionString: url });
            await client.connect();
            held.push(client);
        }
        await held[0].query("CREATE EXTENSION vector");

        dev = await startAtlasDevDatabase();

        project = fs.mkdtempSync(path.join(os.tmpdir(), "managed-push-"));
        fs.mkdirSync(path.join(project, "backend"));
        fs.mkdirSync(path.join(project, "backend", "schema"), { recursive: true });
        fs.writeFileSync(path.join(project, "backend", "package.json"), JSON.stringify({ name: "backend", type: "module" }));
        fs.writeFileSync(path.join(project, "backend", "resources.js"),
            'import { database } from "@rebasepro/types";\nexport const main = database({ extensions: ["vector"] });\n');
        fs.writeFileSync(path.join(project, "backend", "schema", "tasks.js"), tasks);
        fs.writeFileSync(path.join(project, "backend", "schema", "index.js"), "export { tasks } from \"./tasks.js\";\n");
    });

    afterAll(async () => {
        for (const client of held) await client.end().catch(() => undefined);
        await dev?.stop();
        await proxy?.stop();
        await server?.stop();
        await db?.close();
        if (project) fs.rmSync(project, { recursive: true, force: true });
    });

    const driver = (...args: string[]) => execa(TSX, [DRIVER_CLI, ...args], {
        cwd: path.join(project, "backend"),
        reject: false,
        all: true,
        env: {
            DATABASE_URL: url,
            REBASE_DEV_DATABASE_KIND: "managed",
            REBASE_ATLAS_DEV_URL: dev.url,
            PTAH_DEV_SERVER_DISPOSABLE: "1",
            REBASE_PTAH_DEV_PGLITE: "1",
            // The code under test, not the last build.
            TSX_TSCONFIG_PATH: path.join(REPO, "tsconfig.typecheck.json")
        }
    });
    const schemaDir = () => path.join(project, "backend", "schema");

    /** Every schema holding a table named `atlas_schema_revisions`. */
    const revisionTables = async (): Promise<string[]> => (await held[0].query<{ table_schema: string }>(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'atlas_schema_revisions' ORDER BY 1"
    )).rows.map(row => row.table_schema);

    const recorded = async (): Promise<string[]> => (await held[0].query<{ version: string }>(
        "SELECT version FROM rebase.atlas_schema_revisions ORDER BY version"
    )).rows.map(row => row.version);

    const newestMigration = (): string => {
        const files = fs.readdirSync(path.join(project, "backend", "drizzle", "migrations")).filter(f => f.endsWith(".sql")).sort();
        return files.at(-1) ?? "";
    };
    const newestVersion = (): string => /^(\d+)/.exec(newestMigration())?.[1] ?? "";

    it("plans the push instead of failing on `Error: EOF`", async () => {
        const result = await driver("db", "push", "--dry-run", "--schema-dir", schemaDir());

        expect(result.all).not.toContain("Error: EOF");
        expect(result.all).toContain("Planned changes");
        expect(result.all).not.toContain("DROP EXTENSION");
        expect(result.exitCode).toBe(0);
    });

    it("on a database boot provisioned, names --baseline, leaves no revisions table outside `rebase`, and the baseline applies", async () => {
        // What boot does with the collection before any migration exists.
        await held[0].query("CREATE TABLE public.tasks (id uuid PRIMARY KEY, title varchar NOT NULL)");
        const generated = await driver("db", "generate", "--schema-dir", schemaDir(), "init");
        expect(generated.exitCode, generated.all).toBe(0);
        const desired = fs.readFileSync(path.join(project, "backend", ".rebase", "sql", "schema.sql"), "utf8");
        expect(desired).toContain("CREATE TABLE");
        expect(desired).toContain("VECTOR(3)");
        // The next diff replays migration history, not the live database. Put
        // these objects in the baseline migration so their protection is tested.
        const migrationsDir = path.join(project, "backend", "drizzle", "migrations");
        fs.appendFileSync(path.join(migrationsDir, newestMigration()), `
CREATE VIEW public.task_ids AS SELECT id FROM public.tasks;
CREATE INDEX custom_title_idx ON public.tasks (title);
CREATE FUNCTION public.custom_touch() RETURNS trigger AS $$
    BEGIN RETURN NEW; END
$$ LANGUAGE plpgsql;
CREATE TRIGGER custom_touch BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.custom_touch();
CREATE POLICY custom_read ON public.tasks AS RESTRICTIVE
    FOR SELECT TO PUBLIC USING (true);
`);
        const hashed = await execa(PTAH_COMPAT, ["migrate", "hash", "--dir", "file://drizzle/migrations"], {
            cwd: path.join(project, "backend"), reject: false, all: true
        });
        expect(hashed.exitCode, hashed.all).toBe(0);
        await held[0].query("ALTER TABLE public.tasks ADD COLUMN embedding vector(3)");
        await held[0].query("CREATE VIEW public.task_ids AS SELECT id FROM public.tasks");
        const version = newestVersion();
        expect(version).not.toBe("");
        // What it ends on says so before `db migrate` has to.
        expect(generated.all).toContain(`rebase db migrate --baseline ${version}`);

        const failed = await driver("db", "migrate");
        expect(failed.all).not.toContain("EOF");
        expect(failed.all).toContain("already exists");
        expect(failed.all).toContain(`rebase db migrate --baseline ${version}`);
        expect(failed.exitCode).toBe(1);
        expect(await revisionTables()).toEqual(["rebase"]);

        const baselined = await driver("db", "migrate", "--baseline", version);
        expect(baselined.all).not.toContain("EOF");
        expect(baselined.exitCode).toBe(0);
        expect(await recorded()).toEqual([version]);
        expect(await revisionTables()).toEqual(["rebase"]);
    });

    it("generates no migration when the declared schema and history are unchanged", async () => {
        const before = newestMigration();
        const generated = await driver("db", "generate", "--schema-dir", schemaDir(), "unchanged");
        expect(generated.exitCode, generated.all).toBe(0);
        expect(newestMigration()).toBe(before);
    });

    it("synchronizes a baselined target before authoring policy changes", async () => {
        await held[0].query("CREATE POLICY custom_read ON public.tasks AS RESTRICTIVE FOR SELECT TO PUBLIC USING (true)");
        await held[0].query("CREATE INDEX custom_title_idx ON public.tasks (title)");
        await held[0].query(`CREATE FUNCTION public.custom_touch() RETURNS trigger AS $$
            BEGIN RETURN NEW; END
        $$ LANGUAGE plpgsql`);
        await held[0].query("CREATE TRIGGER custom_touch BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.custom_touch()");
        const pushed = await driver("db", "push", "--schema-dir", schemaDir());
        expect(pushed.exitCode, pushed.all).toBe(0);
        const again = await driver("db", "push", "--dry-run", "--schema-dir", schemaDir());
        expect(again.exitCode, again.all).toBe(0);
        expect(again.all).toContain("No changes");
        const customPolicy = await held[0].query(
            "SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'custom_read'"
        );
        const customTrigger = await held[0].query(
            "SELECT 1 FROM pg_trigger WHERE tgname = 'custom_touch' AND NOT tgisinternal"
        );
        expect(customPolicy.rowCount).toBe(1);
        expect(customTrigger.rowCount).toBe(1);
        const customIndex = await held[0].query(
            "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tasks' AND indexname = 'custom_title_idx'"
        );
        expect(customIndex.rowCount).toBe(1);
    });

    it("generates and applies a migration for a policy-only change", async () => {
        fs.writeFileSync(path.join(schemaDir(), "tasks.js"), publicTasks);
        const generated = await driver("db", "generate", "--schema-dir", schemaDir(), "policy_only");
        expect(generated.exitCode, generated.all).toBe(0);
        const migration = fs.readFileSync(path.join(project, "backend", "drizzle", "migrations", newestMigration()), "utf8");
        expect(migration).toMatch(/(?:CREATE|ALTER|DROP) POLICY/);
        expect(migration).not.toContain("custom_read");
        expect(migration).not.toContain("custom_touch");
        expect(migration).not.toContain("custom_title_idx");
        expect(migration).not.toContain("DROP VIEW");
        expect(migration).not.toContain("DROP EXTENSION");
        const applied = await driver("db", "migrate");
        expect(applied.exitCode, applied.all).toBe(0);
    });

    it("generates and applies a migration for a declared view-only change", async () => {
        fs.writeFileSync(path.join(schemaDir(), "task_titles.js"), taskTitles);
        fs.writeFileSync(path.join(schemaDir(), "index.js"),
            "export { tasks } from \"./tasks.js\";\nexport { taskTitles } from \"./task_titles.js\";\n");
        const added = await driver("db", "generate", "--schema-dir", schemaDir(), "add_view");
        expect(added.exitCode, added.all).toBe(0);
        const firstApply = await driver("db", "migrate");
        expect(firstApply.exitCode, firstApply.all).toBe(0);

        fs.writeFileSync(path.join(schemaDir(), "task_titles.js"),
            taskTitles.replace("SELECT id, title FROM", "SELECT id, title || '!' AS title FROM"));
        const changed = await driver("db", "generate", "--schema-dir", schemaDir(), "change_view");
        expect(changed.exitCode, changed.all).toBe(0);
        const migration = fs.readFileSync(path.join(project, "backend", "drizzle", "migrations", newestMigration()), "utf8");
        expect(migration).toMatch(/(?:CREATE|REPLACE|DROP) VIEW/);
        expect(migration).not.toContain("task_ids");
        expect(migration).not.toContain("DROP EXTENSION");
        const secondApply = await driver("db", "migrate");
        expect(secondApply.exitCode, secondApply.all).toBe(0);
        const definition = await held[0].query<{ definition: string }>(
            "SELECT definition FROM pg_views WHERE schemaname = 'public' AND viewname = 'task_titles'"
        );
        expect(definition.rows[0]?.definition).toContain("'!'");
        const synced = await driver("db", "push", "--dry-run", "--schema-dir", schemaDir());
        expect(synced.exitCode, synced.all).toBe(0);
        expect(synced.all).toContain("No changes");
    });

    it("plans and migrates a removed view without dropping an unrelated view", async () => {
        const managedFile = path.join(project, "backend", "drizzle", "ptah-managed.json");
        expect(fs.readFileSync(managedFile, "utf8")).toContain("public.task_titles");
        fs.rmSync(path.join(schemaDir(), "task_titles.js"));
        fs.writeFileSync(path.join(schemaDir(), "index.js"), "export { tasks } from \"./tasks.js\";\n");

        const pushPlan = await driver("db", "push", "--dry-run", "--schema-dir", schemaDir());
        expect(pushPlan.exitCode, pushPlan.all).toBe(0);
        expect(pushPlan.all).toMatch(/DROP VIEW[^;]*task_titles/);
        expect(pushPlan.all).not.toMatch(/DROP VIEW[^;]*task_ids/);

        const generated = await driver("db", "generate", "--schema-dir", schemaDir(), "remove_view");
        expect(generated.exitCode, generated.all).toBe(0);
        const migration = fs.readFileSync(path.join(project, "backend", "drizzle", "migrations", newestMigration()), "utf8");
        expect(migration).toMatch(/DROP VIEW[^;]*task_titles/);
        expect(migration).not.toMatch(/DROP VIEW[^;]*task_ids/);
        expect(fs.readFileSync(managedFile, "utf8")).toContain("public.task_titles");

        const applied = await driver("db", "migrate");
        expect(applied.exitCode, applied.all).toBe(0);
        const views = await held[0].query<{ viewname: string }>(
            "SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname IN ('task_titles', 'task_ids') ORDER BY viewname"
        );
        expect(views.rows.map(row => row.viewname)).toEqual(["task_ids"]);

        const before = newestMigration();
        const repeat = await driver("db", "generate", "--schema-dir", schemaDir(), "unchanged_after_view_removal");
        expect(repeat.exitCode, repeat.all).toBe(0);
        expect(newestMigration()).toBe(before);
    });

    it("generates search, vector index and trigger changes through the same migration plan", async () => {
        fs.writeFileSync(path.join(schemaDir(), "tasks.js"), indexedTasks);
        const generated = await driver("db", "generate", "--schema-dir", schemaDir(), "add_indexes_and_trigger");
        expect(generated.exitCode, generated.all).toBe(0);
        const migration = fs.readFileSync(path.join(project, "backend", "drizzle", "migrations", newestMigration()), "utf8");
        expect(migration).toContain("CREATE INDEX");
        expect(migration).toContain("CREATE TRIGGER");
        expect(migration).not.toContain("custom_read");
        expect(migration).not.toContain("custom_touch");

        const applied = await driver("db", "migrate");
        expect(applied.exitCode, applied.all).toBe(0);
        const indexes = await held[0].query<{ indexname: string }>(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tasks'"
        );
        expect(indexes.rows.some(row => row.indexname.includes("embedding"))).toBe(true);
        expect(indexes.rows.some(row => row.indexname.includes("search"))).toBe(true);
        const triggers = await held[0].query<{ tgname: string }>(
            "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal"
        );
        expect(triggers.rows.some(row => row.tgname.includes("updated"))).toBe(true);
        const synced = await driver("db", "push", "--dry-run", "--schema-dir", schemaDir());
        expect(synced.exitCode, synced.all).toBe(0);
        expect(synced.all).toContain("No changes");
    });

    it("applies the next migration beside the dev server's connections, and a second run finds nothing to do", async () => {
        fs.writeFileSync(path.join(schemaDir(), "tasks.js"), indexedTasks.replace(
            "title: col.text().notNull()",
            "title: col.text().notNull(),\n        done: col.boolean()"
        ));
        const before = await recorded();
        const generated = await driver("db", "generate", "--schema-dir", schemaDir(), "add_done");
        expect(generated.exitCode, generated.all).toBe(0);
        const version = newestVersion();
        expect(before).not.toContain(version);
        const migration = fs.readFileSync(path.join(project, "backend", "drizzle", "migrations", newestMigration()), "utf8");
        expect(migration).not.toContain("DROP EXTENSION");
        expect(migration).not.toContain("DROP VIEW");
        expect(migration).not.toContain("DROP COLUMN \"embedding\"");

        const applied = await driver("db", "migrate");
        expect(applied.all).not.toContain("EOF");
        expect(applied.exitCode, applied.all).toBe(0);
        expect(await recorded()).toEqual([...before, version]);
        const column = await held[0].query("SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'done'");
        expect(column.rowCount).toBe(1);

        const again = await driver("db", "migrate");
        expect(again.exitCode).toBe(0);
        expect(await recorded()).toEqual([...before, version]);
        expect(await revisionTables()).toEqual(["rebase"]);
    });

    // On a database that already records migrations, `--baseline` is `atlas
    // migrate set`, which takes no `--skip-lock`: beside the dev server's two
    // connections it failed on `EOF` every time, and worked with dev stopped.
    it("records a column boot already added with a second --baseline, beside the dev server's connections", async () => {
        fs.writeFileSync(path.join(schemaDir(), "tasks.js"), indexedTasks.replace(
            "title: col.text().notNull()",
            "title: col.text().notNull(),\n        done: col.boolean(),\n        slug: col.varchar({ length: 255 })"
        ));
        // What boot does with the new column before any migration does.
        await held[0].query("ALTER TABLE public.tasks ADD COLUMN slug varchar(255)");
        const before = await recorded();
        const generated = await driver("db", "generate", "--schema-dir", schemaDir(), "add_slug");
        expect(generated.exitCode, generated.all).toBe(0);
        const version = newestVersion();
        expect(before).not.toContain(version);

        const failed = await driver("db", "migrate");
        expect(failed.all).toContain(`rebase db migrate --baseline ${version}`);
        expect(failed.exitCode).toBe(1);

        const baselined = await driver("db", "migrate", "--baseline", version);
        expect(baselined.all).not.toContain("EOF");
        expect(baselined.all).toContain("Marking every migration up to");
        expect(baselined.exitCode, baselined.all).toBe(0);
        expect(await recorded()).toEqual([...before, version]);
        expect(await revisionTables()).toEqual(["rebase"]);
    });

    it("keeps application query results correct during a Ptah plan", { timeout: 60000 }, async () => {
        const plan = driver("db", "push", "--dry-run", "--schema-dir", schemaDir());
        let finished = false;
        let concurrentQueries = 0;
        void plan.then(() => { finished = true; });
        await new Promise(resolve => setTimeout(resolve, 100));
        const planWasRunning = !finished;

        for (let value = 0; value < 200 && !finished; value += 1) {
            const result = await held[0].query<{ value: number }>("SELECT $1::integer AS value", [value]);
            expect(result.rows[0]?.value).toBe(value);
            concurrentQueries += 1;
        }

        const result = await plan;
        expect(result.exitCode, result.all).toBe(0);
        expect(planWasRunning).toBe(true);
        expect(concurrentQueries).toBeGreaterThan(10);
    });

    it("drops removed managed tables and views through db push", async () => {
        fs.writeFileSync(path.join(schemaDir(), "scratch_notes.js"), scratchNotes);
        fs.writeFileSync(path.join(schemaDir(), "task_titles.js"), taskTitles);
        fs.writeFileSync(path.join(schemaDir(), "index.js"),
            "export { tasks } from \"./tasks.js\";\n" +
            "export { scratchNotes } from \"./scratch_notes.js\";\n" +
            "export { taskTitles } from \"./task_titles.js\";\n");
        const created = await driver("db", "push", "--schema-dir", schemaDir());
        expect(created.exitCode, created.all).toBe(0);
        await held[0].query("CREATE OR REPLACE VIEW public.task_ids AS SELECT id FROM public.tasks");

        fs.rmSync(path.join(schemaDir(), "scratch_notes.js"));
        fs.rmSync(path.join(schemaDir(), "task_titles.js"));
        fs.writeFileSync(path.join(schemaDir(), "index.js"), "export { tasks } from \"./tasks.js\";\n");
        const planned = await driver("db", "push", "--dry-run", "--schema-dir", schemaDir());
        expect(planned.exitCode, planned.all).toBe(0);
        expect(planned.all).toMatch(/DROP TABLE[^;]*scratch_notes/);
        expect(planned.all).toMatch(/DROP VIEW[^;]*task_titles/);

        const removed = await driver("db", "push", "--allow-destructive", "--schema-dir", schemaDir());
        expect(removed.exitCode, removed.all).toBe(0);
        const table = await held[0].query("SELECT to_regclass('public.scratch_notes') AS relation");
        expect(table.rows[0]?.relation).toBeNull();
        const view = await held[0].query("SELECT to_regclass('public.task_titles') AS relation");
        expect(view.rows[0]?.relation).toBeNull();
        const foreign = await held[0].query("SELECT to_regclass('public.task_ids') AS relation");
        expect(foreign.rows[0]?.relation).not.toBeNull();
    });
});
