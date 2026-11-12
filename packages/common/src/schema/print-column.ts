import type {
    ColumnDef,
    ColumnStorage,
    ColumnTransform,
    ColumnType,
    ColumnValidation,
    JsonShapeDef
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

import { array, call, concat, object, printString, render, text } from "./print-doc";
import type { Doc } from "./print-doc";
import { TablePrintError, printNumber, valueDoc } from "./print-value";

/**
 * Which builders a printed piece of source uses, so the module printer imports
 * exactly those.
 *
 * @group Schema
 */
export type SchemaBuilderName = "defineTable" | "defineAuthTable" | "defineView" | "col" | "rel" | "json";

/**
 * What the column and JSON-shape printers need besides the definition.
 * Internal: the public functions build it from their options.
 */
export interface ColumnPrintContext {
    /** Where the column sits, for refusals: `posts.columns.title`. */
    path: string;
    /**
     * The source of a field-level `transform`, by path relative to the column:
     * `""` the column itself, `"[]"` an array column's element, `"seo.title"`
     * a field of its JSON shape, `"[].image"` a field inside a JSON array.
     */
    transforms: Readonly<Record<string, string>>;
    /** Collects the builders the printed source uses. */
    used: Set<SchemaBuilderName>;
    /** Where this context sits below the printed column (`""`, `"[]"`), for the refusal's hint. */
    origin: string;
    /** How the caller supplies the source of the transform at a path below the printed column. */
    sourceHint: (relative: string) => string;
}

/** The hint of {@link printColumn}: its own options. */
const columnOptionHint = (relative: string): string =>
    relative === "" ? "as `transform`" : `under \`transforms["${relative}"]\``;

/**
 * Options of {@link printColumn}.
 *
 * @group Schema
 */
export interface PrintColumnOptions {
    /**
     * The column's key in `columns`. With it, `.column(name)` is left out when
     * the SQL name is the snake_case of the key (the builder's own default).
     */
    key?: string;
    /**
     * The source text of the column's `transform` (`"{ beforeSave: ({ value }) => value.trim() }"`),
     * printed verbatim. Required when the definition carries a transform: a
     * function cannot be printed from its value.
     */
    transform?: string;
    /**
     * Sources of transforms nested inside the column, by path relative to it:
     * `"[]"` an array column's element, `"seo.title"` a field of its JSON
     * shape, `"[].image"` a field inside a JSON array, `"blocks.[].text"` …
     * see {@link joinTransformPath}.
     */
    transforms?: Readonly<Record<string, string>>;
}

/**
 * The path of a nested transform: a JSON field is joined with `.`, an array
 * item is `[]`.
 *
 * @group Schema
 */
export function joinTransformPath(parent: string, segment: string): string {
    if (parent === "") return segment;
    if (segment === "") return parent;
    return segment === "[]" ? `${parent}[]` : `${parent}.${segment}`;
}

const BYTE_UNITS: readonly [string, number][] = [
    ["TB", 1024 ** 4],
    ["GB", 1024 ** 3],
    ["MB", 1024 ** 2],
    ["KB", 1024]
];

/**
 * A byte size as it reads best: `"10MB"` when it is an exact multiple of a
 * binary unit (what `parseByteSize` reads back to the same number), the
 * number of bytes otherwise.
 *
 * @group Schema
 */
export function printByteSize(bytes: number): string {
    if (Number.isInteger(bytes) && bytes > 0) {
        for (const [unit, size] of BYTE_UNITS) {
            if (bytes % size === 0) return printString(`${bytes / size}${unit}`);
        }
    }
    return printNumber(bytes);
}

const STORAGE_KEYS: readonly (keyof ColumnStorage)[] = [
    "source", "path", "accept", "maxBytes", "imageResize", "public", "fileName", "metadata", "includeBucketUrl", "storeUrl"
];

function storageDoc(storage: ColumnStorage, path: string): Doc {
    const known = new Set<string>(STORAGE_KEYS);
    for (const key of Object.keys(storage)) {
        if (!known.has(key)) throw new TablePrintError(`${path}.storage.${key}`, "it is not a storage option `col.storage()` takes.");
    }
    const entries: [string, Doc][] = [];
    for (const key of STORAGE_KEYS) {
        const value = storage[key];
        if (value === undefined) continue;
        entries.push([key, key === "maxBytes" && typeof value === "number" ? text(printByteSize(value)) : valueDoc(value, `${path}.storage.${key}`)]);
    }
    return object(entries);
}

/**
 * Whether a pattern prints as a RegExp literal: when it has flags (one
 * literal instead of `matches` + `matchesFlags`) or holds backslashes (which
 * a string would double), and the literal reads back to the same source.
 */
function regexLiteral(matches: string, flags: string | undefined): string | undefined {
    if (flags === "") return undefined;
    if (flags === undefined && !matches.includes("\\")) return undefined;
    try {
        const parsed = new RegExp(matches, flags);
        if (parsed.source !== matches) return undefined;
        return String(parsed);
    } catch {
        return undefined;
    }
}

/** `.validate({...})`'s argument: the rules in their own order, a pattern as a RegExp literal where it reads better. */
function validationDoc(rules: ColumnValidation, path: string): Doc {
    const literal = typeof rules.matches === "string" ? regexLiteral(rules.matches, rules.matchesFlags) : undefined;
    const entries: [string, Doc][] = [];
    for (const [key, value] of Object.entries(rules)) {
        if (value === undefined) continue;
        if (literal !== undefined && key === "matchesFlags") continue;
        entries.push([key, literal !== undefined && key === "matches" ? text(literal) : valueDoc(value, `${path}.validate.${key}`)]);
    }
    return object(entries);
}

/** `.method(args)`, as a chain link. */
const link = (method: string, args: Doc[] = []): Doc => call(`.${method}`, args);

const hasFunction = (transform: ColumnTransform | undefined): boolean =>
    transform !== undefined && Object.values(transform).some(value => typeof value === "function");

/**
 * The `.transform(...)` link, from the caller's source. A transform carrying a
 * function and no source is refused: dropping a hook silently would change
 * what the server does with every write.
 */
function transformLink(declared: boolean, transform: ColumnTransform | undefined, relative: string, ctx: ColumnPrintContext): Doc | undefined {
    const source = ctx.transforms[relative];
    if (source !== undefined) return link("transform", [text(source)]);
    if (declared || hasFunction(transform)) {
        const full = joinTransformPath(ctx.origin, relative);
        throw new TablePrintError(
            relative === "" ? `${ctx.path}.transform` : `${ctx.path} (transform at "${relative}")`,
            `the transform is a function, which cannot be printed from its value. Pass its source text ${ctx.sourceHint(full)}.`
        );
    }
    if (transform !== undefined) return link("transform", [valueDoc(transform, `${ctx.path}.transform`)]);
    return undefined;
}

const DEFAULT_STRING_LENGTH = 255;

/** The column types `.userId()` applies to. */
const USER_ID_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["text", "varchar", "char", "uuid"]);

/** The flags and options every builder starts from: what is left out when printing. */
const isUntouchedElement = (element: ColumnDef): boolean =>
    element.column === undefined && !element.notNull && !element.primaryKey && !element.unique &&
    element.default === undefined && element.generatedAs === undefined && !element.readOnly && !element.private &&
    element.access === undefined && element.stamp === undefined && element.oneOf === undefined &&
    element.description === undefined && element.semantic === undefined && element.vectorIndex === undefined &&
    element.json === undefined && element.element === undefined && element.transform === undefined;

const sameData = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function simpleBuilder(type: ColumnType, path: string): Doc {
    switch (type.kind) {
        case "text":
        case "uuid":
        case "smallint":
        case "integer":
        case "bigint":
        case "smallserial":
        case "serial":
        case "bigserial":
        case "real":
        case "doublePrecision":
        case "boolean":
        case "timestamptz":
        case "date":
        case "time":
        case "bytea":
        case "json":
        case "jsonb":
            return call(`col.${type.kind}`);
        case "varchar":
        case "char":
            return call(`col.${type.kind}`, type.length === DEFAULT_STRING_LENGTH ? [] : [text(printNumber(type.length))]);
        case "numeric": {
            const args: Doc[] = [];
            if (type.precision !== undefined) args.push(text(printNumber(type.precision)));
            if (type.scale !== undefined) args.push(text(printNumber(type.scale)));
            return call("col.numeric", args);
        }
        case "enum": {
            const args: Doc[] = [array(type.values.map(value => text(printString(value))))];
            if (type.name !== undefined) args.push(object([["name", text(printString(type.name))]]));
            return call("col.enum", args);
        }
        case "vector":
            return call("col.vector", [text(printNumber(type.dimensions))]);
        case "array":
            throw new TablePrintError(path, "an array column needs its element definition to be printed.");
        case "other":
            return call("col.custom", [text(printString(type.sqlType))]);
    }
}

/**
 * The type builder of a column and the `ColumnDef` members it accounts for:
 * `col.storage(...)`, `col.geopoint()`, `col.jsonb(json…)`, `col.vector(d, { index })`,
 * `col.array(inner)`, `col.storage(...).multiple()`, or the plain builder of the type.
 */
function typeBuilder(def: ColumnDef, ctx: ColumnPrintContext): Doc {
    const { type } = def;
    if (def.semantic === "geopoint") {
        if (type.kind !== "jsonb" || def.json !== undefined) {
            throw new TablePrintError(ctx.path, `the meaning "geopoint" on a \`${type.kind}\` column has no builder.`);
        }
        return call("col.geopoint");
    }
    if (def.semantic === "user" && (def.storage !== undefined || !USER_ID_KINDS.has(type.kind))) {
        throw new TablePrintError(
            ctx.path,
            `\`.userId()\` on ${def.storage !== undefined ? "a storage column" : `a \`${type.kind}\` column`}; it applies to text, varchar, char and uuid columns.`
        );
    }
    if (def.vectorIndex !== undefined && type.kind !== "vector") {
        throw new TablePrintError(ctx.path, "a vector index on a column that is not `col.vector()`.");
    }
    if (def.json !== undefined && type.kind !== "json" && type.kind !== "jsonb") {
        throw new TablePrintError(ctx.path, "a JSON shape on a column that is not `col.json()` / `col.jsonb()`.");
    }
    if (def.element !== undefined && type.kind !== "array") {
        throw new TablePrintError(ctx.path, "an element definition on a column that is not an array.");
    }
    switch (type.kind) {
        case "text":
            if (def.storage !== undefined) return call("col.storage", [storageDoc(def.storage, ctx.path)]);
            break;
        case "json":
        case "jsonb":
            if (def.json !== undefined) {
                return call(`col.${type.kind}`, [jsonShapeDoc(def.json, ctx, "")]);
            }
            break;
        case "vector":
            if (def.vectorIndex !== undefined) {
                return call("col.vector", [
                    text(printNumber(type.dimensions)),
                    object([["index", valueDoc(def.vectorIndex, `${ctx.path}.vectorIndex`)]])
                ]);
            }
            break;
        case "array":
            return arrayBuilder(def, type, ctx);
        default:
            break;
    }
    if (def.storage !== undefined) {
        throw new TablePrintError(ctx.path, `storage rules on a \`${type.kind}\` column; \`col.storage()\` is a text column.`);
    }
    return simpleBuilder(type, ctx.path);
}

function arrayBuilder(def: ColumnDef, type: Extract<ColumnType, { kind: "array" }>, ctx: ColumnPrintContext): Doc {
    const element: ColumnDef = def.element ?? {
        type: type.of,
        notNull: false,
        primaryKey: false,
        unique: false,
        readOnly: false,
        private: false
    };
    if (!sameData(element.type, type.of)) {
        throw new TablePrintError(ctx.path, "the array's element definition is of another type than the array.");
    }
    // `col.storage(...).multiple()`: TEXT[] of files, the element carrying the
    // storage rules and (only) the per-file validation.
    if (def.storage !== undefined && type.of.kind === "text" && element.storage !== undefined &&
        sameData(element.storage, def.storage) && isUntouchedElement(element) && ctx.transforms["[]"] === undefined) {
        const parts: Doc[] = [call("col.storage", [storageDoc(def.storage, ctx.path)])];
        if (element.validate !== undefined) parts.push(link("validate", [validationDoc(element.validate, `${ctx.path}[]`)]));
        parts.push(link("multiple"));
        return concat(parts);
    }
    if (!sameData(def.storage, element.storage)) {
        throw new TablePrintError(
            ctx.path,
            "the array's storage rules differ from its element's; `col.array(col.storage(...))` and `.multiple()` both keep them equal."
        );
    }
    const inner = columnChain(element, {
        ...ctx,
        path: `${ctx.path}[]`,
        transforms: nestedTransforms(ctx.transforms, "[]"),
        origin: joinTransformPath(ctx.origin, "[]")
    }, undefined, false);
    return call("col.array", [inner]);
}

/** The transforms under one nested path, re-rooted at it. */
export function nestedTransforms(transforms: Readonly<Record<string, string>>, prefix: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, source] of Object.entries(transforms)) {
        if (path === prefix) out[""] = source;
        else if (path.startsWith(`${prefix}.`)) out[path.slice(prefix.length + 1)] = source;
        else if (path.startsWith(`${prefix}[]`)) out[path.slice(prefix.length)] = source;
    }
    return out;
}

/**
 * The canonical modifier order, after the type builder. Each step prints only
 * what differs from the builder's own default.
 *
 * 1. `.column(name)` — left out when it is the snake_case of the key
 * 2. `.primaryKey()`
 * 3. `.notNull()` — left out when `.primaryKey()` implies it
 * 4. `.unique()`
 * 5. the default: `.default(v)` / `.defaultSql(sql)` / `.defaultRandom()` / `.identity()` / `.dbDefault()`
 * 6. `.generatedAs(sql)`
 * 7. the stamp: `.onCreateNow()` / `.onUpdateNow()` / `.onCreateUser()` / `.onUpdateUser()`
 * 8. `.userId()` — what the column holds, beside the stamp that may fill it
 * 9. `.oneOf([...])`
 * 10. `.validate({...})`
 * 11. `.transform(...)`
 * 12. `.readOnly()` — left out when `.generatedAs()` implies it
 * 13. `.private()`
 * 14. `.access({...})`
 * 15. `.describe(text)`
 *
 * `.multiple()` belongs to the type builder (`col.storage({...}).multiple()`):
 * every modifier after it applies to the `TEXT[]` column, and a per-file
 * `.validate()` sits before it.
 *
 * @group Schema
 */
export const COLUMN_MODIFIER_ORDER = [
    "column", "primaryKey", "notNull", "unique", "default", "generatedAs", "stamp", "userId",
    "oneOf", "validate", "transform", "readOnly", "private", "access", "describe"
] as const;

const STAMP_LINKS: Record<string, string> = {
    "create:now": "onCreateNow",
    "update:now": "onUpdateNow",
    "create:user": "onCreateUser",
    "update:user": "onUpdateUser"
};

/**
 * The builder chain of one column, as a doc.
 *
 * @param key The column's key, to leave out a `.column()` that only repeats its snake_case.
 * @param declaresTransform The column has a transform although `def.transform`
 *   carries no function (a descriptor says so with a flag).
 */
export function columnChain(def: ColumnDef, ctx: ColumnPrintContext, key: string | undefined, declaresTransform: boolean): Doc {
    ctx.used.add("col");
    const base = typeBuilder(def, ctx);
    const parts: Doc[] = [base];
    if (def.column !== undefined && !(key !== undefined && def.column === toSnakeCase(key))) {
        parts.push(link("column", [text(printString(def.column))]));
    }
    if (def.primaryKey) parts.push(link("primaryKey"));
    if (def.notNull && !def.primaryKey) parts.push(link("notNull"));
    if (def.unique) parts.push(link("unique"));
    if (def.default !== undefined) {
        switch (def.default.kind) {
            case "literal":
                parts.push(link("default", [valueDoc(def.default.value, `${ctx.path}.default`)]));
                break;
            case "sql":
                parts.push(link("defaultSql", [text(printString(def.default.expression))]));
                break;
            case "random-uuid":
                parts.push(link("defaultRandom"));
                break;
            case "identity":
                parts.push(link("identity"));
                break;
            case "database":
                parts.push(link("dbDefault"));
                break;
        }
    }
    if (def.generatedAs !== undefined) parts.push(link("generatedAs", [text(printString(def.generatedAs))]));
    if (def.stamp !== undefined) {
        const method = STAMP_LINKS[`${def.stamp.on}:${def.stamp.value}`];
        if (method === undefined) throw new TablePrintError(`${ctx.path}.stamp`, `unknown stamp ${JSON.stringify(def.stamp)}.`);
        parts.push(link(method));
    }
    if (def.semantic === "user") parts.push(link("userId"));
    if (def.oneOf !== undefined) parts.push(link("oneOf", [valueDoc(def.oneOf, `${ctx.path}.oneOf`)]));
    if (def.validate !== undefined) parts.push(link("validate", [validationDoc(def.validate, ctx.path)]));
    const transform = transformLink(declaresTransform, def.transform, "", ctx);
    if (transform) parts.push(transform);
    if (def.readOnly && def.generatedAs === undefined) parts.push(link("readOnly"));
    if (def.private) parts.push(link("private"));
    if (def.access !== undefined) parts.push(link("access", [valueDoc(def.access, `${ctx.path}.access`)]));
    if (def.description !== undefined) parts.push(link("describe", [text(printString(def.description))]));
    return parts.length === 1 ? base : concat(parts);
}

const JSON_SIMPLE: Readonly<Record<string, string>> = {
    number: "json.number",
    boolean: "json.boolean",
    date: "json.date",
    geopoint: "json.geopoint",
    unknown: "json.unknown"
};

/**
 * The builder of one node of a JSON shape, as a doc. Modifier order:
 * `.required()` → `.default(v)` → `.onCreateNow()` / `.onUpdateNow()` /
 * `.onCreateUser()` / `.onUpdateUser()` → `.userId()` → `.oneOf([...])` → `.validate({...})` → `.transform(...)` → `.describe(text)`.
 *
 * @param relative The node's path inside the column, for nested transforms.
 */
export function jsonShapeDoc(shape: JsonShapeDef, ctx: ColumnPrintContext, relative: string): Doc {
    ctx.used.add("json");
    const here = relative === "" ? ctx.path : `${ctx.path} (at "${relative}")`;
    let base: Doc;
    switch (shape.kind) {
        case "string":
            base = shape.storage !== undefined ? call("json.storage", [storageDoc(shape.storage, here)]) : call("json.string");
            break;
        case "object": {
            const fields = Object.entries(shape.fields).map(([key, field]): [string, Doc] =>
                [key, jsonShapeDoc(field, ctx, joinTransformPath(relative, key))]);
            const args: Doc[] = [object(fields)];
            if (shape.additional === true) args.push(object([["additional", text("true")]]));
            base = call("json.object", args);
            break;
        }
        case "array":
            base = call("json.array", [jsonShapeDoc(shape.of, ctx, joinTransformPath(relative, "[]"))]);
            break;
        case "oneOf": {
            const variants = Object.entries(shape.variants).map(([key, variant]): [string, Doc] =>
                [key, jsonShapeDoc(variant, ctx, joinTransformPath(relative, key))]);
            const args: Doc[] = [object(variants)];
            const options: [string, Doc][] = [];
            if (shape.typeField !== "type") options.push(["typeField", text(printString(shape.typeField))]);
            if (shape.valueField !== "value") options.push(["valueField", text(printString(shape.valueField))]);
            if (options.length > 0) args.push(object(options));
            base = call("json.oneOf", args);
            break;
        }
        default:
            base = call(JSON_SIMPLE[shape.kind]);
            break;
    }
    const parts: Doc[] = [base];
    if (shape.required === true) parts.push(link("required"));
    if (shape.default !== undefined) parts.push(link("default", [valueDoc(shape.default, `${here}.default`)]));
    if (shape.kind === "date" && shape.stamp !== undefined) parts.push(link(shape.stamp === "create" ? "onCreateNow" : "onUpdateNow"));
    if (shape.kind === "string" && shape.stamp !== undefined) parts.push(link(shape.stamp === "createUser" ? "onCreateUser" : "onUpdateUser"));
    if (shape.kind === "string" && shape.semantic === "user") {
        if (shape.storage !== undefined) throw new TablePrintError(here, "`.userId()` on `json.storage()`; it applies to `json.string()`.");
        parts.push(link("userId"));
    }
    if ((shape.kind === "string" || shape.kind === "number") && shape.oneOf !== undefined) {
        parts.push(link("oneOf", [valueDoc(shape.oneOf, `${here}.oneOf`)]));
    }
    if ((shape.kind === "string" || shape.kind === "number" || shape.kind === "date" || shape.kind === "array") && shape.validate !== undefined) {
        parts.push(link("validate", [validationDoc(shape.validate, here)]));
    }
    const transform = transformLink(false, shape.transform, relative, ctx);
    if (transform) parts.push(transform);
    if (shape.description !== undefined) parts.push(link("describe", [text(printString(shape.description))]));
    return parts.length === 1 ? base : concat(parts);
}

/**
 * The builder chain of one column: `col.uuid().primaryKey().defaultRandom()`.
 *
 * Deterministic, in the canonical modifier order ({@link COLUMN_MODIFIER_ORDER}),
 * printing only what differs from the builder's defaults. Throws a
 * {@link TablePrintError} for what no chain reproduces — a transform without
 * its source, a type with no builder.
 *
 * @group Schema
 */
export function printColumn(def: ColumnDef, options: PrintColumnOptions = {}): string {
    const transforms: Record<string, string> = { ...options.transforms };
    if (options.transform !== undefined) transforms[""] = options.transform;
    const ctx: ColumnPrintContext = { path: options.key ?? "column", transforms, used: new Set(), origin: "", sourceHint: columnOptionHint };
    return render(columnChain(def, ctx, options.key, false));
}

/**
 * The builder of a JSON shape: `json.object({ title: json.string().required() })`.
 *
 * @param transforms Sources of the transforms inside the shape, by path
 *   (`""` the node itself, `"title"`, `"[].text"`).
 *
 * @group Schema
 */
export function printJsonShape(shape: JsonShapeDef, transforms: Readonly<Record<string, string>> = {}): string {
    const ctx: ColumnPrintContext = { path: "json", transforms, used: new Set(), origin: "", sourceHint: columnOptionHint };
    return render(jsonShapeDoc(shape, ctx, ""));
}
