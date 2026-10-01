/**
 * The property keys a column needs for the planner to build that same column.
 *
 * Introspection writes collections, and `rebase db push` plans them back into
 * DDL. The two used to read a column differently: introspection wrote
 * `type: "number"` for an `integer`, and the planner reads an unqualified
 * number as `NUMERIC`; `validation.max: 40` for a `varchar(40)`, and the
 * planner reads an unqualified string as `TEXT`; a `time` as a plain `date`,
 * which the planner makes a `timestamptz` — a change Postgres refuses to cast.
 * So adopting a database — introspect, then push, the documented path — planned
 * a type change on nearly every column, and some it could not even dry-run.
 *
 * Each function here answers one question about one column: what to write so
 * that `planSchema` produces exactly what the catalogue holds. Where no
 * property can say it, the answer is a note naming the column and what a push
 * would do to it, so the reader decides before anything runs.
 *
 * Pure: catalogue rows in, keys and notes out.
 */
import type { ForeignKeyRow, TableColumn } from "./introspect-db-logic";

/** Keys to write on a property, as `key: value` source fragments, plus what could not be said. */
export interface ColumnStorage {
    /** e.g. `columnType: "varchar"`, `precision: 10`. */
    keys: string[];
    /** Why the planner will not reproduce this column exactly, when it will not. */
    note?: string;
}

const literal = (value: string): string => JSON.stringify(value);

/** `character varying` → `varchar`, the spellings the planner's `columnType` uses. */
const NUMBER_COLUMN_TYPE: Record<string, string> = {
    "integer": "integer",
    "bigint": "bigint",
    "real": "real",
    "double precision": "double precision"
};

/** A sequence default — `nextval('orders_id_seq'::regclass)`. */
const SEQUENCE_DEFAULT = /^nextval\('([^']+)'::regclass\)$/;

/**
 * Whether a `nextval` default names the sequence `SERIAL` would have made for
 * this column — the only one the planner can declare, because it declares the
 * column as `SERIAL` and lets Postgres name the sequence.
 */
const isConventionalSequence = (col: TableColumn, sequence: string): boolean => {
    const bare = sequence.replace(/^.*\./, "").replace(/^"|"$/g, "");
    return bare === serialSequenceName(col.table_name, col.column_name);
};

/**
 * The name Postgres gives a `SERIAL` column's sequence — `ChooseRelationName`
 * with the `seq` label: `<table>_<column>_seq`, and when that is over 63 bytes
 * the longer of the two names is shortened, one character at a time, until it
 * fits.
 */
export function serialSequenceName(table: string, column: string): string {
    const available = 63 - "_seq".length - 1;
    let tableChars = table.length;
    let columnChars = column.length;
    while (tableChars + columnChars > available) {
        if (tableChars > columnChars) tableChars--;
        else columnChars--;
    }
    return `${table.slice(0, tableChars)}_${column.slice(0, columnChars)}_seq`;
}

/**
 * The `isId` (and `columnType`) a single-column primary key needs.
 *
 * `isId: "increment"` is an identity column, and only an INTEGER one. A serial
 * key — an integer with a `nextval` default — is `SERIAL`/`BIGSERIAL`, declared
 * through `columnType` beside `isId: "manual"`. A uuid key is `"uuid"` only when
 * the database generates it; a key with no default is `"manual"`, which keeps
 * the planner from inventing one.
 */
export function primaryKeyStorage(col: TableColumn, propType: string): ColumnStorage {
    const dataType = col.data_type.toLowerCase();
    const fallback = col.column_default?.trim();
    if (propType === "number") {
        if (col.is_identity === "YES") {
            if (dataType === "integer") return { keys: [`isId: ${literal("increment")}`] };
            return {
                keys: [`isId: ${literal("increment")}`],
                note: `"${col.column_name}" is a ${dataType} identity key; \`isId: "increment"\` is always ` +
                    "INTEGER, so a push would plan a narrowing type change (and ask before applying it)."
            };
        }
        const sequence = fallback ? SEQUENCE_DEFAULT.exec(fallback) : null;
        if (sequence) {
            const serial = dataType === "bigint" ? "bigserial" : dataType === "integer" ? "serial" : undefined;
            if (serial && isConventionalSequence(col, sequence[1])) {
                return { keys: [`isId: ${literal("manual")}`, `columnType: ${literal(serial)}`] };
            }
            return {
                keys: [`isId: ${literal("manual")}`, ...numberColumnType(dataType)],
                note: `"${col.column_name}" takes its value from the sequence ${sequence[1]}, which no property ` +
                    "can declare; a push would plan dropping that default."
            };
        }
        if (fallback) {
            return { keys: [`isId: ${literal(`sql\`${fallback}\``)}`, ...numberColumnType(dataType)] };
        }
        return { keys: [`isId: ${literal("manual")}`, ...numberColumnType(dataType)] };
    }

    if (dataType === "uuid") {
        if (fallback === "gen_random_uuid()") return { keys: [`isId: ${literal("uuid")}`] };
        if (fallback) return { keys: [`isId: ${literal(`sql\`${fallback}\``)}`, `columnType: ${literal("uuid")}`] };
        return { keys: [`isId: ${literal("manual")}`, `columnType: ${literal("uuid")}`] };
    }
    const strategy = fallback ? `sql\`${fallback}\`` : "manual";
    const stored = stringStorage(col);
    return { keys: [`isId: ${literal(strategy)}`, ...stored.keys], note: stored.note };
}

/** `columnType` for a number column the planner would otherwise make NUMERIC. */
function numberColumnType(dataType: string): string[] {
    const mapped = NUMBER_COLUMN_TYPE[dataType];
    return mapped ? [`columnType: ${literal(mapped)}`] : [];
}

/** The keys a `string` column needs; the bound itself is emitted as `validation.max`. */
function stringStorage(col: TableColumn): ColumnStorage {
    const dataType = col.data_type.toLowerCase();
    switch (dataType) {
        case "text":
            return { keys: [] };
        case "character varying":
            if (typeof col.character_maximum_length === "number" && col.character_maximum_length > 0) {
                return { keys: [`columnType: ${literal("varchar")}`] };
            }
            return {
                keys: [`columnType: ${literal("varchar")}`],
                note: `"${col.column_name}" is a varchar with no length; the planner always writes one ` +
                    "(255 unless `validation.max` says otherwise), so a push would plan a narrowing type change."
            };
        case "character":
            return { keys: [`columnType: ${literal("char")}`] };
        case "uuid":
            return { keys: [`columnType: ${literal("uuid")}`] };
        default:
            return {
                keys: [],
                note: `"${col.column_name}" is ${col.data_type === "USER-DEFINED" ? col.udt_name : col.data_type}, ` +
                    "which no property type stores; it is read as text, and a push would plan converting the column to text."
            };
    }
}

/**
 * The keys a non-key column needs, for the property type introspection chose.
 *
 * `enumTypeName` is the type the planner would name for this column
 * (`<table>_<column>`, cut to 63 bytes); an enum column whose type is called
 * anything else cannot be declared, and the note says how to rename it.
 */
export function columnStorage(
    col: TableColumn,
    propType: string,
    context: { isEnumColumn: boolean; enumTypeName: string; enumTypeShared: boolean }
): ColumnStorage {
    const dataType = col.data_type.toLowerCase();

    if (context.isEnumColumn) {
        if (col.udt_name === context.enumTypeName) return { keys: [] };
        return {
            keys: [],
            note: context.enumTypeShared
                ? `"${col.column_name}" uses the enum type "${col.udt_name}", which other columns share; Rebase gives ` +
                    `each column its own type (<table>_<column>), so a push would plan "${context.enumTypeName}" and a ` +
                    "conversion Postgres cannot cast."
                : `"${col.column_name}" uses the enum type "${col.udt_name}", and Rebase names a column's enum type ` +
                    `<table>_<column>. Rename it before pushing: ALTER TYPE "${col.udt_name}" RENAME TO "${context.enumTypeName}";`
        };
    }

    switch (propType) {
        case "number": {
            if (dataType === "numeric") {
                const keys: string[] = [];
                if (typeof col.numeric_precision === "number") keys.push(`precision: ${col.numeric_precision}`);
                if (typeof col.numeric_precision === "number" && typeof col.numeric_scale === "number") {
                    keys.push(`scale: ${col.numeric_scale}`);
                }
                return { keys };
            }
            if (dataType === "smallint") {
                return {
                    keys: [`columnType: ${literal("integer")}`],
                    note: `"${col.column_name}" is smallint, which no \`columnType\` names; it is declared integer, ` +
                        "so a push widens it (every value survives)."
                };
            }
            const mapped = numberColumnType(dataType);
            if (mapped.length > 0) return { keys: mapped };
            return {
                keys: [],
                note: `"${col.column_name}" is ${col.data_type}, which no \`columnType\` names; it is declared ` +
                    "numeric, and a push would plan converting it."
            };
        }
        case "string":
            return stringStorage(col);
        case "date":
            switch (dataType) {
                case "timestamp with time zone":
                    return { keys: [] };
                case "date":
                    return { keys: [`columnType: ${literal("date")}`] };
                case "time without time zone":
                    return { keys: [`columnType: ${literal("time")}`] };
                default:
                    return {
                        keys: [],
                        note: `"${col.column_name}" is ${col.data_type}; a date property stores timestamptz, date or ` +
                            "time, so a push would plan converting it to timestamptz (and ask before applying it)."
                    };
            }
        case "map":
            return dataType === "json" ? { keys: [`columnType: ${literal("json")}`] } : { keys: [] };
        default:
            return { keys: [] };
    }
}

/**
 * The `columnType` an array column needs, or a note when its element type is
 * not one the planner stores natively.
 *
 * Only `text[]`, `integer[]`, `boolean[]` and `numeric[]` are. Reading
 * `bigint[]` as `integer[]` — what this used to do — planned a narrowing.
 */
export function arrayStorage(col: TableColumn): { columnType?: string; innerType: string; note?: string } {
    switch (col.udt_name) {
        case "_text": return { columnType: "text[]", innerType: "string" };
        case "_int4": return { columnType: "integer[]", innerType: "number" };
        case "_bool": return { columnType: "boolean[]", innerType: "boolean" };
        case "_numeric": return { columnType: "numeric[]", innerType: "number" };
        default: {
            const element = col.udt_name.replace(/^_/, "");
            return {
                innerType: "string",
                note: `"${col.column_name}" is an array of ${element}; arrays are stored as text[], integer[], ` +
                    "boolean[] or numeric[] (anything else as jsonb), so a push would plan converting it."
            };
        }
    }
}

/**
 * A column default as a `defaultValue`, when it is a literal a property can carry.
 *
 * `undefined` when there is no default to carry, or when the default is one the
 * generator expresses another way (`now()` is `autoValue`, a key's default is
 * its `isId`). `{ note }` when there is a default and no property can say it —
 * a push would plan dropping it.
 */
export function literalDefaultOf(
    col: TableColumn,
    propType: string
): { source: string } | { note: string } | undefined {
    const raw = col.column_default?.trim();
    if (!raw) return undefined;
    // `autoValue` carries these two — the planner writes `now()` for it.
    if (/^(now\(\)|CURRENT_TIMESTAMP)$/i.test(raw)) return undefined;

    // `'text'::type` — the type part may itself be quoted or qualified.
    const quoted = /^'((?:[^']|'')*)'(?:::[\w\s."[\]]+)?$/.exec(raw);
    const unquoted = quoted ? quoted[1].replace(/''/g, "'") : undefined;

    switch (propType) {
        case "string":
            if (unquoted !== undefined) return { source: literal(unquoted) };
            break;
        case "number": {
            const text = unquoted ?? raw.replace(/^\((.*)\)$/, "$1").replace(/::[\w\s]+$/, "");
            if (/^-?\d+(\.\d+)?$/.test(text) && Number.isFinite(Number(text))) return { source: String(Number(text)) };
            break;
        }
        case "boolean":
            if (/^true$/i.test(raw)) return { source: "true" };
            if (/^false$/i.test(raw)) return { source: "false" };
            break;
        case "map":
            if (unquoted !== undefined) {
                try {
                    const parsed: unknown = JSON.parse(unquoted);
                    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                        return { source: JSON.stringify(parsed) };
                    }
                } catch {
                    // Not JSON: fall through to the note.
                }
            }
            break;
        default:
            break;
    }
    return { note: `"${col.column_name}" defaults to ${raw}, which no \`defaultValue\` can express; a push would plan dropping that default.` };
}

/** `ON DELETE` as the relation's `onDelete`, when it is not the default the planner would choose. */
export function onDeleteOf(fk: ForeignKeyRow, required: boolean): string | undefined {
    const rule = fk.delete_rule?.toUpperCase();
    if (!rule) return undefined;
    const defaultRule = required ? "RESTRICT" : "SET NULL";
    if (rule === defaultRule) return undefined;
    return rule.toLowerCase();
}
