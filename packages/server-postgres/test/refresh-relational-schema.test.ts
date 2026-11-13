/**
 * A live schema apply gives a running driver new tables in place: the drizzle
 * handle every service holds learns the new relational schema
 * (`refreshRelationalSchema`), and the registry every service holds takes the
 * new tables (`PostgresTableRegistry.replaceWith`). The Postgres round trip is
 * `test/e2e/live-schema-refresh-e2e.test.ts`; these pin the in-place swaps.
 */
import pg from "pg";
import { relations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { col, defineTable } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { refreshRelationalSchema } from "../src/model/refresh-relational-schema";
import { buildTableRegistry } from "../src/model/build-registry";

const postsV1 = pgTable("posts", { id: serial("id").primaryKey(), title: text("title") });
const postsV2 = pgTable("posts", { id: serial("id").primaryKey(), title: text("title"), subtitle: text("subtitle") });
const notes = pgTable("notes", { id: serial("id").primaryKey(), body: text("body"), postId: integer("post_id") });
const notesRelations = relations(notes, ({ one }) => ({ post: one(postsV2, { fields: [notes.postId], references: [postsV2.id] }) }));

describe("refreshRelationalSchema", () => {
    // Never connects: nothing here runs a query, only builds one.
    const pool = new pg.Pool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
    afterAll(() => pool.end());

    it("serves a table the handle was not opened with, and the columns a table gained", () => {
        const db = drizzle(pool, { schema: { posts: postsV1 } });
        const session = db._.session;
        expect(Object.keys(db.query)).toEqual(["posts"]);

        refreshRelationalSchema(db, { posts: postsV2, notes, notesRelations });

        expect(Object.keys(db.query).sort()).toEqual(["notes", "posts"]);
        expect(db.query.posts.findMany().toSQL().sql).toContain("\"subtitle\"");
        expect(db.query.notes.findMany({ with: { post: true } }).toSQL().sql).toContain("\"posts\"");
        // The same handle and session: whoever held them before holds the new schema.
        expect(db._.session).toBe(session);
        expect(Object.keys(db._.schema ?? {}).sort()).toEqual(["notes", "posts"]);
    });

    it("stops serving a table the new schema no longer holds", () => {
        const db = drizzle(pool, { schema: { posts: postsV1, notes } });
        refreshRelationalSchema(db, { posts: postsV1 });
        expect(Object.keys(db.query)).toEqual(["posts"]);
        expect(db._.fullSchema).not.toHaveProperty("notes");
    });
});

describe("PostgresTableRegistry.replaceWith", () => {
    const posts = defineTable("posts", { columns: { id: col.serial().primaryKey(), title: col.text() }, rls: "admin-only" });
    const notesDef = defineTable("notes", { columns: { id: col.serial().primaryKey(), body: col.text() }, rls: "admin-only" });

    it("takes the other registry's tables at once and keeps its own global hooks", () => {
        const registry = buildTableRegistry({ compiledTables: compileSchema([posts]), tables: { posts: postsV1 } });
        const afterRead = () => ({});
        registry.setGlobalHooks({ afterRead });
        const before = registry.tables();

        registry.replaceWith(buildTableRegistry({
            compiledTables: compileSchema([posts, notesDef]),
            tables: { posts: postsV2, notes }
        }));

        expect(registry.tables()).not.toBe(before);
        expect(registry.tables().map(table => table.slug)).toEqual(["posts", "notes"]);
        expect(registry.requireTable("notes").pg).toBe(notes);
        expect(registry.getPgTable("posts")).toBe(postsV2);
        expect(registry.globalHooks()?.afterRead).toBe(afterRead);

        registry.replaceWith(buildTableRegistry({ compiledTables: compileSchema([posts]), tables: { posts: postsV2 } }));
        expect(registry.getTable("notes")).toBeUndefined();
        expect(registry.hasPgTable("notes")).toBe(false);
    });
});
