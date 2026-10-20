/**
 * `diffDatabaseBranch` and `mergeDatabaseBranch` against a real server: a
 * branch made with `CREATE DATABASE … TEMPLATE`, changed on both sides, then
 * compared and merged.
 *
 * What it pins, beyond "the diff is right":
 *
 * - **Who changed a row.** The target keeps taking writes while the branch is
 *   worked on. A row it inserted is not a row the branch deleted, and a merge
 *   must not delete it. `xmin` against the branch database's creation tells
 *   them apart.
 * - **A merge writes all or nothing.** A conflict, a table that cannot be
 *   merged, or a fingerprint from before the last change writes nothing.
 * - **What wins.** `onConflict` decides, and the target's own changes stay.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { DatabaseAdmin } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { DatabasePoolManager } from "../../src/databasePoolManager.js";
import { BranchService } from "../../src/services/BranchService.js";
import { ApiError } from "@rebasepro/server";
import { diffDatabaseBranch, mergeDatabaseBranch } from "../../src/branching/branch-diff.js";

const MAIN = "rebase";

describe("database branch diff and merge", () => {
    let container: PgContainer;
    let maintenance: Pool;
    let poolManager: DatabasePoolManager;
    let branches: BranchService;
    let admin: DatabaseAdmin;

    const on = async (database: string, text: string, params?: unknown[]) =>
        (await poolManager.getPool(database).query(text, params)).rows;
    const main = (text: string, params?: unknown[]) => on(MAIN, text, params);
    const branch = (name: string, text: string, params?: unknown[]) => on(`rb_${name}`, text, params);

    async function refusal(promise: Promise<unknown>): Promise<ApiError> {
        try {
            await promise;
        } catch (error) {
            if (error instanceof ApiError) return error;
            throw error;
        }
        throw new Error("expected a refusal");
    }

    beforeAll(async () => {
        container = await startPgContainer();
        const url = new URL(container.connectionString);
        url.pathname = "/postgres";
        maintenance = new Pool({ connectionString: url.toString(), max: 2 });
        poolManager = new DatabasePoolManager(container.connectionString);
        branches = new BranchService(drizzle(maintenance), poolManager);
        await branches.ensureBranchMetadataTable();
        admin = {
            executeSql: async (text, options) => on(options?.database ?? MAIN, text, options?.params),
            createBranch: (name, options) => branches.createBranch(name, options),
            deleteBranch: (name) => branches.deleteBranch(name),
            listBranches: () => branches.listBranches(),
            getBranchInfo: (name) => branches.getBranchInfo(name)
        };

        await main(`
            CREATE TABLE authors (id serial PRIMARY KEY, name text NOT NULL);
            CREATE TABLE posts (
                id serial PRIMARY KEY,
                author_id int REFERENCES authors(id),
                title text NOT NULL,
                views bigint NOT NULL DEFAULT 0
            );
            CREATE TABLE tags (id int PRIMARY KEY, label text);
            CREATE TABLE audit_log (at timestamptz DEFAULT now(), line text);
            ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
            CREATE POLICY posts_read ON posts FOR SELECT USING (true);
            CREATE POLICY posts_write ON posts FOR INSERT WITH CHECK (author_id IS NOT NULL);
            INSERT INTO authors (name) VALUES ('ada'), ('grace');
            INSERT INTO posts (author_id, title, views) VALUES
                (1, 'one', 1), (1, 'two', 2), (2, 'three', 3), (2, 'four', 4);
            INSERT INTO tags VALUES (1, 'a'), (2, 'b');
        `);
        await branches.createBranch("agent");
    }, 180_000);

    afterAll(async () => {
        await poolManager?.shutdown().catch(() => {});
        await maintenance?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("reports nothing for a branch nobody has touched", async () => {
        const diff = await diffDatabaseBranch(admin, "agent");
        expect(diff.targetDatabase).toBe(MAIN);
        expect(diff.branchDatabase).toBe("rb_agent");
        expect(diff.forkPointKnown).toBe(true);
        expect(diff.schema).toEqual([]);
        expect(diff.data).toEqual([]);
        expect(diff.schemas).toContain("public");
    });

    describe("once both sides have changed", () => {
        beforeAll(async () => {
            // The agent, on its branch.
            await branch("agent", `
                CREATE TABLE notes (id int PRIMARY KEY, body text);
                INSERT INTO notes VALUES (1, 'new table');
                ALTER TABLE tags ADD COLUMN color text;
                DROP POLICY posts_write ON posts;
                CREATE POLICY posts_write ON posts FOR INSERT WITH CHECK (author_id IS NOT NULL AND title <> '');
                CREATE POLICY posts_delete ON posts FOR DELETE USING (false);
                ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
                INSERT INTO authors (id, name) VALUES (200, 'agent author');
                INSERT INTO posts (id, author_id, title) VALUES (50, 200, 'agent post');
                UPDATE posts SET title = 'one, edited' WHERE id = 1;
                DELETE FROM posts WHERE id = 2;
                UPDATE posts SET views = 400 WHERE id = 4;
                UPDATE tags SET label = 'changed' WHERE id = 1;
                INSERT INTO audit_log (line) VALUES ('branch');
            `);
            // Production, meanwhile.
            await main(`
                UPDATE posts SET views = 30 WHERE id = 3;
                INSERT INTO posts (id, author_id, title) VALUES (60, 1, 'written on main');
                UPDATE posts SET views = 41 WHERE id = 4;
            `);
        });

        it("lists the schema and policy changes as SQL", async () => {
            const diff = await diffDatabaseBranch(admin, "agent");
            const summary = diff.schema.map((change) => `${change.change} ${change.object} ${change.table}${change.name ? `.${change.name}` : ""}`);
            expect(summary).toEqual(expect.arrayContaining([
                "added table notes",
                "added column tags.color",
                "altered policy posts.posts_write",
                "added policy posts.posts_delete",
                "altered rls authors"
            ]));
            expect(summary).toHaveLength(5);
            const notes = diff.schema.find((change) => change.table === "notes");
            expect(notes?.after).toContain("CREATE TABLE \"public\".\"notes\"");
            const policy = diff.schema.find((change) => change.name === "posts_write");
            expect(policy?.before).toContain("WITH CHECK ((author_id IS NOT NULL))");
            expect(policy?.after).toContain("title <> ''");
        });

        it("counts the rows the branch changed, apart from the ones the target changed", async () => {
            const diff = await diffDatabaseBranch(admin, "agent");
            const posts = diff.data.find((entry) => entry.table === "posts");
            expect(posts).toMatchObject({
                primaryKey: ["id"],
                inserted: 1,     // 50
                updated: 1,      // 1
                deleted: 1,      // 2
                conflicts: 1,    // 4: both changed its views
                targetChanges: 2 // 3 and 60, main's own
            });
            expect(posts?.blocked).toBeUndefined();

            const byKey = new Map(posts?.samples.map((sample) => [sample.key, sample]));
            expect(byKey.get("[50]")).toMatchObject({ change: "inserted", after: { title: "agent post", views: "0" } });
            expect(byKey.get("[1]")).toMatchObject({ change: "updated", changedColumns: ["title"], before: { title: "one" }, after: { title: "one, edited" } });
            expect(byKey.get("[2]")).toMatchObject({ change: "deleted", before: { title: "two" } });
            expect(byKey.get("[4]")).toMatchObject({ change: "conflict", changedColumns: ["views"], before: { views: "41" }, after: { views: "400" } });
            // Never offered as the branch's: main wrote them.
            expect(byKey.has("[3]")).toBe(false);
            expect(byKey.has("[60]")).toBe(false);

            expect(diff.data.find((entry) => entry.table === "authors")).toMatchObject({ inserted: 1, updated: 0, deleted: 0 });
            expect(diff.data.find((entry) => entry.table === "notes")).toMatchObject({ inserted: 1, blocked: { code: "TABLE_ADDED" } });
            expect(diff.data.find((entry) => entry.table === "tags")).toMatchObject({ updated: 1, blocked: { code: "COLUMNS_DIFFER" } });
            expect(diff.data.find((entry) => entry.table === "audit_log")).toMatchObject({
                blocked: { code: "NO_PRIMARY_KEY" },
                rowCounts: { target: 0, branch: 1 }
            });
        });

        it("caps the sample rows per table, and shows none at zero", async () => {
            const one = await diffDatabaseBranch(admin, "agent", { sampleLimit: 1 });
            expect(one.data.find((entry) => entry.table === "posts")?.samples).toHaveLength(1);
            const none = await diffDatabaseBranch(admin, "agent", { sampleLimit: 0 });
            expect(none.data.every((entry) => entry.samples.length === 0)).toBe(true);
            expect(none.fingerprint).toBe(one.fingerprint);
        });

        it("writes nothing when a table cannot be merged, when rows conflict, or when the diff is stale", async () => {
            const before = await main("SELECT id, title, views FROM posts ORDER BY id");
            const diff = await diffDatabaseBranch(admin, "agent");

            const blocked = await refusal(mergeDatabaseBranch(admin, "agent", { expectedFingerprint: diff.fingerprint }));
            expect(blocked.code).toBe("BRANCH_MERGE_BLOCKED");
            expect(blocked.statusCode).toBe(409);
            expect(blocked.details).toMatchObject({ tables: expect.arrayContaining([
                expect.objectContaining({ table: "notes", code: "TABLE_ADDED" }),
                expect.objectContaining({ table: "tags", code: "COLUMNS_DIFFER" })
            ]) });

            const conflict = await refusal(mergeDatabaseBranch(admin, "agent", { expectedFingerprint: diff.fingerprint, skipBlocked: true }));
            expect(conflict.code).toBe("BRANCH_MERGE_CONFLICT");

            await branch("agent", "UPDATE posts SET views = 7 WHERE id = 1");
            const stale = await refusal(mergeDatabaseBranch(admin, "agent", {
                expectedFingerprint: diff.fingerprint, skipBlocked: true, onConflict: "branch"
            }));
            expect(stale.code).toBe("BRANCH_DIFF_STALE");

            expect(await main("SELECT id, title, views FROM posts ORDER BY id")).toEqual(before);
        });

        it("merges the branch's rows, keeps the target's, and lets the branch win a conflict when told to", async () => {
            const diff = await diffDatabaseBranch(admin, "agent");
            const result = await mergeDatabaseBranch(admin, "agent", {
                expectedFingerprint: diff.fingerprint,
                skipBlocked: true,
                onConflict: "branch"
            });
            expect(result.tables).toEqual(expect.arrayContaining([
                { schema: "public", table: "authors", inserted: 1, updated: 0, deleted: 0 },
                { schema: "public", table: "posts", inserted: 1, updated: 2, deleted: 1 }
            ]));
            expect(result.skipped.map((entry) => entry.table).sort()).toEqual(["audit_log", "notes", "tags"]);
            expect(result.schemaChangesNotMerged).toBe(5);
            expect(result.warnings).toEqual([]);

            expect(await main("SELECT id, title, views::int AS views FROM posts ORDER BY id")).toEqual([
                { id: 1, title: "one, edited", views: 7 },
                { id: 3, title: "three", views: 30 },          // main's update, kept
                { id: 4, title: "four", views: 400 },          // the conflict, the branch's
                { id: 50, title: "agent post", views: 0 },     // its author arrived in the same statement
                { id: 60, title: "written on main", views: 0 } // main's insert, kept
            ]);
            // A skipped table is untouched.
            expect(await main("SELECT label FROM tags WHERE id = 1")).toEqual([{ label: "a" }]);
            // The sequences are past the ids the merge wrote.
            expect(await main("SELECT nextval('authors_id_seq')::int AS id")).toEqual([{ id: 201 }]);
            expect(await main("SELECT nextval('posts_id_seq')::int AS id")).toEqual([{ id: 61 }]);

            // And nothing the branch changed in a mergeable table is left.
            const after = await diffDatabaseBranch(admin, "agent");
            const posts = after.data.find((entry) => entry.table === "posts");
            expect(posts).toMatchObject({ inserted: 0, updated: 0, deleted: 0, conflicts: 0 });
            expect(after.data.find((entry) => entry.table === "authors")).toBeUndefined();
        });
    });

    it("keeps the target's row in a conflict with onConflict: target", async () => {
        await branches.createBranch("second");
        await branch("second", "UPDATE tags SET label = 'branch' WHERE id = 2");
        await main("UPDATE tags SET label = 'main' WHERE id = 2");
        const diff = await diffDatabaseBranch(admin, "second");
        expect(diff.data.find((entry) => entry.table === "tags")).toMatchObject({ conflicts: 1 });

        const result = await mergeDatabaseBranch(admin, "second", { expectedFingerprint: diff.fingerprint, onConflict: "target" });
        expect(result.conflictsKept).toBe(1);
        expect(result.tables).toEqual([]);
        expect(await main("SELECT label FROM tags WHERE id = 2")).toEqual([{ label: "main" }]);
    });

    it("rolls every table back when the target refuses one row", async () => {
        await branches.createBranch("third");
        await branch("third", `
            INSERT INTO authors (id, name) VALUES (300, 'fine'), (301, 'refused');
            UPDATE tags SET label = 'third' WHERE id = 1;
        `);
        // A constraint main gained after the branch was made, which the
        // branch's rows were never checked against.
        await main("ALTER TABLE authors ADD CONSTRAINT no_refused CHECK (name <> 'refused')");
        const diff = await diffDatabaseBranch(admin, "third");
        await expect(mergeDatabaseBranch(admin, "third", { expectedFingerprint: diff.fingerprint }))
            .rejects.toThrow(/no_refused/);
        expect(await main("SELECT id FROM authors WHERE id >= 300")).toEqual([]);
        expect(await main("SELECT label FROM tags WHERE id = 1")).toEqual([{ label: "a" }]);
    });

    it("refuses a branch that does not exist", async () => {
        const missing = await refusal(diffDatabaseBranch(admin, "nope"));
        expect(missing.code).toBe("BRANCH_NOT_FOUND");
        expect(missing.statusCode).toBe(404);
    });
});
