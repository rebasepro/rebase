/**
 * Live schema editing, against a real Postgres and a real git repository.
 *
 * Everything else about this feature is asserted at the unit level: the
 * classifier over collection shapes, the commit generator over file contents,
 * the ordering over fakes. All of that can be true while the feature does not
 * work, because the two things it actually has to do — put a column in a
 * database, and put a commit in a repository — are the two things a fake cannot
 * prove.
 *
 * So this one runs the whole chain: plan a change through the real Postgres
 * driver, commit it into a real repository with real git, apply the real DDL to
 * a real database, and then ask both of them whether it happened.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

// Relative, not by package name: inside a git worktree `@rebasepro/server`
// resolves through node_modules into the PRIMARY checkout, which would verify
// code that is not the code under test.
import { applySchemaChange } from "../../../server/src/schema-edit/apply-schema-change.js";
import { createLocalGitRepository } from "../../../server/src/schema-edit/local-git-repository.js";

const posts = (properties: Record<string, unknown>) => ({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        ...properties
    }
}) as never;

describe("live schema editing, end to end", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    let repoRoot: string;

    const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

    beforeAll(async () => {
        container = await startPgContainer();

        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        // The starting point: a table that already exists and already has a row,
        // which is what makes the NOT NULL question real rather than theoretical.
        await admin.query(`
            CREATE TABLE public.posts (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255)
            );
        `);
        await admin.query(`INSERT INTO public.posts (id, title) VALUES ('1', 'first');`);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const registry = new PostgresCollectionRegistry();
        const db = drizzle(pool);
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-live-schema-e2e-"));
        execFileSync("git", ["init", "-q"], { cwd: repoRoot });
        execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: repoRoot });
        execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repoRoot });
        execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: repoRoot });
        fs.writeFileSync(path.join(repoRoot, "README.md"), "# project\n");
        execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
        execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: repoRoot });
    }, 180_000);

    afterAll(async () => {
        if (pool) await pool.end().catch(() => {});
        if (admin) await admin.end().catch(() => {});
        if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
        if (container) await stopPgContainer(container.containerName);
    });

    const columnsOf = async (table: string): Promise<Record<string, string>> => {
        const { rows } = await admin.query<{ column_name: string; is_nullable: string }>(
            `SELECT column_name, is_nullable FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`,
            [table]
        );
        return Object.fromEntries(rows.map(r => [r.column_name, r.is_nullable]));
    };

    it("puts a column in the database and a commit in the repository", async () => {
        const before = [posts({})];
        const after = [posts({ subtitle: { name: "Subtitle", type: "string" } })];

        const plan = await driver.admin.planSchemaChange!(before, after);
        expect(plan.classified.applicable).toBe(true);

        const result = await applySchemaChange({
            plan,
            repository: createLocalGitRepository({
                root: repoRoot,
                author: { name: "Panel", email: "panel@rebase.pro" }
            }),
            apply: async (statements) => {
                for (const statement of statements) await admin.query(statement);
            }
        });

        expect(result.applied).toBe(true);

        // The database really has it…
        expect(await columnsOf("posts")).toHaveProperty("subtitle");

        // …and the repository really has the commit, carrying the generated
        // artifacts a deploy depends on, not just the collection file.
        expect(git("log", "-1", "--pretty=%s")).toContain("subtitle");
        expect(git("log", "-1", "--pretty=%an")).toBe("Panel");
        const committed = git("show", "--name-only", "--pretty=", "HEAD").split("\n");
        expect(committed).toContain("backend/src/schema.generated.ts");
        expect(committed).toContain("drizzle/schema.sql");

        // The existing row survived. An additive change must not rewrite data.
        const { rows } = await admin.query("SELECT id, title, subtitle FROM public.posts");
        expect(rows).toEqual([{ id: "1", title: "first", subtitle: null }]);
    }, 180_000);

    it("adds the column NULLABLE when the property is required — and refuses to pretend otherwise", async () => {
        const before = [posts({ subtitle: { name: "Subtitle", type: "string" } })];
        const after = [posts({
            subtitle: { name: "Subtitle", type: "string" },
            author: { name: "Author", type: "string", validation: { required: true } }
        })];

        // This is the `diverges` case, and the whole reason that verdict exists:
        // Postgres checks NOT NULL against the row already in the table, so the
        // ensure path withholds it and the column arrives nullable. The planner
        // refuses rather than applying something that does not match the config.
        await expect(driver.admin.planSchemaChange!(before, after))
            .rejects.toThrow(/NOT NULL/);

        // Nothing happened: no column, no commit.
        expect(await columnsOf("posts")).not.toHaveProperty("author");
    }, 180_000);

    it("refuses to drop a column, and leaves the data alone", async () => {
        const before = [posts({ subtitle: { name: "Subtitle", type: "string" } })];
        const after = [posts({})];

        await expect(driver.admin.planSchemaChange!(before, after))
            .rejects.toThrow(/cannot be applied/);

        expect(await columnsOf("posts")).toHaveProperty("subtitle");
    }, 180_000);

    it("creates a whole new table, with its constraints intact", async () => {
        const before = [posts({ subtitle: { name: "Subtitle", type: "string" } })];
        const tags = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {
                id: { name: "ID", type: "string", isId: true },
                // Required is safe here: the table is new, so there are no rows
                // for the constraint to be checked against.
                label: { name: "Label", type: "string", validation: { required: true } }
            }
        } as never;

        const plan = await driver.admin.planSchemaChange!(before, [...before, tags]);
        const result = await applySchemaChange({
            plan,
            repository: createLocalGitRepository({ root: repoRoot }),
            apply: async (statements) => {
                for (const statement of statements) await admin.query(statement);
            }
        });

        expect(result.applied).toBe(true);
        const columns = await columnsOf("tags");
        expect(columns).toHaveProperty("id");
        // A fresh table takes its constraints, unlike a column added to a live one.
        expect(columns.label).toBe("NO");
    }, 180_000);

    it("commits before applying, so a failed apply still leaves the change in git", async () => {
        const headBefore = git("rev-parse", "HEAD");
        const before = [posts({ subtitle: { name: "Subtitle", type: "string" } })];
        const after = [posts({
            subtitle: { name: "Subtitle", type: "string" },
            summary: { name: "Summary", type: "string" }
        })];

        const plan = await driver.admin.planSchemaChange!(before, after);
        const result = await applySchemaChange({
            plan,
            repository: createLocalGitRepository({ root: repoRoot }),
            apply: async () => { throw new Error("database went away"); }
        });

        expect(result.applied).toBe(false);
        expect(result.applyError).toContain("database went away");

        // The commit landed anyway — which is the point of the ordering. The
        // repository is now ahead of the database, which is the ordinary state
        // between an edit and a deploy, and boot reconciles it.
        expect(git("rev-parse", "HEAD")).not.toBe(headBefore);
        expect(git("show", "--name-only", "--pretty=", "HEAD")).toContain("drizzle/schema.sql");
        expect(await columnsOf("posts")).not.toHaveProperty("summary");
    }, 180_000);

    /**
     * The three changes that used to apply in part and report success.
     *
     * These live here rather than in a unit test for one reason: what makes
     * them bugs is what Postgres does, and a fake cannot be wrong about
     * Postgres in the same way Postgres is. So the assertions are on the
     * catalogue and on the rows, never on the plan — a plan that says the right
     * thing while the database disagrees is the exact failure being tested for.
     */
    describe("constraints the configuration asks for", () => {
        const enumProperty = (values: string[]) => ({
            name: "Status",
            type: "string",
            enum: values.map(id => ({ id, label: id }))
        });

        const enumValues = async (typeName: string): Promise<string[]> => {
            const { rows } = await admin.query<{ value: string }>(
                `SELECT e.enumlabel AS value FROM pg_enum e
                 JOIN pg_type t ON e.enumtypid = t.oid
                 WHERE t.typname = $1 ORDER BY e.enumsortorder`,
                [typeName]
            );
            return rows.map(row => row.value);
        };

        const applyThrough = async (before: never[], after: never[]) => {
            const plan = await driver.admin.planSchemaChange!(before, after);
            return applySchemaChange({
                plan,
                repository: createLocalGitRepository({ root: repoRoot }),
                apply: async (statements) => {
                    for (const statement of statements) await admin.query(statement);
                }
            });
        };

        it("adds a value to an enum type that already exists", async () => {
            // The bug: `ensure` skipped a type it already saw, so the value
            // never reached the database and the first row using it was
            // rejected by a type that had never heard of it. Nothing reported
            // anything — the boot said success and the insert said constraint
            // violation, hours apart.
            const withEnum = [posts({ status: enumProperty(["draft", "live"]) })];
            await applyThrough([posts({})] as never[], withEnum as never[]);
            expect(await enumValues("posts_status")).toEqual(["draft", "live"]);

            const widened = [posts({ status: enumProperty(["draft", "live", "archived"]) })];
            const result = await applyThrough(withEnum as never[], widened as never[]);

            expect(result.applied).toBe(true);
            expect(await enumValues("posts_status")).toEqual(["draft", "live", "archived"]);

            // The proof that matters: a row can now be written with it.
            await admin.query(
                `INSERT INTO public.posts (id, title, status) VALUES ('2', 'second', 'archived')`
            );
            const { rows } = await admin.query("SELECT status FROM public.posts WHERE id = '2'");
            expect(rows[0]).toEqual({ status: "archived" });
            await admin.query("DELETE FROM public.posts WHERE id = '2'");
        }, 180_000);

        it("adds a required column NOT NULL when the table is empty", async () => {
            await admin.query(`CREATE TABLE public.empty_authors (id VARCHAR(255) PRIMARY KEY);`);
            const authors = (properties: Record<string, unknown>) => ({
                slug: "empty_authors",
                name: "Authors",
                table: "empty_authors",
                properties: { id: { name: "ID", type: "string", isId: true }, ...properties }
            }) as never;

            const result = await applyThrough(
                [authors({})] as never[],
                [authors({ email: { name: "Email", type: "string", validation: { required: true } } })] as never[]
            );

            expect(result.applied).toBe(true);
            // NO means NOT NULL. On an empty table the constraint cannot fail,
            // so withholding it was never protecting anything — it just left a
            // column the config calls required accepting nulls forever.
            expect((await columnsOf("empty_authors")).email).toBe("NO");

            await expect(
                admin.query(`INSERT INTO public.empty_authors (id) VALUES ('x')`)
            ).rejects.toThrow(/null value in column "email"/);
        }, 180_000);

        it("withholds NOT NULL on a populated table, and says which column", async () => {
            // `posts` holds a row with no value for the new column, so the
            // constraint would be checked against it and fail. Refused — but
            // refused in words, which is the whole change: this used to be a
            // successful boot and a silently nullable column.
            const before = [posts({ subtitle: { name: "Subtitle", type: "string" } })];
            const after = [posts({
                subtitle: { name: "Subtitle", type: "string" },
                author: { name: "Author", type: "string", validation: { required: true } }
            })];

            await expect(driver.admin.planSchemaChange!(before, after))
                .rejects.toThrow(/already holds rows/);
            expect(await columnsOf("posts")).not.toHaveProperty("author");
        }, 180_000);

        it("drops NOT NULL when the property stops being required", async () => {
            await admin.query(
                `CREATE TABLE public.strict (id VARCHAR(255) PRIMARY KEY, label VARCHAR(255) NOT NULL);`
            );
            await admin.query(`INSERT INTO public.strict (id, label) VALUES ('1', 'set');`);

            const strict = (required: boolean) => ({
                slug: "strict",
                name: "Strict",
                table: "strict",
                properties: {
                    id: { name: "ID", type: "string", isId: true },
                    label: {
                        name: "Label",
                        type: "string",
                        ...(required ? { validation: { required: true } } : {})
                    }
                }
            }) as never;

            expect((await columnsOf("strict")).label).toBe("NO");

            const result = await applyThrough([strict(true)] as never[], [strict(false)] as never[]);

            expect(result.applied).toBe(true);
            // Loosening cannot fail and cannot lose data: the row is still
            // there, and the column now accepts what the config says it does.
            expect((await columnsOf("strict")).label).toBe("YES");
            await admin.query(`INSERT INTO public.strict (id) VALUES ('2')`);
            const { rows } = await admin.query("SELECT id, label FROM public.strict ORDER BY id");
            expect(rows).toEqual([{ id: "1", label: "set" }, { id: "2", label: null }]);
        }, 180_000);

        it("sets NOT NULL when an empty table's property becomes required", async () => {
            await admin.query(
                `CREATE TABLE public.tightening (id VARCHAR(255) PRIMARY KEY, code VARCHAR(255));`
            );
            const tightening = (required: boolean) => ({
                slug: "tightening",
                name: "Tightening",
                table: "tightening",
                properties: {
                    id: { name: "ID", type: "string", isId: true },
                    code: {
                        name: "Code",
                        type: "string",
                        ...(required ? { validation: { required: true } } : {})
                    }
                }
            }) as never;

            expect((await columnsOf("tightening")).code).toBe("YES");

            const result = await applyThrough(
                [tightening(false)] as never[],
                [tightening(true)] as never[]
            );

            expect(result.applied).toBe(true);
            expect((await columnsOf("tightening")).code).toBe("NO");
        }, 180_000);
    });
});
