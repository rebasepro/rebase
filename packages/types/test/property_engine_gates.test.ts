/**
 * Compile-time tests for engine-specific property type gates.
 *
 * These tests verify that the type system correctly restricts which property
 * primitives are available on each engine's collection type:
 *   - Postgres  → relation (no reference)
 *   - Firestore → reference (no relation)
 *   - MongoDB   → reference (no relation)
 *
 * Tests marked with @ts-expect-error verify that invalid combinations are
 * rejected at compile time. The Jest assertions are trivial (always true) —
 * the real value is that `tsc --noEmit` validates the @ts-expect-error
 * annotations: if a line compiles when it shouldn't, tsc reports an error.
 */
import type {
    PostgresCollection,
    FirebaseCollection,
    MongoDBCollection,
    SnapshotCollection,
    PostgresProperties,
    FirebaseProperties,
    MongoProperties,
    Properties,
    ReferenceProperty,
    RelationProperty,
    StringProperty
} from "../src";

describe("Engine-specific property type gates", () => {

    describe("PostgresCollection", () => {

        it("accepts RelationProperty in properties", () => {
            const col: PostgresCollection = {
                slug: "pg_test",
                name: "PG Test",
                table: "pg_test",
                properties: {
                    author: {
                        type: "relation",
                        collectionPath: "authors"
                    }
                }
            };
            expect(col.properties.author.type).toBe("relation");
        });

        it("rejects ReferenceProperty in properties (compile-time)", () => {
            // This SHOULD fail to compile — Postgres doesn't support reference.
            const refProp: ReferenceProperty = {
                type: "reference",
                path: "authors"
            };
            const properties: PostgresProperties = {
                title: { type: "string" },
                // @ts-expect-error — ReferenceProperty is excluded from PostgresProperties
                author_ref: refProp
            };
            // Runtime: this line only runs if tsc is bypassed; just confirm the gate exists
            expect(properties).toBeDefined();
        });
    });

    describe("FirebaseCollection", () => {

        it("accepts ReferenceProperty in properties", () => {
            const col: FirebaseCollection = {
                slug: "fs_test",
                name: "FS Test",
                driver: "firestore",
                properties: {
                    author: {
                        type: "reference",
                        path: "authors"
                    }
                }
            };
            expect(col.properties.author.type).toBe("reference");
        });

        it("rejects RelationProperty in properties (compile-time)", () => {
            const relProp: RelationProperty = {
                type: "relation",
                collectionPath: "authors"
            };
            const properties: FirebaseProperties = {
                title: { type: "string" },
                // @ts-expect-error — RelationProperty is excluded from FirebaseProperties
                author_rel: relProp
            };
            expect(properties).toBeDefined();
        });
    });

    describe("MongoDBCollection", () => {

        it("accepts ReferenceProperty in properties", () => {
            const col: MongoDBCollection = {
                slug: "mongo_test",
                name: "Mongo Test",
                driver: "mongodb",
                properties: {
                    author: {
                        type: "reference",
                        path: "authors"
                    }
                }
            };
            expect(col.properties.author.type).toBe("reference");
        });

        it("rejects RelationProperty in properties (compile-time)", () => {
            const relProp: RelationProperty = {
                type: "relation",
                collectionPath: "authors"
            };
            const properties: MongoProperties = {
                title: { type: "string" },
                // @ts-expect-error — RelationProperty is excluded from MongoProperties
                author_rel: relProp
            };
            expect(properties).toBeDefined();
        });
    });

    describe("StringProperty", () => {

        it("does not have a reference field", () => {
            const sp: StringProperty = {
                type: "string"
            };
            // @ts-expect-error — StringProperty.reference was removed
            const ref = sp.reference;
            expect(ref).toBeUndefined();
        });

        it("still has other expected fields", () => {
            const sp: StringProperty = {
                type: "string",
                email: true,
                url: true,
                previewAsTag: true
            };
            expect(sp.email).toBe(true);
            expect(sp.url).toBe(true);
            expect(sp.previewAsTag).toBe(true);
        });
    });

    describe("SnapshotCollection union", () => {

        it("is the union of all three engine-specific types", () => {
            const pgCol: PostgresCollection = {
                slug: "pg",
                name: "PG",
                table: "pg",
                properties: { title: { type: "string" } }
            };
            const fsCol: FirebaseCollection = {
                slug: "fs",
                name: "FS",
                driver: "firestore",
                properties: { title: { type: "string" } }
            };
            const mongoCol: MongoDBCollection = {
                slug: "mongo",
                name: "Mongo",
                driver: "mongodb",
                properties: { title: { type: "string" } }
            };

            // All three should be assignable to SnapshotCollection
            const collections: SnapshotCollection[] = [pgCol, fsCol, mongoCol];
            expect(collections).toHaveLength(3);
        });
    });
});
