import { DataService } from "../src/services/dataService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A query chain that resolves to `rows` however it is continued.
 *
 * These mocks used to stop at `.where()` — the shape the old nested-path
 * builder happened to produce, which honoured `limit` and nothing else. A
 * nested listing is now the ordinary collection query with one more condition,
 * so it continues into `orderBy`/`limit`/`offset` like any other. Modelling the
 * whole chain keeps these tests about behaviour rather than about which builder
 * ran.
 */
function resolvesTo(rows: unknown[]) {
    const chain: Record<string, unknown> = {
        then: (resolve: Function) => resolve(rows)
    };
    for (const method of ["limit", "offset", "orderBy", "where", "innerJoin", "$dynamic"]) {
        chain[method] = jest.fn(() => chain);
    }
    return chain;
}

/**
 * Flatten a Drizzle condition or order expression into the text it compiles to.
 *
 * The db here is a mock: it answers with whatever rows a test hands it, so
 * asserting on the rows proves nothing about the query. What the source
 * actually controls is the expression it hands the query builder, and this is
 * how a test reads it. `PgDialect.sqlToQuery` is the real renderer but needs
 * real `Column` instances, and the tables in this file are plain objects — so
 * this walks `queryChunks` directly: columns render as their name, string
 * chunks verbatim, and bound values as themselves.
 */
function compiled(node: unknown): string {
    if (node === null || node === undefined) return String(node);
    if (Array.isArray(node)) return node.map(compiled).join(", ");
    if (typeof node === "object") {
        const chunk = node as Record<string, unknown>;
        if (Array.isArray(chunk.queryChunks)) return chunk.queryChunks.map(compiled).join("");
        if (Array.isArray(chunk.value)) return chunk.value.join("");
        if (typeof chunk.name === "string") return chunk.name;
        if ("value" in chunk) return compiled(chunk.value);
    }
    return String(node);
}

/** The table a `db.insert(t)` / `db.update(t)` / `db.delete(t)` call addressed. */
function tableNames(mock: jest.Mock): string[] {
    return mock.mock.calls.map(([table]) => (table as { _def: { tableName: string } })._def.tableName);
}

/** The payloads handed to `.set(...)`, in call order. */
function setPayloads(mock: jest.Mock): unknown[] {
    return mock.mock.calls.map(([payload]) => payload);
}

const collectionRegistry = new PostgresCollectionRegistry();

describe("DataService - Relation Types Tests", () => {
    let dataService: DataService;
    let db: jest.Mocked<NodePgDatabase<any>>;

    // Mock tables for different relation scenarios
    const mockOrdersTable = {
        id: { name: "id" },
        customerId: { name: "customer_id" },
        total: { name: "total" },
        _def: { tableName: "orders" }
    };

    const mockCustomersTable = {
        id: { name: "id" },
        name: { name: "name" },
        email: { name: "email" },
        customerId: { name: "customer_id" }, // Add for relations
        _def: { tableName: "customers" }
    };

    const mockProductsTable = {
        id: { name: "id" },
        name: { name: "name" },
        price: { name: "price" },
        customerId: { name: "customer_id" }, // Add for relations
        _def: { tableName: "products" }
    };

    const mockOrderItemsTable = {
        order_id: { name: "order_id" },
        product_id: { name: "product_id" },
        quantity: { name: "quantity" },
        _def: { tableName: "order_items" }
    };

    const mockUserProfilesTable = {
        id: { name: "id" },
        userId: { name: "user_id" },
        bio: { name: "bio" },
        _def: { tableName: "user_profiles" }
    };

    // Collection definitions for testing different relation types
    const customersCollection: CollectionConfig = {
        slug: "customers",
        name: "Customers",
        table: "customers",
        properties: {
            id: { type: "number" },
            name: { type: "string" },
            email: { type: "string" },
            orders: { type: "relation",
relationName: "orders" },
            profile: { type: "relation",
relationName: "profile" }
        },
        relations: [
            {
                kind: "hasMany",
                relationName: "orders",
                target: () => ordersCollection,
                foreignKeyOnTarget: "customer_id"
            },
            {
                kind: "hasOne",
                relationName: "profile",
                target: () => userProfilesCollection,
                foreignKeyOnTarget: "user_id"
            }
        ],
        idField: "id"
    };

    const ordersCollection: CollectionConfig = {
        slug: "orders",
        name: "Orders",
        table: "orders",
        properties: {
            id: { type: "number" },
            total: { type: "number" },
            customer: { type: "relation",
relationName: "customer" },
            products: { type: "relation",
relationName: "products" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "customer",
                target: () => customersCollection,
                localKey: "customer_id"
            },
            {
                kind: "manyToMany",
                relationName: "products",
                target: () => productsCollection,
                through: {
                    table: "order_items",
                    sourceColumn: "order_id",
                    targetColumn: "product_id"
                }
            }
        ],
        idField: "id"
    };

    const productsCollection: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number" },
            name: { type: "string" },
            price: { type: "number" }
        },
        idField: "id"
    };

    const userProfilesCollection: CollectionConfig = {
        slug: "user_profiles",
        name: "User Profiles",
        table: "user_profiles",
        properties: {
            id: { type: "number" },
            bio: { type: "string" },
            user: { type: "relation",
relationName: "user" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "user",
                target: () => customersCollection,
                localKey: "user_id"
            }
        ],
        idField: "id"
    };

    beforeEach(() => {
        jest.clearAllMocks();

        jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("customers")) return customersCollection;
            if (path.startsWith("orders")) return ordersCollection;
            if (path.startsWith("products")) return productsCollection;
            if (path.startsWith("user_profiles")) return userProfilesCollection;
            return undefined;
        });

        jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
            if (tableName === "customers") return mockCustomersTable as any;
            if (tableName === "orders") return mockOrdersTable as any;
            if (tableName === "products") return mockProductsTable as any;
            if (tableName === "user_profiles") return mockUserProfilesTable as any;
            if (tableName === "order_items") return mockOrderItemsTable as any;
            return undefined;
        });

        // Create a mock query object that can be awaited
        const mockQuery = {
            then: jest.fn((resolve) => resolve(Object.assign([], { rowCount: 1 })))
        };

        db = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            $dynamic: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnValue(mockQuery),
            innerJoin: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
            // The junction writer diffs and inserts what arrived with
            // ON CONFLICT DO NOTHING — see junction-diff-write.
            onConflictDoNothing: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            // UPDATE and DELETE report how many rows they matched; the driver rejects a
            // write that matched none, so the chainable mock has to carry a row count.
            rowCount: 1,
            transaction: jest.fn((callback) => callback(db)),
            then: jest.fn((resolve) => resolve(Object.assign([], { rowCount: 1 })))
        } as any;

        dataService = new DataService(db, collectionRegistry);
    });

    describe("One-to-Many Relations (Inverse)", () => {
        it("should fetch related entities using foreign key where clause", async () => {
            const mockOrders = [
                { id: 1,
total: 100,
customerId: 1 },
                { id: 2,
total: 200,
customerId: 1 }
            ];
            // RelationService.fetchEntitiesUsingJoins ends query chain with where(), not orderBy()
            db.where.mockReturnValue(resolvesTo(mockOrders) as never);

            const entities = await dataService.fetchCollection("customers/1/orders", {});

            expect(entities).toHaveLength(2);
            expect(entities[0].total).toBe(100);
            // Should use WHERE clause, not JOIN for simple inverse relations
            expect(db.where).toHaveBeenCalled();
        });

        it("should handle empty result sets", async () => {
            db.orderBy.mockResolvedValue([]);

            const entities = await dataService.fetchCollection("customers/999/orders", {});

            expect(entities).toHaveLength(0);
        });
    });

    describe("Many-to-One Relations (Owning)", () => {
        it("should serialize owning relation correctly on create", async () => {
            const newOrder = {
                total: 150,
                customer: { id: "1",
path: "customers",
__type: "relation" }
            };

            db.returning.mockResolvedValue([{ id: 3 }]);
            db.limit.mockResolvedValue([{
                id: 3,
                total: 150,
                customerId: 1
            }]);

            const entity = await dataService.save("orders", newOrder);

            expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
                total: 150,
                customerId: "1"
            }));
            // Save answers with the row `GET /:id` serves: the FK column,
            // no relation ref — refs are the admin view-model's, built
            // client-side.
            expect(entity.customerId).toBe(1);
            expect(entity.customer).toBeUndefined();
        });

        it("should deserialize owning relation correctly on fetch", async () => {
            const mockOrder = {
                id: 1,
                total: 100,
                customerId: 5
            };
            db.limit.mockResolvedValue([mockOrder]);

            const entity = await dataService.fetchOne("orders", 1);

            expect(entity?.customer).toEqual({
                id: "5",
                path: "customers",
                __type: "relation"
            });
        });
    });

    describe("Many-to-Many Relations (Through Table)", () => {
        it("should handle many-to-many relations with junction table", async () => {
            const mockProducts = [
                { id: 1,
name: "Product 1",
price: 10 },
                { id: 2,
name: "Product 2",
price: 20 }
            ];
            db.where.mockReturnValue(resolvesTo(mockProducts) as never);

            const entities = await dataService.fetchCollection("orders/1/products", {});

            expect(entities).toHaveLength(2);
            expect(entities[0].name).toBe("Product 1");
            // The junction is reached with a correlated EXISTS, not an INNER
            // JOIN. A join through a junction multiplies the target rows by the
            // number of matching links, which silently breaks `limit`/`offset`
            // — the whole reason a related listing can now paginate at all.
            expect(db.innerJoin).not.toHaveBeenCalled();
        });

        it("should create many-to-many relations correctly", async () => {
            const newOrder = {
                total: 300,
                products: [
                    { id: "1",
path: "products",
__type: "relation" },
                    { id: "2",
path: "products",
__type: "relation" }
                ]
            };

            db.returning.mockResolvedValue([{ id: 4 }]);
            db.limit.mockResolvedValue([{
                id: 4,
                total: 300
            }]);

            await dataService.save("orders", newOrder as never);

            // A to-many key is never a column on the row. It is stripped from
            // the INSERT and written afterwards as one junction row per id,
            // against the id the INSERT came back with — which is why the link
            // cannot be written before the row exists.
            expect(tableNames(db.insert as jest.Mock)).toEqual(["orders", "order_items"]);
            expect(db.values).toHaveBeenNthCalledWith(1, { total: 300 });
            expect(db.values).toHaveBeenNthCalledWith(2, [
                { order_id: "4",
product_id: "1" },
                { order_id: "4",
product_id: "2" }
            ]);
        });
    });

    describe("One-to-One Relations", () => {
        it("should handle one-to-one relations correctly", async () => {
            const mockProfile = [
                { id: 1,
bio: "User bio",
userId: 1 }
            ];
            // RelationService ends query chain with where()
            db.where.mockReturnValue(resolvesTo(mockProfile) as never);

            const entities = await dataService.fetchCollection("customers/1/profile", {});

            expect(entities).toHaveLength(1);
            expect(entities[0].bio).toBe("User bio");
        });

        it("should create one-to-one relations correctly", async () => {
            const newProfile = {
                bio: "New user bio",
                user: { id: "1",
path: "customers",
__type: "relation" }
            };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{
                id: 1,
                bio: "New user bio",
                userId: 1
            }]);

            const entity = await dataService.save("user_profiles", newProfile);

            expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
                bio: "New user bio",
                userId: "1"
            }));
        });
    });

    describe("Relation Validation", () => {
        it("should handle null relations gracefully", async () => {
            const orderWithoutCustomer = {
                total: 150
            };

            db.returning.mockResolvedValue([{ id: 5 }]);
            // This mock is used by fetchOne after save which chains .where().limit()
            // NOTE: The mock returns customerId: null, but due to how the DataService
            // deserializes owning relations from saved entities, it may still create a relation
            // object. This test verifies that save works without providing a customer relation.
            db.limit.mockResolvedValue([{
                id: 5,
                total: 150,
                customerId: null
            }]);

            const entity = await dataService.save("orders", orderWithoutCustomer);

            // Verify the entity was saved with the correct values (no customer_id set)
            expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
                total: 150
            }));
            // Verify the entity was returned successfully
            expect(entity.id).toBe(5);
            expect(entity.total).toBe(150);
        });
    });

    describe("Complex Relation Queries", () => {
        it("should handle deep nested relation paths", async () => {
            const mockProducts = [
                { id: 1,
name: "Product 1" }
            ];
            // RelationService ends query chain with where()
            db.where.mockReturnValue(resolvesTo(mockProducts) as never);

            const entities = await dataService.fetchCollection("customers/1/orders/1/products", {});

            expect(entities).toHaveLength(1);
            expect(collectionRegistry.getCollectionByPath).toHaveBeenCalledWith("customers");
        });

        it("should apply filters on related entities", async () => {
            const mockOrders = [
                { id: 1,
total: 100,
customerId: 1 }
            ];
            // RelationService ends query chain with where()
            db.where.mockReturnValue(resolvesTo(mockOrders) as never);

            await dataService.fetchCollection("customers/1/orders", {
                filter: { total: [">=", 100] }
            });

            // The rows come back from the mock whatever the query says, so
            // counting them passes with the filter deleted from the source.
            // The condition the listing composed is the part the source owns —
            // and it has to carry *both* halves: the parent scope narrows the
            // relation, the filter narrows within it, and a nested listing that
            // dropped either one would serve rows the caller did not ask for.
            const where = compiled(db.where.mock.calls[0][0]);
            expect(where).toContain("customer_id = 1");
            expect(where).toContain("total >= 100");
        });

        it("should order related entities correctly", async () => {
            const mockOrders = [
                { id: 2,
total: 200,
customerId: 1 },
                { id: 1,
total: 100,
customerId: 1 }
            ];
            // The chain `where()` returns is where ORDER BY lands, so the test
            // has to hold on to it — `db.orderBy` is never the one called.
            const chain = resolvesTo(mockOrders);
            db.where.mockReturnValue(chain as never);

            await dataService.fetchCollection("customers/1/orders", {
                orderBy: "total",
                order: "desc"
            });

            // Returning the mock's rows in the order the mock listed them says
            // nothing: only what reached ORDER BY does. The id tiebreaker
            // trails the requested key so the order is total, and keyset
            // pagination has a unique cursor to advance on.
            // The NULL placement is written out rather than inherited from
            // Postgres's default, which is what it already was: `DESC` means
            // `NULLS FIRST`. It is stated because the keyset comparison behind
            // cursor paging encodes the same placement.
            const orderBy = (chain.orderBy as jest.Mock).mock.calls[0].map(compiled);
            expect(orderBy).toEqual(["total DESC NULLS FIRST", "id desc"]);
        });
    });

    describe("Relation Updates", () => {
        it("should update owning relations correctly", async () => {
            const updatedOrder = {
                customer: { id: "2",
path: "customers",
__type: "relation" }
            };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{
                id: 1,
                total: 100,
                customerId: 2
            }]);

            const entity = await dataService.save("orders", updatedOrder, 1);

            expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
                customerId: "2"
            }));
        });

        it("should handle removing relations", async () => {
            // An explicit null is a request to unlink, and the only way to make
            // one: the owning key lives on this row, so removal is an UPDATE
            // that writes NULL to it. Serialization drops `undefined` values,
            // and a null that goes the same way leaves the old link in place —
            // the save reports success and the relation never changes.
            const orderWithoutCustomer = { customer: null };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{
                id: 1,
                total: 100,
                customerId: null
            }]);

            await dataService.save("orders", orderWithoutCustomer as never, 1);

            expect(db.update).toHaveBeenCalledWith(mockOrdersTable);
            expect(db.set).toHaveBeenCalledWith({ customerId: null });
        });

        it("should leave an omitted relation untouched", async () => {
            // Absent and null are different requests. With the key omitted and
            // nothing else in the payload there is no column to write at all,
            // and Drizzle rejects an empty `set` — so the source has to skip
            // the UPDATE rather than issue one.
            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{
                id: 1,
                total: 100,
                customerId: 2
            }]);

            await dataService.save("orders", {}, 1);

            expect(db.set).not.toHaveBeenCalled();
        });
    });

    describe("Advanced Relation Types - Complete Coverage", () => {
        // Additional mock tables for joinPath scenarios
        const mockAuthorsTable = {
            id: { name: "id" },
            name: { name: "name" },
            _def: { tableName: "authors" }
        };

        const mockPostsTable = {
            id: { name: "id" },
            title: { name: "title" },
            authorId: { name: "author_id" },
            _def: { tableName: "posts" }
        };

        const mockCommentsTable = {
            id: { name: "id" },
            content: { name: "content" },
            postId: { name: "post_id" },
            _def: { tableName: "comments" }
        };

        const mockTagsTable = {
            id: { name: "id" },
            name: { name: "name" },
            _def: { tableName: "tags" }
        };

        const mockPostTagsTable = {
            post_id: { name: "post_id" },
            tag_id: { name: "tag_id" },
            _def: { tableName: "post_tags" }
        };

        // Test Case 1: ONE + owning + localKey (already covered in "Many-to-One Relations")
        // This is the Post -> Author relationship

        describe("ONE + owning + joinPath", () => {
            const postsWithAuthorViaJoinPath: CollectionConfig = {
                slug: "posts_jp",
                name: "Posts with JoinPath",
                table: "posts",
                properties: {
                    id: { type: "number" },
                    title: { type: "string" },
                    authorProfile: { type: "relation",
relationName: "authorProfile" }
                },
                relations: [
                    {
                        kind: "via",
                        relationName: "authorProfile",
                        target: () => userProfilesCollection,
                        cardinality: "one",
                        joinPath: [
                            { table: "authors",
on: { from: "posts.author_id",
to: "authors.id" } },
                            { table: "user_profiles",
on: { from: "authors.id",
to: "user_profiles.user_id" } }
                        ]
                    }
                ],
                idField: "id"
            };

            it("should handle one-to-one owning relation via joinPath on write", async () => {
                jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(postsWithAuthorViaJoinPath);
                jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
                    if (tableName === "posts") return mockPostsTable as any;
                    if (tableName === "authors") return mockAuthorsTable as any;
                    if (tableName === "user_profiles") return mockUserProfilesTable as any;
                    return undefined;
                });

                const newPost = {
                    title: "Test Post",
                    authorProfile: { id: "1",
path: "user_profiles",
__type: "relation" }
                };

                // The link is written through the parent's own foreign key, so
                // the source reads that column back before it writes anything.
                // The mock answers every select the same way, so this one is
                // picked out by the projection the source asks for — which is
                // also what makes the projection assertable below.
                let parentKeyRead: Record<string, unknown> | undefined;
                db.select.mockImplementation(((selection?: Record<string, unknown>) => {
                    if (selection && "val" in selection) {
                        parentKeyRead = selection;
                        const chain: Record<string, unknown> = {};
                        chain.from = () => chain;
                        chain.where = () => chain;
                        chain.limit = () => Promise.resolve([{ val: 7 }]);
                        return chain;
                    }
                    return db;
                }) as never);

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
title: "Test Post",
authorId: 7 }]);

                await dataService.save("posts_jp", newPost);

                // Asserting a transaction ran says nothing — every save is
                // wrapped in one. These are the writes the joinPath produced.
                //
                // The chain is posts.author_id → authors.id → user_profiles.
                // The value written into the profile is the *parent's*
                // author_id, not the post's id: reading the wrong end of the
                // first hop links the profile to a row it has no relation to.
                expect(parentKeyRead?.val).toBe(mockPostsTable.authorId);
                expect(tableNames(db.update as jest.Mock)).toEqual(["user_profiles", "user_profiles"]);
                // To-one: whoever currently holds the parent's key is cleared
                // before the named target takes it, or the pair ends up with
                // two profiles claiming the same author.
                expect(setPayloads(db.set as jest.Mock)).toEqual([{ userId: null }, { userId: 7 }]);
            });

            it("applies joinPath updates BEFORE main UPDATE on existing entities to prevent stale data corruption", async () => {
                jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(postsWithAuthorViaJoinPath);
                jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
                    if (tableName === "posts") return mockPostsTable as any;
                    if (tableName === "authors") return mockAuthorsTable as any;
                    if (tableName === "user_profiles") return mockUserProfilesTable as any;
                    return undefined;
                });

                const postUpdate = {
                    title: "Test Post Updated",
                    authorProfile: { id: "1",
path: "user_profiles",
__type: "relation" }
                };

                const expectedOps: string[] = [];

                // Track updateJoinPathOneToOneRelations
                const relationService = dataService.getPersistService().getRelationWriteService();
                const spyJoinPath = jest.spyOn(relationService, "updateJoinPathOneToOneRelations").mockImplementation(async () => {
                    expectedOps.push("joinPathUpdate");
                });

                // Track main entity update
                const originalUpdate = db.update;
                db.update = jest.fn(function(this: any, table) {
                    if (table && (table as any)._def?.tableName === "posts") {
                        expectedOps.push("mainUpdate");
                    }
                    return originalUpdate.call(this, table);
                }) as any;

                db.limit.mockResolvedValue([{ id: 1,
title: "Test Post Updated",
authorId: 1 }]);

                try {
                    await dataService.save("posts_jp", postUpdate, 1);
                    expect(expectedOps).toEqual(["joinPathUpdate", "mainUpdate"]);
                } finally {
                    db.update = originalUpdate;
                    spyJoinPath.mockRestore();
                }
            });
        });

        describe("ONE + inverse + foreignKeyOnTarget (already covered in One-to-One Relations)", () => {
            // This is the Customer <- Profile relationship
            it("should update inverse one-to-one relation", async () => {
                const customerWithProfile = {
                    name: "John Doe",
                    profile: { id: "1",
path: "user_profiles",
__type: "relation" }
                };

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
name: "John Doe" }]);

                await dataService.save("customers", customerWithProfile);

                // The customers row carries no profile column: the key lives on
                // user_profiles, so the write lands there. A transaction ran
                // either way — every save opens one — which is why that alone
                // never showed whether the relation was written.
                expect(tableNames(db.update as jest.Mock)).toEqual(["user_profiles", "user_profiles"]);
                // Clear-then-set, in that order: a profile that used to point
                // at this customer has to let go before the named one takes
                // over, or a to-one relation ends up with two holders.
                expect(setPayloads(db.set as jest.Mock)).toEqual([{ userId: null }, { userId: "1" }]);
            });
        });

        describe("ONE + inverse + joinPath", () => {
            const authorsWithProfileViaJoinPath: CollectionConfig = {
                slug: "authors_jp",
                name: "Authors with Profile via JoinPath",
                table: "authors",
                properties: {
                    id: { type: "number" },
                    name: { type: "string" },
                    profile: { type: "relation",
relationName: "profile" }
                },
                relations: [
                    {
                        kind: "via",
                        relationName: "profile",
                        target: () => userProfilesCollection,
                        cardinality: "one",
                        joinPath: [
                            { table: "customers",
on: { from: "authors.id",
to: "customers.id" } },
                            { table: "user_profiles",
on: { from: "customers.id",
to: "user_profiles.user_id" } }
                        ]
                    }
                ],
                idField: "id"
            };

            it("should handle one-to-one inverse relation via joinPath on write", async () => {
                jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(authorsWithProfileViaJoinPath);
                jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
                    if (tableName === "authors") return mockAuthorsTable as any;
                    if (tableName === "customers") return mockCustomersTable as any;
                    if (tableName === "user_profiles") return mockUserProfilesTable as any;
                    return undefined;
                });

                const newAuthor = {
                    name: "Jane Author",
                    profile: { id: "2",
path: "user_profiles",
__type: "relation" }
                };

                // See the owning joinPath test above: the parent's key is read
                // back before the link is written, and the mock picks that read
                // out by its projection.
                let parentKeyRead: Record<string, unknown> | undefined;
                db.select.mockImplementation(((selection?: Record<string, unknown>) => {
                    if (selection && "val" in selection) {
                        parentKeyRead = selection;
                        const chain: Record<string, unknown> = {};
                        chain.from = () => chain;
                        chain.where = () => chain;
                        chain.limit = () => Promise.resolve([{ val: 3 }]);
                        return chain;
                    }
                    return db;
                }) as never);

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
name: "Jane Author" }]);

                await dataService.save("authors_jp", newAuthor);

                // This chain starts authors.id → customers.id, so the value
                // carried to the profile is the author's own id — the contrast
                // with the owning case above, where it was an intermediate FK.
                // Resolving the same column for both would write one of them
                // against a value from the wrong table.
                expect(parentKeyRead?.val).toBe(mockAuthorsTable.id);
                expect(tableNames(db.update as jest.Mock)).toEqual(["user_profiles", "user_profiles"]);
                expect(setPayloads(db.set as jest.Mock)).toEqual([{ userId: null }, { userId: 3 }]);
            });
        });

        describe("MANY + owning + through (already covered in Many-to-Many Relations)", () => {
            // This is the Order -> Products via order_items relationship
            it("should update many-to-many owning relation with through", async () => {
                const orderWithProducts = {
                    total: 500,
                    products: [
                        { id: "1",
path: "products",
__type: "relation" },
                        { id: "2",
path: "products",
__type: "relation" }
                    ]
                };

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
total: 500 }]);

                // An update, unlike the create covered above: the row already
                // has links, so the set has to be *replaced* rather than added
                // to.
                await dataService.save("orders", orderWithProducts as never, 1);

                expect(db.set).toHaveBeenCalledWith({ total: 500 });
                expect(tableNames(db.insert as jest.Mock)).toEqual(["order_items"]);
                expect(db.values).toHaveBeenCalledWith([
                    { order_id: "1",
product_id: "1" },
                    { order_id: "1",
product_id: "2" }
                ]);
                // Nothing is linked in this mock, so both products are new and
                // there is nothing to remove: the writer diffs against the
                // stored set rather than clearing it first. What a save does
                // to an existing set is pinned in junction-diff-write.
                expect(tableNames(db.delete as jest.Mock)).toEqual([]);
            });
        });

        describe("MANY + owning + joinPath", () => {
            const postsWithTagsViaJoinPath: CollectionConfig = {
                slug: "posts_tags_jp",
                name: "Posts with Tags via JoinPath",
                table: "posts",
                properties: {
                    id: { type: "number" },
                    title: { type: "string" },
                    tags: { type: "relation",
relationName: "tags" }
                },
                relations: [
                    {
                        kind: "via",
                        relationName: "tags",
                        target: () => ({
                            slug: "tags",
                            name: "Tags",
                            table: "tags",
                            properties: { id: { type: "number" },
name: { type: "string" } },
                            idField: "id"
                        }),
                        cardinality: "many",
                        joinPath: [
                            { table: "post_tags",
on: { from: "posts.id",
to: "post_tags.post_id" } },
                            { table: "tags",
on: { from: "post_tags.tag_id",
to: "tags.id" } }
                        ]
                    }
                ],
                idField: "id"
            };

            it("should handle many-to-many owning relation via joinPath on write", async () => {
                jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
                    if (path === "posts_tags_jp" || path === "posts") return postsWithTagsViaJoinPath;
                    if (path.startsWith("tags")) return postsWithTagsViaJoinPath.relations![0].target();
                    return undefined;
                });
                jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
                    if (tableName === "posts") return mockPostsTable as any;
                    if (tableName === "post_tags") return mockPostTagsTable as any;
                    if (tableName === "tags") return mockTagsTable as any;
                    return undefined;
                });

                const postWithTags = {
                    title: "Tagged Post",
                    tags: [
                        { id: "1",
path: "tags",
__type: "relation" },
                        { id: "2",
path: "tags",
__type: "relation" }
                    ]
                };

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
title: "Tagged Post" }]);
                // Mock the fetch for tags relation - return empty array since we're testing write
                db.orderBy.mockResolvedValue([]);

                const _entity = await dataService.save("posts_tags_jp", postWithTags);

                // Should manage junction table via joinPath
                expect(db.transaction).toHaveBeenCalled();
                // The links this save asks for are all new, so the junction is
                // written and nothing is removed — see junction-diff-write.
                expect(db.insert).toHaveBeenCalled();
            });
        });

        describe("MANY + inverse + foreignKeyOnTarget (already covered)", () => {
            // This is the Customer <- Orders relationship
            it("should update one-to-many inverse relation", async () => {
                const customerWithOrders = {
                    name: "Big Customer",
                    orders: [
                        { id: "1",
path: "orders",
__type: "relation" },
                        { id: "2",
path: "orders",
__type: "relation" }
                    ]
                };

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
name: "Big Customer" }]);

                await dataService.save("customers", customerWithOrders);

                // No junction here — the key is a column on orders, so the set
                // is expressed as two UPDATEs on that column.
                expect(tableNames(db.update as jest.Mock)).toEqual(["orders", "orders"]);
                // The first clears the customer off every order that is no
                // longer in the list, the second stamps it onto the ones that
                // are. Without the clearing pass a removed order keeps pointing
                // at this customer and silently stays in the collection.
                expect(setPayloads(db.set as jest.Mock)).toEqual([
                    { customerId: null },
                    { customerId: "1" }
                ]);
            });
        });

        describe("MANY + inverse + through", () => {
            const productsWithOrdersInverse: CollectionConfig = {
                slug: "products_orders",
                name: "Products with Orders Inverse",
                table: "products",
                properties: {
                    id: { type: "number" },
                    name: { type: "string" },
                    orders: { type: "relation",
relationName: "orders" }
                },
                relations: [
                    {
                        kind: "via",
                        relationName: "orders",
                        target: () => ordersCollection,
                        cardinality: "many",
                        // Add joinPath to satisfy the validation
                        joinPath: [
                            { table: "order_items",
on: { from: "products.id",
to: "order_items.product_id" } },
                            { table: "orders",
on: { from: "order_items.order_id",
to: "orders.id" } }
                        ]
                    }
                ],
                idField: "id"
            };

            it("should handle many-to-many inverse relation with through", async () => {
                jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
                    if (path === "products_orders" || path === "products") return productsWithOrdersInverse;
                    if (path.startsWith("orders")) return ordersCollection;
                    return undefined;
                });
                jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
                    if (tableName === "products") return mockProductsTable as any;
                    if (tableName === "orders") return mockOrdersTable as any;
                    if (tableName === "order_items") return mockOrderItemsTable as any;
                    return undefined;
                });

                const productWithOrders = {
                    name: "Popular Product",
                    orders: [
                        { id: "1",
path: "orders",
__type: "relation" },
                        { id: "2",
path: "orders",
__type: "relation" }
                    ]
                };

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
name: "Popular Product" }]);
                // Mock the fetch for orders relation - return empty array
                db.orderBy.mockResolvedValue([]);

                const _entity = await dataService.save("products_orders", productWithOrders);

                // Should manage junction table from inverse side
                expect(db.transaction).toHaveBeenCalled();
                expect(db.insert).toHaveBeenCalled();
            });
        });

        describe("MANY + inverse + joinPath", () => {
            const tagsWithPostsViaJoinPath: CollectionConfig = {
                slug: "tags_posts_jp",
                name: "Tags with Posts via JoinPath",
                table: "tags",
                properties: {
                    id: { type: "number" },
                    name: { type: "string" },
                    posts: { type: "relation",
relationName: "posts" }
                },
                relations: [
                    {
                        kind: "via",
                        relationName: "posts",
                        target: () => ({
                            slug: "posts",
                            name: "Posts",
                            table: "posts",
                            properties: { id: { type: "number" },
title: { type: "string" } },
                            idField: "id"
                        }),
                        cardinality: "many",
                        joinPath: [
                            { table: "post_tags",
on: { from: "tags.id",
to: "post_tags.tag_id" } },
                            { table: "posts",
on: { from: "post_tags.post_id",
to: "posts.id" } }
                        ]
                    }
                ],
                idField: "id"
            };

            it("should handle many-to-many inverse relation via joinPath on write", async () => {
                jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
                    if (path === "tags_posts_jp" || path === "tags") return tagsWithPostsViaJoinPath;
                    if (path.startsWith("posts")) return tagsWithPostsViaJoinPath.relations![0].target();
                    return undefined;
                });
                jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
                    if (tableName === "tags") return mockTagsTable as any;
                    if (tableName === "post_tags") return mockPostTagsTable as any;
                    if (tableName === "posts") return mockPostsTable as any;
                    return undefined;
                });

                const tagWithPosts = {
                    name: "Popular Tag",
                    posts: [
                        { id: "1",
path: "posts",
__type: "relation" },
                        { id: "2",
path: "posts",
__type: "relation" }
                    ]
                };

                db.returning.mockResolvedValue([{ id: 1 }]);
                db.limit.mockResolvedValue([{ id: 1,
name: "Popular Tag" }]);
                // Mock the fetch for posts relation - return empty array since we're testing write
                db.orderBy.mockResolvedValue([]);

                const _entity = await dataService.save("tags_posts_jp", tagWithPosts);

                // Should manage junction table via inverse joinPath
                expect(db.transaction).toHaveBeenCalled();
                expect(db.insert).toHaveBeenCalled();
            });
        });
    });
});
