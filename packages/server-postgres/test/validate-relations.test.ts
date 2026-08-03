import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";

import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { findRelationDefects, assertRelationsResolve } from "../src/collections/validate-relations";

/**
 * The union settled what a relation may *say*. This settles whether what it
 * says is true of the database.
 *
 * Each case here used to boot fine and then answer `[]` at query time, which is
 * the same answer a correctly-configured relation gives for a parent with no
 * children — so there was no way to tell a broken relation from an empty one.
 */

// ── Schema ───────────────────────────────────────────────────────────────

const posts = pgTable("posts", { id: text("id").primaryKey(),
author_id: text("author_id") });
const users = pgTable("users", { id: text("id").primaryKey() });
const tags = pgTable("tags", { id: text("id").primaryKey() });
const comments = pgTable("comments", { id: text("id").primaryKey(),
post_id: text("post_id") });
const posts_tags = pgTable("posts_tags", { post_id: text("post_id"),
tag_id: text("tag_id") });
const user_roles = pgTable("user_roles", { user_id: text("user_id"),
role_id: integer("role_id") });
const roles = pgTable("roles", { id: integer("id").primaryKey() });

const coll = (slug: string, table: string, extra: Partial<CollectionConfig> = {}): CollectionConfig => ({
    slug,
    name: slug,
    table,
    properties: { id: { type: "string",
isId: true } },
    ...extra
} as unknown as CollectionConfig);

const usersCollection = coll("users", "users");
const tagsCollection = coll("tags", "tags");
const commentsCollection = coll("comments", "comments");
const rolesCollection = coll("roles", "roles");

/** Build a registry holding the whole schema plus the collections given. */
function registryWith(collections: CollectionConfig[]): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple(collections);
    for (const [name, table] of Object.entries({ posts,
users,
tags,
comments,
posts_tags,
user_roles,
roles })) {
        registry.registerTable(table as never, name);
    }
    return registry;
}

/** The defects found for a `posts` collection carrying one relation. */
function defectsFor(relations: unknown[]): ReturnType<typeof findRelationDefects> {
    const postsCollection = coll("posts", "posts", { relations } as never);
    const all = [postsCollection, usersCollection, tagsCollection, commentsCollection, rolesCollection];
    return findRelationDefects(all, registryWith(all));
}

describe("relation validation at boot", () => {
    describe("accepts what is actually there", () => {
        it("passes every kind when all the names resolve", () => {
            expect(defectsFor([
                { kind: "belongsTo",
relationName: "author",
target: () => usersCollection,
localKey: "author_id" },
                { kind: "hasMany",
relationName: "comments",
target: () => commentsCollection,
foreignKeyOnTarget: "post_id" },
                {
                    kind: "manyToMany",
                    relationName: "tags",
                    target: () => tagsCollection,
                    through: { table: "posts_tags",
sourceColumn: "post_id",
targetColumn: "tag_id" }
                },
                // A link on a natural key: `author_id` is on `posts`, and the
                // comments carry it too.
                { kind: "hasMany",
relationName: "sibling_comments",
target: () => commentsCollection,
sourceKey: "author_id",
foreignKeyOnTarget: "post_id" }
            ])).toEqual([]);
        });

        it("stays quiet about a target belonging to another backend", () => {
            const elsewhere = coll("elsewhere", "elsewhere");
            const postsCollection = coll("posts", "posts", {
                relations: [{ kind: "belongsTo",
relationName: "x",
target: () => elsewhere,
localKey: "author_id" }]
            } as never);
            // `elsewhere` is never registered — its tables are not ours to check.
            const all = [postsCollection, usersCollection];
            expect(findRelationDefects(all, registryWith(all))).toEqual([]);
        });
    });

    describe("catches names the type system cannot", () => {
        it("a belongsTo pointing at a column that does not exist", () => {
            const [d] = defectsFor([
                { kind: "belongsTo",
relationName: "author",
target: () => usersCollection,
localKey: "writer_id" }
            ]);
            expect(d.problem).toContain("`localKey: \"writer_id\"` is not a column on `posts`");
            expect(d.fix).toContain("`author_id`");
        });

        it("a hasMany whose foreign key is not on the target", () => {
            const [d] = defectsFor([
                { kind: "hasMany",
relationName: "comments",
target: () => commentsCollection,
foreignKeyOnTarget: "article_id" }
            ]);
            expect(d.problem).toContain("is not a column on the target table `comments`");
            expect(d.fix).toContain("`post_id`");
        });

        it("a sourceKey that names a column on the target instead of the source", () => {
            // The likeliest way to get `sourceKey` wrong, because it sits next
            // to `foreignKeyOnTarget` and every other column in the block does
            // live on the target.
            const [d] = defectsFor([
                {
                    kind: "hasMany",
                    relationName: "comments",
                    target: () => commentsCollection,
                    foreignKeyOnTarget: "post_id",
                    sourceKey: "post_id"
                }
            ]);
            expect(d.problem).toContain("`sourceKey: \"post_id\"` is not a column on `posts`");
            expect(d.fix).toContain("it is a column on the *target* table `comments`");
        });

        it("a sourceKey that exists nowhere", () => {
            const [d] = defectsFor([
                {
                    kind: "hasMany",
                    relationName: "comments",
                    target: () => commentsCollection,
                    foreignKeyOnTarget: "post_id",
                    sourceKey: "auth_user_id"
                }
            ]);
            expect(d.problem).toContain("`sourceKey: \"auth_user_id\"` is not a column on `posts`");
            expect(d.fix).toContain("add the column");
        });

        it("the junction-name footgun: a derived table that was never created", () => {
            // No `through` — the table name is derived by sorting and joining,
            // which is exactly what silently changes when a table is renamed.
            const [d] = defectsFor([
                { kind: "manyToMany",
relationName: "categories",
target: () => rolesCollection }
            ]);
            expect(d.problem).toContain("junction table");
            expect(d.problem).toContain("does not exist");
            expect(d.fix).toContain("derived from the two table names sorted");
        });

        it("a junction column that is not on the junction table", () => {
            const found = defectsFor([
                {
                    kind: "manyToMany",
                    relationName: "tags",
                    target: () => tagsCollection,
                    through: { table: "posts_tags",
sourceColumn: "article_id",
targetColumn: "tag_id" }
                }
            ]);
            expect(found).toHaveLength(1);
            expect(found[0].problem).toContain("`through.sourceColumn: \"article_id\"`");
            expect(found[0].fix).toContain("naming *this* collection");
        });
    });

    describe("walks a via chain and says which hop is wrong", () => {
        const viaRelation = (joinPath: unknown[]) => ([{
            kind: "via",
            relationName: "roles",
            target: () => rolesCollection,
            cardinality: "many",
            joinPath
        }]);

        it("accepts a chain that connects", () => {
            expect(defectsFor(viaRelation([
                { table: "user_roles",
on: { from: "author_id",
to: "user_id" } },
                { table: "roles",
on: { from: "role_id",
to: "id" } }
            ]))).toEqual([]);
        });

        it("names the step whose table does not exist", () => {
            const [d] = defectsFor(viaRelation([
                { table: "account_roles",
on: { from: "author_id",
to: "user_id" } }
            ]));
            expect(d.problem).toContain("step 1");
            expect(d.problem).toContain("`account_roles`, which is not a table");
        });

        it("catches a `from` column that is not on the previous table", () => {
            const [d] = defectsFor(viaRelation([
                { table: "user_roles",
on: { from: "owner_id",
to: "user_id" } },
                { table: "roles",
on: { from: "role_id",
to: "id" } }
            ]));
            expect(d.problem).toContain("step 1 joins `posts.owner_id`");
            expect(d.fix).toContain("this collection's table");
        });

        it("catches a `from` column that is not on the *previous step's* table", () => {
            const [d] = defectsFor(viaRelation([
                { table: "user_roles",
on: { from: "author_id",
to: "user_id" } },
                { table: "roles",
on: { from: "group_id",
to: "id" } }
            ]));
            expect(d.problem).toContain("step 2 joins `user_roles.group_id`");
            expect(d.fix).toContain("the previous step's table (`user_roles`)");
        });

        it("catches a chain that ends somewhere other than the target", () => {
            const [d] = defectsFor(viaRelation([
                { table: "user_roles",
on: { from: "author_id",
to: "user_id" } }
            ]));
            expect(d.problem).toContain("ends at `user_roles`, but it targets `roles`");
        });

        it("catches a composite join comparing unequal numbers of columns", () => {
            const found = defectsFor(viaRelation([
                { table: "user_roles",
on: { from: ["author_id", "id"],
to: "user_id" } },
                { table: "roles",
on: { from: "role_id",
to: "id" } }
            ]));
            expect(found.some(d => d.problem.includes("compares 2 column(s) against 1"))).toBe(true);
        });

        it("rejects an empty joinPath rather than joining nothing", () => {
            const [d] = defectsFor(viaRelation([]));
            expect(d.problem).toContain("`joinPath` is empty");
        });
    });

    describe("assertRelationsResolve", () => {
        it("says nothing when everything resolves", () => {
            const all = [coll("posts", "posts"), usersCollection];
            expect(() => assertRelationsResolve(all, registryWith(all))).not.toThrow();
        });

        it("reports every defect at once, each with its fix", () => {
            const postsCollection = coll("posts", "posts", {
                relations: [
                    { kind: "belongsTo",
relationName: "author",
target: () => usersCollection,
localKey: "writer_id" },
                    { kind: "hasMany",
relationName: "comments",
target: () => commentsCollection,
foreignKeyOnTarget: "article_id" }
                ]
            } as never);
            const all = [postsCollection, usersCollection, commentsCollection];

            let message = "";
            try {
                assertRelationsResolve(all, registryWith(all));
            } catch (e) {
                message = (e as Error).message;
            }

            expect(message).toContain("2 relations cannot resolve");
            // Both, not just the first — one boot, one full list.
            expect(message).toContain("posts.author (belongsTo)");
            expect(message).toContain("posts.comments (hasMany)");
            expect(message).toContain("fix:");
            // Says why it is fatal rather than a warning.
            expect(message).toContain("return no rows at query time");
        });
    });
});
