import { DataService } from "../src/services/dataService";
import { SQL } from "drizzle-orm";
import { integer, PgDialect, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { DrizzleClient } from "../src/interfaces";

const collectionRegistry = new PostgresCollectionRegistry();

// Real Drizzle tables, and the real `DrizzleConditionBuilder` behind them.
//
// This suite used to stub out `buildSearchConditions`, `combineConditionsWith*`,
// `buildFilterConditions` and `buildRelationQuery`, then assert that the stubs
// had been called. Nothing about a subcollection listing was actually exercised:
// the one thing that makes `tags/19/posts` different from `posts` — the parent
// id from the path reaching the WHERE clause — is produced entirely inside those
// builders, so with them stubbed the assertions held whether or not the scope
// existed at all. Emitting real SQL and reading it back is what makes them bite.
const tagsTable = pgTable("tags", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    description: varchar("description")
});

const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title").notNull(),
    content: varchar("content"),
    tagId: integer("tag_id"),
    authorId: integer("author_id")
});

const authorsTable = pgTable("authors", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    email: varchar("email").notNull(),
    bio: varchar("bio")
});

const commentsTable = pgTable("comments", {
    id: serial("id").primaryKey(),
    content: varchar("content"),
    author_name: varchar("author_name"),
    postId: integer("post_id")
});

// Nothing here is a string property, so a search over it compiles to no
// condition at all — the case the read path has to refuse rather than widen.
const viewsTable = pgTable("views", {
    id: serial("id").primaryKey(),
    count: integer("count"),
    postId: integer("post_id")
});

const tagsCollection: CollectionConfig = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        description: { type: "string" },
        posts: { type: "relation",
relationName: "posts" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection,
            foreignKeyOnTarget: "tag_id"
        }
    ],
    idField: "id"
};

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" },
        content: { type: "string" },
        tag: { type: "relation",
relationName: "tag" },
        author: { type: "relation",
relationName: "author" },
        comments: { type: "relation",
relationName: "comments" },
        views: { type: "relation",
relationName: "views" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "tag",
            target: () => tagsCollection,
            localKey: "tag_id"
        },
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => authorsCollection,
            localKey: "author_id"
        },
        {
            kind: "hasMany",
            relationName: "comments",
            target: () => commentsCollection,
            foreignKeyOnTarget: "post_id"
        },
        {
            kind: "hasMany",
            relationName: "views",
            target: () => viewsCollection,
            foreignKeyOnTarget: "post_id"
        }
    ],
    idField: "id"
};

const authorsCollection: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        email: { type: "string" },
        bio: { type: "string" },
        posts: { type: "relation",
relationName: "posts" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection,
            foreignKeyOnTarget: "author_id"
        }
    ],
    idField: "id"
};

const commentsCollection: CollectionConfig = {
    slug: "comments",
    name: "Comments",
    table: "comments",
    properties: {
        id: { type: "number" },
        content: { type: "string" },
        author_name: { type: "string" },
        post: { type: "relation",
relationName: "post" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "post",
            target: () => postsCollection,
            localKey: "post_id"
        }
    ],
    idField: "id"
};

const viewsCollection: CollectionConfig = {
    slug: "views",
    name: "Views",
    table: "views",
    properties: {
        id: { type: "number" },
        count: { type: "number" }
    },
    relations: [],
    idField: "id"
};

const collectionsBySlug: Record<string, CollectionConfig> = {
    tags: tagsCollection,
    posts: postsCollection,
    authors: authorsCollection,
    comments: commentsCollection,
    views: viewsCollection
};

const tablesByName: Record<string, unknown> = {
    tags: tagsTable,
    posts: postsTable,
    authors: authorsTable,
    comments: commentsTable,
    views: viewsTable
};

/** One `db.select()` chain, with everything the read path hung off it. */
interface RecordedQuery {
    table?: unknown;
    /** Every `.where(...)`; the cursor path applies a second, wider one. */
    wheres: SQL[];
    joins: { table: unknown; condition: SQL }[];
    orderBy: unknown[];
    limit?: number;
    offset?: number;
}

/**
 * A `db` stand-in that keeps the SQL instead of running it.
 *
 * The chain has to be thenable, because the read path awaits the builder
 * directly rather than calling `.execute()`.
 */
function createRecordingDb(rows: Record<string, unknown>[] = []) {
    const queries: RecordedQuery[] = [];

    const select = jest.fn(() => {
        const record: RecordedQuery = { wheres: [],
joins: [],
orderBy: [] };
        queries.push(record);
        const builder: Record<string, unknown> = {
            from: (table: unknown) => {
                record.table = table;
                return builder;
            },
            $dynamic: () => builder,
            where: (condition: SQL) => {
                if (condition) record.wheres.push(condition);
                return builder;
            },
            innerJoin: (table: unknown, condition: SQL) => {
                record.joins.push({ table,
condition });
                return builder;
            },
            orderBy: (...expressions: unknown[]) => {
                record.orderBy.push(...expressions);
                return builder;
            },
            limit: (value: number) => {
                record.limit = value;
                return builder;
            },
            offset: (value: number) => {
                record.offset = value;
                return builder;
            },
            then: (resolve: (value: unknown) => unknown) => resolve(rows)
        };
        return builder;
    });

    const db = {
        select,
        delete: jest.fn(),
        insert: jest.fn(),
        update: jest.fn(),
        transaction: jest.fn()
    } as unknown as DrizzleClient;

    return { db,
queries,
select };
}

const pgDialect = new PgDialect();
const renderSql = (condition: SQL) => pgDialect.sqlToQuery(condition);

/** The condition the query actually ran with — the last one applied. */
const finalWhere = (query: RecordedQuery) => renderSql(query.wheres[query.wheres.length - 1]);

describe("DataService - Subcollection Search Tests", () => {

    beforeEach(() => {
        jest.clearAllMocks();

        jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation((path: string) => {
            const collection = collectionsBySlug[path];
            if (!collection) throw new Error(`Collection not found: ${path}`);
            return collection;
        });

        jest.spyOn(collectionRegistry, "getTable").mockImplementation(
            (tableName: string) => (tablesByName[tableName] ?? null) as never
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("fetchCollection with subcollection search", () => {
        it("should handle search in one-to-many inverse relation subcollection", async () => {
            // Scenario: Search posts under a specific tag (tags/19/posts)
            const { db, queries } = createRecordingDb([
                { id: 1,
title: "Mental Health Tips",
content: "Content about mental health",
tag_id: 19 },
                { id: 2,
title: "Mental Wellness",
content: "More mental health content",
tag_id: 19 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            const result = await dataService.fetchCollection("tags/19/posts", {
                searchString: "mental",
                limit: 50
            });

            // The point of the whole path: `19` is a segment of a URL, and it has
            // to end up bound into the query as the tag the posts hang off. The
            // search terms are ANDed *under* it, not alongside it — a search that
            // escaped the scope would list every matching post in the table.
            expect(queries[0].table).toBe(postsTable);
            expect(finalWhere(queries[0])).toEqual({
                sql: '("posts"."tag_id" = $1 and ("posts"."title" ilike $2 or "posts"."content" ilike $3))',
                params: [19, "%mental%", "%mental%"],
                typings: expect.anything()
            });
            expect(result.map(row => row.title)).toEqual(["Mental Health Tips", "Mental Wellness"]);
        });

        it("should handle search in many-to-one owning relation subcollection", async () => {
            // Scenario: Search posts under a specific author (authors/5/posts)
            const { db, queries } = createRecordingDb([
                { id: 10,
title: "Mental Strategies",
content: "Author's take on mental health",
author_id: 5 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            await dataService.fetchCollection("authors/5/posts", {
                searchString: "mental",
                limit: 25
            });

            // Same target table as the tags case, a different foreign key: the
            // scope has to follow the relation the path names, not the target.
            expect(finalWhere(queries[0])).toMatchObject({
                sql: '("posts"."author_id" = $1 and ("posts"."title" ilike $2 or "posts"."content" ilike $3))',
                params: [5, "%mental%", "%mental%"]
            });
        });

        it("should handle search in nested subcollection (posts/123/comments)", async () => {
            // Scenario: Search comments under a specific post (posts/123/comments)
            const { db, queries } = createRecordingDb([
                { id: 1,
content: "Great mental health advice!",
author_name: "John",
post_id: 123 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            await dataService.fetchCollection("posts/123/comments", {
                searchString: "mental",
                limit: 20
            });

            // The searched columns come from the *comments* collection, so a
            // scope built against the parent's properties would search `title`.
            expect(queries[0].table).toBe(commentsTable);
            expect(finalWhere(queries[0])).toMatchObject({
                sql: '("comments"."post_id" = $1 and ("comments"."content" ilike $2 or "comments"."author_name" ilike $3))',
                params: [123, "%mental%", "%mental%"]
            });
        });

        it("should combine search conditions with existing filters", async () => {
            const { db, queries } = createRecordingDb([
                { id: 1,
title: "Mental Health",
content: "Published content",
tag_id: 19 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            await dataService.fetchCollection("tags/19/posts", {
                searchString: "mental",
                filter: {
                    title: ["==", "Mental Health"]
                },
                limit: 10
            });

            // Three independent narrowings, all conjoined. The filter is the one
            // that used to be asserted by checking `db.select` had been called,
            // which is true of a query carrying none of them.
            expect(finalWhere(queries[0])).toMatchObject({
                sql: '("posts"."tag_id" = $1 and ("posts"."title" ilike $2 or "posts"."content" ilike $3) and "posts"."title" = $4)',
                params: [19, "%mental%", "%mental%", "Mental Health"]
            });
            expect(queries[0].limit).toBe(10);
        });

        it("should handle empty search results gracefully", async () => {
            const { db, queries } = createRecordingDb([]);
            const dataService = new DataService(db, collectionRegistry);

            const result = await dataService.fetchCollection("tags/19/posts", {
                searchString: "nonexistent",
                limit: 50
            });

            expect(result).toEqual([]);
            // An empty answer is only correct if it came from a query that was
            // still scoped to the tag — otherwise "no results" is indistinguishable
            // from having asked the wrong question.
            expect(finalWhere(queries[0])).toMatchObject({
                sql: '("posts"."tag_id" = $1 and ("posts"."title" ilike $2 or "posts"."content" ilike $3))',
                params: [19, "%nonexistent%", "%nonexistent%"]
            });
        });

        it("should handle search with ordering and pagination", async () => {
            const { db, queries } = createRecordingDb([
                { id: 3,
title: "Mental Health Z",
content: "Content Z",
tag_id: 19 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            await dataService.fetchCollection("tags/19/posts", {
                searchString: "mental",
                orderBy: "title",
                order: "asc",
                limit: 10,
                startAfter: { id: 5,
title: "Mental Health B" }
            });

            // The cursor is applied by re-issuing a *wider* `where`, so the scope
            // and the search have to be carried into it as well — dropping them
            // there is how a paged nested listing leaks the rest of the table
            // from page two onwards.
            expect(queries[0].wheres).toHaveLength(2);
            expect(finalWhere(queries[0])).toMatchObject({
                sql: '("posts"."tag_id" = $1 and ("posts"."title" ilike $2 or "posts"."content" ilike $3) and ' +
                    '("posts"."title" > $4 or ("posts"."title" = $5 and "posts"."id" > $6)))',
                params: [19, "%mental%", "%mental%", "Mental Health B", "Mental Health B", 5]
            });
            expect(queries[0].limit).toBe(10);
            expect(queries[0].orderBy).toHaveLength(2);
        });
    });

    describe("searchRows with subcollection paths", () => {
        it("should handle direct search on subcollection using searchRows method", async () => {
            const { db, queries } = createRecordingDb([
                { id: 1,
title: "Mental Health Guide",
content: "Comprehensive guide",
tag_id: 19 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            await dataService.searchRows("posts", "mental", { limit: 30 });

            // A root search carries no scope, which is exactly what distinguishes
            // it from the nested cases above.
            expect(finalWhere(queries[0])).toMatchObject({
                sql: '("posts"."title" ilike $1 or "posts"."content" ilike $2)',
                params: ["%mental%", "%mental%"]
            });
            expect(queries[0].limit).toBe(30);
        });
    });

    describe("fetchRelatedEntities with search", () => {
        it("should pass search parameters correctly to fetchEntitiesUsingJoins", async () => {
            const { db, queries } = createRecordingDb([
                { id: 1,
title: "Mental Health Post",
content: "Content",
tag_id: 19 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            await dataService.fetchRelatedEntities("tags", 19, "posts", {
                searchString: "mental",
                limit: 20
            });

            // The relation-query path builds the same scope from the parent id it
            // is handed directly, rather than from a path segment.
            expect(finalWhere(queries[0])).toMatchObject({
                sql: '("posts"."tag_id" = $1 and ("posts"."title" ilike $2 or "posts"."content" ilike $3))',
                params: [19, "%mental%", "%mental%"]
            });
            expect(queries[0].limit).toBe(20);
        });
    });

    describe("Edge cases and error handling", () => {
        it("should handle invalid subcollection paths gracefully", async () => {
            const { db } = createRecordingDb();
            const dataService = new DataService(db, collectionRegistry);

            await expect(dataService.fetchCollection("invalid/path", {
                searchString: "test"
            })).rejects.toThrow("Invalid relation path");
        });

        it("should handle missing relations gracefully", async () => {
            const { db } = createRecordingDb();
            const dataService = new DataService(db, collectionRegistry);

            await expect(dataService.fetchCollection("tags/19/nonexistent", {
                searchString: "test"
            })).rejects.toThrow("Relation 'nonexistent' not found");
        });

        it("should handle search in collection with no searchable properties", async () => {
            const { db, queries } = createRecordingDb([{ id: 1,
count: 7,
post_id: 123 }]);
            const dataService = new DataService(db, collectionRegistry);

            const result = await dataService.fetchCollection("posts/123/views", {
                searchString: "mental"
            });

            // `views` has no string column to match, so there is no condition the
            // search could compile to. Running the query anyway would return every
            // view of the post as if all of them matched.
            expect(result).toEqual([]);
            // The builder is constructed before the check, but it is abandoned
            // with nothing on it — never given a condition and never awaited.
            expect(queries[0].wheres).toHaveLength(0);
        });
    });

    describe("Performance and optimization", () => {
        it("should use proper limit when searching (default 50 for search)", async () => {
            const { db, queries } = createRecordingDb([
                { id: 1,
title: "Mental Health",
content: "Content",
tag_id: 19 }
            ]);
            const dataService = new DataService(db, collectionRegistry);

            // No explicit limit: a search is capped rather than left unbounded,
            // and the cap is 50. The number never appeared in this test before,
            // so any cap — or none — satisfied it.
            await dataService.fetchCollection("tags/19/posts", { searchString: "mental" });
            expect(queries[0].limit).toBe(50);

            // Relation hydration issues its own queries, so the second listing is
            // not simply the last thing recorded.
            const secondListing = queries.length;
            await dataService.fetchCollection("tags/19/posts", {
                searchString: "mental",
                limit: 25
            });
            expect(queries[secondListing].limit).toBe(25);
        });
    });
});
