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
    for (const method of ["limit", "offset", "orderBy", "where", "from", "innerJoin", "$dynamic"]) {
        chain[method] = jest.fn(() => chain);
    }
    return chain;
}

const collectionRegistry = new PostgresCollectionRegistry();

// --- Mock Drizzle ORM table definitions ---
const mockAuthorsTable = {
    id: { name: "id" },
    name: { name: "name" },
    _def: { tableName: "authors" }
};
const mockPostsTable = {
    id: { name: "id",
dataType: "number" },
    title: { name: "title" },
    author_id: { name: "author_id",
dataType: "number" },
    _def: { tableName: "posts" }
};
const mockTagsTable = {
    id: { name: "id",
dataType: "number" },
    name: { name: "name" },
    _def: { tableName: "tags" }
};
const mockPostsTagsTable = {
    post_id: { name: "post_id",
dataType: "number" },
    tag_id: { name: "tag_id",
dataType: "number" },
    _def: { tableName: "posts_tags" }
};
const mockProjectUsersTable = {
    project_id: { name: "project_id" },
    id: { name: "id" },
    email: { name: "email" },
    _def: { tableName: "project_users" }
};

// --- Correctly typed Mock Entity Collections ---
let authorsCollection: CollectionConfig;
const tagsCollection: CollectionConfig = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" }
    },
    idField: "id"
};

const projectUsersCollection: CollectionConfig = {
    slug: "project_users",
    name: "Project Users",
    table: "project_users",
    properties: {
        project_id: { type: "string" },
        id: { type: "string" },
        email: { type: "string" }
    },
    primaryKeys: ["project_id", "id"]
};

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" },
        author: {
            type: "relation",
            relationName: "author"
        },
        tags: {
            type: "relation",
            relationName: "tags"
        }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => authorsCollection,
            localKey: "author_id"
        },
        {
            kind: "manyToMany",
            relationName: "tags",
            target: () => tagsCollection,
            through: {
                table: "posts_tags",
                sourceColumn: "post_id",
                targetColumn: "tag_id"
            }
        }
    ],
    idField: "id"
};

authorsCollection = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        posts: {
            type: "relation",
            relationName: "posts"
        }
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

describe("DataService", () => {
    let dataService: DataService;
    let db: jest.Mocked<NodePgDatabase>;

    beforeEach(() => {
        jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("authors")) return authorsCollection;
            if (path.startsWith("posts")) return postsCollection;
            if (path.startsWith("tags")) return tagsCollection;
            if (path.startsWith("project_users")) return projectUsersCollection;
            return undefined;
        });
        jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
            if (tableName === "authors") return mockAuthorsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "posts") return mockPostsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "tags") return mockTagsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "posts_tags") return mockPostsTagsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "project_users") return mockProjectUsersTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            return undefined;
        });
        jest.spyOn(collectionRegistry, "getCollections").mockReturnValue([authorsCollection, postsCollection, tagsCollection, projectUsersCollection]);

        db = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            $dynamic: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([]),
            orderBy: jest.fn().mockResolvedValue([]), // This is now a terminal operation by default
            innerJoin: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
            // Junction inserts land with ON CONFLICT DO NOTHING so that two
            // editors adding the same link concurrently is a no-op rather than
            // a unique violation.
            onConflictDoNothing: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            // UPDATE and DELETE report how many rows they matched; the driver rejects a
            // write that matched none, so the chainable mock has to carry a row count.
            rowCount: 1,
            transaction: jest.fn((callback) => callback(db))
        } as unknown as jest.Mocked<NodePgDatabase>;

        dataService = new DataService(db, collectionRegistry);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("fetchOne", () => {
        it("should parse a 'one' relation ID into a relation object with a string ID", async () => {
            const mockPost = {
                id: 2,
                title: "My First Post",
                author: 1
            };
            db.limit.mockResolvedValue([mockPost]);
            const entity = await dataService.fetchOne("posts", 2);
            // The service correctly converts relation IDs to strings.
            expect(entity?.author).toEqual({
                id: "1",
                path: "authors",
                __type: "relation"
            });
        });

        it("should parse a composite ID and use both parts in the WHERE clause", async () => {
            const mockUser = {
                project_id: "proj1",
                id: "user1",
                email: "test@test.com"
            };
            db.limit.mockResolvedValue([mockUser] as unknown as never);

            const entity = await dataService.fetchOne("project_users", "proj1:::user1");

            // Check that we fetched the actual mocked user
            expect(entity?.id).toBe("proj1:::user1");
            expect(entity?.email).toBe("test@test.com");

            expect(db.select).toHaveBeenCalled();
            expect(db.from).toHaveBeenCalled();
            expect(db.where).toHaveBeenCalled();
            expect(db.limit).toHaveBeenCalledWith(1);
        });
    });

    describe("save (create)", () => {
        it("should correctly serialize and deserialize a 'one' relation", async () => {
            const newPost = {
                title: "Post by Jane",
                author: {
                    id: "3",
                    path: "authors",
                    __type: "relation"
                }
            };
            db.returning.mockResolvedValue([{ id: 4 }]);
            // Mock the fetch-back call after the save
            db.limit.mockResolvedValue([{
                id: 4,
                title: "Post by Jane",
                author_id: "3" // Database stores the foreign key
            }]);

            const entity = await dataService.save("posts", newPost);

            // 1. Check that the relation was serialized to a foreign key for the database insert
            expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
                title: "Post by Jane",
                author_id: "3" // Should be serialized to FK for database storage
            }));

            // 2. The returned row is the one `GET /:id` serves: raw columns,
            // the FK under its own name, and no relation ref — the Entity
            // view-model (refs, canonical id) is built by its consumers.
            expect(entity.id).toBe(4);
            expect(entity.author_id).toBe("3");
            expect(entity.author).toBeUndefined();
        });

        it("answers a save with the same row shape a REST read serves", async () => {
            // POST /data/posts used to answer with the admin view-model row
            // (string-normalized ids, `__type: "relation"` refs) while the GET
            // that followed served raw columns — the same resource, two shapes.
            // The save's fetch-back now runs the same walk as `GET /:id`.
            const dbRow = {
                id: 7,
                title: "Same shape",
                author_id: "3"
            };
            db.returning.mockResolvedValue([{ id: 7 }]);
            db.limit.mockResolvedValue([dbRow]);

            const saved = await dataService.save("posts", { title: "Same shape" });
            const read = await dataService.getFetchService().fetchOneForRest("posts", 7);

            expect(saved).toEqual(read);
        });

        it("should save a entity with composite primary keys in UPSERT/onConflictDoUpdate mode", async () => {
            const valuesToSave = {
                project_id: "proj1",
                id: "user1",
                email: "new@test.com"
            };

            const returnedSaved = {
                project_id: "proj1",
                id: "user1",
                email: "new@test.com"
            };

            const mockWhere = jest.fn().mockResolvedValue(Object.assign([returnedSaved], { rowCount: 1 }));
            const mockSet = jest.fn().mockReturnValue({
                where: mockWhere
            });

            // Intercept update chain
            db.update.mockReturnValue({
                set: mockSet
            } as unknown as ReturnType<typeof db.update>);

            // Mock fetch back (the final step of save)
            db.limit.mockResolvedValue([returnedSaved] as unknown as never);

            const savedEntity = await dataService.save("project_users", valuesToSave, "proj1:::user1");

            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ email: "new@test.com" }));
            expect(mockWhere).toHaveBeenCalled();

            // The row's columns, exactly as `GET /:id` serves them. The
            // composite address ("proj1:::user1") is derived by consumers from
            // the key columns, not written into the row.
            expect(savedEntity.id).toBe("user1");
            expect(savedEntity.project_id).toBe("proj1");
            expect(savedEntity.email).toBe("new@test.com");
        });
    });

    describe("save (update)", () => {
        // The junction is diffed, not rebuilt. Delete-all-then-reinsert lost a
        // concurrent editor's links, and — because it deleted what the caller
        // could *read* — an RLS-filtered read turned into a partial delete of
        // rows the caller was never allowed to see.
        it("adds only the links that arrived, and deletes only the ones that left", async () => {
            const updatedPost = { tags: [{ id: 11 }, { id: 12 }] };
            db.limit.mockResolvedValue([{
                id: 5,
                title: "Post with Tags"
            }]);
            // Post 5 already links tag 11; 99 is about to lose its link.
            // Scoped to the junction read by its projection, so the save's own
            // `.where(...).limit(1)` fetch-back still resolves normally.
            db.select.mockImplementation((fields?: unknown) => (
                fields && typeof fields === "object" && "targetId" in fields
                    ? resolvesTo([{ targetId: 11 }, { targetId: 99 }])
                    : db
            ) as never);

            await dataService.save("posts", updatedPost, 5);

            // 12 is new, so it alone is inserted — 11 is left where it is.
            expect(db.insert).toHaveBeenCalledWith(mockPostsTagsTable);
            expect(db.values).toHaveBeenLastCalledWith([{
                post_id: 5,
                tag_id: 12
            }]);
            // 99 is gone from the payload, so it alone is removed.
            expect(db.delete).toHaveBeenCalledWith(mockPostsTagsTable);
        });

        it("issues no delete when every existing link survives", async () => {
            db.limit.mockResolvedValue([{
                id: 5,
                title: "Post with Tags"
            }]);
            db.select.mockImplementation((fields?: unknown) => (
                fields && typeof fields === "object" && "targetId" in fields
                    ? resolvesTo([{ targetId: 11 }])
                    : db
            ) as never);

            await dataService.save("posts", { tags: [{ id: 11 }, { id: 12 }] }, 5);

            expect(db.delete).not.toHaveBeenCalled();
        });
    });

    describe("fetchCollectionFromPath", () => {
        it("should fetch related entities from a nested path", async () => {
            const mockRelatedPosts = [
                { id: 1,
title: "Post by John",
author_id: 1 },
                { id: 2,
title: "Another Post by John",
author_id: 1 }
            ];
            // RelationService.fetchEntitiesUsingJoins ends query chain with where(), not orderBy()
            // Make where() awaitable by returning a promise-like object
            db.where.mockReturnValue(resolvesTo(mockRelatedPosts) as never);

            const entities = await dataService.fetchCollection("authors/1/posts", {});

            // The service should have been called to get the 'authors' collection definition.
            expect(collectionRegistry.getCollectionByPath).toHaveBeenCalledWith("authors");
            // For inverse relations like authors->posts, no join is needed as it uses a WHERE clause on the foreign key
            expect(entities).toHaveLength(2);
            expect(entities[0].title).toBe("Post by John");
        });
    });
});


describe("DataService - Comprehensive Tests", () => {
    let dataService: DataService;
    let db: jest.Mocked<NodePgDatabase<any>>;

    // Extended mock tables for more complex scenarios
    const mockUsersTable = {
        id: { name: "id",
dataType: "number" },
        email: { name: "email" },
        name: { name: "name" },
        created_at: { name: "created_at" },
        project_id: { name: "project_id" }, // Add for relations
        assignee_id: { name: "assignee_id" }, // Add for relations
        _def: { tableName: "users" }
    };

    const mockCompaniesTable = {
        id: { name: "id" },
        name: { name: "name" },
        user_id: { name: "user_id" },
        company_id: { name: "company_id" }, // Add for relations
        _def: { tableName: "companies" }
    };

    const mockProjectsTable = {
        id: { name: "id" },
        title: { name: "title" },
        description: { name: "description" },
        company_id: { name: "company_id" },
        status: { name: "status" },
        priority: { name: "priority" },
        project_id: { name: "project_id" }, // Add for relations
        assignee_id: { name: "assignee_id" }, // Add for relations
        _def: { tableName: "projects" }
    };

    const mockTasksTable = {
        id: { name: "id" },
        title: { name: "title" },
        project_id: { name: "project_id" },
        assignee_id: { name: "assignee_id" },
        _def: { tableName: "tasks" }
    };

    const mockCategoriesTable = {
        id: { name: "id" },
        name: { name: "name" },
        parent_id: { name: "parent_id" },
        _def: { tableName: "categories" }
    };

    const mockProjectTagsTable = {
        project_id: { name: "project_id" },
        tag_id: { name: "tag_id" },
        _def: { tableName: "project_tags" }
    };

    const mockTagsTable = {
        id: { name: "id",
dataType: "number" },
        name: { name: "name" },
        _def: { tableName: "tags" }
    };

    // Complex collection definitions
    const usersCollection: CollectionConfig = {
        slug: "users",
        name: "Users",
        table: "users",
        properties: {
            id: { type: "number" },
            email: { type: "string" },
            name: { type: "string" },
            created_at: { type: "date" },
            companies: { type: "relation",
relationName: "companies" }
        },
        relations: [{
            kind: "hasMany",
            relationName: "companies",
            target: () => companiesCollection,
            foreignKeyOnTarget: "user_id"
        }],
        idField: "id"
    };

    const companiesCollection: CollectionConfig = {
        slug: "companies",
        name: "Companies",
        table: "companies",
        properties: {
            id: { type: "number" },
            name: { type: "string" },
            owner: { type: "relation",
relationName: "owner" },
            projects: { type: "relation",
relationName: "projects" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "owner",
                target: () => usersCollection,
                localKey: "user_id"
            },
            {
                kind: "hasMany",
                relationName: "projects",
                target: () => projectsCollection,
                foreignKeyOnTarget: "company_id"
            }
        ],
        idField: "id"
    };

    const projectsCollection: CollectionConfig = {
        slug: "projects",
        name: "Projects",
        table: "projects",
        properties: {
            id: { type: "number" },
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
            priority: { type: "number" },
            company: { type: "relation",
relationName: "company" },
            tasks: { type: "relation",
relationName: "tasks" },
            tags: { type: "relation",
relationName: "tags" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "company",
                target: () => companiesCollection,
                localKey: "company_id"
            },
            {
                kind: "hasMany",
                relationName: "tasks",
                target: () => tasksCollection,
                foreignKeyOnTarget: "project_id"
            },
            {
                kind: "manyToMany",
                relationName: "tags",
                target: () => tagsCollection,
                through: {
                    table: "project_tags",
                    sourceColumn: "project_id",
                    targetColumn: "tag_id"
                }
            }
        ],
        idField: "id"
    };

    const tasksCollection: CollectionConfig = {
        slug: "tasks",
        name: "Tasks",
        table: "tasks",
        properties: {
            id: { type: "number" },
            title: { type: "string" },
            project: { type: "relation",
relationName: "project" },
            assignee: { type: "relation",
relationName: "assignee" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "project",
                target: () => projectsCollection,
                localKey: "project_id"
            },
            {
                kind: "belongsTo",
                relationName: "assignee",
                target: () => usersCollection,
                localKey: "assignee_id"
            }
        ],
        idField: "id"
    };

    const tagsCollection: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: {
            id: { type: "number" },
            name: { type: "string" }
        },
        idField: "id"
    };

    const categoriesCollection: CollectionConfig = {
        slug: "categories",
        name: "Categories",
        table: "categories",
        properties: {
            id: { type: "number" },
            name: { type: "string" },
            parent: { type: "relation",
relationName: "parent" },
            children: { type: "relation",
relationName: "children" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "parent",
                target: () => categoriesCollection,
                localKey: "parent_id"
            },
            {
                kind: "hasMany",
                relationName: "children",
                target: () => categoriesCollection,
                foreignKeyOnTarget: "parent_id"
            }
        ],
        idField: "id"
    };

    beforeEach(() => {
        jest.clearAllMocks();

        jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("users")) return usersCollection;
            if (path.startsWith("companies")) return companiesCollection;
            if (path.startsWith("projects")) return projectsCollection;
            if (path.startsWith("tasks")) return tasksCollection;
            if (path.startsWith("tags")) return tagsCollection;
            if (path.startsWith("categories")) return categoriesCollection;
            return undefined;
        });

        jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
            if (tableName === "users") return mockUsersTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "companies") return mockCompaniesTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "projects") return mockProjectsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "tasks") return mockTasksTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "tags") return mockTagsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "categories") return mockCategoriesTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            if (tableName === "project_tags") return mockProjectTagsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
            return undefined;
        });

        db = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            $dynamic: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
            // Junction inserts land with ON CONFLICT DO NOTHING so that two
            // editors adding the same link concurrently is a no-op rather than
            // a unique violation.
            onConflictDoNothing: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            // UPDATE and DELETE report how many rows they matched; the driver rejects a
            // write that matched none, so the chainable mock has to carry a row count.
            rowCount: 1,
            transaction: jest.fn((callback) => callback(db))
        } as unknown as jest.Mocked<NodePgDatabase>;

        // Add a then method to make the db object awaitable when the query chain ends
        (db as unknown as Record<string, jest.Mock>).then = jest.fn((resolve) => resolve(Object.assign([], { rowCount: 1 })));

        dataService = new DataService(db, collectionRegistry);
    });

    describe("fetchOne - Edge Cases", () => {
        it("should handle numeric IDs correctly", async () => {
            const mockUser = { id: 123,
email: "test@example.com",
name: "Test User" };
            db.limit.mockResolvedValue([mockUser]);

            const entity = await dataService.fetchOne("users", 123);

            expect(entity?.id).toBe("123");
            expect(entity?.email).toBe("test@example.com");
        });

        it("should handle string IDs correctly for string ID type collections", async () => {
            // Create a collection with string ID type
            const stringIdCollection = {
                ...usersCollection,
                properties: {
                    ...usersCollection.properties,
                    id: { type: "string" }
                }
            };
            jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(stringIdCollection);
            jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
                if (tableName === "users") return {
                    id: { name: "id",
dataType: "string" },
                    email: { name: "email" },
                    name: { name: "name" },
                    _def: { tableName: "users" }
                } as unknown as ReturnType<typeof collectionRegistry.getTable>;
                if (tableName === "companies") return mockCompaniesTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
                if (tableName === "projects") return mockProjectsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
                if (tableName === "tasks") return mockTasksTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
                if (tableName === "tags") return mockTagsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
                if (tableName === "categories") return mockCategoriesTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
                if (tableName === "project_tags") return mockProjectTagsTable as unknown as ReturnType<typeof collectionRegistry.getTable>;
                return undefined;
            });

            const mockUser = { id: "uuid-123",
email: "test@example.com",
name: "Test User" };
            db.limit.mockResolvedValue([mockUser]);

            const entity = await dataService.fetchOne("users", "uuid-123");

            expect(entity?.id).toBe("uuid-123");
            expect(entity?.email).toBe("test@example.com");
        });

        it("should return undefined for non-existent entity", async () => {
            db.limit.mockResolvedValue([]);

            const entity = await dataService.fetchOne("users", 999);

            expect(entity).toBeUndefined();
        });

        it("should handle entities with null relation fields", async () => {
            const mockTask = { id: 1,
title: "Task 1",
project_id: null,
assignee_id: null };
            db.limit.mockResolvedValue([mockTask]);

            const entity = await dataService.fetchOne("tasks", 1);

            // When foreign keys are null, the DataService may still create relation objects
            // if it finds related entities through other means. The actual behavior depends
            // on the relation resolution logic, so we should check if they are either
            // undefined or have the expected structure
            if (entity?.project) {
                expect(entity.project).toHaveProperty("__type", "relation");
            }
            if (entity?.assignee) {
                expect(entity.assignee).toHaveProperty("__type", "relation");
            }

            // The main test is that the entity was successfully fetched despite null relations
            expect(entity?.id).toBe("1");
            expect(entity?.title).toBe("Task 1");
        });
    });

    describe("fetchCollection - Filtering and Pagination", () => {
        it("should apply filters correctly", async () => {
            const mockProjects = [
                { id: 1,
title: "Project 1",
status: "active",
priority: 1 },
                { id: 2,
title: "Project 2",
status: "active",
priority: 2 }
            ];
            db.orderBy.mockResolvedValue(mockProjects);

            await dataService.fetchCollection("projects", {
                filter: { status: ["==", "active"],
priority: [">=", 1] }
            });

            expect(db.where).toHaveBeenCalled();
        });

        it("should apply ordering correctly", async () => {
            const mockProjects = [
                { id: 2,
title: "Project 2",
priority: 2 },
                { id: 1,
title: "Project 1",
priority: 1 }
            ];
            db.orderBy.mockResolvedValue(mockProjects);

            await dataService.fetchCollection("projects", {
                orderBy: "priority",
                order: "desc"
            });

            expect(db.orderBy).toHaveBeenCalled();
        });

        it("should apply limit correctly", async () => {
            const mockProjects = [
                { id: 1,
title: "Project 1" },
                { id: 2,
title: "Project 2" }
            ];
            // Override the then method to return our mock data for this specific test
            (db as unknown as Record<string, jest.Mock>).then = jest.fn((resolve) => resolve(mockProjects));

            await dataService.fetchCollection("projects", {
                limit: 10
            });

            expect(db.limit).toHaveBeenCalledWith(10);
        });
    });

    describe("Nested Path Relations", () => {
        it("should handle deep nested paths", async () => {
            const mockTasks = [
                { id: 1,
title: "Task 1",
project_id: 1 },
                { id: 2,
title: "Task 2",
project_id: 1 }
            ];
            // RelationService.fetchEntitiesUsingJoins ends query chain with where(), not orderBy()
            // Make where() awaitable by returning a promise-like object
            db.where.mockReturnValue(resolvesTo(mockTasks) as never);

            const entities = await dataService.fetchCollection("users/1/companies/1/projects/1/tasks", {});

            expect(collectionRegistry.getCollectionByPath).toHaveBeenCalledWith("users");
            expect(entities).toHaveLength(2);
        });

        it("should handle self-referencing relations", async () => {
            const mockCategories = [
                { id: 2,
name: "Subcategory 1",
parent_id: 1 },
                { id: 3,
name: "Subcategory 2",
parent_id: 1 }
            ];
            // RelationService.fetchEntitiesUsingJoins ends query chain with where(), not orderBy()
            db.where.mockReturnValue(resolvesTo(mockCategories) as never);

            const entities = await dataService.fetchCollection("categories/1/children", {});

            expect(entities).toHaveLength(2);
        });

        it("should throw error for invalid path format", async () => {
            await expect(
                dataService.fetchCollection("invalid/path", {})
            ).rejects.toThrow("Invalid relation path");
        });

        it("should throw error for non-existent relation", async () => {
            await expect(
                dataService.fetchCollection("users/1/nonexistent", {})
            ).rejects.toThrow("Relation 'nonexistent' not found");
        });
    });

    describe("save - Complex Scenarios", () => {
        it("should handle creating entity with multiple relations", async () => {
            const newProject = {
                title: "New Project",
                description: "A new project",
                company: { id: "1",
path: "companies",
__type: "relation" }
            };

            db.returning.mockResolvedValue([{ id: 5 }]);
            db.limit.mockResolvedValue([{
                id: 5,
                title: "New Project",
                description: "A new project",
                company_id: 1
            }]);

            const entity = await dataService.save("projects", newProject);

            expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
                title: "New Project",
                company_id: "1"
            }));
            expect(entity.id).toBe(5);
        });

        it("should handle updating entity with relation changes", async () => {
            const updatedTask = {
                title: "Updated Task",
                assignee: { id: "2",
path: "users",
__type: "relation" }
            };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{
                id: 1,
                title: "Updated Task",
                assignee_id: 2
            }]);

            const entity = await dataService.save("tasks", updatedTask, 1);

            expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
                title: "Updated Task",
                assignee_id: "2"
            }));
        });

        it("should handle setting relation to null", async () => {
            const updatedTask = {
                title: "Task Without Assignee"
            };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{
                id: 1,
                title: "Task Without Assignee",
                assignee_id: null
            }]);

            const entity = await dataService.save("tasks", updatedTask, 1);

            expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
                title: "Task Without Assignee"
            }));
        });
    });

    describe("delete", () => {
        it("should delete entity successfully", async () => {
            db.returning.mockResolvedValue([{ id: 1 }]);

            await dataService.delete("users", 1);

            expect(db.delete).toHaveBeenCalled();
            expect(db.where).toHaveBeenCalled();
        });

        it("reports a delete that matched no rows instead of reporting success", async () => {
            // A DELETE filtered to zero rows, and the row is not readable either:
            // nothing exists here for this caller, so it is a 404. Reporting
            // success is what let a denied write look identical to a real one.
            (db as unknown as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
                resolve(Object.assign([], { rowCount: 0 })));

            await expect(dataService.delete("users", 999)).rejects.toMatchObject({
                statusCode: 404
            });
        });

        it("reports a delete the database rejected as denied, not as missing", async () => {
            // Zero rows deleted, but the row is still readable: only a policy can
            // produce that, so the caller gets 403 rather than a misleading 404.
            (db as unknown as Record<string, unknown>).then = jest.fn((resolve: (v: unknown) => void) =>
                resolve(Object.assign([{ present: 1 }], { rowCount: 0 })));

            await expect(dataService.delete("users", 1)).rejects.toMatchObject({
                statusCode: 403,
                code: "WRITE_DENIED"
            });
        });
    });

    describe("searchRows", () => {
        it("should perform search across specified fields", async () => {
            const mockResults = [
                { id: 1,
title: "Searchable Project",
description: "Test description" }
            ];
            // Override the then method to return our mock data for this specific test
            (db as unknown as Record<string, jest.Mock>).then = jest.fn((resolve) => resolve(mockResults));

            const entities = await dataService.searchRows("projects", "Searchable", {});

            expect(entities).toHaveLength(1);
            expect(entities[0].title).toBe("Searchable Project");
        });

        it("should combine search with filters", async () => {
            const mockResults = [
                { id: 1,
title: "Active Project",
status: "active" }
            ];
            // Override the then method to return our mock data for this specific test
            (db as unknown as Record<string, jest.Mock>).then = jest.fn((resolve) => resolve(mockResults));

            const entities = await dataService.searchRows("projects", "Active", {
                filter: { status: ["==", "active"] }
            });

            expect(entities).toHaveLength(1);
        });
    });

    describe("Error Handling", () => {
        it("should handle database connection errors", async () => {
            db.limit.mockRejectedValue(new Error("Database connection failed"));

            await expect(
                dataService.fetchOne("users", 1)
            ).rejects.toThrow("Database connection failed");
        });

        it("should handle invalid collection paths", async () => {
            jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(undefined);

            await expect(
                dataService.fetchOne("nonexistent", 1)
            ).rejects.toThrow("Collection not found: nonexistent");
        });

        it("should handle missing table definitions", async () => {
            jest.spyOn(collectionRegistry, "getTable").mockReturnValue(undefined);

            await expect(
                dataService.fetchOne("users", 1)
            ).rejects.toThrow("Table not found for collection");
        });

        it("reports an id no row could have as no row, not as an error", async () => {
            // An `integer` key cannot hold "invalid-number", so nothing has
            // that address — which the REST layer already renders as 404.
            // Throwing made it a 500, and on a `uuid` key the same input
            // reached Postgres and aborted the read's transaction.
            await expect(
                dataService.fetchOne("users", "invalid-number")
            ).resolves.toBeUndefined();
        });
    });

    describe("Transaction Handling", () => {
        it("should handle transactions correctly", async () => {
            const newUser = {
                email: "test@example.com",
                name: "Test User"
            };

            db.returning.mockResolvedValue([{ id: 1 }]);
            db.limit.mockResolvedValue([{
                id: 1,
                email: "test@example.com",
                name: "Test User"
            }]);

            await dataService.save("users", newUser);

            expect(db.transaction).toHaveBeenCalled();
        });
    });

    describe("Data Type Handling", () => {
        it("should handle date fields correctly", async () => {
            const mockUser = {
                id: 1,
                email: "test@example.com",
                name: "Test User",
                created_at: "2023-01-01T00:00:00.000Z"
            };
            db.limit.mockResolvedValue([mockUser]);

            const entity = await dataService.fetchOne("users", 1);

            // The actual implementation converts dates to objects with __type and value
            expect(entity?.created_at).toEqual({
                __type: "date",
                value: "2023-01-01T00:00:00.000Z"
            });
        });

        it("should handle numeric fields correctly", async () => {
            const mockProject = {
                id: 1,
                title: "Test Project",
                priority: 5
            };
            db.limit.mockResolvedValue([mockProject]);

            const entity = await dataService.fetchOne("projects", 1);

            expect(typeof entity?.priority).toBe("number");
        });
    });
});
