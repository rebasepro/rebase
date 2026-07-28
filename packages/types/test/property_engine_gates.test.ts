/**
 * Compile-time tests for the engine gates on collections and properties.
 *
 * **These assertions only mean anything if `tsc` sees this file.** The Jest
 * bodies are trivially true; the content is in the `@ts-expect-error`
 * directives, which fail the build if the line they mark ever starts
 * compiling. Jest does not typecheck — its transform strips types — so this
 * file is listed in the root `tsconfig.tests.json` and runs as the second half
 * of `pnpm typecheck`.
 *
 * That was not true until now, and the cost is on display in this file's own
 * history: it spent the whole time asserting against `driver: "firestore"`
 * (the field is `engine`), `collectionPath` on a relation (replaced by the
 * `relation` tagged union), `previewAsTag` and `reference` on `StringProperty`
 * (moved to the admin block, and deleted, respectively), and `properties`
 * missing their required `name`. Every one of those is a type error. All of
 * them passed, every run, for as long as the file existed — a green test
 * asserting a shape that had not existed for months.
 *
 * What the gates are:
 *
 * | | Postgres | Firestore | MongoDB |
 * |---|---|---|---|
 * | `relation` property | yes | no | no |
 * | `reference` property | no | yes | yes |
 * | `columnType` / `columnName` | yes | no | no |
 * | `table`, `relations`, `disableDefaultPolicies` | yes | no | no |
 * | `securityRules` | yes (RLS) | no | yes (query filter) |
 */
import type {
    CollectionConfig,
    FirebaseCollectionConfig,
    FirebaseProperties,
    MongoDBCollectionConfig,
    MongoProperties,
    PostgresCollectionConfig,
    PostgresProperties,
    ReferenceProperty,
    RelationProperty,
    StringProperty
} from "../src";

/** A relation's `target` is a thunk, so the tests need something to point at. */
const authorsCollection: PostgresCollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: { name: { name: "Name", type: "string" } }
};

describe("engine gates — property primitives", () => {

    it("Postgres takes `relation`, not `reference`", () => {
        const col: PostgresCollectionConfig = {
            slug: "pg_test",
            name: "PG Test",
            table: "pg_test",
            properties: {
                author: {
                    name: "Author",
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => authorsCollection }
                }
            }
        };
        expect(col.properties.author.type).toBe("relation");

        const refProp: ReferenceProperty = { name: "Author", type: "reference", path: "authors" };
        const properties: PostgresProperties = {
            title: { name: "Title", type: "string" },
            // @ts-expect-error — `reference` is a document-store primitive
            author_ref: refProp
        };
        expect(properties).toBeDefined();
    });

    it("Firestore takes `reference`, not `relation`", () => {
        const col: FirebaseCollectionConfig = {
            slug: "fs_test",
            name: "FS Test",
            engine: "firestore",
            properties: {
                author: { name: "Author", type: "reference", path: "authors" }
            }
        };
        expect(col.properties.author.type).toBe("reference");

        const relProp: RelationProperty = {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: () => authorsCollection }
        };
        const properties: FirebaseProperties = {
            title: { name: "Title", type: "string" },
            // @ts-expect-error — Firestore has no joins
            author_rel: relProp
        };
        expect(properties).toBeDefined();
    });

    it("MongoDB takes `reference`, not `relation`", () => {
        const col: MongoDBCollectionConfig = {
            slug: "mongo_test",
            name: "Mongo Test",
            engine: "mongodb",
            properties: {
                author: { name: "Author", type: "reference", path: "authors" }
            }
        };
        expect(col.properties.author.type).toBe("reference");

        const relProp: RelationProperty = {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: () => authorsCollection }
        };
        const properties: MongoProperties = {
            title: { name: "Title", type: "string" },
            // @ts-expect-error — MongoDB has no joins
            author_rel: relProp
        };
        expect(properties).toBeDefined();
    });
});

describe("engine gates — column fields", () => {

    it("Postgres properties carry columnType and columnName", () => {
        const properties: PostgresProperties = {
            id: { name: "Id", type: "string", columnType: "uuid", isId: "uuid" },
            count: { name: "Count", type: "number", columnType: "bigserial" },
            payload: { name: "Payload", type: "map", columnType: "jsonb" },
            renamed: { name: "Renamed", type: "string", columnName: "legacy_col" }
        };
        expect(Object.keys(properties)).toHaveLength(4);
    });

    it("Firestore properties do not", () => {
        const properties: FirebaseProperties = {
            // @ts-expect-error — Firestore has no columns; `supportsColumnTypes` is false
            id: { name: "Id", type: "string", columnType: "uuid" }
        };
        const renamed: FirebaseProperties = {
            // @ts-expect-error — nothing derives a column name for Firestore
            title: { name: "Title", type: "string", columnName: "legacy_col" }
        };
        expect([properties, renamed]).toHaveLength(2);
    });

    it("MongoDB properties do not", () => {
        const properties: MongoProperties = {
            // @ts-expect-error — MongoDB has no columns; `supportsColumnTypes` is false
            count: { name: "Count", type: "number", columnType: "bigserial" }
        };
        const renamed: MongoProperties = {
            // @ts-expect-error — nothing derives a column name for MongoDB
            title: { name: "Title", type: "string", columnName: "legacy_col" }
        };
        expect([properties, renamed]).toHaveLength(2);
    });

    it("the omit distributes, so `type` still narrows", () => {
        // A non-distributive Omit collapses the union and widens the
        // discriminant, which would make this switch unreachable.
        const p: MongoProperties[string] = { name: "Title", type: "string" };
        if (p.type === "string") {
            const s: Omit<StringProperty, "columnType" | "columnName"> = p;
            expect(s.type).toBe("string");
        }
    });
});

describe("engine gates — collection fields", () => {

    it("Postgres carries table, relations and disableDefaultPolicies", () => {
        const c: PostgresCollectionConfig = {
            slug: "orders",
            name: "Orders",
            table: "orders",
            properties: {},
            relations: [],
            disableDefaultPolicies: true,
            securityRules: [{ ownerField: "user_id" }]
        };
        expect(c.table).toBe("orders");
    });

    it("MongoDB carries none of the three", () => {
        const withTable: MongoDBCollectionConfig = {
            slug: "orders",
            name: "Orders",
            engine: "mongodb",
            properties: {},
            // @ts-expect-error — MongoDB has no tables
            table: "orders"
        };
        const withRelations: MongoDBCollectionConfig = {
            slug: "orders",
            name: "Orders",
            engine: "mongodb",
            properties: {},
            // @ts-expect-error — MongoDB has no joins
            relations: []
        };
        const withOptOut: MongoDBCollectionConfig = {
            slug: "orders",
            name: "Orders",
            engine: "mongodb",
            properties: {},
            // @ts-expect-error — nothing injects default policies for MongoDB
            disableDefaultPolicies: true
        };
        expect([withTable, withRelations, withOptOut]).toHaveLength(3);
    });

    it("Firestore carries none of the three either", () => {
        const c: FirebaseCollectionConfig = {
            slug: "events",
            name: "Events",
            engine: "firestore",
            properties: {},
            // @ts-expect-error — Firestore has no tables
            table: "events"
        };
        expect(c.slug).toBe("events");
    });

    it("securityRules stay driver-agnostic — MongoDB enforces them as a query filter", () => {
        const c: MongoDBCollectionConfig = {
            slug: "orders",
            name: "Orders",
            engine: "mongodb",
            properties: {},
            securityRules: [{ ownerField: "user_id" }]
        };
        expect(c.securityRules).toHaveLength(1);
    });
});

describe("the CollectionConfig union", () => {

    it("admits all three engines", () => {
        const pgCol: PostgresCollectionConfig = {
            slug: "pg",
            name: "PG",
            table: "pg",
            properties: { title: { name: "Title", type: "string" } }
        };
        const fsCol: FirebaseCollectionConfig = {
            slug: "fs",
            name: "FS",
            engine: "firestore",
            properties: { title: { name: "Title", type: "string" } }
        };
        const mongoCol: MongoDBCollectionConfig = {
            slug: "mongo",
            name: "Mongo",
            engine: "mongodb",
            properties: { title: { name: "Title", type: "string" } }
        };

        const collections: CollectionConfig[] = [pgCol, fsCol, mongoCol];
        expect(collections).toHaveLength(3);
    });
});
