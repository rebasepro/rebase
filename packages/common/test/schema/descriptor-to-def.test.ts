import { describe, expect, it } from "@jest/globals";
import { col, defineTable, defineView, rel, type TableDescriptor, pgEnum, sql } from "@rebasepro/types";

import { compileTables } from "../../src/schema/compile-tables";
import { columnDefOfDescriptor, tableDefsFromDescriptors } from "../../src/schema/descriptor-to-def";
import { lowerTables } from "../../src/schema/lower-tables";
import { isSchemaDefinitionError } from "../../src/schema/errors";
import { DEFAULT_RLS } from "./print-table.fixtures";

const userStatusEnum = pgEnum("user_status", ["active", "gone"]);

/**
 * A descriptor nobody authored (what introspection reports) reaches the
 * lowering through `tableDefsFromDescriptors`. It must mean exactly what the
 * descriptor says: compiled again, it is the same descriptor.
 */

const users = defineTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.varchar({ length: 320 }).notNull().unique(),
        ip: col.custom({ dataType: "inet" }),
        roles: col.text({ enum: ["a", "b"] }).array(),
        status: userStatusEnum().notNull().default("active")
    },
    rls: [{ operation: "select", access: "authenticated" }]
});
const tags = defineTable("tags", { columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), name: col.text() }, rls: "admin-only" });
const posts = defineTable("blog_posts", {
    slug: "posts",
    description: "Posts.",
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        title: col.text().notNull().validate({ max: 200 }),
        authorId: col.uuid().notNull(),
        body: col.jsonb(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        words: col.integer().generatedAlwaysAs(sql`0`),
        deletedAt: col.timestamp({ withTimezone: true })
    },
    relations: {
        author: rel.belongsTo(() => users, { onDelete: "cascade" }),
        editor: rel.belongsTo(() => users, { notNull: true, unique: true, index: false }),
        tags: rel.manyToMany(() => tags, { pivot: { rank: col.integer().default(0) } })
    },
    rls: DEFAULT_RLS,
    defaultPolicies: false,
    softDelete: true,
    history: true,
    indexes: [{ columns: ["title"], reason: "by title" }]
});
const comments = defineTable("comments", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), postId: col.integer() },
    relations: { post: rel.belongsTo(() => posts, { localKey: "post_id" }) },
    rls: "admin-only"
});
const counts = defineView("post_counts", {
    query: "SELECT 1 AS n",
    materialized: true,
    roles: ["admin", "editor"],
    columns: { n: col.integer().primaryKey() }
});

const DEFS = [users, tags, posts, comments, counts];

describe("tableDefsFromDescriptors", () => {
    it("compiles back to the very descriptors it was given", () => {
        const descriptors = compileTables(DEFS);
        expect(compileTables(tableDefsFromDescriptors(descriptors))).toEqual(descriptors);
    });

    it("resolves relation targets among the set, lazily, so tables may point at each other", () => {
        const defs = tableDefsFromDescriptors(compileTables(DEFS));
        const lowered = lowerTables(defs, { introspected: true });
        const postsCollection = lowered.find(collection => collection.slug === "posts");
        const author = postsCollection?.relations?.find(relation => relation.relationName === "author");
        expect(author?.target().slug).toBe("users");
    });

    it("replaces the rls when asked, and says what no definition can", () => {
        const closed: TableDescriptor = { ...compileTables([tags])[0], rls: { posture: "rules", rules: [], defaultPolicies: false } };
        expect(() => tableDefsFromDescriptors([closed])).toThrow(/tags: has row-level security with no rule and no admin baseline/);
        const [def] = tableDefsFromDescriptors([closed], { rls: () => "admin-only" });
        expect(def.config).toMatchObject({ rls: "admin-only" });
        // Empty rules with the baseline is admin-only.
        const baselineOnly: TableDescriptor = { ...closed, rls: { posture: "rules", rules: [], defaultPolicies: true } };
        expect(tableDefsFromDescriptors([baselineOnly])[0].config).toMatchObject({ rls: "admin-only" });
    });

    it("refuses what a descriptor cannot be turned back into, listing every one", () => {
        const [tagsDescriptor] = compileTables([tags]);
        const withHooks: TableDescriptor = { ...tagsDescriptor, name: "hooked", slug: "hooked", hooks: { afterRead: true } };
        const authTable: TableDescriptor = { ...tagsDescriptor, name: "people", slug: "people", auth: {} };
        const view: TableDescriptor = { ...compileTables([counts])[0], view: { materialized: true } };
        try {
            tableDefsFromDescriptors([withHooks, authTable, view]);
            throw new Error("expected a refusal");
        } catch (error) {
            if (!isSchemaDefinitionError(error)) throw error;
            expect(error.problems.map(problem => `${problem.table}: ${problem.message}`)).toEqual([
                expect.stringMatching(/^hooked: declares hooks \(afterRead\)/),
                expect.stringMatching(/^people: is an auth table/),
                expect.stringMatching(/^post_counts: is a view whose descriptor carries no query/)
            ]);
        }
    });

    it("leaves a derived foreign-key column to its relation, with its nullability on the relation", () => {
        const descriptors = compileTables(DEFS);
        const postsDescriptor = descriptors.find(descriptor => descriptor.slug === "posts");
        expect(postsDescriptor?.columns.find(column => column.key === "editorId")).toMatchObject({ derived: true, nullable: false, unique: true });
        const def = tableDefsFromDescriptors(descriptors).find(candidate => candidate.name === "blog_posts");
        expect(Object.keys(def?.config.columns ?? {})).not.toContain("editorId");
        expect(def?.config.relations?.editor).toMatchObject({ kind: "belongsTo", notNull: true, unique: true, index: false });
    });
});

describe("columnDefOfDescriptor", () => {
    it("is the definition the column was compiled from", () => {
        const [compiled] = compileTables([users]);
        for (const column of compiled.columns) {
            const key = column.key as keyof typeof users.config.columns;
            const def = { ...users.config.columns[key].def, column: column.column };
            expect({ key, def: columnDefOfDescriptor(column) }).toEqual({ key, def });
        }
    });
});
