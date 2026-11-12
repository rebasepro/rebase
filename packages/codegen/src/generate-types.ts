import type { ColumnDescriptor, ColumnType, JsonShape, RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { isNumericColumnType, isTemporalColumnType } from "@rebasepro/types";
import { sortCollectionsBySlug } from "@rebasepro/common";
import { toCollectionAccessor, toSafeIdentifier } from "./utils";

/**
 * A schema that cannot be expressed as a valid TypeScript file.
 *
 * Thrown rather than emitted. The generator used to concatenate whatever it was
 * given, so a slug that collided with another one, or that was not an
 * identifier, produced a file that either failed to compile or — worse —
 * compiled while quietly routing one table to another's slug.
 *
 * @group SDK generation
 */
export class CodegenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CodegenError";
    }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A property name for the emitted TypeScript: verbatim when it is a valid
 * identifier, quoted otherwise.
 *
 * Every key that reaches the output goes through here. Column keys are not
 * required to be identifiers — `"order"`, `"user id"`, a quoted Postgres
 * identifier — and the previous behaviour of camel-casing them into shape
 * renamed the column in the type while the wire kept the original, so the
 * generated `Row` described fields that did not exist.
 */
function emitKey(key: string): string {
    return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/**
 * A string literal, escaped.
 *
 * `"${value}"` was the previous form. A value containing a quote closed the
 * literal early, which at best broke the file and at worst let a slug from a
 * remote schema inject top-level statements into a file the developer
 * compiles and bundles.
 */
function emitString(value: string): string {
    return JSON.stringify(value);
}

const GEOPOINT_TYPE = "{ latitude: number; longitude: number; }";

/** A closed value set as a union of literals: strings escaped, numbers only when every value is one. */
function literalUnion(values: readonly (string | number)[], numeric: boolean): string | undefined {
    if (values.length === 0) return undefined;
    if (numeric) {
        const numbers = values.map(Number);
        // A numeric set carrying something that is not a number cannot be
        // written as a union of numeric literals. Widening to `number` is
        // imprecise; emitting `NaN | undefined` is invalid.
        if (numbers.some(n => !Number.isFinite(n))) return undefined;
        return numbers.map(n => String(n)).join(" | ");
    }
    return values.map(v => emitString(String(v))).join(" | ");
}

/**
 * The TypeScript type of a value of one Postgres type, as the wire serves it.
 *
 * A Postgres enum and a `.oneOf()` set are literal unions; a timestamp, a date
 * and a time are ISO strings; `bytea` is base64; a vector is its numbers; a
 * type Rebase serves but does not create (`other`) is `unknown`.
 */
function scalarType(type: ColumnType, oneOf: readonly (string | number)[] | undefined): string {
    if (type.kind === "enum") return literalUnion(type.values, false) ?? "string";
    if (isNumericColumnType(type)) return (oneOf && literalUnion(oneOf, true)) ?? "number";
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "uuid":
            return (oneOf && literalUnion(oneOf, false)) ?? "string";
        case "boolean":
            return "boolean";
        case "timestamptz":
        case "date":
        case "time":
            return "string";
        case "vector":
            return "number[]";
        case "bytea":
            return "string";
        case "json":
        case "jsonb":
            return "Record<string, unknown>";
        default:
            return "unknown";
    }
}

/**
 * The TypeScript type of a JSON document, from the shape the table declares.
 *
 * An object types its declared fields — a field the shape does not mark
 * `required` may be absent or null — and an open object (`additional`) with no
 * declared field is a record. A typed block list (`json.oneOf`) is the union of
 * its blocks, each a `{ <typeField>: "<variant>"; <valueField>: … }`.
 */
function jsonType(shape: JsonShape): string {
    switch (shape.kind) {
        case "string":
            return (shape.oneOf && literalUnion(shape.oneOf, false)) ?? "string";
        case "number":
            return (shape.oneOf && literalUnion(shape.oneOf, true)) ?? "number";
        case "boolean":
            return "boolean";
        case "date":
            return "string";
        case "geopoint":
            return GEOPOINT_TYPE;
        case "object": {
            const entries = Object.entries(shape.fields);
            if (entries.length === 0 && shape.additional) return "Record<string, unknown>";
            const inner = entries
                .map(([key, field]) => {
                    const optional = !field.required;
                    const type = jsonType(field);
                    return `${emitKey(key)}${optional ? "?" : ""}: ${optional ? `${type} | null` : type};`;
                })
                .join(" ");
            return `{ ${inner} }`;
        }
        case "array":
            return `Array<${jsonType(shape.of)}>`;
        case "oneOf": {
            const variants = Object.entries(shape.variants);
            // A block whose discriminator and value share a key cannot be
            // written as an object type (a remote schema can say anything).
            if (variants.length === 0 || shape.typeField === shape.valueField) return "unknown";
            return variants
                .map(([name, variant]) => `{ ${emitKey(shape.typeField)}: ${emitString(name)}; ${emitKey(shape.valueField)}: ${jsonType(variant)}; }`)
                .join(" | ");
        }
        default:
            return "unknown";
    }
}

/** The TypeScript type of a column's value on a read. */
function columnType(column: ColumnDescriptor): string {
    if (column.semantic === "geopoint") return GEOPOINT_TYPE;
    if (column.json && (column.type.kind === "json" || column.type.kind === "jsonb")) return jsonType(column.json);
    if (column.type.kind === "array") return `Array<${scalarType(column.type.of, column.element?.oneOf)}>`;
    return scalarType(column.type, column.oneOf);
}

/**
 * The TypeScript type of a key: `number` for a numeric column, `string` for
 * every other — what a foreign key, a link written by the relation's name and
 * a to-many membership hold.
 */
function keyType(column: ColumnDescriptor | undefined): string {
    if (!column) return "string | number";
    return isNumericColumnType(column.type) ? "number" : "string";
}

/**
 * A column's type on a write: its own type (a temporal column also as a
 * `Date`), or `null` too when it is nullable.
 *
 * `Row` has typed a nullable column `T | null` for a while; its write twins
 * did not, so the one way to clear a value — `update(id, { publishedAt: null })`,
 * `{ authorId: null }` to unassign, the edit-form round trip of a row that came
 * back with nulls in it — was a compile error the server would have accepted.
 * A primary key is never null.
 */
function writableType(column: ColumnDescriptor, tsType: string): string {
    // A temporal value is written as a `Date` as readily as an ISO string: the
    // client sends it through `JSON.stringify`, which spells it as the ISO
    // string the server stores. `Row` keeps `string`, because that is what a
    // read returns.
    const written = isTemporalColumnType(column.type) ? `${tsType} | Date` : tsType;
    return column.nullable ? `${written} | null` : written;
}

/**
 * Whether a create may leave the column out: it may be null, or the database
 * or the server fills it — a default of any kind (a literal, SQL, a random
 * uuid, an identity, one the database owns), a serial, a stamp.
 */
function insertOptional(column: ColumnDescriptor): boolean {
    if (column.nullable) return true;
    if (column.default !== undefined || column.stamp !== undefined) return true;
    const kind = column.type.kind;
    return kind === "smallserial" || kind === "serial" || kind === "bigserial";
}

/** Nobody may read it: `.private()`, or `access({ read: [] })`. */
function unreadable(column: ColumnDescriptor): boolean {
    return column.private === true || column.access?.read?.length === 0;
}

/** Nobody may write it: `.private()`, `.readOnly()`, generated, or `access({ write: [] })`. */
function unwritable(column: ColumnDescriptor): boolean {
    return column.private === true || column.readOnly === true || column.generated !== undefined
        || column.access?.write?.length === 0;
}

/** One emitted `key: type;` line, already indented. */
function line(key: string, type: string, optional: boolean): string {
    return `      ${emitKey(key)}${optional ? "?" : ""}: ${type};`;
}

type BelongsTo = Extract<RelationDescriptor, { kind: "belongsTo" }>;

/** Everything the generator needs to know about the tables of one run. */
interface Run {
    accessors: Map<string, string>;
    bySlug: Map<string, TableDescriptor>;
}

/**
 * Map every slug to the property name it is reachable under on `client.data`.
 *
 * The accessor is a safe identifier because `client.data.myNotes` is the point
 * of generating this at all, and `collectionsDictionary` maps it back to the
 * slug the wire uses. Two slugs that safe down to the same identifier cannot
 * both have it: the interface would not compile, and the dictionary — an object
 * literal — would silently keep only the last, routing one table's reads to
 * the other's. There is no defensible way to pick, so this refuses.
 */
function buildAccessors(tables: readonly TableDescriptor[]): Map<string, string> {
    const accessors = new Map<string, string>();
    const bySafeName = new Map<string, string>();

    for (const table of tables) {
        const slug = table.slug;
        if (typeof slug !== "string" || slug.length === 0) {
            throw new CodegenError(
                "A table has no slug, so it has no name to generate a type for. " +
                "Every table needs a unique `slug`."
            );
        }

        const safe = toSafeIdentifier(slug);
        if (safe.length === 0) {
            throw new CodegenError(
                `The slug ${emitString(slug)} has no characters that can form a property name, ` +
                "so it cannot be reached as `client.data.<name>`. Use a slug containing " +
                "letters, digits, underscores or dashes."
            );
        }

        const accessor = toCollectionAccessor(slug);
        if (accessor !== safe) {
            console.warn(
                `[codegen] The table ${emitString(slug)} would be \`client.data.${safe}\`, a name ` +
                `the client reserves, so its typed accessor is \`client.data.${accessor}\`. ` +
                `\`client.data.collection(${emitString(slug)})\` reaches it too.`
            );
        }

        const existing = bySafeName.get(accessor);
        if (existing !== undefined) {
            throw new CodegenError(
                `The tables ${emitString(existing)} and ${emitString(slug)} both generate the ` +
                `accessor "${accessor}", so only one of them could be reached from the generated client ` +
                "and the other's reads would silently go to the wrong table. Rename one of the slugs."
            );
        }

        bySafeName.set(accessor, slug);
        accessors.set(slug, accessor);
    }

    return accessors;
}

/** The single key column of a table, or its first, for the type a link to it holds. */
function keyColumnOf(table: TableDescriptor | undefined): ColumnDescriptor | undefined {
    if (!table) return undefined;
    const key = table.primaryKey[0];
    return key === undefined ? undefined : table.columns.find(column => column.key === key);
}

/**
 * The type a link to a relation's target holds: whatever the target's key is —
 * or, for a target outside this run, whatever the `belongsTo`'s own foreign-key
 * column holds.
 */
function targetKeyType(relation: RelationDescriptor, run: Run, plan: TablePlan): string {
    const own = relation.kind === "belongsTo" ? plan.byKey.get(relation.localField) : undefined;
    return keyType(keyColumnOf(run.bySlug.get(relation.target)) ?? own);
}

/** Two column types that a foreign key may hold between: identical, a serial read as its integer. */
function sameKeyType(a: ColumnType, b: ColumnType): boolean {
    const plain = (type: ColumnType): ColumnType => {
        switch (type.kind) {
            case "smallserial": return { kind: "smallint" };
            case "serial": return { kind: "integer" };
            case "bigserial": return { kind: "bigint" };
            default: return type;
        }
    };
    return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

/**
 * The key a foreign-key column is served under when a relation derives it:
 * `author_id` → `authorId`, each later segment keeping its own casing. The
 * same rule as `toWireKey` in `@rebasepro/utils` (which this package does not
 * depend on); used only to recognise such a column, never to name one.
 */
function derivedFieldKey(localKey: string): string {
    const segments = localKey.split(/[-_ ]+/).filter(Boolean);
    if (segments.length <= 1) return localKey;
    return segments
        .map((segment, index) => index === 0
            ? segment.charAt(0).toLowerCase() + segment.slice(1)
            : segment.charAt(0).toUpperCase() + segment.slice(1))
        .join("");
}

/**
 * Whether a `belongsTo`'s column is nothing but the link: the column the
 * relation would derive (its key the derived key of `localKey`, the target's
 * key type, no rule, default or flag of its own), over a constraint.
 *
 * Such a column is listed with the relations, after the table's own columns —
 * where a derived foreign key always is, so declaring the column a relation
 * would derive does not move it in the generated types.
 */
function isLinkOnly(column: ColumnDescriptor, relation: BelongsTo, run: Run): boolean {
    if (!relation.constraint) return false;
    if (column.derived) return true;
    if (derivedFieldKey(relation.localKey) !== column.key) return false;
    if (column.primaryKey || column.default !== undefined || column.generated !== undefined || column.readOnly || column.private) return false;
    if (column.access !== undefined || column.stamp !== undefined || column.validate !== undefined || column.oneOf !== undefined) return false;
    if (column.description !== undefined || column.storage !== undefined || column.semantic !== undefined) return false;
    if (column.vectorIndex !== undefined || column.json !== undefined || column.element !== undefined || column.transforms !== undefined) return false;
    const targetKey = keyColumnOf(run.bySlug.get(relation.target));
    return targetKey === undefined || sameKeyType(column.type, targetKey.type);
}

/** One table, split the way every block reads it. */
interface TablePlan {
    table: TableDescriptor;
    /** The table's own columns, in physical order. */
    columns: ColumnDescriptor[];
    /** Each `belongsTo`, with its foreign-key column when that column is listed with the relations. */
    links: { relation: BelongsTo; column: ColumnDescriptor | undefined }[];
    /** Keys nobody can read or write: off every type. */
    excluded: Set<string>;
    /** Keys nobody may write: off `Insert` and `Update`. */
    unwritable: Set<string>;
    byKey: Map<string, ColumnDescriptor>;
}

function planTable(table: TableDescriptor, run: Run): TablePlan {
    const byKey = new Map(table.columns.map(column => [column.key, column]));
    const linkColumns = new Set<string>();
    const links: TablePlan["links"] = [];
    for (const relation of table.relations) {
        if (relation.kind !== "belongsTo") continue;
        const column = byKey.get(relation.localField);
        const listedWithRelation = column !== undefined && isLinkOnly(column, relation, run);
        if (listedWithRelation && column) linkColumns.add(column.key);
        links.push({ relation, column: listedWithRelation ? column : undefined });
    }

    // A column nobody may read *and* nobody may write is off the surface in
    // both directions; one nobody may write is off `Insert` and `Update`. A
    // `belongsTo` goes with its foreign-key column: `author: 7` names the same
    // row `authorId: 7` does, and an include of a hidden link would serve it.
    const excluded = new Set<string>();
    const unwritableKeys = new Set<string>();
    for (const column of table.columns) {
        const closedWrite = unwritable(column);
        if (closedWrite) unwritableKeys.add(column.key);
        if (closedWrite && unreadable(column)) excluded.add(column.key);
    }
    for (const relation of table.relations) {
        if (relation.kind !== "belongsTo") continue;
        if (excluded.has(relation.localField)) excluded.add(relation.name);
        if (unwritableKeys.has(relation.localField)) unwritableKeys.add(relation.name);
    }
    for (const key of excluded) unwritableKeys.add(key);

    return {
        table,
        columns: table.columns.filter(column => !linkColumns.has(column.key)),
        links,
        excluded,
        unwritable: unwritableKeys,
        byKey
    };
}

/**
 * The type an *included* relation arrives as: the target's own row, inlined.
 *
 * This is what the read pipeline actually serves — the target's flat columns
 * where the relation was, through the SDK and the HTTP API alike. It is
 * deliberately *not* a `{ __type: "relation" }` envelope: that shape is the
 * panel's view-model and never reaches a developer's `find()`.
 *
 * Falls back to an open record when the target is not part of this generation
 * run, since there is no `Row` to point at.
 */
function includedRelationType(relation: RelationDescriptor, run: Run): string {
    const accessor = run.accessors.get(relation.target);
    const rowType = accessor
        ? `Database[${emitString(accessor)}]["Row"]`
        : "Record<string, unknown>";
    // A read of a many-to-many whose junction carries columns serves them on
    // each target as `_pivot`.
    const pivot = relation.kind === "manyToMany" ? pivotType(relation.through.pivot, "read") : undefined;
    const elementType = pivot ? `${rowType} & { _pivot?: ${pivot} }` : rowType;
    return relation.cardinality === "many" ? `Array<${elementType}>` : elementType;
}

/**
 * Generate the typed SDK's `database.types.ts` from table descriptors — what
 * `compileTables` produces, `GET /api/schema/tables` serves and introspection
 * reports.
 *
 * Emits `Database` (per table: `Row`, `Insert`, `Update`, `Relations`, `Slug`),
 * `CollectionName`, `collectionsDictionary`, `CollectionsDictionary` and the
 * `include` helpers `RelationsOf`, `RelationKeys`, `RelationTarget`,
 * `IncludeOptionsFor`, `IncludeFor` and `RowWith`.
 *
 * Deterministic: tables are emitted in slug order whatever order they arrive
 * in, so `rebase doctor` can regenerate in memory and diff against the file.
 *
 * @throws {CodegenError} when two slugs produce one accessor, or a slug has
 *   nothing an accessor can be built from.
 *
 * @group SDK generation
 */
export function generateTypedefs(input: readonly TableDescriptor[]): string {
    // Sorted here rather than only in `generate-sdk`: the output is
    // order-dependent and `rebase doctor` regenerates it in memory to diff
    // against the file on disk. While only the writer sorted, a project whose
    // file order differed from its slug order was reported permanently stale.
    const tables = sortCollectionsBySlug(input);
    const run: Run = {
        accessors: buildAccessors(tables),
        bySlug: new Map(tables.map(table => [table.slug, table]))
    };
    const lines: string[] = [
        "/**",
        " * This file was auto-generated by Rebase.",
        " * Do not make direct changes to the file.",
        " */",
        "",
        "export interface Database {"
    ];

    for (const table of tables) {
        const plan = planTable(table, run);
        lines.push(`  ${emitKey(run.accessors.get(table.slug)!)}: {`);
        emitRow(lines, plan, run);
        if (table.kind === "view") {
            // A view is never written: the server refuses a create, an update
            // and a delete on one, so no write is typed.
            lines.push("    Insert: never;");
            lines.push("    Update: never;");
        } else {
            emitInsert(lines, plan, run);
            emitUpdate(lines, plan, run);
        }
        emitRelations(lines, plan, run);

        // ── Slug ──
        //
        // The name the wire knows this table by. The entry is keyed by the
        // accessor (`orderItems`), and the client's typed `collection(slug)`
        // has to get from one to the other. Written by the one function that
        // chose the accessor, so the two cannot disagree.
        lines.push(`    Slug: ${emitString(table.slug)};`);
        lines.push("  };");
    }

    lines.push("}");
    lines.push("");
    lines.push("export type CollectionName = keyof Database;");
    lines.push("");
    lines.push("export const collectionsDictionary = {");
    for (const table of tables) {
        lines.push(`  ${emitKey(run.accessors.get(table.slug)!)}: ${emitString(table.slug)},`);
    }
    lines.push("} as const;");
    lines.push("");
    // Describes the const above rather than restating its keys: `myNotes`
    // maps to `"my-notes"`, so a `{ [K in CollectionName]: K }` would be false
    // for every slug that is not already an identifier.
    lines.push("export type CollectionsDictionary = typeof collectionsDictionary;");
    lines.push("");
    lines.push(...includeHelperLines());

    return lines.join("\n");
}

/**
 * `Row` — what a read serves.
 *
 * ## A `belongsTo` has three shapes, and all three are typed
 *
 *  1. **Write** — `Insert`/`Update` accept *either* the foreign key under its
 *     own wire name (`{ authorId: 5 }`) or the relation's name
 *     (`{ author: 5 }`). Emitted by `emitWritableRelations`.
 *  2. **Read** — a row carries `authorId`. Always: it is a column.
 *  3. **Read with `include`** — the target's own row arrives under `author`.
 *     Optional, because it is absent from every read that did not name it; the
 *     generated `RowWith` makes it required for a read that did.
 *
 * `fields` narrows which columns a read returns, but a column is optional here
 * only because the value may be null, never because the caller might not have
 * asked for it: a projection is a choice made at one call site.
 */
function emitRow(lines: string[], plan: TablePlan, run: Run): void {
    lines.push("    Row: {");
    const emitted = new Set<string>(plan.excluded);
    // A primary key is on every row a read can return, and so is every
    // `NOT NULL` column; the rest may be null.
    for (const column of plan.columns) {
        if (emitted.has(column.key)) continue;
        const type = columnType(column);
        lines.push(line(column.key, column.nullable ? `${type} | null` : type, column.nullable));
        emitted.add(column.key);
    }
    // The foreign keys listed with their relations, under their wire names.
    for (const { relation, column } of plan.links) {
        if (!column || emitted.has(column.key)) continue;
        const type = targetKeyType(relation, run, plan);
        lines.push(line(column.key, column.nullable ? `${type} | null` : type, column.nullable));
        emitted.add(column.key);
    }
    // The relations — the target's own row, inlined. Optional throughout: a
    // relation is only loaded when the read names it in `include`.
    for (const relation of plan.table.relations) {
        if (emitted.has(relation.name)) continue;
        lines.push(line(relation.name, includedRelationType(relation, run), true));
        emitted.add(relation.name);
    }
    lines.push("    };");
}

/**
 * `Insert` — what `create()` accepts: no hidden column and nothing nobody may
 * write; a column the database or the server fills may be left out.
 */
function emitInsert(lines: string[], plan: TablePlan, run: Run): void {
    lines.push("    Insert: {");
    const emitted = new Set<string>(plan.unwritable);
    for (const column of plan.columns) {
        if (emitted.has(column.key)) continue;
        lines.push(line(column.key, writableType(column, columnType(column)), insertOptional(column)));
        emitted.add(column.key);
    }
    const eitherSpelling = emitWritableRelations(lines, plan, run, emitted, false);
    // A required `belongsTo` written under either of its names: one
    // `& (A | B)` per such relation, so each is satisfied on its own.
    lines.push(eitherSpelling.length === 0 ? "    };" : `    } & ${eitherSpelling.join(" & ")};`);
}

/**
 * `Update` — everything optional, and the primary key left out: an update
 * addresses a row by its key, it does not reassign one.
 */
function emitUpdate(lines: string[], plan: TablePlan, run: Run): void {
    lines.push("    Update: {");
    const emitted = new Set<string>(plan.unwritable);
    for (const column of plan.columns) {
        if (column.primaryKey || emitted.has(column.key)) continue;
        lines.push(line(column.key, writableType(column, columnType(column)), true));
        emitted.add(column.key);
    }
    emitWritableRelations(lines, plan, run, emitted, true);
    lines.push("    };");
}

/**
 * `Relations` — which relations the table has, and which table each one
 * reaches. Not a shape a read returns: it is the *graph*, and `include` is the
 * one parameter that needs it. `IncludeFor` walks it to constrain an include's
 * keys at every level, and `RowWith` reads it to make an included relation
 * non-optional on the row that comes back.
 *
 * Emitted as the accessor NAME rather than the target's `Row`, so a
 * self-referencing relation is a finite string instead of a type that expands
 * forever. A table with no relations gets `Record<never, never>`, not `{}`,
 * which typescript-eslint's `no-empty-object-type` refuses in every project
 * that lints its generated SDK. A hidden relation is left out: the server
 * answers an include naming one as it answers a typo.
 */
function emitRelations(lines: string[], plan: TablePlan, run: Run): void {
    const includable = plan.table.relations.filter(relation => !plan.excluded.has(relation.name));
    if (includable.length === 0) {
        lines.push("    Relations: Record<never, never>;");
        return;
    }
    lines.push("    Relations: {");
    for (const relation of includable) {
        const accessor = run.accessors.get(relation.target);
        // A target outside this generation run has no accessor to name, so the
        // relation is typed as reaching nothing rather than as reaching
        // something that does not exist.
        lines.push(`      ${emitKey(relation.name)}: ${accessor ? emitString(accessor) : "never"};`);
    }
    lines.push("    };");
}

/**
 * The `include` type machinery, emitted into the generated file.
 *
 * It lives here rather than in `@rebasepro/types` because it is the *graph*
 * that makes it work, and the graph only exists once a project's tables have
 * been generated. `IncludeSpec` in `@rebasepro/types` is deliberately
 * unconstrained; these narrow it for a project that has relations.
 *
 * - `IncludeFor<"posts">` — an include whose keys are relations that exist,
 *   recursively, so a typo is a compile error rather than a 400 at runtime.
 * - `RowWith<"posts", I>` — the row a read with that include returns, where
 *   every included relation is **present** rather than optional.
 *
 * The depth bound matches the server's (`MAX_INCLUDE_DEPTH`), and is spelled as
 * a decrementing tuple because TypeScript has no arithmetic — `Prev[3]` is `2`.
 */
function includeHelperLines(): string[] {
    return [
        "/** Which collection each of `A`'s relations reaches. */",
        "export type RelationsOf<A extends CollectionName> =",
        "  Database[A] extends { Relations: infer R } ? R : Record<string, never>;",
        "",
        "/** The names of `A`'s relations. */",
        "export type RelationKeys<A extends CollectionName> = keyof RelationsOf<A> & string;",
        "",
        "/** The collection a relation reaches, or `never` when it left this project. */",
        "export type RelationTarget<A extends CollectionName, K extends RelationKeys<A>> =",
        "  RelationsOf<A>[K] extends CollectionName ? RelationsOf<A>[K] : never;",
        "",
        "/** Counts `IncludeFor` down; TypeScript has no arithmetic. */",
        "type Prev = [never, 0, 1, 2, 3];",
        "",
        "/**",
        " * Per-relation options, minus `include` — which `IncludeFor` supplies at",
        " * the next depth so the nested keys are checked against the *target's*",
        " * relations rather than this collection's.",
        " */",
        "export interface IncludeOptionsFor<A extends CollectionName, K extends RelationKeys<A>, D extends number> {",
        "  limit?: number;",
        "  where?: Record<string, unknown>;",
        "  logical?: unknown;",
        "  orderBy?: unknown;",
        "  fields?: string[];",
        "  include?: RelationTarget<A, K> extends CollectionName",
        "    ? IncludeFor<RelationTarget<A, K>, Prev[D]>",
        "    : never;",
        "}",
        "",
        "/**",
        " * An `include` for collection `A`: its relation names, dotted paths, or the",
        " * parametrised tree — with every key checked against the relations that",
        " * actually exist, at every level.",
        " */",
        "export type IncludeFor<A extends CollectionName, D extends number = 3> =",
        "  D extends 0",
        "    ? never",
        "    : | readonly (RelationKeys<A> | \"*\")[]",
        "      | { [K in RelationKeys<A>]?: true | IncludeOptionsFor<A, K, D> };",
        "",
        "/** The relation names an include asks for at the top level. */",
        "type IncludedKeys<A extends CollectionName, I> =",
        "  I extends readonly (infer K)[]",
        "    ? Extract<K, RelationKeys<A>>",
        "    : Extract<keyof I, RelationKeys<A>>;",
        "",
        "/**",
        " * The row a read with include `I` returns: `Row`, with every included",
        " * relation made **required**.",
        " *",
        " * `Row` types a relation as optional because it is absent from every read",
        " * that did not name it. Once a read has named it, it is there — and having",
        " * to write `row.author?.name` after asking for the author is the type",
        " * describing a possibility the query already ruled out.",
        " */",
        "export type RowWith<A extends CollectionName, I> =",
        "  Database[A][\"Row\"] & Required<Pick<Database[A][\"Row\"], IncludedKeys<A, I> & keyof Database[A][\"Row\"]>>;",
        ""
    ];
}

/**
 * Every relation write the server performs, typed.
 *
 * - A `belongsTo` is written under either of two names: its foreign key's wire
 *   key (`{ authorId: 5 }`) and the relation's name (`{ author: 5 }`), which
 *   the server maps onto the column — the second only over a constraint
 *   (`rel.belongsTo(…, { constraint: false })` keeps a bare column, written by
 *   its key alone). A **required** `belongsTo` is satisfied by either: on an
 *   `Insert` both names go in optional, and the requirement comes back as one
 *   returned `({ authorId: T } | { author: T })` for the caller to intersect
 *   with the object. Both stay in the object so `keyof Insert` names them.
 * - A `hasOne`, and a single-hop to-one `via`, is written by naming the target
 *   row; `null` unlinks it.
 * - A to-many membership (`hasMany`, `manyToMany`, a single-hop to-many `via`)
 *   is written as the targets' keys, or `{ id }`, or `{ id, _pivot }` where the
 *   junction declares payload columns. A multi-hop `via` is read-only.
 *
 * The target's key type is the one `Row` uses for the link.
 */
function emitWritableRelations(
    lines: string[],
    plan: TablePlan,
    run: Run,
    emittedKeys: Set<string>,
    allOptional: boolean
): string[] {
    // Every name each `belongsTo` can still be written under, so `emit` knows
    // whether a required one has a second spelling to fall back on.
    const spellings = new Map<BelongsTo, string[]>();
    const addSpelling = (relation: BelongsTo, key: string): void => {
        if (emittedKeys.has(key)) return;
        const keys = spellings.get(relation) ?? [];
        if (!keys.includes(key)) keys.push(key);
        spellings.set(relation, keys);
    };
    for (const { relation } of plan.links) addSpelling(relation, relation.localField);
    for (const { relation } of plan.links) if (relation.constraint) addSpelling(relation, relation.name);

    const eitherSpelling: string[] = [];
    const emit = (key: string, relation: BelongsTo): void => {
        if (emittedKeys.has(key)) return;
        const required = plan.byKey.get(relation.localField)?.nullable === false;
        // A foreign key that is not required can be unassigned, which is a
        // write of `null` — see `writableType`.
        const type = required ? targetKeyType(relation, run, plan) : `${targetKeyType(relation, run, plan)} | null`;
        const names = spellings.get(relation) ?? [key];
        const oneOfSeveral = required && !allOptional && names.length > 1;
        lines.push(line(key, type, allOptional || !required || oneOfSeveral));
        emittedKeys.add(key);
        if (oneOfSeveral && names[0] === key) {
            eitherSpelling.push(`(${names.map(name => `{ ${emitKey(name)}: ${type} }`).join(" | ")})`);
        }
    };

    for (const { relation } of plan.links) emit(relation.localField, relation);
    for (const { relation } of plan.links) if (relation.constraint) emit(relation.name, relation);

    for (const relation of plan.table.relations) {
        if (emittedKeys.has(relation.name)) continue;
        const toOneWritable = relation.kind === "hasOne"
            || (relation.kind === "via" && relation.cardinality === "one" && relation.writable);
        if (!toOneWritable) continue;
        lines.push(line(relation.name, `${targetKeyType(relation, run, plan)} | null`, true));
        emittedKeys.add(relation.name);
    }

    for (const relation of plan.table.relations) {
        if (relation.cardinality !== "many" || emittedKeys.has(relation.name)) continue;
        if (relation.kind === "via" && !relation.writable) continue;
        const fk = targetKeyType(relation, run, plan);
        const pivot = relation.kind === "manyToMany" ? pivotType(relation.through.pivot, "write") : undefined;
        const element = `${fk} | { id: ${fk}${pivot ? `; _pivot?: ${pivot}` : ""} }`;
        lines.push(line(relation.name, `Array<${element}>`, true));
        emittedKeys.add(relation.name);
    }

    return eitherSpelling;
}

/**
 * The `_pivot` a many-to-many link carries: the junction's payload columns,
 * typed as a row's columns are on a read and as a write's on a write.
 * `undefined` when the junction declares none, so there is no `_pivot` to name.
 */
function pivotType(pivot: readonly ColumnDescriptor[], direction: "read" | "write"): string | undefined {
    if (pivot.length === 0) return undefined;
    const fields = pivot.map(column => {
        const tsType = columnType(column);
        const required = !column.nullable;
        const type = direction === "write" ? writableType(column, tsType) : (required ? tsType : `${tsType} | null`);
        return `${emitKey(column.key)}${required && direction === "read" ? "" : "?"}: ${type};`;
    });
    return `{ ${fields.join(" ")} }`;
}
