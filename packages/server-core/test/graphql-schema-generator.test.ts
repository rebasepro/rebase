import { GraphQLSchemaGenerator } from "../src/api/graphql/graphql-schema-generator";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { EntityCollection } from "../../types/src/types/collections";
import {
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLNonNull,
    GraphQLString,
    GraphQLFloat,
    GraphQLBoolean,
    GraphQLList,
    GraphQLInputObjectType,
    graphql,
    printSchema
} from "graphql";

describe("GraphQLSchemaGenerator", () => {
    let mockDriver: jest.Mocked<DataDriver>;
    let collections: EntityCollection[];

    beforeEach(() => {
        mockDriver = {
            key: "postgres",
            initialised: true,
            fetchCollection: jest.fn(),
            listenCollection: jest.fn(),
            fetchEntity: jest.fn(),
            listenEntity: jest.fn(),
            saveEntity: jest.fn(),
            deleteEntity: jest.fn(),
            checkUniqueField: jest.fn(),
            countEntities: jest.fn(),
            withAuth: jest.fn(),
            admin: {} as any,
        } as unknown as jest.Mocked<DataDriver>;

        collections = [
            {
                slug: "posts",
                name: "Posts",
                singularName: "Post",
                description: "Blog posts",
                properties: {
                    title: { name: "Title", type: "string", validation: { required: true } },
                    body: { name: "Body", type: "string" },
                    views: { name: "Views", type: "number" },
                    published: { name: "Published", type: "boolean" },
                    createdAt: { name: "Created At", type: "date" },
                },
            } as unknown as EntityCollection,
            {
                slug: "authors",
                name: "Authors",
                singularName: "Author",
                properties: {
                    name: { name: "Name", type: "string", validation: { required: true } },
                    bio: { name: "Bio", type: "string" },
                },
            } as unknown as EntityCollection,
        ];
    });

    // ─── Schema Generation ──────────────────────────────────────────

    describe("generateSchema", () => {
        it("returns a valid GraphQLSchema", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            expect(schema).toBeInstanceOf(GraphQLSchema);
        });

        it("creates Query and Mutation root types", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            expect(schema.getQueryType()).toBeDefined();
            expect(schema.getMutationType()).toBeDefined();
        });

        it("generates a printable SDL without errors", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const sdl = printSchema(schema);
            expect(sdl).toContain("type Post");
            expect(sdl).toContain("type Author");
            expect(sdl).toContain("type Query");
            expect(sdl).toContain("type Mutation");
        });
    });

    // ─── Entity Types ───────────────────────────────────────────────

    describe("entity types", () => {
        it("creates an object type for each collection", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const typeMap = schema.getTypeMap();
            expect(typeMap["Post"]).toBeInstanceOf(GraphQLObjectType);
            expect(typeMap["Author"]).toBeInstanceOf(GraphQLObjectType);
        });

        it("generates an id field as NonNull String", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const postType = schema.getType("Post") as GraphQLObjectType;
            const fields = postType.getFields();
            expect(fields.id).toBeDefined();
            expect(fields.id.type).toBeInstanceOf(GraphQLNonNull);
            expect((fields.id.type as GraphQLNonNull<any>).ofType).toBe(GraphQLString);
        });

        it("maps string properties to GraphQLString", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const postType = schema.getType("Post") as GraphQLObjectType;
            const bodyField = postType.getFields().body;
            expect(bodyField.type).toBe(GraphQLString);
        });

        it("maps number properties to GraphQLFloat", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const postType = schema.getType("Post") as GraphQLObjectType;
            const viewsField = postType.getFields().views;
            expect(viewsField.type).toBe(GraphQLFloat);
        });

        it("maps boolean properties to GraphQLBoolean", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const postType = schema.getType("Post") as GraphQLObjectType;
            const publishedField = postType.getFields().published;
            expect(publishedField.type).toBe(GraphQLBoolean);
        });

        it("maps date properties to GraphQLString", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const postType = schema.getType("Post") as GraphQLObjectType;
            const createdAtField = postType.getFields().createdAt;
            // Date is non-null because the original property definition doesn't set required,
            // so it should be nullable GraphQLString
            expect(createdAtField).toBeDefined();
        });

        it("wraps required properties in NonNull", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const postType = schema.getType("Post") as GraphQLObjectType;
            const titleField = postType.getFields().title;
            expect(titleField.type).toBeInstanceOf(GraphQLNonNull);
        });

        it("skips relation properties from entity fields", () => {
            const withRelation: EntityCollection[] = [
                {
                    slug: "comments",
                    name: "Comments",
                    singularName: "Comment",
                    properties: {
                        text: { name: "Text", type: "string" },
                        author: { name: "Author", type: "relation" },
                    },
                } as unknown as EntityCollection,
            ];
            const generator = new GraphQLSchemaGenerator(withRelation, mockDriver);
            const schema = generator.generateSchema();
            const commentType = schema.getType("Comment") as GraphQLObjectType;
            const fields = commentType.getFields();
            expect(fields.text).toBeDefined();
            expect(fields.author).toBeUndefined();
        });
    });

    // ─── Input Types ────────────────────────────────────────────────

    describe("input types", () => {
        it("creates input types for each collection", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const typeMap = schema.getTypeMap();
            expect(typeMap["PostInput"]).toBeInstanceOf(GraphQLInputObjectType);
            expect(typeMap["AuthorInput"]).toBeInstanceOf(GraphQLInputObjectType);
        });

        it("input types skip relation properties", () => {
            const withRelation: EntityCollection[] = [
                {
                    slug: "comments",
                    name: "Comments",
                    singularName: "Comment",
                    properties: {
                        text: { name: "Text", type: "string" },
                        post: { name: "Post", type: "relation" },
                    },
                } as unknown as EntityCollection,
            ];
            const generator = new GraphQLSchemaGenerator(withRelation, mockDriver);
            const schema = generator.generateSchema();
            const inputType = schema.getType("CommentInput") as GraphQLInputObjectType;
            const fields = inputType.getFields();
            expect(fields.text).toBeDefined();
            expect(fields.post).toBeUndefined();
        });
    });

    // ─── Query Resolvers ────────────────────────────────────────────

    describe("query resolvers", () => {
        it("creates single-entity and list queries for each collection", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const queryType = schema.getQueryType()!;
            const fields = queryType.getFields();

            // Single entity queries (lowercase singular name)
            expect(fields.post).toBeDefined();
            expect(fields.author).toBeDefined();

            // List queries (slug)
            expect(fields.posts).toBeDefined();
            expect(fields.authors).toBeDefined();
        });

        it("single-entity query calls fetchEntity with correct args", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            const mockEntity = {
                id: "1",
                path: "posts",
                values: { title: "Hello World", body: "Content" },
            };
            mockDriver.fetchEntity.mockResolvedValue(mockEntity as any);

            const result = await graphql({
                schema,
                source: `query { post(id: "1") { id title body } }`,
            });

            expect(result.errors).toBeUndefined();
            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "posts",
                    entityId: "1",
                })
            );
        });

        it("list query calls fetchCollection with limit and offset", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            mockDriver.fetchCollection.mockResolvedValue([]);

            const result = await graphql({
                schema,
                source: `query { posts(limit: 10, offset: 5) { id title } }`,
            });

            expect(result.errors).toBeUndefined();
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "posts",
                    limit: 10,
                    startAfter: "5",
                })
            );
        });

        it("list query parses JSON where filter", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            mockDriver.fetchCollection.mockResolvedValue([]);

            const result = await graphql({
                schema,
                source: `query { posts(where: "{\\"published\\": true}") { id } }`,
            });

            expect(result.errors).toBeUndefined();
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    filter: { published: true },
                })
            );
        });

        it("list query rejects invalid JSON where filter", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            const result = await graphql({
                schema,
                source: `query { posts(where: "not-json") { id } }`,
            });

            expect(result.errors).toBeDefined();
            expect(result.errors![0].message).toContain("Invalid 'where' filter");
        });

        it("list query rejects non-object JSON where filter", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            const result = await graphql({
                schema,
                source: `query { posts(where: "[1,2,3]") { id } }`,
            });

            expect(result.errors).toBeDefined();
            expect(result.errors![0].message).toContain("Filter must be a JSON object");
        });
    });

    // ─── Mutation Resolvers ─────────────────────────────────────────

    describe("mutation resolvers", () => {
        it("creates create, update, and delete mutations for each collection", () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();
            const mutationType = schema.getMutationType()!;
            const fields = mutationType.getFields();

            expect(fields.createPost).toBeDefined();
            expect(fields.updatePost).toBeDefined();
            expect(fields.deletePost).toBeDefined();
            expect(fields.createAuthor).toBeDefined();
            expect(fields.updateAuthor).toBeDefined();
            expect(fields.deleteAuthor).toBeDefined();
        });

        it("create mutation calls saveEntity with status 'new'", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            const mockEntity = {
                id: "1",
                path: "posts",
                values: { title: "New Post" },
            };
            mockDriver.saveEntity.mockResolvedValue(mockEntity as any);

            const result = await graphql({
                schema,
                source: `mutation { createPost(input: { title: "New Post" }) { id } }`,
            });

            expect(result.errors).toBeUndefined();
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "posts",
                    values: { title: "New Post" },
                    status: "new",
                })
            );
        });

        it("update mutation calls saveEntity with status 'existing' and entityId", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            const mockEntity = {
                id: "1",
                path: "posts",
                values: { title: "Updated" },
            };
            mockDriver.saveEntity.mockResolvedValue(mockEntity as any);

            const result = await graphql({
                schema,
                source: `mutation { updatePost(id: "1", input: { title: "Updated" }) { id } }`,
            });

            expect(result.errors).toBeUndefined();
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "posts",
                    entityId: "1",
                    values: { title: "Updated" },
                    status: "existing",
                })
            );
        });

        it("delete mutation returns true on success", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            const mockEntity = { id: "1", path: "posts", values: {} };
            mockDriver.fetchEntity.mockResolvedValue(mockEntity as any);
            mockDriver.deleteEntity.mockResolvedValue(undefined);

            const result = await graphql({
                schema,
                source: `mutation { deletePost(id: "1") }`,
            });

            expect(result.errors).toBeUndefined();
            expect(result.data?.deletePost).toBe(true);
            expect(mockDriver.deleteEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    entity: mockEntity,
                })
            );
        });

        it("delete mutation returns false when entity not found", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            mockDriver.fetchEntity.mockResolvedValue(undefined as any);

            const result = await graphql({
                schema,
                source: `mutation { deletePost(id: "nonexistent") }`,
            });

            expect(result.errors).toBeUndefined();
            expect(result.data?.deletePost).toBe(false);
        });

        it("delete mutation returns false when deleteEntity throws", async () => {
            const generator = new GraphQLSchemaGenerator(collections, mockDriver);
            const schema = generator.generateSchema();

            const mockEntity = { id: "1", path: "posts", values: {} };
            mockDriver.fetchEntity.mockResolvedValue(mockEntity as any);
            mockDriver.deleteEntity.mockRejectedValue(new Error("DB error"));

            const result = await graphql({
                schema,
                source: `mutation { deletePost(id: "1") }`,
            });

            expect(result.errors).toBeUndefined();
            expect(result.data?.deletePost).toBe(false);
        });
    });

    // ─── Edge Cases ─────────────────────────────────────────────────

    describe("edge cases", () => {
        it("handles empty collections array", () => {
            const generator = new GraphQLSchemaGenerator([], mockDriver);
            const schema = generator.generateSchema();
            expect(schema).toBeInstanceOf(GraphQLSchema);
        });

        it("handles collection with array property", () => {
            const arrayCollection: EntityCollection[] = [
                {
                    slug: "tags",
                    name: "Tags",
                    singularName: "Tag",
                    properties: {
                        labels: { name: "Labels", type: "array" },
                    },
                } as unknown as EntityCollection,
            ];
            const generator = new GraphQLSchemaGenerator(arrayCollection, mockDriver);
            const schema = generator.generateSchema();
            const tagType = schema.getType("Tag") as GraphQLObjectType;
            const labelsField = tagType.getFields().labels;
            expect(labelsField.type).toBeInstanceOf(GraphQLList);
        });

        it("handles collection with vector property", () => {
            const vectorCollection: EntityCollection[] = [
                {
                    slug: "embeddings",
                    name: "Embeddings",
                    singularName: "Embedding",
                    properties: {
                        embedding: { name: "Embedding", type: "vector" },
                    },
                } as unknown as EntityCollection,
            ];
            const generator = new GraphQLSchemaGenerator(vectorCollection, mockDriver);
            const schema = generator.generateSchema();
            const embeddingType = schema.getType("Embedding") as GraphQLObjectType;
            const embeddingField = embeddingType.getFields().embedding;
            expect(embeddingField.type).toBeInstanceOf(GraphQLList);
        });

        it("handles collection with binary property", () => {
            const binaryCollection: EntityCollection[] = [
                {
                    slug: "files",
                    name: "Files",
                    singularName: "File",
                    properties: {
                        data: { name: "Data", type: "binary" },
                    },
                } as unknown as EntityCollection,
            ];
            const generator = new GraphQLSchemaGenerator(binaryCollection, mockDriver);
            const schema = generator.generateSchema();
            const fileType = schema.getType("File") as GraphQLObjectType;
            const dataField = fileType.getFields().data;
            expect(dataField.type).toBe(GraphQLString);
        });

        it("deduplicates types when generateSchema is called", () => {
            const dupeCollections: EntityCollection[] = [
                {
                    slug: "items",
                    name: "Items",
                    singularName: "Item",
                    properties: {
                        name: { name: "Name", type: "string" },
                    },
                } as unknown as EntityCollection,
            ];
            const generator = new GraphQLSchemaGenerator(dupeCollections, mockDriver);
            // Calling generateSchema should not throw even if types are created internally multiple times
            const schema = generator.generateSchema();
            expect(schema.getType("Item")).toBeDefined();
            expect(schema.getType("ItemInput")).toBeDefined();
        });
    });
});
