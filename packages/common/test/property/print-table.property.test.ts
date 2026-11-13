/**
 * For all columns the builders can produce, printing the column and
 * evaluating the printed chain gives back the same definition.
 *
 * Columns are generated through the real `col.*` builders (never as raw
 * `ColumnDef` objects), so the claim is about what an author can write: each
 * generator below picks a type builder and then a random subset of the
 * modifiers that type accepts, applied in a random order where the builder
 * allows it. Excluded, and why:
 *
 * - transforms: a function cannot be printed from its value — the printer
 *   takes its source from the caller, which the example suite covers;
 * - a leading SQL name equal to the key's snake_case: the printer leaves it out
 *   by design, so the comparison resolves the SQL name on both sides;
 * - stamps on an array's items: a stamp describes the column, and nothing that
 *   describes the column can come before `.array()`.
 */
import { describe, expect, it } from "@jest/globals";
import fc from "fast-check";
import { col, json, pgEnum, sql } from "@rebasepro/types";
import type { AnyColumn, AnyJsonField, ColumnBuilder, ColumnFlags, NumericColumnKind, SqlTemplate, TextColumnKind, VectorConfig } from "@rebasepro/types";

import { printColumn } from "../../src/schema/print-table";
import { comparableColumn, evaluateColumn } from "../schema/print-eval";

const word = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
const roles = fc.array(word, { maxLength: 3 });
/** Any string at all — quotes, backslashes, newlines, unicode — as a value. */
const anyString = fc.string({ unit: "binary", maxLength: 12 });
const patterns = fc.constantFrom<[string | RegExp, string | undefined]>(
    ["^[a-z]+$", undefined],
    ["^\\d{3}-\\d{4}$", undefined],
    ["a/b", undefined],
    ["^x$", "i"],
    [/^\+?[0-9 ]+$/, undefined],
    [/a\/b/gi, undefined],
    ["[", undefined],
    ["^x$", ""]
);

type Universal = {
    column?: string;
    primaryKey: boolean;
    notNull: boolean;
    unique: boolean;
    readOnly: boolean;
    private: boolean;
    access?: { read?: string[]; write?: string[] };
    describe?: string;
    defaultSql?: string;
    dbDefault: boolean;
    generatedAs?: string;
};

const universal: fc.Arbitrary<Universal> = fc.record({
    column: fc.option(word, { nil: undefined }),
    primaryKey: fc.boolean(),
    notNull: fc.boolean(),
    unique: fc.boolean(),
    readOnly: fc.boolean(),
    private: fc.boolean(),
    access: fc.option(fc.record({ read: roles, write: roles }, { requiredKeys: [] }), { nil: undefined }),
    describe: fc.option(anyString, { nil: undefined }),
    defaultSql: fc.option(fc.constantFrom("now()", "gen_short_id()", "'it''s'"), { nil: undefined }),
    dbDefault: fc.boolean(),
    generatedAs: fc.option(fc.constantFrom("1 + 1", "lower(\"name\")"), { nil: undefined })
});

/** A generated SQL expression as a `sql` template: what `` sql`…` `` builds from the same text. */
function sqlText(text: string): SqlTemplate {
    return sql(Object.assign([text], { raw: [text] }));
}

/** A builder, given the SQL column name the generator picked (or none). */
type Start<D, K extends BuilderKindUsed> = (name: string | undefined) => ColumnBuilder<D, K, ColumnFlags>;
type BuilderKindUsed = TextColumnKind | NumericColumnKind | "uuid" | "boolean" | "timestamptz" | "date" | "time" | "jsonb" | "json" | "bytea" | "array" | "storage" | "geopoint" | "vector" | "enum";

/**
 * Build the column with its SQL name, then apply the modifiers every builder
 * has, in a fixed order the result does not depend on.
 */
function applyUniversal<D, K extends BuilderKindUsed>(start: Start<D, K>, mods: Universal): ColumnBuilder<D, K, ColumnFlags> {
    let builder = start(mods.column);
    if (mods.notNull) builder = builder.notNull();
    if (mods.primaryKey) builder = builder.primaryKey();
    if (mods.unique) builder = builder.unique();
    if (mods.defaultSql !== undefined) builder = builder.default(sqlText(mods.defaultSql));
    else if (mods.dbDefault) builder = builder.dbDefault();
    if (mods.generatedAs !== undefined) builder = builder.generatedAlwaysAs(sqlText(mods.generatedAs));
    if (mods.readOnly) builder = builder.readOnly();
    if (mods.private) builder = builder.private();
    if (mods.access !== undefined) builder = builder.access(mods.access);
    if (mods.describe !== undefined) builder = builder.describe(mods.describe);
    return builder;
}

const textColumn: fc.Arbitrary<AnyColumn> = fc.record({
    base: fc.constantFrom<Start<string, TextColumnKind>>(
        name => col.text(name),
        name => name === undefined ? col.varchar({ length: 255 }) : col.varchar(name, { length: 255 }),
        name => name === undefined ? col.varchar({ length: 40 }) : col.varchar(name, { length: 40 }),
        name => name === undefined ? col.char({ length: 3 }) : col.char(name, { length: 3 })
    ),
    mods: universal,
    literal: fc.option(anyString, { nil: undefined }),
    oneOf: fc.option(fc.array(anyString, { minLength: 1, maxLength: 4 }), { nil: undefined }),
    validate: fc.option(fc.record({
        min: fc.nat(10),
        max: fc.nat(500),
        length: fc.nat(20),
        email: fc.boolean(),
        url: fc.boolean(),
        lowercase: fc.boolean(),
        trim: fc.boolean(),
        matchesMessage: anyString,
        requiredMessage: anyString
    }, { requiredKeys: [] }), { nil: undefined }),
    pattern: fc.option(patterns, { nil: undefined }),
    stamp: fc.constantFrom(undefined, "create", "update")
}).map(({ base, mods, literal, oneOf, validate, pattern, stamp }) => {
    let builder: ColumnBuilder<string, TextColumnKind, ColumnFlags> = applyUniversal(base, mods);
    if (literal !== undefined) builder = builder.default(literal);
    if (stamp === "create") builder = builder.onCreateUser();
    if (stamp === "update") builder = builder.onUpdateUser();
    if (oneOf !== undefined) builder = builder.oneOf(oneOf);
    if (validate !== undefined || pattern !== undefined) {
        const rules = { ...validate };
        if (pattern !== undefined) {
            const [matches, flags] = pattern;
            Object.assign(rules, flags === undefined ? { matches } : { matches, matchesFlags: flags });
        }
        builder = builder.validate(rules);
    }
    return builder;
});

const numberColumn: fc.Arbitrary<AnyColumn> = fc.record({
    base: fc.constantFrom<Start<number, NumericColumnKind>>(
        name => col.smallint(name), name => col.integer(name),
        name => name === undefined ? col.bigint({ mode: "number" }) : col.bigint(name, { mode: "number" }),
        name => col.real(name), name => col.doublePrecision(name),
        name => col.numeric(name), name => col.numeric(name, { precision: 12 }), name => col.numeric(name, { precision: 12, scale: 4 }),
        name => col.serial(name), name => col.smallserial(name),
        name => name === undefined ? col.bigserial({ mode: "number" }) : col.bigserial(name, { mode: "number" })
    ),
    mods: universal,
    literal: fc.option(fc.oneof(fc.integer(), fc.double()), { nil: undefined }),
    oneOf: fc.option(fc.array(fc.integer(), { minLength: 1, maxLength: 4 }), { nil: undefined }),
    validate: fc.option(fc.record({
        min: fc.integer(), max: fc.integer(), lessThan: fc.double({ noNaN: true }), moreThan: fc.integer(),
        positive: fc.boolean(), negative: fc.boolean(), integer: fc.boolean()
    }, { requiredKeys: [] }), { nil: undefined })
}).map(({ base, mods, literal, oneOf, validate }) => {
    let builder: ColumnBuilder<number, NumericColumnKind, ColumnFlags> = applyUniversal(base, mods);
    if (literal !== undefined) builder = builder.default(literal);
    if (oneOf !== undefined) builder = builder.oneOf(oneOf);
    if (validate !== undefined) builder = builder.validate(validate);
    return builder;
});

const identityColumn: fc.Arbitrary<AnyColumn> = fc.record({
    base: fc.constantFrom<Start<number, "smallint" | "integer" | "bigint">>(
        name => col.smallint(name), name => col.integer(name),
        name => name === undefined ? col.bigint({ mode: "number" }) : col.bigint(name, { mode: "number" })
    ),
    mods: universal
}).map(({ base, mods }) => applyUniversal(name => base(name).generatedByDefaultAsIdentity(), { ...mods, defaultSql: undefined, dbDefault: false }));

const uuidColumn: fc.Arbitrary<AnyColumn> = fc.record({
    mods: universal,
    random: fc.boolean(),
    stamp: fc.constantFrom(undefined, "create", "update")
}).map(({ mods, random, stamp }) => applyUniversal(name => {
    let builder: ColumnBuilder<string, "uuid", ColumnFlags> = col.uuid(name);
    if (random) builder = builder.defaultRandom();
    if (stamp === "create") builder = builder.onCreateUser();
    if (stamp === "update") builder = builder.onUpdateUser();
    return builder;
}, random ? { ...mods, defaultSql: undefined, dbDefault: false } : mods));

const temporalColumn: fc.Arbitrary<AnyColumn> = fc.record({
    base: fc.constantFrom<Start<string, "timestamptz" | "date" | "time">>(
        name => name === undefined ? col.timestamp({ withTimezone: true }) : col.timestamp(name, { withTimezone: true }),
        name => col.date(name),
        name => col.time(name)
    ),
    mods: universal,
    stamp: fc.constantFrom(undefined, "create", "update"),
    literal: fc.option(fc.date({ min: new Date("1970-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z"), noInvalidDate: true }), { nil: undefined }),
    bounds: fc.option(fc.record({ min: fc.constant("2020-01-01"), max: fc.date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z"), noInvalidDate: true }) }, { requiredKeys: [] }), { nil: undefined })
}).map(({ base, mods, stamp, literal, bounds }) => {
    let builder: ColumnBuilder<string, "timestamptz" | "date" | "time", ColumnFlags> = applyUniversal(base, mods);
    if (literal !== undefined) builder = builder.default(literal);
    if (stamp === "create") builder = builder.onCreateNow();
    if (stamp === "update") builder = builder.onUpdateNow();
    if (bounds !== undefined) builder = builder.validate(bounds);
    return builder;
});

const enumColumn: fc.Arbitrary<AnyColumn> = fc.record({
    values: fc.uniqueArray(word, { minLength: 1, maxLength: 4 }),
    name: fc.option(word, { nil: undefined }),
    mods: universal,
    pickDefault: fc.boolean()
}).map(({ values, name, mods, pickDefault }) => {
    const [first, ...rest] = values;
    const labels: [string, ...string[]] = [first, ...rest];
    let builder: ColumnBuilder<string, "enum", ColumnFlags> = applyUniversal(column => {
        if (name !== undefined) return pgEnum(name, labels)(column);
        return column === undefined ? col.enum(labels) : col.enum(column, labels);
    }, mods);
    if (pickDefault) builder = builder.default(first);
    return builder;
});

const leafShape: fc.Arbitrary<AnyJsonField> = fc.oneof(
    fc.record({ required: fc.boolean(), max: fc.option(fc.nat(99), { nil: undefined }), oneOf: fc.option(fc.array(anyString, { minLength: 1, maxLength: 3 }), { nil: undefined }), text: fc.option(anyString, { nil: undefined }) })
        .map(({ required, max, oneOf, text }) => {
            let field: AnyJsonField = json.string();
            if (oneOf !== undefined) field = json.string().oneOf(oneOf);
            if (max !== undefined) field = json.string().validate({ max });
            if (text !== undefined) field = field.describe(text);
            return required ? field.required() : field;
        }),
    fc.record({ fallback: fc.option(fc.integer(), { nil: undefined }) }).map(({ fallback }) => fallback === undefined ? json.number() : json.number().default(fallback)),
    fc.constant(json.boolean().default(true)),
    fc.constantFrom(json.date(), json.date().onCreateNow(), json.date().onUpdateNow()),
    fc.constant(json.geopoint()),
    fc.constant(json.unknown()),
    fc.constant(json.storage({ path: "nested/", maxBytes: "1MB" }))
);

const shape: fc.Arbitrary<AnyJsonField> = fc.letrec<{ node: AnyJsonField }>(tie => ({
    node: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        leafShape,
        fc.record({ fields: fc.dictionary(word, tie("node"), { maxKeys: 3 }), additional: fc.boolean() })
            .map(({ fields, additional }) => json.object(fields, { additional })),
        tie("node").map(of => json.array(of)),
        fc.record({ variants: fc.dictionary(word, tie("node"), { minKeys: 1, maxKeys: 2 }), typeField: fc.constantFrom("type", "kind"), valueField: fc.constantFrom("value", "data") })
            .map(({ variants, typeField, valueField }) => json.oneOf(variants, { typeField, valueField }))
    )
})).node;

const jsonColumn: fc.Arbitrary<AnyColumn> = fc.record({
    binary: fc.boolean(),
    shape: fc.option(shape, { nil: undefined }),
    mods: universal
}).map(({ binary, shape: field, mods }) => {
    if (field === undefined) return applyUniversal(name => binary ? col.jsonb(name) : col.json(name), mods);
    return applyUniversal(name => {
        if (name === undefined) return binary ? col.jsonb(field) : col.json(field);
        return binary ? col.jsonb(name, field) : col.json(name, field);
    }, mods);
});

const storageOptions = fc.record({
    source: fc.option(word, { nil: undefined }),
    path: fc.constantFrom("a/", "users/{id}/"),
    accept: fc.option(fc.array(fc.constantFrom("image/*", "application/pdf"), { maxLength: 2 }), { nil: undefined }),
    maxBytes: fc.option(fc.oneof(fc.nat(5_000_000), fc.constantFrom("10MB", "512KB", "1.5GB")), { nil: undefined }),
    public: fc.option(fc.boolean(), { nil: undefined }),
    fileName: fc.option(fc.constant("{file}"), { nil: undefined })
}, { requiredKeys: ["path"] });

const storageColumn: fc.Arbitrary<AnyColumn> = fc.record({
    options: storageOptions,
    multiple: fc.boolean(),
    perFile: fc.option(fc.record({ max: fc.nat(200) }), { nil: undefined }),
    items: fc.option(fc.record({ maxItems: fc.nat(10) }), { nil: undefined }),
    mods: universal
}).map(({ options, multiple, perFile, items, mods }) => {
    const validated = (name: string | undefined): ColumnBuilder<string, "storage"> => {
        const single = name === undefined ? col.storage(options) : col.storage(name, options);
        return perFile !== undefined ? single.validate(perFile) : single;
    };
    if (!multiple) return applyUniversal(validated, mods);
    const many: ColumnBuilder<string[], "array", ColumnFlags> = applyUniversal(name => validated(name).multiple(), mods);
    return items !== undefined ? many.validate(items) : many;
});

/** The item types an array is generated over, each with the rules that describe one item. */
type ItemKind = "text" | "textEnum" | "varchar" | "userId" | "integer" | "numeric" | "uuid" | "enum" | "date" | "timestamp" | "time";

/**
 * An array column: the item builder (named with the column's SQL name, as
 * Drizzle names an array), the item's own rules, then `.array()`.
 */
function arrayOf(kind: ItemKind, name: string | undefined, labels: [string, ...string[]], ruled: boolean, text: string | undefined): ColumnBuilder<unknown[], "array", ColumnFlags> {
    switch (kind) {
        case "text": {
            let item = col.text(name);
            if (ruled) item = item.validate({ max: 20, trim: true });
            return (text === undefined ? item : item.describe(text)).array();
        }
        case "textEnum": {
            const item = name === undefined ? col.text({ enum: labels }) : col.text(name, { enum: labels });
            return (text === undefined ? item : item.describe(text)).array();
        }
        case "varchar": {
            const item = name === undefined ? col.varchar({ length: 40 }) : col.varchar(name, { length: 40 });
            return (ruled ? item.validate({ min: 1 }) : item).array();
        }
        case "userId": return col.text(name).userId().array();
        case "integer": {
            const item = col.integer(name);
            return (ruled ? item.validate({ min: 0, integer: true }) : item).array();
        }
        case "numeric": return col.numeric(name, { precision: 12, scale: 4 }).array();
        case "uuid": return col.uuid(name).array();
        case "enum": return (name === undefined ? col.enum(labels) : col.enum(name, labels)).array();
        case "date": {
            const item = col.date(name);
            return (ruled ? item.validate({ min: "2020-01-01" }) : item).array();
        }
        case "timestamp": return (name === undefined ? col.timestamp({ withTimezone: true }) : col.timestamp(name, { withTimezone: true })).array();
        case "time": return col.time(name).array();
    }
}

const arrayColumn: fc.Arbitrary<AnyColumn> = fc.record({
    kind: fc.constantFrom<ItemKind>("text", "textEnum", "varchar", "userId", "integer", "numeric", "uuid", "enum", "date", "timestamp", "time"),
    labels: fc.uniqueArray(word, { minLength: 1, maxLength: 4 }),
    ruled: fc.boolean(),
    text: fc.option(anyString, { nil: undefined }),
    mods: universal,
    items: fc.option(fc.record({ minItems: fc.nat(3), maxItems: fc.nat(30), uniqueItems: fc.boolean() }, { requiredKeys: [] }), { nil: undefined })
}).map(({ kind, labels, ruled, text, mods, items }) => {
    const [first, ...rest] = labels;
    const builder = applyUniversal(name => arrayOf(kind, name, [first, ...rest], ruled, text), mods);
    return items !== undefined ? builder.validate(items) : builder;
});

/** `col.vector(config)`, with the SQL name first when there is one. */
function vector(name: string | undefined, config: VectorConfig): ColumnBuilder<number[], "vector"> {
    return name === undefined ? col.vector(config) : col.vector(name, config);
}

const otherColumn: fc.Arbitrary<AnyColumn> = fc.record({
    which: fc.constantFrom("boolean", "bytea", "geopoint", "vector", "vectorNoIndex", "vectorIndexed"),
    mods: universal,
    flag: fc.boolean()
}).map(({ which, mods, flag }) => {
    switch (which) {
        case "boolean": return applyUniversal(name => col.boolean(name).default(flag), mods);
        case "bytea": return applyUniversal(name => col.bytea(name), mods);
        case "geopoint": return applyUniversal(name => col.geopoint(name), mods);
        case "vector": return applyUniversal(name => vector(name, { dimensions: 4 }), mods);
        case "vectorNoIndex": return applyUniversal(name => vector(name, { dimensions: 4, index: false }), mods);
        default: return applyUniversal(name => vector(name, { dimensions: 8, index: { method: flag ? "hnsw" : "ivfflat", metric: ["l2", "ip"], lists: 10 } }), mods);
    }
});

const anyColumn = fc.oneof(textColumn, numberColumn, identityColumn, uuidColumn, temporalColumn, enumColumn, jsonColumn, storageColumn, arrayColumn, otherColumn);

describe("printColumn round trip, for all columns", () => {
    it("evaluate(printColumn(def)) is def", () => {
        fc.assert(fc.property(anyColumn, fc.option(word, { nil: undefined }), (builder, key) => {
            const printed = printColumn(builder.def, { key });
            expect(comparableColumn(evaluateColumn(printed), key)).toEqual(comparableColumn(builder.def, key));
        }), { numRuns: 1500 });
    });

    it("is deterministic", () => {
        fc.assert(fc.property(anyColumn, builder => {
            expect(printColumn(builder.def)).toBe(printColumn(builder.def));
        }), { numRuns: 200 });
    });
});
