import { describe, expect, it } from "@jest/globals";
import {
    isTableDef,
    isViewDef,
    type AnyTableDef,
    type AnyViewDef,
    type ColumnDef,
    type SecurityRule
} from "@rebasepro/types";
import {
    type LegacyCollectionConfig,
    type LegacyPostgresCollectionConfig,
    type LegacyPostgresProperty
} from "@rebasepro/common/migrate";

import { collectionToTableDef, collectionsToTableDefs, type LegacyVectorIndexConfig, type LiftNote } from "../../src/migrate";
import { isSchemaDefinitionError } from "../../src/schema/errors";
import { createCallContext } from "../../src/data/call-context";

const uuidKey: LegacyPostgresProperty = { type: "string", isId: "uuid" };

function collection(slug: string, properties: LegacyPostgresCollectionConfig["properties"], extra: Partial<LegacyPostgresCollectionConfig> = {}): LegacyPostgresCollectionConfig {
    return { slug, name: slug, table: slug, properties, ...extra };
}

/** The column definitions of the one table a collection converts to. */
function columnsOf(def: AnyTableDef | AnyViewDef): Record<string, ColumnDef> {
    return Object.fromEntries(Object.entries(def.config.columns).map(([key, builder]) => [key, builder.def]));
}

function liftOne(properties: LegacyPostgresCollectionConfig["properties"]): { columns: Record<string, ColumnDef>; notes: LiftNote[] } {
    const { table, notCarried } = collectionToTableDef(collection("t", { id: uuidKey, ...properties }));
    return { columns: columnsOf(table), notes: notCarried.filter(note => note.field !== "name" || note.key !== undefined) };
}

/** A column definition with the builder's base flags. */
const def = (patch: Partial<ColumnDef>): ColumnDef => ({ type: { kind: "text" }, notNull: false, primaryKey: false, unique: false, readOnly: false, private: false, ...patch });

function refusal(run: () => unknown): string[] {
    try {
        run();
    } catch (error) {
        if (isSchemaDefinitionError(error)) return error.problems.map(problem => `${problem.table}${problem.key ? `.${problem.key}` : ""}: ${problem.message}`);
        throw error;
    }
    throw new Error("expected a SchemaDefinitionError");
}

describe("collectionToTableDef — columns", () => {
    it.each<[string, LegacyPostgresProperty, Partial<ColumnDef>]>([
        ["text", { type: "string" }, {}],
        ["required + unique", { type: "string", validation: { required: true, unique: true } }, { notNull: true, unique: true }],
        ["enum", { type: "string", enum: ["a", "b"] }, { type: { kind: "enum", values: ["a", "b"] } }],
        ["enum record", { type: "string", enum: { x: "X" } }, { type: { kind: "enum", values: ["x"] } }],
        ["uuid column", { type: "string", columnType: "uuid" }, { type: { kind: "uuid" } }],
        ["varchar takes its length from `validation.max`", { type: "string", columnType: "varchar", validation: { max: 80 } }, { type: { kind: "varchar", length: 80 } }],
        ["varchar without max is 255", { type: "string", columnType: "varchar" }, { type: { kind: "varchar", length: 255 } }],
        ["varchar with an explicit 255 keeps the rule", { type: "string", columnType: "varchar", validation: { max: 255 } }, { type: { kind: "varchar", length: 255 }, validate: { max: 255 } }],
        ["char", { type: "string", columnType: "char", validation: { max: 2 } }, { type: { kind: "char", length: 2 } }],
        ["string rules", { type: "string", validation: { min: 1, max: 5, matches: /^a$/i, matchesMessage: "m", requiredMessage: "r", trim: true } },
            { validate: { min: 1, max: 5, matches: "^a$", matchesFlags: "i", matchesMessage: "m", requiredMessage: "r", trim: true } }],
        ["email and url flags", { type: "string", email: true, url: true }, { validate: { email: true, url: true } }],
        ["user stamp", { type: "string", autoValue: "user_on_update" }, { stamp: { on: "update", value: "user" } }],
        ["userSelect is userId", { type: "string", userSelect: true }, { semantic: "user" }],
        ["userSelect on a uuid", { type: "string", columnType: "uuid", userSelect: true }, { type: { kind: "uuid" }, semantic: "user" }],
        ["userSelect on each item of text[]", { type: "array", of: { type: "string", userSelect: true } },
            { type: { kind: "array", of: { kind: "text" } }, element: def({ semantic: "user" }) }],
        ["storage", { type: "string", storage: { storagePath: "p/", acceptedFiles: ["image/*"], maxSize: 10, storageSource: "media" } },
            { storage: { path: "p/", accept: ["image/*"], maxBytes: 10, source: "media" } }],
        ["excludeFromApi is private", { type: "string", excludeFromApi: true }, { private: true }],
        ["no client writes is readOnly", { type: "string", access: { read: ["hr"], write: [] } }, { readOnly: true, access: { read: ["hr"] } }],
        ["access", { type: "string", access: { write: ["hr"] } }, { access: { write: ["hr"] } }],
        ["description", { type: "string", description: "d" }, { description: "d" }],
        ["columnName", { type: "string", columnName: "legacy" }, { column: "legacy" }],
        ["databaseDefault true", { type: "string", databaseDefault: true }, { default: { kind: "database" } }],
        ["databaseDefault sql", { type: "string", databaseDefault: "sql`gen()`" }, { default: { kind: "sql", expression: "gen()" } }],
        ["defaultValue", { type: "string", defaultValue: "x" }, { default: { kind: "literal", value: "x" } }],
        ["number is numeric", { type: "number" }, { type: { kind: "numeric" } }],
        ["number with precision", { type: "number", precision: 10, scale: 2 }, { type: { kind: "numeric", precision: 10, scale: 2 } }],
        ["number integer rule", { type: "number", validation: { integer: true, min: 0 } }, { type: { kind: "integer" }, validate: { integer: true, min: 0 } }],
        ["number columnType", { type: "number", columnType: "bigserial" }, { type: { kind: "bigserial" } }],
        ["number enum is oneOf", { type: "number", enum: [{ id: 1, label: "One" }] }, { type: { kind: "numeric" }, oneOf: [1] }],
        ["boolean", { type: "boolean", defaultValue: false }, { type: { kind: "boolean" }, default: { kind: "literal", value: false } }],
        ["timestamp", { type: "date", columnType: "timestamp" }, { type: { kind: "timestamptz" } }],
        ["date", { type: "date", columnType: "date", autoValue: "on_create" }, { type: { kind: "date" }, stamp: { on: "create", value: "now" } }],
        ["time", { type: "date", columnType: "time" }, { type: { kind: "time" } }],
        ["Date default is ISO", { type: "date", defaultValue: new Date("2020-01-01T00:00:00.000Z") }, { type: { kind: "timestamptz" }, default: { kind: "literal", value: "2020-01-01T00:00:00.000Z" } }],
        ["Date bounds are ISO", { type: "date", validation: { min: new Date("2020-01-01T00:00:00.000Z") } }, { type: { kind: "timestamptz" }, validate: { min: "2020-01-01T00:00:00.000Z" } }],
        ["map", { type: "map" }, { type: { kind: "jsonb" } }],
        ["map json", { type: "map", columnType: "json" }, { type: { kind: "json" } }],
        ["map keyValue", { type: "map", keyValue: true }, { type: { kind: "jsonb" }, json: { kind: "object", fields: {}, additional: true } }],
        ["map properties", { type: "map", properties: { a: { type: "string", validation: { required: true } }, d: { type: "date", autoValue: "on_update" } } },
            { type: { kind: "jsonb" }, json: { kind: "object", fields: { a: { kind: "string", required: true }, d: { kind: "date", stamp: "update" } } } }],
        ["geopoint", { type: "geopoint" }, { type: { kind: "jsonb" }, semantic: "geopoint" }],
        ["text[]", { type: "array", of: { type: "string", enum: ["x"] } }, { type: { kind: "array", of: { kind: "text" } }, element: def({ oneOf: ["x"] }) }],
        ["integer[]", { type: "array", of: { type: "number", validation: { integer: true } } },
            { type: { kind: "array", of: { kind: "integer" } }, element: def({ type: { kind: "integer" }, validate: { integer: true } }) }],
        ["columnType boolean[]", { type: "array", columnType: "boolean[]" }, { type: { kind: "array", of: { kind: "boolean" } }, element: def({ type: { kind: "boolean" } }) }],
        ["array counts are minItems/maxItems", { type: "array", of: { type: "string" }, validation: { min: 1, max: 2 } },
            { type: { kind: "array", of: { kind: "text" } }, element: def({}), validate: { minItems: 1, maxItems: 2 } }],
        ["array of files", { type: "array", of: { type: "string", storage: { storagePath: "f/" } } },
            { type: { kind: "array", of: { kind: "text" } }, storage: { path: "f/" }, element: def({ storage: { path: "f/" } }) }],
        ["JSON array", { type: "array", of: { type: "date" } }, { type: { kind: "jsonb" }, json: { kind: "array", of: { kind: "date" } } }],
        ["JSON array of anything", { type: "array" }, { type: { kind: "jsonb" }, json: { kind: "array", of: { kind: "unknown" } } }],
        ["typed blocks", { type: "array", oneOf: { properties: { t: { type: "string" } }, valueField: "v" } },
            { type: { kind: "jsonb" }, json: { kind: "array", of: { kind: "oneOf", typeField: "type", valueField: "v", variants: { t: { kind: "string" } } } } }],
        ["vector", { type: "vector", dimensions: 3, index: { distance: ["l2", "inner_product"], lists: 4, method: "ivfflat" } },
            { type: { kind: "vector", dimensions: 3 }, vectorIndex: { method: "ivfflat", metric: ["l2", "ip"], lists: 4 } }],
        ["binary", { type: "binary" }, { type: { kind: "bytea" } }]
    ])("%s", (_name, property, expected) => {
        const { columns } = liftOne({ c: property });
        expect(columns.c).toEqual(def(expected));
    });

    it("lifts the key strategies", () => {
        const lift = (property: LegacyPostgresProperty): ColumnDef => columnsOf(collectionToTableDef(collection("t", { id: property })).table).id;
        expect(lift({ type: "string", isId: "uuid" })).toEqual(def({ type: { kind: "uuid" }, primaryKey: true, notNull: true, default: { kind: "random-uuid" } }));
        expect(lift({ type: "number", isId: "increment" })).toEqual(def({ type: { kind: "integer" }, primaryKey: true, notNull: true, default: { kind: "identity" } }));
        expect(lift({ type: "string", isId: "sql`gen_id()`" })).toEqual(def({ primaryKey: true, notNull: true, default: { kind: "sql", expression: "gen_id()" } }));
        expect(lift({ type: "string", isId: "gen_id()" })).toEqual(def({ primaryKey: true, notNull: true, default: { kind: "sql", expression: "gen_id()" } }));
        expect(lift({ type: "number", isId: true })).toEqual(def({ type: { kind: "integer" }, primaryKey: true, notNull: true }));
        expect(lift({ type: "string" })).toEqual(def({ primaryKey: true, notNull: true }));
    });

    it("writes the implicit key of a keyless collection as the first column, and keeps a composite key's order", () => {
        const keyless = collectionToTableDef(collection("t", { body: { type: "string" } })).table;
        expect(Object.keys(keyless.config.columns)).toEqual(["id", "body"]);
        expect(columnsOf(keyless).id).toEqual(def({ primaryKey: true, notNull: true, default: { kind: "sql", expression: "gen_random_uuid()::text" } }));
        const composite = collectionToTableDef(collection("t", { b: { type: "string", isId: true }, v: { type: "string" }, a: { type: "number", isId: true } })).table;
        expect(Object.entries(columnsOf(composite)).filter(([, column]) => column.primaryKey).map(([key]) => key)).toEqual(["b", "a"]);
    });

    it("lifts property callbacks to a transform that calls them with the original collection", async () => {
        const seen: unknown[] = [];
        const original = collection("t", {
            id: uuidKey,
            c: { type: "string", callbacks: { afterRead: ({ collection: c, row, value }) => { seen.push([c, row, value]); return value; } } }
        });
        const column = columnsOf(collectionToTableDef(original).table).c;
        const table = { name: "t", slug: "t", table: "t", schema: "public", kind: "table" as const, columns: [], primaryKey: [], relations: [], rls: { posture: "admin-only" as const, rules: [], defaultPolicies: true } };
        await column.transform?.afterRead?.({ table, path: "t", context: createCallContext(), value: "v", values: { c: "v" } });
        expect(seen).toEqual([[original, { c: "v" }, "v"]]);
    });

    it("notes what it does not carry", () => {
        const processFile = async (file: File) => file;
        const property: LegacyPostgresProperty = {
            type: "string",
            name: "Label",
            enum: [{ id: "a", label: "Ay", color: "redLight" }],
            metadata: { crm: true },
            storage: { storagePath: "p/", processFile },
            validation: { uniqueInArray: true }
        };
        Reflect.set(property, "multiline", true);
        const { notes } = liftOne({ c: property });
        expect(notes.map(note => [note.key, note.field, note.kind, note.valueKind])).toEqual([
            ["c", "name", "ui", "string"],
            ["c", "metadata", "metadata", "object"],
            ["c", "multiline", "unknown", "boolean"],
            // Outside an array it never had an effect.
            ["c", "validation.uniqueInArray", "inert", "boolean"],
            ["c", "enum", "ui", "array"],
            ["c", "storage.processFile", "browser", "function"]
        ]);
    });
});

describe("collectionToTableDef — unique array items", () => {
    it("carries an array's `uniqueInArray` as `uniqueItems`, and an item's too, noting that the server now enforces it", () => {
        const { columns, notes } = liftOne({
            tags: { type: "array", columnType: "text[]", of: { type: "string" }, validation: { uniqueInArray: true } },
            codes: { type: "array", columnType: "text[]", of: { type: "string", validation: { uniqueInArray: true } } },
            doc: { type: "map", properties: { refs: { type: "array", of: { type: "string" }, validation: { uniqueInArray: true } } } }
        });
        expect(columns.tags.validate).toEqual({ uniqueItems: true });
        expect(columns.codes.validate).toEqual({ uniqueItems: true });
        const refs = columns.doc.json?.kind === "object" ? columns.doc.json.fields.refs : undefined;
        expect(refs?.kind === "array" && refs.validate).toEqual({ uniqueItems: true });
        expect(notes.map(note => [note.key, note.field, note.kind])).toEqual([["codes[]", "validation.uniqueInArray", "derived"]]);
        expect(notes[0].reason).toContain("the server now refuses a duplicate item on every write");
    });

    it("carries `uniqueInArray` on fields of an array's object items as the array's `uniqueBy`", () => {
        const { columns, notes } = liftOne({
            lines: {
                type: "array",
                columnType: "jsonb",
                of: { type: "map", properties: { sku: { type: "string", validation: { uniqueInArray: true } }, ean: { type: "string", validation: { uniqueInArray: true } }, qty: { type: "number" } } }
            },
            doc: {
                type: "map",
                properties: { rows: { type: "array", of: { type: "map", properties: { code: { type: "string", validation: { uniqueInArray: true } } } } } }
            }
        });
        expect(columns.lines.validate).toEqual({ uniqueBy: ["sku", "ean"] });
        const rows = columns.doc.json?.kind === "object" ? columns.doc.json.fields.rows : undefined;
        expect(rows?.kind === "array" && rows.validate).toEqual({ uniqueBy: ["code"] });
        expect(notes).toEqual([]);
    });
});

describe("collectionToTableDef — relations", () => {
    const authors = collection("authors", { id: uuidKey });
    const counters = collection("counters", { id: { type: "number", isId: true, columnType: "serial" } });

    it("writes a belongsTo's foreign key where its relation property was, typed as the target's key", () => {
        const posts = collection("posts", {
            id: uuidKey,
            author: { type: "relation", validation: { required: true }, relation: { kind: "belongsTo", target: () => authors, onDelete: "cascade" } },
            counter: { type: "relation", relation: { kind: "belongsTo", target: () => counters, localKey: "counter_ref" } },
            title: { type: "string" }
        });
        const { tables } = collectionsToTableDefs([posts, authors, counters]);
        const table = tables[0];
        expect(Object.keys(table.config.columns)).toEqual(["id", "authorId", "counterRef", "title"]);
        expect(columnsOf(table).authorId).toEqual(def({ type: { kind: "uuid" }, notNull: true }));
        expect(columnsOf(table).counterRef).toEqual(def({ type: { kind: "integer" } }));
        const relations = table.config.relations ?? {};
        expect(relations.author).toMatchObject({ kind: "belongsTo", onDelete: "cascade" });
        expect(relations.author).not.toHaveProperty("localKey");
        expect(relations.counter).toMatchObject({ kind: "belongsTo", localKey: "counter_ref" });
        expect(relations.author.target()).toBe(tables[1]);
    });

    it("carries a user stamp inside a JSON document onto the string node", () => {
        const t = collection("t", {
            id: uuidKey,
            m: { type: "map", properties: { by: { type: "string", autoValue: "user_on_create" }, editor: { type: "string", autoValue: "user_on_update" } } }
        });
        const column = columnsOf(collectionsToTableDefs([t]).tables[0]).m;
        expect(column.json).toEqual({
            kind: "object",
            fields: { by: { kind: "string", stamp: "createUser" }, editor: { kind: "string", stamp: "updateUser" } }
        });
    });

    it("carries `userSelect` as `.userId()`, at the top, on array items and inside a JSON document, with no note", () => {
        const t = collection("t", {
            id: uuidKey,
            owner: { type: "string", userSelect: true },
            plain: { type: "string", userSelect: false },
            watchers: { type: "array", of: { type: "string", userSelect: true } },
            m: { type: "map", properties: { approver: { type: "string", userSelect: true } } }
        });
        const { tables, notCarried } = collectionsToTableDefs([t]);
        const columns = columnsOf(tables[0]);
        expect(columns.owner.semantic).toBe("user");
        expect(columns.plain.semantic).toBeUndefined();
        expect(columns.watchers.element?.semantic).toBe("user");
        expect(columns.m.json).toEqual({ kind: "object", fields: { approver: { kind: "string", semantic: "user" } } });
        expect(notCarried.filter(note => note.field === "userSelect").map(note => [note.key, note.kind])).toEqual([["plain", "redundant"]]);
    });

    it("refuses `userSelect` over a column that cannot hold a user's id", () => {
        expect(() => collectionToTableDef(collection("t", { id: uuidKey, s: { type: "string", enum: [{ id: "a", label: "a" }], userSelect: true } })))
            .toThrow(/is a `userSelect` field over a `enum` column/);
        expect(() => collectionToTableDef(collection("t", { id: uuidKey, s: { type: "string", storage: { storagePath: "a/" }, userSelect: true } })))
            .toThrow(/holds a user's id or a file's path, not both/);
    });

    it("carries a relation property's `access` and `excludeFromApi` onto the relation", () => {
        const posts = collection("posts", {
            id: uuidKey,
            author: { type: "relation", access: { read: ["admin"], write: [] }, relation: { kind: "belongsTo", target: () => authors } },
            editors: { type: "relation", excludeFromApi: true, relation: { kind: "hasMany", target: () => authors, foreignKeyOnTarget: "post_id" } },
            open: { type: "relation", excludeFromApi: false, relation: { kind: "manyToMany", target: () => authors } }
        });
        const { tables, notCarried } = collectionsToTableDefs([posts, authors]);
        const relations = tables[0].config.relations ?? {};
        expect(relations.author).toMatchObject({ kind: "belongsTo", access: { read: ["admin"], write: [] } });
        expect(relations.author).not.toHaveProperty("private");
        expect(relations.editors).toMatchObject({ kind: "hasMany", private: true });
        expect(relations.editors).not.toHaveProperty("access");
        expect(relations.open).not.toHaveProperty("private");
        expect(notCarried.find(note => note.key === "open" && note.field === "excludeFromApi")).toMatchObject({ kind: "redundant" });
        // The column the relation-property form plans carries no rule of its own.
        expect(columnsOf(tables[0]).authorId).toEqual(def({ type: { kind: "uuid" } }));
    });

    it("binds the property that owns the foreign key, and notes a requiredness only the relation stated", () => {
        const posts = collection("posts", {
            id: uuidKey,
            authorId: { type: "string", columnName: "author_id" },
            author: { type: "relation", validation: { required: true } }
        }, { relations: [{ kind: "belongsTo", relationName: "author", target: () => authors, localKey: "author_id" }] });
        const { tables, notCarried } = collectionsToTableDefs([posts, authors]);
        expect(Object.keys(tables[0].config.columns)).toEqual(["id", "authorId"]);
        expect(columnsOf(tables[0]).authorId).toEqual(def({}));
        expect(notCarried.find(note => note.field === "validation.required")).toMatchObject({ collection: "posts", key: "author", kind: "inert" });
    });

    it("renames a relation whose foreign key is served under its own key", () => {
        const employees: LegacyPostgresCollectionConfig = collection("employees", {
            id: { type: "number", isId: "increment" },
            reportsTo: { type: "relation", relation: { kind: "belongsTo", target: () => employees, localKey: "reports_to" } }
        });
        const { tables, notCarried } = collectionsToTableDefs([employees]);
        expect(Object.keys(tables[0].config.columns)).toEqual(["id", "reportsTo"]);
        expect(Object.keys(tables[0].config.relations ?? {})).toEqual(["reportsToRelation"]);
        expect(tables[0].config.relations?.reportsToRelation).toMatchObject({ localKey: "reports_to" });
        expect(notCarried.find(note => note.kind === "renamed")).toMatchObject({ key: "reportsTo", field: "relationName", value: "reportsTo" });
    });

    it("lifts a belongsTo declared only in `relations` over a declared column as unconstrained", () => {
        const posts = collection("posts", { id: uuidKey, authorId: { type: "string" } }, {
            relations: [{ kind: "belongsTo", relationName: "author", target: () => authors }]
        });
        const relation = collectionsToTableDefs([posts, authors]).tables[0].config.relations?.author;
        expect(relation).toMatchObject({ kind: "belongsTo", constraint: false, index: false });
    });

    it("keeps a derived foreign key when the target's key is composite, so the planner refuses as it always has", () => {
        const pair = collection("pair", { a: { type: "string", isId: true }, b: { type: "string", isId: true } });
        const link = collection("link", { id: uuidKey, pair: { type: "relation", relation: { kind: "belongsTo", target: () => pair } } });
        const table = collectionsToTableDefs([link, pair]).tables[0];
        expect(Object.keys(table.config.columns)).toEqual(["id"]);
        expect(table.config.relations?.pair).toMatchObject({ kind: "belongsTo" });
    });

    it("pins only the names the collection wrote, for every kind", () => {
        const tags = collection("tags", { id: uuidKey });
        const posts = collection("posts", { id: uuidKey }, {
            relations: [
                { kind: "hasMany", relationName: "comments", target: () => tags, foreignKeyOnTarget: "post_ref", sourceKey: "id", onDelete: "cascade" },
                { kind: "hasOne", relationName: "cover", target: () => tags },
                { kind: "manyToMany", relationName: "tags", target: () => tags, through: { table: "pt", sourceColumn: "p", targetColumn: "t", properties: { n: { type: "number" } } }, onDelete: "restrict", onUpdate: "cascade" },
                { kind: "manyToMany", relationName: "plain", target: () => tags },
                { kind: "via", relationName: "path", target: () => tags, cardinality: "one", joinPath: [{ table: "tags", on: { from: "id", to: "id" } }] }
            ]
        });
        const { tables, notCarried } = collectionsToTableDefs([posts, tags]);
        const relations = tables[0].config.relations ?? {};
        expect(relations.comments).toMatchObject({ kind: "hasMany", foreignKey: "post_ref", sourceKey: "id" });
        expect(relations.cover).not.toHaveProperty("foreignKey");
        expect(relations.tags).toMatchObject({ kind: "manyToMany", through: "pt", sourceKey: "p", targetKey: "t", onDelete: "restrict" });
        expect(Object.keys(relations.tags.kind === "manyToMany" ? relations.tags.pivot ?? {} : {})).toEqual(["n"]);
        expect(relations.plain).not.toHaveProperty("through");
        expect(relations.path).toMatchObject({ kind: "via", cardinality: "one", steps: [{ table: "tags", on: { from: "id", to: "id" } }] });
        expect(notCarried.map(note => [note.key, note.field, note.kind])).toEqual(expect.arrayContaining([
            ["comments", "onDelete", "inert"],
            ["tags", "onUpdate", "inert"]
        ]));
    });

    it("converts a target outside the set, once", () => {
        const posts = collection("posts", {
            id: uuidKey,
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } },
            editor: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
        });
        const { tables } = collectionsToTableDefs([posts]);
        const relations = tables[0].config.relations ?? {};
        expect(relations.author.target()).toBe(relations.editor.target());
        expect(relations.author.target().name).toBe("authors");
    });

    it("lifts a reference to a column plus an unindexed belongsTo, and an unresolved one to a column", () => {
        const refs = collection("refs", { id: uuidKey });
        Reflect.set(refs.properties, "supplier", { type: "reference", path: "authors", validation: { required: true } });
        Reflect.set(refs.properties, "loose", { type: "reference", path: "nowhere" });
        const { tables, notCarried } = collectionsToTableDefs([refs, authors]);
        expect(columnsOf(tables[0]).supplier).toEqual(def({ type: { kind: "uuid" }, notNull: true }));
        expect(columnsOf(tables[0]).loose).toEqual(def({}));
        expect(tables[0].config.relations?.supplierRelation).toMatchObject({ kind: "belongsTo", localKey: "supplier", index: false });
        expect(notCarried.find(note => note.key === "loose")).toMatchObject({ field: "path", kind: "inert" });
    });
});

describe("collectionToTableDef — table keys", () => {
    const rules: SecurityRule[] = [{ operation: "select", access: "public" }];

    it("lifts rls: admin-only, rules as written, inherit, defaultPolicies", () => {
        const defaults: SecurityRule[] = [{ operation: "select", roles: ["reader"] }];
        const { tables, defaultRls } = collectionsToTableDefs([
            collection("a", { id: uuidKey }),
            collection("b", { id: uuidKey }, { securityRules: rules }),
            collection("c", { id: uuidKey }, { securityRules: defaults }),
            collection("d", { id: uuidKey }, { securityRules: rules, disableDefaultPolicies: true })
        ], { defaultSecurityRules: defaults });
        const config = (index: number) => {
            const table = tables[index];
            if (!isTableDef(table)) throw new Error("expected a table");
            return table.config;
        };
        expect(config(0).rls).toBe("inherit");
        expect(config(1).rls).toEqual(rules);
        expect(Array.isArray(config(1).rls) ? config(1).rls[0] : undefined).toBe(rules[0]);
        expect(config(2).rls).toBe("inherit");
        expect(config(3)).toMatchObject({ rls: rules, defaultPolicies: false });
        expect(defaultRls).toEqual(defaults);
        const alone = collectionToTableDef(collection("a", { id: uuidKey })).table;
        expect(isTableDef(alone) && alone.config.rls).toBe("admin-only");
    });

    it("lifts every table-level key", () => {
        const orgs = collection("orgs", { id: uuidKey });
        const documents = collection("documents", {
            id: uuidKey,
            org: { type: "relation", relation: { kind: "belongsTo", target: () => orgs } },
            deletedAt: { type: "date" },
            title: { type: "string" }
        }, {
            table: "documents_table",
            schema: "docs",
            dataSource: "analytics",
            description: "d",
            metadata: { m: 1 },
            securityRules: rules,
            tenant: { field: "org", from: { claim: "org_id" } },
            softDelete: true,
            history: true,
            strictWrites: false,
            search: { fields: ["title"] },
            indexes: [{ on: ["org", { prop: "title", direction: "desc" }], where: { prop: "deletedAt", op: "is null" }, include: ["title"], reason: "r" }]
        });
        const table = collectionsToTableDefs([documents, orgs]).tables[0];
        expect(table.name).toBe("documents_table");
        expect(table.config).toMatchObject({
            slug: "documents",
            schema: "docs",
            database: "analytics",
            description: "d",
            metadata: { m: 1 },
            tenant: { field: "orgId", from: { claim: "org_id" } },
            softDelete: true,
            history: true,
            strictWrites: false,
            search: { fields: ["title"] },
            indexes: [{ columns: ["org", { column: "title", direction: "desc" }], where: { column: "deletedAt", op: "is null" }, include: ["title"], reason: "r" }]
        });
    });

    it("lifts the auth table, and notes the panel's actions", () => {
        const { table, notCarried } = collectionToTableDef(collection("users", { id: uuidKey }, {
            auth: { enabled: true, personalKeys: true, actions: { resetPassword: true } }
        }));
        expect(table).toMatchObject({ auth: { personalKeys: true } });
        expect(notCarried.find(note => note.field === "auth.actions")).toMatchObject({ kind: "ui" });
        expect(collectionToTableDef(collection("users", { id: uuidKey }, { auth: true })).table).toMatchObject({ auth: {} });
        expect(collectionToTableDef(collection("users", { id: uuidKey }, { auth: { enabled: false } })).table).not.toHaveProperty("auth");
    });

    it("lifts a view, noting what a view does not use", () => {
        const { table, notCarried } = collectionToTableDef(collection("titles", { id: { type: "string", isId: true } }, {
            view: { query: "SELECT id FROM posts", roles: ["admin"] },
            securityRules: rules,
            callbacks: { afterRead: ({ row }) => row, beforeSave: ({ values }) => values }
        }));
        expect(isViewDef(table)).toBe(true);
        expect(table.config).not.toHaveProperty("roles");
        expect(Object.keys(table.config.hooks ?? {})).toEqual(["afterRead"]);
        expect(notCarried.map(note => note.field)).toEqual(expect.arrayContaining(["securityRules", "view.roles", "callbacks.beforeSave"]));
    });

    it("lifts collection callbacks to hooks that call them with the original collection and `row`", async () => {
        const seen: unknown[] = [];
        const original = collection("t", { id: uuidKey }, {
            callbacks: { beforeDelete: ({ collection: c, row, id }) => { seen.push([c, row, id]); } }
        });
        const table = collectionToTableDef(original).table;
        const descriptor = { name: "t", slug: "t", table: "t", schema: "public", kind: "table" as const, columns: [], primaryKey: [], relations: [], rls: { posture: "admin-only" as const, rules: [], defaultPolicies: true } };
        const hooks = isTableDef(table) ? table.config.hooks : undefined;
        await hooks?.beforeDelete?.({ table: descriptor, path: "t", context: createCallContext(), id: 1, values: { id: 1 } });
        expect(seen).toEqual([[original, { id: 1 }, 1]]);
    });
});

describe("collectionToTableDef — refusals", () => {
    const authors = collection("authors", { id: uuidKey });
    const firestore: LegacyCollectionConfig = { slug: "fs", name: "fs", engine: "firestore", properties: {} };

    it.each<[string, () => LegacyCollectionConfig[], RegExp]>([
        ["a Firestore collection", () => [firestore], /^fs: is a firestore collection/],
        ["databaseId", () => [collection("t", { id: uuidKey }, { databaseId: "x" })], /sets `databaseId`/],
        ["a schema-prefixed table", () => [collection("t", { id: uuidKey }, { table: "s.t" })], /schema prefix/],
        ["a function storage path", () => [collection("t", { id: uuidKey, f: { type: "string", storage: { storagePath: () => "x" } } })], /^t\.f: computes its storage path with a function/],
        ["a via without joinPath", () => [collection("t", { id: uuidKey }, { relations: [{ kind: "via", relationName: "v", target: () => authors, cardinality: "many", joinPath: [] }] }), authors], /^t\.v: is a `via` relation without a `joinPath`/],
        ["a tuple", () => [collection("t", { id: uuidKey, a: { type: "array", of: [{ type: "string" }] } })], /declares a tuple/],
        ["cuid", () => [collection("t", { id: { type: "string", isId: "cuid" } })], /cuid/],
        ["increment on a string", () => [collection("t", { id: { type: "string", isId: "increment" } })], /`isId: "increment"` needs a number property/],
        ["uuid on a number", () => [collection("t", { id: { type: "number", isId: "uuid" } })], /`isId: "uuid"` needs a string property/],
        ["an empty string enum", () => [collection("t", { id: uuidKey, e: { type: "string", enum: [] } })], /empty `enum`/],
        ["excludeFromApi with access", () => [collection("t", { id: uuidKey, s: { type: "string", excludeFromApi: true, access: { read: [] } } })], /both `excludeFromApi` and `access`/],
        ["two defaults", () => [collection("t", { id: uuidKey, s: { type: "string", databaseDefault: true, defaultValue: "x" } })], /both a `databaseDefault` and a `defaultValue`/],
        ["a key strategy with a default", () => [collection("t", { id: { type: "string", isId: "uuid", defaultValue: "x" } })], /key strategy and a `defaultValue`/],
        ["no rules and no default policies", () => [collection("t", { id: uuidKey }, { disableDefaultPolicies: true })], /leaves no policy at all/],
        ["a belongsTo over a column nobody declares", () => [collection("t", { id: uuidKey }, { relations: [{ kind: "belongsTo", relationName: "author", target: () => authors }] }), authors], /^t\.author: is a `belongsTo` declared only in `relations`, over the column "author_id", which no property declares/],
        ["an inline relation named after another key", () => [collection("t", { id: uuidKey, a: { type: "relation", relation: { kind: "belongsTo", relationName: "b", target: () => authors } } }), authors], /^t\.a: declares an inline relation named "b"/],
        ["a relation property naming no relation", () => [collection("t", { id: uuidKey, a: { type: "relation" } })], /no relation named "a" is declared/],
        ["a lone relation key", () => [collection("t", { a: { type: "relation", isId: true, relation: { kind: "belongsTo", target: () => authors } } }), authors], /is the only `isId` property, and it is a relation/],
        ["callbacks on a relation property", () => [collection("t", { id: uuidKey, a: { type: "relation", callbacks: { afterRead: ({ value }) => value }, relation: { kind: "hasMany", target: () => authors } } }), authors], /^t\.a: is a hasMany relation property declaring `callbacks`\. .*move the logic into the table's `hooks`/],
        ["excludeFromApi with access on a relation property", () => [collection("t", { id: uuidKey, a: { type: "relation", excludeFromApi: true, access: { read: [] }, relation: { kind: "hasMany", target: () => authors } } }), authors], /^t\.a: declares both `excludeFromApi` and `access`/],
        ["a view with tenant", () => [collection("t", { id: { type: "string", isId: true } }, { view: { query: "SELECT 1" }, tenant: { field: "id", from: { claim: "x" } } })], /serves a view and declares `tenant`/]
    ])("refuses %s", (_name, collections, pattern) => {
        expect(refusal(() => collectionsToTableDefs(collections()))).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
    });

    it("refuses a vector index distance that is not a pgvector distance, rather than dropping it", () => {
        // A project loaded at run time can hold what the frozen type forbids.
        const loaded = (json: string): LegacyVectorIndexConfig => JSON.parse(json);
        for (const index of [loaded("{\"distance\":\"hamming\"}"), loaded("{\"distance\":[\"cosine\",\"hamming\"]}")]) {
            const t = collection("t", { id: uuidKey, embedding: { type: "vector", dimensions: 3, index } });
            expect(refusal(() => collectionsToTableDefs([t]))).toEqual([
                expect.stringMatching(/^t\.embedding: declares the vector index distance "hamming", which is not one of "cosine", "l2", "inner_product"/)
            ]);
        }
    });

    it("reports a collection once, however many relations point at it", () => {
        const broken = collection("broken", { id: { type: "string", isId: "cuid" } });
        const a = collection("a", { id: uuidKey, x: { type: "relation", relation: { kind: "belongsTo", target: () => broken } } });
        const b = collection("b", { id: uuidKey, x: { type: "relation", relation: { kind: "belongsTo", target: () => broken } } });
        expect(refusal(() => collectionsToTableDefs([a, b, broken])).filter(problem => problem.startsWith("broken"))).toHaveLength(1);
    });
});
