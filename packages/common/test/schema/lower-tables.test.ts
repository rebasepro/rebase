import { describe, expect, it } from "@jest/globals";
import {
    col,
    defineAuthTable,
    defineTable,
    defineView,
    json,
    rel,
    type AnyTableDef,
    type AnyViewDef,
    type PostgresCollectionConfig,
    type RebaseCallContext,
    type SecurityRule,
    type TableDescriptor
} from "@rebasepro/types";

import { PENDING_TABLE_FEATURES, lowerTables, type PendingTableFeatureId } from "../../src/schema/lower-tables";
import { SchemaDefinitionError, isSchemaDefinitionError } from "../../src/schema/errors";
import { createCallContext } from "../../src/data/call-context";

const id = col.uuid().primaryKey().defaultRandom();

/** One table holding one column under test, lowered. */
function lowerColumn(column: Parameters<typeof defineTable>[1]["columns"][string]): unknown {
    const [lowered] = lowerTables([defineTable("t", { columns: { id, c: column }, rls: "admin-only" })]);
    return lowered.properties.c;
}

function only(defs: (AnyTableDef | AnyViewDef)[], options: Parameters<typeof lowerTables>[1] = {}): PostgresCollectionConfig {
    return lowerTables(defs, options)[0];
}

/** The problems a lowering is refused with. */
function refusal(run: () => unknown): string[] {
    try {
        run();
    } catch (error) {
        if (isSchemaDefinitionError(error)) return error.problems.map(problem => `${problem.table}${problem.key ? `.${problem.key}` : ""}: ${problem.message}`);
        throw error;
    }
    throw new Error("expected a SchemaDefinitionError");
}

describe("lowerTables — columns", () => {
    it.each<[string, Parameters<typeof lowerColumn>[0], unknown]>([
        ["text", col.text(), { type: "string" }],
        ["text notNull unique", col.text().notNull().unique(), { type: "string", validation: { required: true, unique: true } }],
        ["varchar(n) carries n as `validation.max`", col.varchar(100), { type: "string", columnType: "varchar", validation: { max: 100 } }],
        ["varchar() is 255, which the planner derives", col.varchar(), { type: "string", columnType: "varchar" }],
        ["varchar(255) with an explicit max", col.varchar(255).validate({ max: 255 }), { type: "string", columnType: "varchar", validation: { max: 255 } }],
        ["char(n)", col.char(3), { type: "string", columnType: "char", validation: { max: 3 } }],
        ["uuid", col.uuid(), { type: "string", columnType: "uuid" }],
        ["uuid defaultRandom outside the key", col.uuid().defaultRandom(), { type: "string", columnType: "uuid", databaseDefault: "sql`gen_random_uuid()`" }],
        ["enum", col.enum(["a", "b"]).default("a"), { type: "string", enum: [{ id: "a", label: "a" }, { id: "b", label: "b" }], defaultValue: "a" }],
        ["enum named <table>_<column>", col.enum(["a"], { name: "t_c" }), { type: "string", enum: [{ id: "a", label: "a" }] }],
        ["string rules", col.text().validate({ min: 1, max: 9, length: 4, matches: /^a/i, matchesMessage: "m", trim: true, lowercase: true, uppercase: false, requiredMessage: "r" }),
            { type: "string", validation: { min: 1, max: 9, length: 4, matches: /^a/i, matchesMessage: "m", trim: true, lowercase: true, uppercase: false, requiredMessage: "r" } }],
        ["string pattern without flags stays a string", col.text().validate({ matches: "^a" }), { type: "string", validation: { matches: "^a" } }],
        ["email and url are property flags", col.text().validate({ email: true, url: true }), { type: "string", email: true, url: true }],
        ["onCreateUser", col.uuid().onCreateUser(), { type: "string", columnType: "uuid", autoValue: "user_on_create" }],
        ["onUpdateUser", col.text().onUpdateUser(), { type: "string", autoValue: "user_on_update" }],
        ["defaultSql", col.text().defaultSql("gen_short_id()"), { type: "string", databaseDefault: "sql`gen_short_id()`" }],
        ["dbDefault", col.text().dbDefault(), { type: "string", databaseDefault: true }],
        ["private", col.text().private(), { type: "string", excludeFromApi: true }],
        ["private wins over readOnly", col.text().readOnly().private(), { type: "string", excludeFromApi: true }],
        ["readOnly", col.text().readOnly(), { type: "string", access: { write: [] } }],
        ["readOnly merged with access", col.text().access({ read: ["hr"], write: ["hr"] }).readOnly(), { type: "string", access: { read: ["hr"], write: [] } }],
        ["access", col.text().access({ read: ["hr"] }), { type: "string", access: { read: ["hr"] } }],
        ["describe", col.text().describe("What it is"), { type: "string", description: "What it is" }],
        [".column() renames", col.text().column("legacy_name"), { type: "string", columnName: "legacy_name" }],
        [".column() equal to the derived name is left out", col.text().column("c"), { type: "string" }],
        ["storage", col.storage({ path: "p/", accept: ["image/*"], maxBytes: "1KB", source: "media", public: true, fileName: "{f}", metadata: { a: 1 }, includeBucketUrl: true, storeUrl: false, imageResize: { maxWidth: 5 } }),
            { type: "string", storage: { storagePath: "p/", acceptedFiles: ["image/*"], maxSize: 1024, storageSource: "media", public: true, fileName: "{f}", metadata: { a: 1 }, includeBucketUrl: true, storeUrl: false, imageResize: { maxWidth: 5 } } }],
        ["storage multiple", col.storage({ path: "p/" }).multiple(), { type: "array", columnType: "text[]", of: { type: "string", storage: { storagePath: "p/" } } }],
        ["integer", col.integer(), { type: "number", columnType: "integer" }],
        ["integer with the integer rule infers its type", col.integer().validate({ integer: true }), { type: "number", validation: { integer: true } }],
        ["smallint", col.smallint(), { type: "number", columnType: "smallint" }],
        ["bigint", col.bigint(), { type: "number", columnType: "bigint" }],
        ["smallserial", col.smallserial(), { type: "number", columnType: "smallserial" }],
        ["serial", col.serial(), { type: "number", columnType: "serial" }],
        ["bigserial", col.bigserial(), { type: "number", columnType: "bigserial" }],
        ["real", col.real(), { type: "number", columnType: "real" }],
        ["doublePrecision", col.doublePrecision(), { type: "number", columnType: "double precision" }],
        ["numeric is inferred", col.numeric(), { type: "number" }],
        ["numeric(p, s)", col.numeric(10, 2), { type: "number", precision: 10, scale: 2 }],
        ["numeric with the integer rule names its type", col.numeric().validate({ integer: true }), { type: "number", columnType: "numeric", validation: { integer: true } }],
        ["number oneOf is an enum without a type", col.integer().oneOf([1, 2]), { type: "number", columnType: "integer", enum: [{ id: 1, label: "1" }, { id: 2, label: "2" }] }],
        ["number rules and default", col.integer().validate({ min: 0, max: 9, lessThan: 10, moreThan: -1, positive: true, negative: false }).default(3),
            { type: "number", columnType: "integer", validation: { min: 0, max: 9, lessThan: 10, moreThan: -1, positive: true, negative: false }, defaultValue: 3 }],
        ["boolean default", col.boolean().notNull().default(false), { type: "boolean", validation: { required: true }, defaultValue: false }],
        ["timestamptz", col.timestamptz(), { type: "date" }],
        ["date default kept as written", col.date().default("2024-12-25"), { type: "date", columnType: "date", defaultValue: "2024-12-25" }],
        ["time", col.time().default("09:00"), { type: "date", columnType: "time", defaultValue: "09:00" }],
        ["onCreateNow", col.timestamptz().onCreateNow(), { type: "date", autoValue: "on_create" }],
        ["onUpdateNow", col.timestamptz().notNull().onUpdateNow(), { type: "date", autoValue: "on_update", validation: { required: true } }],
        ["date bounds", col.timestamptz().validate({ min: "2020-01-01T00:00:00.000Z" }), { type: "date", validation: { min: new Date("2020-01-01T00:00:00.000Z") } }],
        ["jsonb", col.jsonb(), { type: "map" }],
        ["json", col.json(), { type: "map", columnType: "json" }],
        ["jsonb default", col.jsonb<{ a: number }>().default({ a: 1 }), { type: "map", defaultValue: { a: 1 } }],
        ["json.object", col.jsonb(json.object({ a: json.string().required().validate({ max: 3 }), n: json.number().oneOf([1]) })),
            { type: "map", properties: { a: { type: "string", validation: { required: true, max: 3 } }, n: { type: "number", enum: [{ id: 1, label: "1" }] } } }],
        ["json.object additional", col.jsonb(json.object({}, { additional: true })), { type: "map", keyValue: true }],
        ["json nested kinds", col.jsonb(json.object({
            b: json.boolean().default(true),
            d: json.date().onCreateNow(),
            g: json.geopoint(),
            s: json.storage({ path: "x/" }),
            o: json.object({ deep: json.string() }),
            a: json.array(json.number()).validate({ maxItems: 2 })
        })), {
            type: "map",
            properties: {
                b: { type: "boolean", defaultValue: true },
                d: { type: "date", autoValue: "on_create" },
                g: { type: "geopoint" },
                s: { type: "string", storage: { storagePath: "x/" } },
                o: { type: "map", properties: { deep: { type: "string" } } },
                a: { type: "array", of: { type: "number" }, validation: { max: 2 } }
            }
        }],
        ["json.array names its column type", col.jsonb(json.array(json.string())), { type: "array", columnType: "jsonb", of: { type: "string" } }],
        ["json.array on json", col.json(json.array(json.date())), { type: "array", columnType: "json", of: { type: "date" } }],
        ["json.array of anything", col.jsonb(json.array(json.unknown())).validate({}), { type: "array", columnType: "jsonb" }],
        ["json.array of oneOf", col.jsonb(json.array(json.oneOf({ text: json.string() }, { typeField: "kind" }))),
            { type: "array", columnType: "jsonb", oneOf: { properties: { text: { type: "string" } }, typeField: "kind" } }],
        ["col.array(text)", col.array(col.text().oneOf(["x"])).validate({ minItems: 1, maxItems: 2 }),
            { type: "array", columnType: "text[]", of: { type: "string", enum: [{ id: "x", label: "x" }] }, validation: { min: 1, max: 2 } }],
        ["col.array(integer)", col.array(col.integer().validate({ min: 0 })), { type: "array", columnType: "integer[]", of: { type: "number", validation: { min: 0 } } }],
        ["col.array(boolean)", col.array(col.boolean()), { type: "array", columnType: "boolean[]", of: { type: "boolean" } }],
        ["col.array(numeric)", col.array(col.numeric()).default([1]), { type: "array", columnType: "numeric[]", of: { type: "number" }, defaultValue: [1] }],
        ["geopoint", col.geopoint().default({ latitude: 1, longitude: 2 }), { type: "geopoint", defaultValue: { latitude: 1, longitude: 2 } }],
        ["vector", col.vector(3), { type: "vector", dimensions: 3 }],
        ["vector index, `ip` is `inner_product`", col.vector(3, { index: { method: "hnsw", metric: ["cosine", "ip"], m: 8, efConstruction: 32 } }),
            { type: "vector", dimensions: 3, index: { method: "hnsw", distance: ["cosine", "inner_product"], m: 8, efConstruction: 32 } }],
        ["vector single metric", col.vector(3, { index: { method: "ivfflat", metric: "l2", lists: 4 } }), { type: "vector", dimensions: 3, index: { method: "ivfflat", distance: "l2", lists: 4 } }],
        ["vector index false", col.vector(3, { index: false }), { type: "vector", dimensions: 3, index: false }],
        ["bytea", col.bytea().unique(), { type: "binary", validation: { unique: true } }]
    ])("%s", (_name, column, expected) => {
        expect(lowerColumn(column)).toEqual(expected);
    });

    it("lowers the key strategies onto `isId`", () => {
        const all = lowerTables([
            defineTable("a", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" }),
            defineTable("b", { columns: { id: col.integer().primaryKey().identity() }, rls: "admin-only" }),
            defineTable("c", { columns: { code: col.text().primaryKey() }, rls: "admin-only" }),
            defineTable("d", { columns: { id: col.text().primaryKey().defaultSql("gen_id()") }, rls: "admin-only" }),
            defineTable("e", { columns: { n: col.integer().primaryKey(), u: col.uuid().primaryKey() }, rls: "admin-only" }),
            defineTable("f", { columns: { day: col.date().primaryKey(), n: col.numeric().primaryKey() }, rls: "admin-only" })
        ]);
        expect(all.map(collection => collection.properties)).toEqual([
            { id: { type: "string", isId: "uuid" } },
            { id: { type: "number", isId: "increment" } },
            { code: { type: "string", isId: true } },
            { id: { type: "string", isId: "sql`gen_id()`" } },
            { n: { type: "number", isId: true }, u: { type: "string", columnType: "uuid", isId: true } },
            { day: { type: "date", columnType: "date", isId: true }, n: { type: "number", columnType: "numeric", isId: true } }
        ]);
    });

    it("leaves out the planner's implicit key, when it is declared first", () => {
        const implicit = col.text().primaryKey().defaultSql("gen_random_uuid()::text");
        const [first, later] = lowerTables([
            defineTable("a", { columns: { id: implicit, body: col.text() }, rls: "admin-only" }),
            defineTable("b", { columns: { body: col.text(), id: implicit }, rls: "admin-only" })
        ]);
        expect(first.properties).toEqual({ body: { type: "string" } });
        expect(later.properties).toEqual({ body: { type: "string" }, id: { type: "string", isId: "sql`gen_random_uuid()::text`" } });
    });

    it("lowers `.transform()` to property callbacks that call it with the table's descriptor", async () => {
        const descriptor = { slug: "t" } as const;
        const seen: unknown[] = [];
        const table = defineTable("t", {
            columns: {
                id,
                c: col.text().transform({
                    beforeSave: props => { seen.push(["beforeSave", props.table, props.value, props.previousValue, props.values]); return props.value.trim(); },
                    afterRead: props => { seen.push(["afterRead", props.table, props.value, props.values]); return props.value.toUpperCase(); }
                })
            },
            rls: "admin-only"
        });
        const tableDescriptor: TableDescriptor = { ...minimalDescriptor(), ...descriptor };
        const [lowered] = lowerTables([table], { describe: slug => (slug === "t" ? tableDescriptor : undefined) });
        const property = lowered.properties.c;
        const context = callContext();
        expect(await property.callbacks?.beforeSave?.({ collection: lowered, path: "t", status: "new", context, value: " x ", previousValue: undefined, values: { c: " x " } })).toBe("x");
        expect(await property.callbacks?.afterRead?.({ collection: lowered, path: "t", context, row: { c: "x" }, value: "x" })).toBe("X");
        expect(seen).toEqual([
            ["beforeSave", tableDescriptor, " x ", undefined, { c: " x " }],
            ["afterRead", tableDescriptor, "x", { c: "x" }]
        ]);
    });
});

describe("lowerTables — relations", () => {
    const users = defineTable("users", { columns: { id }, rls: "admin-only" });
    const counters = defineTable("counters", { columns: { id: col.integer().primaryKey().identity() }, rls: "admin-only" });

    it("plans a bound plain foreign key where its column was declared", () => {
        const posts = defineTable("posts", {
            columns: { id, title: col.text(), authorId: col.uuid().notNull().unique(), body: col.text() },
            relations: { author: rel.belongsTo(() => users, { localKey: "author_id", onDelete: "cascade", onUpdate: "restrict" }) },
            rls: "admin-only"
        });
        const lowered = only([posts, users]);
        expect(Object.keys(lowered.properties)).toEqual(["id", "title", "author", "body"]);
        expect(lowered.properties.author).toEqual({ type: "relation", validation: { required: true, unique: true } });
        expect(lowered.relations).toEqual([
            { kind: "belongsTo", relationName: "author", target: expect.any(Function), localKey: "author_id", onDelete: "cascade", onUpdate: "restrict" }
        ]);
    });

    it("keeps a bound column that is more than a foreign key, the relation carrying the constraint", () => {
        const posts = defineTable("posts", {
            columns: { id, authorRef: col.uuid().column("author_id").describe("who"), body: col.text() },
            relations: { author: rel.belongsTo(() => users, { localKey: "author_id", index: false }) },
            rls: "admin-only"
        });
        const lowered = only([posts, users]);
        expect(Object.keys(lowered.properties)).toEqual(["id", "authorRef", "body", "author"]);
        expect(lowered.properties.authorRef).toEqual({ type: "string", columnType: "uuid", columnName: "author_id", description: "who" });
        expect(lowered.properties.author).toEqual({ type: "relation" });
        expect(lowered.relations?.[0]).toEqual({ kind: "belongsTo", relationName: "author", target: expect.any(Function), localKey: "author_id", index: false });
    });

    it("keeps a bound column whose type is not the target's key type", () => {
        const posts = defineTable("posts", {
            columns: { id, counterId: col.bigint() },
            relations: { counter: rel.belongsTo(() => counters) },
            rls: "admin-only"
        });
        expect(Object.keys(only([posts, counters]).properties)).toEqual(["id", "counterId", "counter"]);
        const plain = defineTable("plain", { columns: { id, counterId: col.integer() }, relations: { counter: rel.belongsTo(() => counters) }, rls: "admin-only" });
        expect(Object.keys(only([plain, counters]).properties)).toEqual(["id", "counter"]);
    });

    it("derives a foreign key after the declared columns", () => {
        const posts = defineTable("posts", {
            columns: { id, title: col.text() },
            relations: { author: rel.belongsTo(() => users, { notNull: true, unique: true }) },
            rls: "admin-only"
        });
        const lowered = only([posts, users]);
        expect(lowered.properties).toEqual({ id: { type: "string", isId: "uuid" }, title: { type: "string" }, author: { type: "relation", validation: { required: true, unique: true } } });
        expect(lowered.relations?.[0]).toEqual({ kind: "belongsTo", relationName: "author", target: expect.any(Function) });
    });

    it("lowers an unconstrained key to a relation no property addresses, over the column it binds", () => {
        const posts = defineTable("posts", {
            columns: { id, authorId: col.uuid() },
            relations: { author: rel.belongsTo(() => users, { constraint: false, index: false }) },
            rls: "admin-only"
        });
        const lowered = only([posts, users]);
        expect(lowered.properties).toEqual({ id: { type: "string", isId: "uuid" }, authorId: { type: "string", columnType: "uuid" } });
        expect(lowered.relations).toEqual([{ kind: "belongsTo", relationName: "author", target: expect.any(Function), index: false }]);
    });

    it("lowers the other kinds under the legacy names", () => {
        const tags = defineTable("tags", { columns: { id }, rls: "admin-only" });
        const posts = defineTable("posts", {
            columns: { id },
            relations: {
                comments: rel.hasMany(() => tags, { foreignKey: "post_ref", sourceKey: "id" }),
                cover: rel.hasOne(() => tags),
                tags: rel.manyToMany(() => tags, { through: "post_tags", sourceKey: "p", targetKey: "t", pivot: { position: col.integer().default(0) }, onDelete: "restrict" }),
                plain: rel.manyToMany(() => tags),
                path: rel.via(() => tags, { steps: [{ table: "post_tags", on: { from: "id", to: "p" } }] }),
                one: rel.via(() => tags, { steps: [{ table: "tags", on: { from: "id", to: "id" } }], cardinality: "one" })
            },
            rls: "admin-only"
        });
        const lowered = only([posts, tags]);
        expect(lowered.properties).toEqual({
            id: { type: "string", isId: "uuid" },
            comments: { type: "relation" },
            cover: { type: "relation" },
            tags: { type: "relation" },
            plain: { type: "relation" },
            path: { type: "relation" },
            one: { type: "relation" }
        });
        expect(lowered.relations).toEqual([
            { kind: "hasMany", relationName: "comments", target: expect.any(Function), foreignKeyOnTarget: "post_ref", sourceKey: "id" },
            { kind: "hasOne", relationName: "cover", target: expect.any(Function) },
            {
                kind: "manyToMany", relationName: "tags", target: expect.any(Function), onDelete: "restrict",
                through: { table: "post_tags", sourceColumn: "p", targetColumn: "t", properties: { position: { type: "number", columnType: "integer", defaultValue: 0 } } }
            },
            { kind: "manyToMany", relationName: "plain", target: expect.any(Function) },
            { kind: "via", relationName: "path", target: expect.any(Function), cardinality: "many", joinPath: [{ table: "post_tags", on: { from: "id", to: "p" } }] },
            { kind: "via", relationName: "one", target: expect.any(Function), cardinality: "one", joinPath: [{ table: "tags", on: { from: "id", to: "id" } }] }
        ]);
    });

    it("returns the same lowered object from every thunk, and lowers a target outside the set on first use", () => {
        const posts = defineTable("posts", { columns: { id }, relations: { author: rel.belongsTo(() => users), editor: rel.belongsTo(() => users) }, rls: "admin-only" });
        const [loweredPosts, loweredUsers] = lowerTables([posts, users]);
        expect(loweredPosts.relations?.[0].target()).toBe(loweredUsers);
        expect(loweredPosts.relations?.[1].target()).toBe(loweredUsers);
        const [alone] = lowerTables([posts]);
        const outside = alone.relations?.[0].target();
        expect(outside?.slug).toBe("users");
        expect(alone.relations?.[1].target()).toBe(outside);
    });

    it("names an absorbed column by its relation in indexes, which the planner resolves to the same column", () => {
        const posts = defineTable("posts", {
            columns: { id, authorId: col.uuid(), at: col.timestamptz() },
            relations: { author: rel.belongsTo(() => users) },
            indexes: [{ columns: ["authorId", { column: "at", direction: "desc" }], include: ["authorId"], where: { column: "authorId", op: "is not null" }, reason: "feed" }],
            rls: "admin-only"
        });
        expect(only([posts, users]).indexes).toEqual([
            { on: ["author", { prop: "at", direction: "desc" }], include: ["author"], where: { prop: "author", op: "is not null" }, reason: "feed" }
        ]);
    });
});

describe("lowerTables — table keys", () => {
    const rules: [SecurityRule, ...SecurityRule[]] = [{ operation: "select", access: "public" }, { name: "w", operations: ["insert"], roles: ["editor"] }];

    it("lowers rls: admin-only, rules verbatim, inherit, defaultPolicies", () => {
        const [adminOnly, ruled, inheriting, ownRules] = lowerTables([
            defineTable("a", { columns: { id }, rls: "admin-only" }),
            defineTable("b", { columns: { id }, rls: rules }),
            defineTable("c", { columns: { id }, rls: "inherit" }),
            defineTable("d", { columns: { id }, rls: rules, defaultPolicies: false })
        ], { defaultRls: rules });
        expect(adminOnly.securityRules).toBeUndefined();
        expect(adminOnly.disableDefaultPolicies).toBeUndefined();
        expect(ruled.securityRules).toEqual(rules);
        ruled.securityRules?.forEach((rule, index) => expect(rule).toBe(rules[index]));
        expect(inheriting.securityRules).toEqual(rules);
        expect(ownRules).toMatchObject({ securityRules: rules, disableDefaultPolicies: true });
        const [inheritsAdminOnly] = lowerTables([defineTable("c", { columns: { id }, rls: "inherit" })], { defaultRls: "admin-only" });
        expect(inheritsAdminOnly.securityRules).toBeUndefined();
    });

    it("refuses an rls posture it cannot resolve, or one that denies everyone", () => {
        expect(refusal(() => lowerTables([defineTable("c", { columns: { id }, rls: "inherit" })]))).toEqual([
            expect.stringMatching(/^c: says `rls: "inherit"`, and no `defaultRls` was given/)
        ]);
        expect(refusal(() => lowerTables([defineTable("a", { columns: { id }, rls: "admin-only", defaultPolicies: false })]))).toEqual([
            expect.stringMatching(/^a: combines an admin-only posture with `defaultPolicies: false`/)
        ]);
        expect(refusal(() => lowerTables([defineTable("a", { columns: { id }, rls: "inherit", defaultPolicies: false })], { defaultRls: "admin-only" }))).toEqual([
            expect.stringMatching(/admin-only posture/)
        ]);
    });

    it("lowers every table-level key", () => {
        const table = defineTable("documents_table", {
            slug: "documents",
            schema: "docs",
            database: "analytics",
            description: "Shared",
            metadata: { owner: "x" },
            columns: { id, orgId: col.text().notNull(), deletedAt: col.timestamptz(), title: col.text() },
            rls: rules,
            tenant: { field: "orgId", from: { claim: "org_id" }, bypassRoles: ["support"] },
            softDelete: { field: "deletedAt" },
            history: true,
            search: { fields: ["title"], language: "english" },
            strictWrites: false,
            indexes: [{ columns: ["title"], using: "gin", reason: "search" }]
        });
        const lowered = only([table]);
        expect({ ...lowered, properties: undefined, securityRules: undefined }).toEqual({
            slug: "documents",
            name: "documents",
            table: "documents_table",
            schema: "docs",
            dataSource: "analytics",
            description: "Shared",
            metadata: { owner: "x" },
            properties: undefined,
            securityRules: undefined,
            tenant: { field: "orgId", from: { claim: "org_id" }, bypassRoles: ["support"] },
            softDelete: { field: "deletedAt" },
            history: true,
            search: { fields: ["title"], language: "english" },
            strictWrites: false,
            indexes: [{ using: "gin", on: ["title"], reason: "search" }]
        });
        expect(only([defineTable("s", { columns: { id, deletedAt: col.timestamptz() }, rls: "admin-only", softDelete: true })]).softDelete).toBe(true);
    });

    it("lowers defineAuthTable to an enabled auth block", () => {
        const onCreateUser = async (values: Record<string, unknown>) => ({ values });
        const lowered = only([defineAuthTable("users", {
            columns: { id, email: col.text().notNull().unique() },
            rls: "admin-only",
            auth: { roles: { editor: { scopes: ["posts:write"] } }, personalKeys: true, onCreateUser }
        })]);
        expect(lowered.auth).toEqual({ enabled: true, roles: { editor: { scopes: ["posts:write"] } }, personalKeys: true, onCreateUser });
        expect(only([defineAuthTable("users", { columns: { id }, rls: "admin-only" })]).auth).toEqual({ enabled: true });
    });

    it("lowers defineView to a view collection with no rules", () => {
        const view = defineView("post_titles", {
            query: "SELECT id, title FROM posts",
            materialized: true,
            roles: ["admin", "editor"],
            columns: { id: col.integer().primaryKey(), title: col.text() },
            indexes: [{ columns: ["title"], reason: "by title" }]
        });
        expect(only([view])).toEqual({
            slug: "post_titles",
            name: "post_titles",
            table: "post_titles",
            view: { query: "SELECT id, title FROM posts", materialized: true, roles: ["admin", "editor"] },
            properties: { id: { type: "number", isId: true }, title: { type: "string" } },
            indexes: [{ on: ["title"], reason: "by title" }]
        });
        expect(only([defineView("v", { query: "SELECT 1 AS n", columns: { n: col.integer() } })]).view).toEqual({ query: "SELECT 1 AS n" });
    });
});

describe("lowerTables — hooks", () => {
    const descriptor: TableDescriptor = { ...minimalDescriptor(), slug: "t" };

    it("calls each hook with the descriptor as `table` and the legacy `row` as `values`", async () => {
        const seen: unknown[] = [];
        const table = defineTable("t", {
            columns: { id, title: col.text() },
            rls: "admin-only",
            hooks: {
                beforeQuery: props => { seen.push(["beforeQuery", props.table.slug, props.operation, props.query]); },
                afterRead: props => { seen.push(["afterRead", props.table.slug, props.values]); return { ...props.values, masked: true }; },
                beforeSave: props => { seen.push(["beforeSave", props.table.slug, props.id, props.values, props.previousValues, props.status]); return props.values; },
                afterSave: props => { seen.push(["afterSave", props.id, props.values]); },
                afterSaveError: props => { seen.push(["afterSaveError", props.error]); },
                beforeDelete: props => { seen.push(["beforeDelete", props.id, props.values]); return false; },
                afterDelete: props => { seen.push(["afterDelete", props.id, props.values]); }
            }
        });
        const [lowered] = lowerTables([table], { describe: () => descriptor });
        const callbacks = lowered.callbacks;
        const context = callContext();
        const base = { collection: lowered, path: "t", context };
        await callbacks?.beforeQuery?.({ ...base, operation: "list", query: { limit: 1 } });
        expect(await callbacks?.afterRead?.({ ...base, row: { title: "a" } })).toEqual({ title: "a", masked: true });
        await callbacks?.beforeSave?.({ ...base, id: 1, values: { title: "b" }, previousValues: { title: "a" }, status: "existing" });
        await callbacks?.afterSave?.({ ...base, id: 1, values: { title: "b" }, status: "existing" });
        await callbacks?.afterSaveError?.({ ...base, values: {}, status: "new", error: "boom" });
        expect(await callbacks?.beforeDelete?.({ ...base, id: 2, row: { title: "c" } })).toBe(false);
        await callbacks?.afterDelete?.({ ...base, id: 2, row: { title: "c" } });
        expect(seen).toEqual([
            ["beforeQuery", "t", "list", { limit: 1 }],
            ["afterRead", "t", { title: "a" }],
            ["beforeSave", "t", 1, { title: "b" }, { title: "a" }, "existing"],
            ["afterSave", 1, { title: "b" }],
            ["afterSaveError", "boom"],
            ["beforeDelete", 2, { title: "c" }],
            ["afterDelete", 2, { title: "c" }]
        ]);
    });

    it("throws at call time, naming the hook, when no `describe` was given", () => {
        const table = defineTable("t", { columns: { id }, rls: "admin-only", hooks: { afterRead: props => props.values } });
        const [lowered] = lowerTables([table]);
        let error: unknown;
        try {
            lowered.callbacks?.afterRead?.({ collection: lowered, path: "t", context: callContext(), row: {} });
        } catch (thrown) {
            error = thrown;
        }
        expect(error).toBeInstanceOf(SchemaDefinitionError);
        expect(String(error)).toMatch(/t\.hooks\.afterRead: ran on a table lowered without a `describe` option/);
    });

    it("lowers a view's read hooks", () => {
        const view = defineView("v", { query: "SELECT 1 AS n", columns: { n: col.integer().primaryKey() }, hooks: { afterRead: props => props.values } });
        const [lowered] = lowerTables([view], { describe: () => descriptor });
        expect(Object.keys(lowered.callbacks ?? {})).toEqual(["afterRead"]);
    });
});

describe("lowerTables — refusals", () => {
    const users = defineTable("users", { columns: { id }, rls: "admin-only" });

    /** One definition per pending feature, each refused with that feature's id. */
    const PENDING: Record<PendingTableFeatureId, () => (AnyTableDef | AnyViewDef)[]> = {
        "column-generated-as": () => [defineTable("t", { columns: { id, g: col.text().generatedAs("upper(x)") }, rls: "admin-only" })],
        "identity-not-primary-key": () => [defineTable("t", { columns: { id, n: col.integer().identity() }, rls: "admin-only" })],
        "identity-width": () => [defineTable("t", { columns: { id: col.bigint().primaryKey().identity() }, rls: "admin-only" })],
        "array-element-type": () => [defineTable("t", { columns: { id, a: col.array(col.uuid()) }, rls: "admin-only" })],
        "array-element-modifiers": () => [defineTable("t", { columns: { id, a: col.array(col.text().notNull()) }, rls: "admin-only" })],
        "enum-type-name": () => [defineTable("t", { columns: { id, s: col.enum(["a"], { name: "shared_status" }) }, rls: "admin-only" })],
        "text-one-of": () => [defineTable("t", { columns: { id, s: col.text().oneOf(["a", "b"]) }, rls: "admin-only" })],
        "has-many-order-by": () => [defineTable("t", { columns: { id }, relations: { posts: rel.hasMany(() => users, { orderBy: ["id", "asc"] }) }, rls: "admin-only" }), users],
        "belongs-to-unconstrained-derived": () => [defineTable("t", { columns: { id }, relations: { user: rel.belongsTo(() => users, { constraint: false, index: false }) }, rls: "admin-only" }), users],
        "belongs-to-unconstrained-index": () => [defineTable("t", { columns: { id, userId: col.uuid() }, relations: { user: rel.belongsTo(() => users, { constraint: false }) }, rls: "admin-only" }), users],
        "varchar-validate-max": () => [defineTable("t", { columns: { id, v: col.varchar(10).validate({ max: 5 }) }, rls: "admin-only" })],
        "index-without-reason": () => [defineTable("t", { columns: { id, v: col.text() }, indexes: [{ columns: ["v"] }], rls: "admin-only" })],
        "json-document-shape": () => [defineTable("t", { columns: { id, j: col.jsonb(json.string()) }, rls: "admin-only" })],
        "json-one-of-placement": () => [defineTable("t", { columns: { id, j: col.jsonb(json.object({ b: json.oneOf({ x: json.string() }) })) }, rls: "admin-only" })],
        "json-unknown-field": () => [defineTable("t", { columns: { id, j: col.jsonb(json.object({ u: json.unknown() })) }, rls: "admin-only" })],
        "array-unique-items": () => [defineTable("t", { columns: { id, a: col.array(col.text()).validate({ uniqueItems: true }) }, rls: "admin-only" })]
    };

    it("lists each pending feature once", () => {
        const ids = PENDING_TABLE_FEATURES.map(feature => feature.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(Object.keys(PENDING).sort()).toEqual([...ids].sort());
    });

    it.each(PENDING_TABLE_FEATURES.map(feature => feature.id))("refuses %s by its id", featureId => {
        const problems = refusal(() => lowerTables(PENDING[featureId]()));
        expect(problems).toEqual([expect.stringContaining(`[${featureId}]`)]);
        expect(problems[0]).toMatch(/^t(\.|:)/);
    });

    it("refuses a table without a key, and collects every problem before throwing", () => {
        const problems = refusal(() => lowerTables([
            defineTable("a", { columns: { v: col.text() }, rls: "admin-only" }),
            defineTable("b", { columns: { id, s: col.text().private().access({ read: ["x"] }) }, rls: "admin-only" })
        ]));
        expect(problems).toEqual([
            expect.stringMatching(/^a: declares no primary key/),
            expect.stringMatching(/^b\.s: is `.private\(\)` and declares `.access\(\)`/)
        ]);
    });

    it("refuses two relations binding one column", () => {
        const problems = refusal(() => lowerTables([defineTable("t", {
            columns: { id, userId: col.uuid() },
            relations: { a: rel.belongsTo(() => users, { localKey: "user_id" }), b: rel.belongsTo(() => users, { localKey: "user_id" }) },
            rls: "admin-only"
        }), users]));
        expect(problems).toEqual([expect.stringMatching(/^t\.b: binds the column "userId", which the relation "a" already binds/)]);
    });

    it("refuses something that is not a definition", () => {
        const problems = refusal(() => lowerTables([users, Object.assign(Object.create(null), { name: "x" })]));
        expect(problems).toEqual([expect.stringMatching(/^x: is not a `defineTable`/)]);
    });
});

/** A descriptor with every required field, for hook tests. */
function minimalDescriptor(): TableDescriptor {
    return {
        name: "t",
        slug: "t",
        table: "t",
        schema: "public",
        kind: "table",
        columns: [],
        primaryKey: [],
        relations: [],
        rls: { posture: "admin-only", rules: [], defaultPolicies: true }
    };
}

/** The call context a hook receives; the hooks under test never read it. */
function callContext(): RebaseCallContext {
    return createCallContext();
}
