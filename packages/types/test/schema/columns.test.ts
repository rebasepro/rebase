import { col, isColumnBuilder, json, normalizeStorage, normalizeValidation, parseByteSize, pgEnum, sql } from "../../src/schema";
import type { ColumnDef, ColumnType } from "../../src/schema";
import { bucket } from "../../src/types/resource_kinds";
import { resetDeclaredResources } from "../../src/types/resources";

/**
 * The runtime behaviour of every `col.*` builder: what each records in its
 * definition, that modifiers never mutate the builder they are called on, how
 * validation and storage options are normalized, and every refusal.
 */

const base = { notNull: false, primaryKey: false, unique: false, readOnly: false, private: false };

describe("col.* — what each builder records", () => {
    const sharedEnum = pgEnum("shared", ["a"]);

    it.each<[string, ColumnType, () => ColumnDef]>([
        ["uuid", { kind: "uuid" }, () => col.uuid().def],
        ["text", { kind: "text" }, () => col.text().def],
        ["varchar()", { kind: "varchar", length: 255 }, () => col.varchar({ length: 255 }).def],
        ["varchar(160)", { kind: "varchar", length: 160 }, () => col.varchar({ length: 160 }).def],
        ["char()", { kind: "char", length: 255 }, () => col.char({ length: 255 }).def],
        ["char(2)", { kind: "char", length: 2 }, () => col.char({ length: 2 }).def],
        ["enum", { kind: "enum", values: ["a", "b"] }, () => col.enum(["a", "b"]).def],
        ["enum named", { kind: "enum", values: ["a"], name: "shared" }, () => sharedEnum().def],
        ["smallint", { kind: "smallint" }, () => col.smallint().def],
        ["integer", { kind: "integer" }, () => col.integer().def],
        ["bigint", { kind: "bigint" }, () => col.bigint({ mode: "number" }).def],
        ["smallserial", { kind: "smallserial" }, () => col.smallserial().def],
        ["serial", { kind: "serial" }, () => col.serial().def],
        ["bigserial", { kind: "bigserial" }, () => col.bigserial({ mode: "number" }).def],
        ["real", { kind: "real" }, () => col.real().def],
        ["doublePrecision", { kind: "doublePrecision" }, () => col.doublePrecision().def],
        ["numeric()", { kind: "numeric" }, () => col.numeric().def],
        ["numeric(10)", { kind: "numeric", precision: 10 }, () => col.numeric({ precision: 10 }).def],
        ["numeric(10, 2)", { kind: "numeric", precision: 10, scale: 2 }, () => col.numeric({ precision: 10, scale: 2 }).def],
        ["boolean", { kind: "boolean" }, () => col.boolean().def],
        ["timestamptz", { kind: "timestamptz" }, () => col.timestamp({ withTimezone: true }).def],
        ["date", { kind: "date" }, () => col.date().def],
        ["time", { kind: "time" }, () => col.time().def],
        ["jsonb", { kind: "jsonb" }, () => col.jsonb().def],
        ["json", { kind: "json" }, () => col.json().def],
        ["array", { kind: "array", of: { kind: "integer" } }, () => col.integer().array().def],
        ["vector", { kind: "vector", dimensions: 3 }, () => col.vector({ dimensions: 3 }).def],
        ["bytea", { kind: "bytea" }, () => col.bytea().def],
        ["geopoint", { kind: "jsonb" }, () => col.geopoint().def],
        ["storage", { kind: "text" }, () => col.storage({ path: "p/" }).def]
    ])("col.%s", (_label, type, build) => {
        expect(build()).toMatchObject({ ...base, type });
    });

    it("starts nullable, writable and served, with nothing else said", () => {
        expect(col.text().def).toEqual({ type: { kind: "text" }, ...base });
    });

    it("marks a geopoint and a storage column with what the type does not say", () => {
        expect(col.geopoint().def.semantic).toBe("geopoint");
        expect(col.storage({ path: "posts/", accept: ["image/*"], maxBytes: "10MB" }).def.storage)
            .toEqual({ path: "posts/", accept: ["image/*"], maxBytes: 10 * 1024 * 1024 });
    });

    it("keeps the element definition of an array, and a storage element's rules", () => {
        const labels = col.text({ enum: ["a", "b"] }).array();
        expect(labels.def.element).toMatchObject({ type: { kind: "text" }, oneOf: ["a", "b"] });
        const files = col.storage({ path: "f/" }).array();
        expect(files.def.storage).toEqual({ path: "f/" });
    });

    it("`.multiple()` turns a storage column into TEXT[] of paths", () => {
        const gallery = col.storage({ path: "g/", maxBytes: 100 }).validate({ max: 10 }).multiple();
        expect(gallery.def.type).toEqual({ kind: "array", of: { kind: "text" } });
        expect(gallery.def.storage).toEqual({ path: "g/", maxBytes: 100 });
        expect(gallery.def.validate).toBeUndefined();
        expect(gallery.def.element).toMatchObject({ type: { kind: "text" }, storage: { path: "g/", maxBytes: 100 }, validate: { max: 10 } });
    });

    it("records the vector index, or `false` for none", () => {
        expect(col.vector({ dimensions: 3 }).def.vectorIndex).toBeUndefined();
        expect(col.vector({ dimensions: 3, index: false }).def.vectorIndex).toBe(false);
        expect(col.vector({ dimensions: 3, index: { method: "ivfflat", metric: ["l2", "ip"], lists: 100 } }).def.vectorIndex)
            .toEqual({ method: "ivfflat", metric: ["l2", "ip"], lists: 100 });
    });

    it("records a JSON shape when one is given", () => {
        expect(col.jsonb(json.object({ a: json.string() })).def.json).toEqual({ kind: "object", fields: { a: { kind: "string" } } });
        expect(col.json(json.array(json.number())).def.json).toEqual({ kind: "array", of: { kind: "number" } });
        expect(col.jsonb().$type<{ a: string }>().def.json).toBeUndefined();
    });
});

describe("col.* — modifiers", () => {
    it("records every universal modifier", () => {
        const transform = { beforeSave: ({ value }: { value: string }) => value.trim() };
        const def: ColumnDef = col.text("legacy_name")
            .notNull()
            .unique()
            .readOnly()
            .access({ read: ["admin"], write: ["editor"] })
            .describe("A name")
            .validate({ min: 1 })
            .transform(transform)
            .def;
        expect(def).toMatchObject({
            column: "legacy_name", notNull: true, unique: true, readOnly: true,
            access: { read: ["admin"], write: ["editor"] }, description: "A name", validate: { min: 1 }
        });
        expect(def.transform?.beforeSave).toBe(transform.beforeSave);
    });

    it("`.primaryKey()` implies NOT NULL", () => {
        expect(col.uuid().primaryKey().def).toMatchObject({ primaryKey: true, notNull: true });
    });

    it("records each kind of default", () => {
        expect(col.text().default("x").def.default).toEqual({ kind: "literal", value: "x" });
        expect(col.timestamp({ withTimezone: true }).default(new Date("2024-01-02T03:04:05.000Z")).def.default)
            .toEqual({ kind: "literal", value: "2024-01-02T03:04:05.000Z" });
        expect(col.text().default(sql`gen_short_id()`).def.default).toEqual({ kind: "sql", expression: "gen_short_id()" });
        expect(col.text().dbDefault().def.default).toEqual({ kind: "database" });
        expect(col.uuid().defaultRandom().def.default).toEqual({ kind: "random-uuid" });
        expect(col.integer().generatedByDefaultAsIdentity().def.default).toEqual({ kind: "identity" });
        expect(col.smallint().generatedByDefaultAsIdentity().def.default).toEqual({ kind: "identity" });
        expect(col.bigint({ mode: "number" }).generatedByDefaultAsIdentity().def.default).toEqual({ kind: "identity" });
    });

    it("`.generatedAs()` makes the column read-only", () => {
        expect(col.integer().generatedAlwaysAs(sql`a + b`).def).toMatchObject({ generatedAs: "a + b", readOnly: true });
    });

    it("`.private()` records the flag", () => {
        expect(col.text().private().def.private).toBe(true);
    });

    it("records the stamps", () => {
        expect(col.timestamp({ withTimezone: true }).onCreateNow().def.stamp).toEqual({ on: "create", value: "now" });
        expect(col.date().onUpdateNow().def.stamp).toEqual({ on: "update", value: "now" });
        expect(col.uuid().onCreateUser().def.stamp).toEqual({ on: "create", value: "user" });
        expect(col.text().onUpdateUser().def.stamp).toEqual({ on: "update", value: "user" });
        expect(col.timestamp({ withTimezone: true }).onCreateNow().onCreateNow().def.stamp).toEqual({ on: "create", value: "now" });
    });

    it("refuses a second, different stamp", () => {
        expect(() => col.timestamp({ withTimezone: true }).onCreateNow().onUpdateNow())
            .toThrow("`.onUpdateNow()` on a column that already has `.onCreateNow()`: a column holds one stamp.");
        expect(() => col.uuid().onCreateUser().onUpdateUser()).toThrow(/already has `\.onCreateUser\(\)`/);
    });

    it("`.userId()` marks a text or uuid column as holding a user's id", () => {
        for (const builder of [col.text(), col.varchar({ length: 64 }), col.char({ length: 36 }), col.uuid()]) {
            expect(builder.userId().def.semantic).toBe("user");
        }
        // It is a meaning, not a stamp: both may be said.
        expect(col.uuid().onCreateUser().userId().def).toMatchObject({ semantic: "user", stamp: { on: "create", value: "user" } });
        expect(col.text().userId().array().def.element?.semantic).toBe("user");
    });

    it("refuses `.userId()` at runtime on a column that cannot hold an id", () => {
        // @ts-expect-error userId is a text or uuid modifier
        expect(() => col.integer().userId()).toThrow("`.userId()` on a `integer` column: a user's id is held by `col.text()`, `col.varchar()`, `col.char()` or `col.uuid()`.");
        // @ts-expect-error a stored file's path is not a user's id
        expect(() => col.storage({ path: "x/" }).userId()).toThrow("`.userId()` on `col.storage()`");
    });

    it("records `.oneOf()` for text and numbers, and refuses anything else at runtime", () => {
        expect(col.text({ enum: ["a", "b"] }).def.oneOf).toEqual(["a", "b"]);
        expect(col.integer().oneOf([1, 2]).def.oneOf).toEqual([1, 2]);
        expect(() => col.integer().oneOf(JSON.parse("[true]"))).toThrow("`.oneOf()` takes strings or numbers.");
        expect(() => col.text({ enum: JSON.parse("[true]") })).toThrow("`col.text({ enum })` takes a non-empty list of strings, got [true].");
    });

    it("`.access()` copies the role lists and keeps only the directions given", () => {
        const read = ["admin"];
        const def = col.text().access({ read }).def;
        read.push("intruder");
        expect(def.access).toEqual({ read: ["admin"] });
    });

    it("`.access()` refuses what is not a list of role names, as a JavaScript caller can write it", () => {
        const untyped: (access: unknown) => unknown = access => col.text().access(JSON.parse(JSON.stringify(access)));
        // A string would otherwise be spread into one role per character.
        expect(() => untyped({ read: "admin" })).toThrow("`access.read` of a column (`.access()`) must be a list of role names, got \"admin\"");
        expect(() => untyped({ write: ["admin", ""] })).toThrow("`access.write` of a column (`.access()`) must be a list of role names");
        expect(() => untyped({ write: [1] })).toThrow("must be a list of role names, got [1]");
        expect(() => untyped({ reed: ["admin"] })).toThrow("has an unknown key \"reed\"");
        expect(() => untyped(["admin"])).toThrow("must be an object of role lists");
        expect(() => untyped(null)).toThrow("must be an object of role lists");
        // Empty lists are meaningful (nobody), and accepted.
        expect(col.text().access({ read: [], write: [] }).def.access).toEqual({ read: [], write: [] });
    });

    it("merges successive `.validate()` calls", () => {
        expect(col.text().validate({ min: 1 }).validate({ max: 5, trim: true }).def.validate).toEqual({ min: 1, max: 5, trim: true });
    });

    it("is immutable: every modifier returns a new builder and leaves the first alone", () => {
        const plain = col.text();
        const before = JSON.stringify(plain.def);
        const modified = plain.notNull().unique().default("x").validate({ min: 1 }).column("c").describe("d").readOnly().private();
        expect(modified).not.toBe(plain);
        expect(JSON.stringify(plain.def)).toBe(before);
        const shared = col.timestamp({ withTimezone: true });
        const a = shared.onCreateNow();
        const b = shared.onUpdateNow();
        expect([a.def.stamp, b.def.stamp, shared.def.stamp]).toEqual([{ on: "create", value: "now" }, { on: "update", value: "now" }, undefined]);
    });
});

describe("col.* — refusals", () => {
    it("refuses a non-positive or fractional varchar/char length", () => {
        expect(() => col.varchar({ length: 0 })).toThrow("`col.varchar({ length })` takes a positive whole number of characters, got 0.");
        expect(() => col.char({ length: 1.5 })).toThrow("`col.char({ length })` takes a positive whole number of characters, got 1.5.");
    });

    it("refuses an empty enum", () => {
        expect(() => col.enum(JSON.parse("[]"))).toThrow("`col.enum([...])` needs at least one value.");
    });

    it("refuses a numeric scale without a precision", () => {
        expect(() => col.numeric(undefined, 2)).toThrow("`col.numeric(precision, scale)`: a scale needs a precision.");
    });

    it("refuses a non-positive vector dimension", () => {
        expect(() => col.vector({ dimensions: 0 })).toThrow("`col.vector({ dimensions })` takes a positive whole number, got 0.");
        expect(() => col.vector({ dimensions: 2.5 })).toThrow(/got 2.5/);
    });

    it("refuses an array of arrays", () => {
        expect(() => col.array(col.text().array())).toThrow("`col.array()` of an array is not supported. Use `col.jsonb()` for nested lists.");
    });

    it("refuses a storage column without a path", () => {
        expect(() => col.storage({ path: "" })).toThrow(/needs a `path`/);
    });
});

describe("normalization", () => {
    it("keeps a RegExp as its source and flags, and a Date bound as an ISO string", () => {
        expect(normalizeValidation({ matches: /^[a-z]+$/gi })).toEqual({ matches: "^[a-z]+$", matchesFlags: "gi" });
        expect(normalizeValidation({ matches: /x/ })).toEqual({ matches: "x" });
        expect(normalizeValidation({ min: new Date("2024-01-01T00:00:00.000Z"), max: "2025-01-01" }))
            .toEqual({ min: "2024-01-01T00:00:00.000Z", max: "2025-01-01" });
        expect(normalizeValidation({ min: 1, max: undefined })).toEqual({ min: 1 });
        expect(col.date().validate({ min: new Date("2024-01-01T00:00:00.000Z") }).def.validate).toEqual({ min: "2024-01-01T00:00:00.000Z" });
    });

    it("reads byte sizes in binary multiples, and refuses what it cannot read", () => {
        expect(parseByteSize(512)).toBe(512);
        expect(parseByteSize("10MB")).toBe(10 * 1024 * 1024);
        expect(parseByteSize("512 kb")).toBe(512 * 1024);
        expect(parseByteSize("1.5GB")).toBe(Math.round(1.5 * 1024 ** 3));
        expect(parseByteSize("2tb")).toBe(2 * 1024 ** 4);
        expect(parseByteSize("100")).toBe(100);
        expect(() => parseByteSize("ten megabytes")).toThrow("Cannot read \"ten megabytes\" as a byte size. Write a number of bytes, or a size such as \"10MB\".");
        expect(() => parseByteSize(-1)).toThrow("A byte size must be a non-negative number, got -1.");
        expect(() => parseByteSize(Number.NaN)).toThrow(/non-negative/);
    });

    it("stores storage options with the bucket by key and the size in bytes, copying lists", () => {
        const accept = ["image/*"];
        const stored = normalizeStorage({
            source: bucket("media"),
            path: "p/",
            accept,
            maxBytes: "1KB",
            imageResize: { maxWidth: 10 },
            public: true,
            fileName: "{rand}",
            metadata: { a: 1 },
            includeBucketUrl: false,
            storeUrl: true
        });
        accept.push("video/*");
        expect(stored).toEqual({
            source: "media", path: "p/", accept: ["image/*"], maxBytes: 1024, imageResize: { maxWidth: 10 },
            public: true, fileName: "{rand}", metadata: { a: 1 }, includeBucketUrl: false, storeUrl: true
        });
        expect(normalizeStorage({ path: "p/", source: "files" })).toEqual({ path: "p/", source: "files" });
        resetDeclaredResources();
    });
});

describe("isColumnBuilder", () => {
    it("recognises a builder by its brand, from any copy of the package", () => {
        expect(isColumnBuilder(col.text())).toBe(true);
        expect(isColumnBuilder({ brand: "rebase.column", def: {} })).toBe(true);
        expect(isColumnBuilder({ def: {} })).toBe(false);
        expect(isColumnBuilder(null)).toBe(false);
        expect(isColumnBuilder("text")).toBe(false);
    });
});

describe("col.custom", () => {
    it("records the type it names, verbatim, as `other`", () => {
        expect(col.custom({ dataType: "inet" }).def).toEqual({ type: { kind: "other", sqlType: "inet" }, ...base });
        expect(col.custom({ dataType: "  geometry(Point, 4326) " }).notNull().def.type).toEqual({ kind: "other", sqlType: "geometry(Point, 4326)" });
        expect(col.custom({ dataType: "citext" }).primaryKey().def).toMatchObject({ primaryKey: true, notNull: true });
    });

    it("refuses a name that is empty or could end the DDL it is written into", () => {
        expect(() => col.custom({ dataType: "" })).toThrow(/takes the Postgres type/);
        expect(() => col.custom({ dataType: "inet; DROP TABLE x" })).toThrow(/holds no `;` and no comment/);
        expect(() => col.custom({ dataType: "inet -- x" })).toThrow(/holds no `;` and no comment/);
    });
});
