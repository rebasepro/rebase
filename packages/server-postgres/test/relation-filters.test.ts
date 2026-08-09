import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { integer, pgTable, PgDialect, primaryKey, serial, varchar } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";

/**
 * Filtering a collection by a relation whose link is not on its own row.
 *
 * `posts` filtered by `tags` has no `tags` column and no foreign key —
 * the link is a row in `posts_tags`. The driver used to drop the key it could
 * not resolve, which returned every post; then it began to reject it. These
 * tests pin the third answer: compiling it into the correlated `EXISTS` the
 * question actually is, and in particular that
 *
 *   - the subquery is correlated rather than joined (a join multiplies rows
 *     and breaks `limit`/`offset`),
 *   - everything inside it is qualified with a local alias while the outer
 *     row's key stays qualified with its own table, and
 *   - the negative operators are `NOT EXISTS` of the positive predicate, not
 *     `EXISTS` of a negated one.
 */

const dialect = new PgDialect();
const render = (condition: { queryChunks: unknown[] } | any) => dialect.sqlToQuery(condition);

const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title").notNull()
});

const tagsTable = pgTable("tags", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull()
});

const postsTagsTable = pgTable("posts_tags", {
    post_id: integer("post_id").notNull(),
    tag_id: integer("tag_id").notNull()
}, (table) => ({
    pk: primaryKey({ columns: [table.post_id, table.tag_id] })
}));

const commentsTable = pgTable("comments", {
    id: serial("id").primaryKey(),
    body: varchar("body").notNull(),
    postId: integer("post_id")
});

/** A self-referential `hasMany`: the subquery's table IS the outer one. */
const categoriesTable = pgTable("categories", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    parentId: integer("parent_id")
});

const tagsCollection = { slug: "tags", name: "Tags", properties: {} } as CollectionConfig;
const commentsCollection = { slug: "comments", name: "Comments", properties: {} } as CollectionConfig;

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        tags: {
            name: "Tags",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tagsCollection,
                through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }
        },
        comments: {
            name: "Comments",
            type: "relation",
            relation: {
                kind: "hasMany",
                target: () => commentsCollection,
                foreignKeyOnTarget: "post_id"
            }
        }
    }
};

const categoriesCollection: CollectionConfig = {
    slug: "categories",
    name: "Categories",
    properties: {
        name: { name: "Name", type: "string" },
        children: {
            name: "Children",
            type: "relation",
            relation: {
                kind: "hasMany",
                target: () => categoriesCollection,
                foreignKeyOnTarget: "parent_id"
            }
        }
    }
};

const createRegistry = () => {
    const registry = { getTable: jest.fn() } as unknown as PostgresCollectionRegistry;
    (registry.getTable as jest.Mock).mockImplementation((tableName: string) => ({
        posts: postsTable,
        tags: tagsTable,
        posts_tags: postsTagsTable,
        comments: commentsTable,
        categories: categoriesTable
    } as Record<string, unknown>)[tableName as string]);
    return registry;
};

describe("filtering by a relation with no column on this row", () => {

    let registry: PostgresCollectionRegistry;

    beforeEach(() => {
        registry = createRegistry();
    });

    const filterPosts = (filter: Record<string, unknown>) =>
        DrizzleConditionBuilder.buildFilterConditions(
            filter as never,
            postsTable,
            "posts",
            { collection: postsCollection, registry, sourceIdColumn: postsTable.id }
        );

    describe("manyToMany", () => {

        it("compiles `tags == <id>` into an EXISTS over the junction", () => {
            const [condition] = filterPosts({ tags: ["==", 4] });
            const query = render(condition);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id" AND "__rel_filter"."tag_id" = $1)'
            );
            expect(query.params).toEqual([4]);
        });

        it("correlates on the source column and constrains the target column", () => {
            // The scope condition (`which tags does post 1 have`) pins the
            // source and correlates on the target; the filter is the same
            // subquery with the two swapped. Getting this backwards compiles
            // and returns plausible-looking nonsense, so pin the direction.
            const query = render(filterPosts({ tags: ["==", 4] })[0]);
            expect(query.sql).toContain('"__rel_filter"."post_id" = "posts"."id"');
            expect(query.sql).toContain('"__rel_filter"."tag_id" = $1');
        });

        it("never joins the junction — a join multiplies the outer rows", () => {
            const query = render(filterPosts({ tags: ["==", 4] })[0]);
            expect(query.sql).not.toContain("JOIN");
        });

        it("unwraps a relation wire object, which is what the admin sends", () => {
            const query = render(filterPosts({ tags: ["==", { __type: "relation", id: 9, path: "tags" }] })[0]);
            expect(query.params).toEqual([9]);
        });

        it("compiles `in` into an EXISTS over the list", () => {
            const query = render(filterPosts({ tags: ["in", [1, 2, 3]] })[0]);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id" AND "__rel_filter"."tag_id" IN ($1, $2, $3))'
            );
            expect(query.params).toEqual([1, 2, 3]);
        });
    });

    describe("hasMany / hasOne", () => {

        it("compiles into an EXISTS over the target's foreign key", () => {
            const query = render(filterPosts({ comments: ["==", 7] })[0]);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "comments" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id" AND "__rel_filter"."id" = $1)'
            );
            expect(query.params).toEqual([7]);
        });

        it("compares the target's own key, not the foreign key", () => {
            // The foreign key is spent on the correlation; the filter value is
            // a comment id. Comparing the FK to it would ask "does this post
            // have a comment whose post_id is 7", which is a different and
            // almost always wrong question.
            const query = render(filterPosts({ comments: ["==", 7] })[0]);
            expect(query.sql).toContain('"__rel_filter"."id" = $1');
        });

        it("stays unambiguous when the target table is the outer table", () => {
            // `categories.children` scans `categories` from inside a query over
            // `categories`. Without the alias the correlation would compare a
            // row to itself and the filter would silently match nothing.
            const [condition] = DrizzleConditionBuilder.buildFilterConditions(
                { children: ["==", 3] } as never,
                categoriesTable,
                "categories",
                { collection: categoriesCollection, registry, sourceIdColumn: categoriesTable.id }
            );
            expect(render(condition).sql).toBe(
                'EXISTS (SELECT 1 FROM "categories" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."parent_id" = "categories"."id" AND "__rel_filter"."id" = $1)'
            );
        });
    });

    describe("negative operators", () => {

        it("`!=` is NOT EXISTS of the positive predicate", () => {
            // Not `EXISTS (… AND tag_id != 4)`: on a many-valued relation that
            // asks "does some tag differ from 4", which is true of nearly every
            // post with two tags. "Is 4 absent" is what unticking a value means.
            const query = render(filterPosts({ tags: ["!=", 4] })[0]);
            expect(query.sql).toBe(
                'NOT EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id" AND "__rel_filter"."tag_id" = $1)'
            );
            expect(query.params).toEqual([4]);
        });

        it("`==` and `!=` partition the rows", () => {
            const positive = render(filterPosts({ tags: ["==", 4] })[0]).sql;
            const negative = render(filterPosts({ tags: ["!=", 4] })[0]).sql;
            expect(negative).toBe(`NOT ${positive}`);
        });

        it("`not-in` is NOT EXISTS of the membership predicate", () => {
            const query = render(filterPosts({ tags: ["not-in", [1, 2]] })[0]);
            expect(query.sql).toBe(
                'NOT EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id" AND "__rel_filter"."tag_id" IN ($1, $2))'
            );
        });

        it("`is-null` means no related row at all", () => {
            const query = render(filterPosts({ tags: ["is-null", null] })[0]);
            expect(query.sql).toBe(
                'NOT EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id")'
            );
            expect(query.params).toEqual([]);
        });

        it("`is-not-null` means at least one related row", () => {
            const query = render(filterPosts({ tags: ["is-not-null", null] })[0]);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id")'
            );
        });

        it("reads `== null` as `is-null`, matching the column path", () => {
            expect(render(filterPosts({ tags: ["==", null] })[0]).sql)
                .toBe(render(filterPosts({ tags: ["is-null", null] })[0]).sql);
        });

        it("reads `!= null` as `is-not-null`", () => {
            expect(render(filterPosts({ tags: ["!=", null] })[0]).sql)
                .toBe(render(filterPosts({ tags: ["is-not-null", null] })[0]).sql);
        });
    });

    describe("the admin's null checkbox", () => {

        // It emits `[whichever operator is selected, null]`. On a to-many
        // relation the multi-select can only produce `in`/`not-in`, so those
        // are the two that have to carry a null value — this is the whole of
        // "posts with no tags" on the wire.

        it("`in null` asks for no related row, not for an empty list", () => {
            const query = render(filterPosts({ tags: ["in", null] })[0]);
            expect(query.sql).toBe(
                'NOT EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id")'
            );
            expect(query.params).toEqual([]);
        });

        it("`not-in null` asks for at least one related row", () => {
            expect(render(filterPosts({ tags: ["not-in", null] })[0]).sql).toBe(
                'EXISTS (SELECT 1 FROM "posts_tags" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id")'
            );
        });

        it("agrees with `is-null` however the operator got there", () => {
            const expected = render(filterPosts({ tags: ["is-null", null] })[0]).sql;
            for (const op of ["==", "in"]) {
                expect(render(filterPosts({ tags: [op, null] })[0]).sql).toBe(expected);
            }
        });

        it("keeps an empty list distinct from a null value", () => {
            // `in []` is "none of these", which matches nothing. `in null` is
            // "has nothing at all", which matches the unlinked rows. Collapsing
            // the two would answer "posts with no tags" with no posts.
            expect(render(filterPosts({ tags: ["in", []] })[0]).sql)
                .not.toBe(render(filterPosts({ tags: ["in", null] })[0]).sql);
        });

        it("compiles on the to-many foreign-key side too", () => {
            expect(render(filterPosts({ comments: ["in", null] })[0]).sql).toBe(
                'NOT EXISTS (SELECT 1 FROM "comments" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id")'
            );
        });
    });

    describe("empty membership lists", () => {

        it("`in []` matches nothing rather than being dropped", () => {
            // The column path drops it. Dropping a condition widens the result
            // set — the whole reason unresolvable fields fail closed — so here
            // an empty list means what it says.
            const conditions = filterPosts({ tags: ["in", []] });
            expect(conditions).toHaveLength(1);
            expect(render(conditions[0]).sql).toContain("AND FALSE)");
            expect(render(conditions[0]).sql).toMatch(/^EXISTS/);
        });

        it("`not-in []` matches everything", () => {
            const query = render(filterPosts({ tags: ["not-in", []] })[0]);
            expect(query.sql).toMatch(/^NOT EXISTS/);
            expect(query.sql).toContain("AND FALSE)");
        });
    });

    describe("the array operators, which the admin offers for an array of relations", () => {

        // A to-many relation *is* the list. These reach the driver because
        // `resolveFilterOperators` hands an array property the array
        // operators, and the item property is a relation — so rejecting them
        // put a 400 behind a control the admin rendered.

        it("`array-contains` asks the same question as `==`", () => {
            expect(render(filterPosts({ tags: ["array-contains", 4] })[0]).sql)
                .toBe(render(filterPosts({ tags: ["==", 4] })[0]).sql);
        });

        it("`array-contains-any` asks the same question as `in`", () => {
            expect(render(filterPosts({ tags: ["array-contains-any", [1, 2]] })[0]).sql)
                .toBe(render(filterPosts({ tags: ["in", [1, 2]] })[0]).sql);
        });

        it("compiles on the foreign-key side too", () => {
            const query = render(filterPosts({ comments: ["array-contains", 7] })[0]);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "comments" AS "__rel_filter" ' +
                'WHERE "__rel_filter"."post_id" = "posts"."id" AND "__rel_filter"."id" = $1)'
            );
        });
    });

    describe("operators the shape cannot express", () => {

        it("rejects an ordering operator instead of dropping it", () => {
            // Returning null here would drop the condition, which is the bug
            // this whole path exists to close.
            let thrown: ApiError | undefined;
            try {
                filterPosts({ tags: [">", 4] });
            } catch (error) {
                thrown = error as ApiError;
            }
            expect(thrown).toBeInstanceOf(ApiError);
            expect(thrown!.statusCode).toBe(400);
            expect(thrown!.code).toBe("UNSUPPORTED_RELATION_FILTER_OPERATOR");
            expect(thrown!.details).toMatchObject({ field: "tags", collection: "posts", operator: ">" });
        });

        it("rejects a pattern operator", () => {
            expect(() => filterPosts({ tags: ["ilike", "%x%"] })).toThrow(ApiError);
        });
    });

    describe("logical conditions", () => {

        it("compiles a relation leaf inside an `or`", () => {
            const condition = DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "or",
                    conditions: [
                        { column: "title", operator: "==", value: "hello" },
                        { column: "tags", operator: "==", value: 4 }
                    ]
                },
                postsTable,
                "posts",
                { collection: postsCollection, registry, sourceIdColumn: postsTable.id }
            );
            const query = render(condition!);
            expect(query.sql).toContain('"posts"."title" = $1');
            expect(query.sql).toContain('EXISTS (SELECT 1 FROM "posts_tags"');
            expect(query.params).toEqual(["hello", 4]);
        });

        it("rejects an unsupported operator on a relation leaf of an `or`", () => {
            // The branch that widens the most: a dropped leaf of a disjunction
            // lets the surviving branches match on their own.
            expect(() => DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "or",
                    conditions: [
                        { column: "title", operator: "==", value: "hello" },
                        { column: "tags", operator: "<", value: 4 }
                    ]
                },
                postsTable,
                "posts",
                { collection: postsCollection, registry, sourceIdColumn: postsTable.id }
            )).toThrow(ApiError);
        });
    });

    describe("without the context to compile one", () => {

        it("still fails closed when no registry is supplied", () => {
            // Not a widened read: a caller that cannot reach the junction gets
            // the behaviour it had before these were compilable.
            expect(() => DrizzleConditionBuilder.buildFilterConditions(
                { tags: ["==", 4] } as never,
                postsTable,
                "posts",
                { collection: postsCollection, sourceIdColumn: postsTable.id }
            )).toThrow(/Unknown filter field 'tags'/);
        });

        it("still fails closed when the source key column is unknown", () => {
            expect(() => DrizzleConditionBuilder.buildFilterConditions(
                { tags: ["==", 4] } as never,
                postsTable,
                "posts",
                { collection: postsCollection, registry }
            )).toThrow(ApiError);
        });

        it("still fails closed for a `via` relation, which has no inverse", () => {
            const viaCollection: CollectionConfig = {
                slug: "posts",
                name: "Posts",
                properties: {
                    coAuthors: {
                        name: "Co-authors",
                        type: "relation",
                        relation: {
                            kind: "via",
                            target: () => tagsCollection,
                            cardinality: "many",
                            joinPath: [{ table: "posts_tags", on: { from: "posts.id", to: "posts_tags.post_id" } }]
                        }
                    }
                }
            } as unknown as CollectionConfig;

            expect(() => DrizzleConditionBuilder.buildFilterConditions(
                { coAuthors: ["==", 4] } as never,
                postsTable,
                "posts",
                { collection: viaCollection, registry, sourceIdColumn: postsTable.id }
            )).toThrow(ApiError);
        });
    });

    describe("a real column still wins", () => {

        it("compiles a plain column to a comparison, not a subquery", () => {
            const query = render(filterPosts({ title: ["==", "hello"] })[0]);
            expect(query.sql).toBe('"posts"."title" = $1');
        });
    });
});
