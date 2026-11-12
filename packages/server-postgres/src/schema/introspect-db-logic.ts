/**
 * Introspection logic — pure functions and the pipeline that transforms
 * raw PostgreSQL metadata into `backend/schema` source (and, for a project
 * with a frontend, `frontend/src/cms` customizations).
 *
 * This module contains NO side-effects: no fs writes, no pg.Client creation,
 * no process.exit.  It is imported by introspect-db.ts (the CLI entry-point)
 * and consumed directly by tests.
 */
import { columnTypeLabel, type ColumnType, type TableDescriptor } from "@rebasepro/types";
import { printIndexModule, printTableModule, tableIdentifier } from "@rebasepro/common";
import { toWireKey } from "@rebasepro/utils";
import { inferColumnHints } from "./introspect-db-inference";
import { mapPgType } from "./introspect-db-types";
import { printCustomizationModule, type CustomizationValue } from "./introspect-db-customization";
import { describeTables } from "./introspect-tables";
import type { CheckFactsByTable } from "./introspect-db-constraints";
import type { TableClassification } from "./introspect-db-structure";
import {
    buildColumnFacts,
    deriveKanbanOrderProperty,
    deriveKanbanProperty,
    deriveListProperties,
    deriveSort,
    deriveTitleProperty,
    isDerivedIndexColumn
} from "./introspect-db-structure";

// ── Typed interfaces for SQL query results ────────────────────────────

export interface TableRow {
    table_name: string;
    /** True for the parent of a partitioned table (`relkind = 'p'`). */
    is_partitioned?: boolean;
    /** Whether row-level security is on (`relrowsecurity`). Absent when the caller did not read it. */
    rls_enabled?: boolean;
}

export interface TableColumn {
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    atttypmod: number | null;
    /** 1-based position in the table, as declared. */
    ordinal_position?: number;
    /** `"ALWAYS"` for a generated column, `"NEVER"` otherwise. */
    is_generated?: string;
    /** The `GENERATED ALWAYS AS (…)` expression, when `is_generated` says so. */
    generation_expression?: string | null;
    /** `"YES"` for an identity column. */
    is_identity?: string;
    /** `"ALWAYS"` or `"BY DEFAULT"` on an identity column. */
    identity_generation?: string | null;
    /** The declared `varchar(n)` / `char(n)` bound, if any. */
    character_maximum_length?: number | null;
    numeric_precision?: number | null;
    numeric_scale?: number | null;
    /**
     * `format_type(atttypid, atttypmod)`: the type as Postgres spells it in
     * full, modifiers included (`timestamp(3) without time zone`,
     * `geometry(Point,4326)`) — what a `col.custom()` column is declared as.
     */
    formatted_type?: string | null;
}

export interface EnumValue {
    enum_name: string;
    enum_value: string;
    sort_order: number;
}

export interface PrimaryKeyRow {
    table_name: string;
    column_name: string;
}

export interface ForeignKeyRow {
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    /** Name of the FK constraint — the only way to tell composite keys apart. */
    constraint_name?: string;
    /** 1-based position of this column within its constraint. */
    ordinal?: number;
    /** `"CASCADE"`, `"RESTRICT"`, `"SET NULL"`, `"SET DEFAULT"`, `"NO ACTION"`. */
    delete_rule?: string;
}

/** A unique constraint or unique index, as an ordered column list. */
export interface UniqueConstraintRow {
    table_name: string;
    constraint_name: string;
    column_names: string[];
}

/** One index: its name, and what it leads with. */
export interface IndexRow {
    table_name: string;
    index_name: string;
    /** The column its first key is, or null for an expression. */
    leading_column: string | null;
    /** Whether it serves every equality lookup on that column: a btree with no predicate. */
    serves_leading_column: boolean;
}

/** A CHECK constraint, as `pg_get_constraintdef` renders it. */
export interface CheckConstraintRow {
    table_name: string;
    constraint_name: string;
    definition: string;
}

/** A `COMMENT ON TABLE` (null `column_name`) or `COMMENT ON COLUMN`. */
export interface CommentRow {
    table_name: string;
    column_name: string | null;
    comment: string;
}

/** A row-level security policy, as `pg_policies` reports it. */
export interface PolicyRow {
    table_name: string;
    policy_name: string;
    /** `PERMISSIVE` or `RESTRICTIVE`. */
    permissive: string;
    /** The `TO` list: database roles, `public` for every role. */
    roles: string[];
    /** `SELECT`, `INSERT`, `UPDATE`, `DELETE` or `ALL`. */
    cmd: string;
    /** The `USING` expression, as Postgres renders it back. */
    qual: string | null;
    /** The `WITH CHECK` expression, as Postgres renders it back. */
    with_check: string | null;
}

/**
 * Everything one introspection run reads from the database.
 *
 * Passed around as one value so a new signal means a new field here rather than
 * a new parameter on every function between the query and the generator — the
 * shape `generateCollectionFile` had grown to seven positional arguments by.
 */
export interface SchemaMetadata {
    schema: string;
    tables: TableRow[];
    columns: TableColumn[];
    enumValues: EnumValue[];
    pks: PrimaryKeyRow[];
    fks: ForeignKeyRow[];
    uniques: UniqueConstraintRow[];
    /**
     * Every index on the introspected tables, by name — how a foreign key
     * whose column Rebase would index is told apart from one it already has.
     * Absent when the caller did not read them, and then nothing is said
     * about foreign-key indexes either way.
     */
    indexes?: IndexRow[];
    checks: CheckConstraintRow[];
    comments: CommentRow[];
    /**
     * The row-level security policies on the introspected tables. Absent when
     * the caller did not read them, and then no collection is given rules.
     */
    policies?: PolicyRow[];
    /**
     * Row counts for the tables that needed one, capped — see `countRowsUpTo`.
     * Absent for every table introspection never had a reason to count.
     */
    rowCounts: Record<string, number>;
}

export interface TableMeta {
    name: string;
    columns: TableColumn[];
    pks: string[];
    fks: ForeignKeyRow[];
}

/**
 * The icon a table's name suggests, for its panel customization: `Database`
 * when the name suggests none (and then no icon is written).
 */
export function getIconForTable(tableName: string): string {
    const table = tableName.toLowerCase();
    if (table.includes("user") || table.includes("account") || table.includes("member") || table.includes("customer") || table.includes("client") || table.includes("patient")) return "Users";
    if (table.includes("post") || table.includes("article") || table.includes("blog") || table.includes("page")) return "FileText";
    if (table.includes("product") || table.includes("item")) return "Package";
    if (table.includes("order") || table.includes("cart") || table.includes("purchase") || table.includes("invoice")) return "ShoppingCart";
    if (table.includes("setting") || table.includes("config")) return "Settings";
    if (table.includes("tag") || table.includes("categor")) return "Tag";
    if (table.includes("image") || table.includes("photo") || table.includes("media") || table.includes("asset")) return "Image";
    if (table.includes("notification") || table.includes("message") || table.includes("email")) return "Mail";
    if (table.includes("log") || table.includes("audit") || table.includes("event")) return "Activity";
    if (table.includes("subscription") || table.includes("plan") || table.includes("billing")) return "CreditCard";
    if (table.includes("comment") || table.includes("review") || table.includes("feedback")) return "MessageCircle";
    return "Database";
}

export { mapPgType };

// ── Build the enum map from query results ─────────────────────────────

export function buildEnumMap(enumValues: EnumValue[]): Map<string, string[]> {
    const enumMap = new Map<string, string[]>();
    for (const ev of enumValues) {
        const existing = enumMap.get(ev.enum_name);
        if (existing) {
            existing.push(ev.enum_value);
        } else {
            enumMap.set(ev.enum_name, [ev.enum_value]);
        }
    }
    return enumMap;
}

// ── Build the tables map from raw query results ───────────────────────

export function buildTablesMap(
    tables: TableRow[],
    columns: TableColumn[],
    pks: PrimaryKeyRow[],
    fks: ForeignKeyRow[]
): Map<string, TableMeta> {
    const tablesMap = new Map<string, TableMeta>();
    for (const t of tables) {
        tablesMap.set(t.table_name, {
            name: t.table_name,
            columns: columns.filter((c) => c.table_name === t.table_name),
            pks: pks.filter((pk) => pk.table_name === t.table_name).map((pk) => pk.column_name),
            fks: fks.filter((fk) => fk.table_name === t.table_name)
        });
    }
    return tablesMap;
}

// ── Identify join tables ──────────────────────────────────────────────

/**
 * Join tables, identified by column name.
 *
 * Superseded for the CLI by `classifyTables` in `./introspect-db-structure`,
 * which asks the database instead: two single-column keys, unique together, no
 * payload column, nothing referencing the table. This rule folds away
 * `northwind.order_details` — which has the key shape and carries unit price,
 * quantity and discount — because it recognises `id`, `created_at` and
 * `updated_at` by name and calls everything else a foreign key.
 *
 * Still the runtime's rule (`describeTables(…, { purpose: "serve" })`): what a
 * backend with no `backend/schema` has always folded away, kept so the set of
 * tables it serves does not move. Row counts, which `classifyTables` needs,
 * are not read at boot.
 */
export function identifyJoinTables(tablesMap: Map<string, TableMeta>): Set<string> {
    const joinTables = new Set<string>();
    for (const [tableName, meta] of tablesMap.entries()) {
        if (meta.fks.length === 2) {
            const isLikelyJoinTable = meta.columns.every((c) =>
                meta.fks.some((fk) => fk.column_name === c.column_name) ||
                c.column_name === "id" ||
                c.column_name === "created_at" ||
                c.column_name === "updated_at"
            );

            if (isLikelyJoinTable) {
                joinTables.add(tableName);
            }
        }
    }
    return joinTables;
}

// ── Property ordering heuristics ──────────────────────────────────────

/**
 * Property metadata used to compute display priority.
 * Keeps computePropertyPriority free of any TableMeta coupling.
 */
export interface PropertyOrderingContext {
    /** The resolved Rebase property type (e.g. "string", "number", "date", "relation"). */
    propType: string;
    /** Whether this column is a primary key. */
    isPk: boolean;
    /** Whether this column is an enum (USER-DEFINED with matching values). */
    isEnum: boolean;
    /** Whether this is a storage/file-upload field (detected from column name). */
    isStorage: boolean;
    /** The PostgreSQL data_type (e.g. "text", "character varying", "jsonb"). */
    pgDataType: string;
    /** The original column index in PostgreSQL (for stable tiebreaking). */
    originalIndex: number;
}

// — Tier 0: Identity (0–9) ————————————————————————————————————————————
const IDENTITY_EXACT: Record<string, number> = {
    id: 0,
    uuid: 1,
    _id: 2
};

// — Tier 1: Title / Name — the "display column" (10–19) ———————————————
const TITLE_EXACT: Record<string, number> = {
    name: 10,
    title: 11,
    label: 12,
    display_name: 13,
    displayname: 13,
    headline: 14,
    subject: 15,
    heading: 16
};

// — Tier 2: Human identity fields (20–29) —————————————————————————————
const HUMAN_IDENTITY_EXACT: Record<string, number> = {
    first_name: 20,
    firstname: 20,
    last_name: 21,
    lastname: 21,
    full_name: 22,
    fullname: 22,
    given_name: 22,
    family_name: 23,
    middle_name: 24,
    username: 25,
    user_name: 25,
    email: 26,
    email_address: 26,
    phone: 27,
    phone_number: 27,
    mobile: 27
};

// — Tier 3: Core descriptors (30–39) ——————————————————————————————————
const DESCRIPTOR_EXACT: Record<string, number> = {
    slug: 30,
    code: 31,
    sku: 32,
    reference: 33,
    ref: 33,
    type: 34,
    kind: 34,
    status: 35,
    state: 35,
    role: 36,
    category: 37,
    group: 38,
    priority: 39,
    order: 39,
    sort_order: 39,
    position: 39
};

// — Tier 12: System timestamps (120–129) ——————————————————————————————
const SYSTEM_TIMESTAMP_EXACT: Record<string, number> = {
    created_at: 120,
    createdat: 120,
    creation_date: 120,
    inserted_at: 121,
    updated_at: 122,
    updatedat: 122,
    modified_at: 122,
    last_modified: 122,
    deleted_at: 123,
    deletedat: 123,
    archived_at: 124
};

// — Pattern-based rules for partial matches ———————————————————————————
const TITLE_PATTERNS = ["name", "title", "label"];
const LONG_TEXT_NAMES = new Set(["description", "summary", "excerpt", "abstract", "overview", "bio", "biography", "about"]);
const RICH_CONTENT_NAMES = new Set(["content", "body", "html", "markup", "text", "article_body", "post_body"]);
const MEDIA_PATTERNS = ["image", "avatar", "photo", "logo", "cover", "thumbnail", "banner", "icon", "picture", "poster"];
const JSON_MAP_NAMES = new Set(["metadata", "meta", "config", "configuration", "settings", "options", "preferences", "data", "payload", "attributes", "extra", "additional_info"]);

/**
 * Compute a numeric priority score for a property.
 * Lower scores appear first in the generated `propertiesOrder` array.
 *
 * The system uses 14 tiers (0–139), with the original column index
 * added as a fractional tiebreaker (originalIndex / 10000) to
 * guarantee stable ordering within the same tier.
 *
 * Pure function — no side effects.
 */
export function computePropertyPriority(
    columnName: string,
    ctx: PropertyOrderingContext
): number {
    // Normalize camelCase/PascalCase to snake_case, then lowercase
    const col = columnName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const tiebreaker = ctx.originalIndex / 10000;

    // ── Tier 0: Primary key identity fields
    if (ctx.isPk) {
        const exactScore = IDENTITY_EXACT[col];
        return (exactScore ?? 5) + tiebreaker;
    }

    // ── Tier 12: System timestamps (check early to prevent false matches)
    const systemTs = SYSTEM_TIMESTAMP_EXACT[col];
    if (systemTs !== undefined) {
        return systemTs + tiebreaker;
    }

    // ── Tier 1: Title / Name exact matches
    const titleExact = TITLE_EXACT[col];
    if (titleExact !== undefined) {
        return titleExact + tiebreaker;
    }

    // ── Tier 2: Human identity exact matches
    const humanExact = HUMAN_IDENTITY_EXACT[col];
    if (humanExact !== undefined) {
        return humanExact + tiebreaker;
    }

    // ── Tier 3: Core descriptor exact matches
    const descriptorExact = DESCRIPTOR_EXACT[col];
    if (descriptorExact !== undefined) {
        return descriptorExact + tiebreaker;
    }

    // ── Tier 1b: Title-like partial matches (e.g. "product_name", "page_title")
    // Score 17–19 so they rank after exact matches but still in tier 1.
    for (const pattern of TITLE_PATTERNS) {
        if (col.includes(pattern) && col !== pattern) {
            return 17 + tiebreaker;
        }
    }

    // ── Tier 9: Media / file upload fields (check before general strings)
    if (ctx.isStorage) {
        return 90 + tiebreaker;
    }
    for (const pattern of MEDIA_PATTERNS) {
        if (col.includes(pattern)) {
            return 91 + tiebreaker;
        }
    }
    if (col.endsWith("_url") || col.endsWith("_uri") || col.endsWith("_link")) {
        return 92 + tiebreaker;
    }

    // ── Tier 7: Long text fields
    if (LONG_TEXT_NAMES.has(col)) {
        return 70 + tiebreaker;
    }

    // ── Tier 8: Rich content fields
    if (RICH_CONTENT_NAMES.has(col)) {
        return 80 + tiebreaker;
    }

    // ── Tier 10: JSON / Map types
    if (ctx.propType === "map") {
        return JSON_MAP_NAMES.has(col) ? 100 + tiebreaker : 105 + tiebreaker;
    }

    // ── Tier 11: Array types
    if (ctx.propType === "array") {
        return 110 + tiebreaker;
    }

    // ── Tier 6: Owning relations
    if (ctx.propType === "relation") {
        return 60 + tiebreaker;
    }

    // ── Tier 4: Short text, enums, booleans — "quick glance" fields
    if (ctx.isEnum) {
        return 40 + tiebreaker;
    }
    if (ctx.propType === "boolean") {
        return 45 + tiebreaker;
    }
    if (ctx.propType === "string" && ctx.pgDataType !== "text") {
        // Short string (varchar, char, uuid that's not a PK)
        return 42 + tiebreaker;
    }

    // ── Tier 5: Numbers & user-facing dates
    if (ctx.propType === "number") {
        return 50 + tiebreaker;
    }
    if (ctx.propType === "date") {
        // A date that isn't a system timestamp (already handled above)
        return 55 + tiebreaker;
    }

    // ── Tier 7b: text data_type that didn't match long-text names
    if (ctx.propType === "string" && ctx.pgDataType === "text") {
        return 75 + tiebreaker;
    }

    // ── Tier 13: Fallback / unknown
    return 130 + tiebreaker;
}

/**
 * Sort a `propertiesOrder` array using the priority heuristic.
 * Returns a new sorted array; does not mutate the input.
 *
 * @param entries - Array of { key, columnName, propType, ... } objects
 *                  carrying the information needed to compute priority.
 */
export interface PropertyOrderEntry {
    /** The property key in the generated collection (may differ from columnName for relations). */
    key: string;
    /** The ordering context for this property. */
    ctx: PropertyOrderingContext;
}

export function sortPropertiesOrder(entries: PropertyOrderEntry[]): string[] {
    return [...entries]
        .sort((a, b) => computePropertyPriority(a.key, a.ctx) - computePropertyPriority(b.key, b.ctx))
        .map((e) => e.key);
}

// ── Generate backend/schema (and frontend/src/cms) source ─────────────

/**
 * What one `schema introspect` run hands the generator.
 *
 * Everything but `metadata` is optional, and the generator degrades without
 * it: no classification is no table roles and no presentation heuristics, no
 * CHECK facts is no bounds, no samples is no data hints, no `cms` is no
 * `customizeTable` files.
 */
export interface SchemaGenerationInput {
    metadata: SchemaMetadata;
    /** Each table's role (`classifyTables`): junctions fold into `manyToMany`, the rest steer the panel. */
    classifications?: Map<string, TableClassification>;
    /** The CHECK constraints, parsed (`parseCheckConstraints`). */
    checkFacts?: CheckFactsByTable;
    /** Sampled rows by table (`--data-inference`). */
    samples?: ReadonlyMap<string, readonly Record<string, unknown>[]>;
    /** Tables not to generate, which nothing may then point at (a name that is no file name). */
    leaveOut?: ReadonlySet<string>;
    /**
     * Present when the project has a frontend that imports `@rebasepro/cms`:
     * the import path from a `frontend/src/cms/<table>.tsx` to the table's
     * schema module. Absent, no customization is written.
     */
    cms?: { tableImport: (table: string) => string };
    /** Where the builders are imported from. `@rebasepro/server/schema` when omitted. */
    specifier?: string;
}

/**
 * The source written for one table.
 */
export interface GeneratedTable {
    table: string;
    /** What `backend/schema/<table>.ts` exports, and `index.ts` re-exports. */
    identifier: string;
    /** `backend/schema/<table>.ts`. */
    schemaModule: string;
    /** `frontend/src/cms/<table>.tsx`, when a presentation heuristic fired and the project has a frontend. */
    customization?: string;
    /** What `rebase db push` would not reproduce exactly, each also at the top of the module. */
    notes: string[];
    /** Decisions the module states that the reader may want to undo (`index: false`, …), each also at its top. */
    remarks: string[];
}

/**
 * What {@link generateSchemaModules} returns.
 */
export interface SchemaGeneration {
    tables: GeneratedTable[];
    /** Tables whose descriptor could not be printed, each with why. */
    failed: { table: string; reason: string }[];
    /** The generated tables whose row-level security is off: the first push switches it on. */
    rlsOff: string[];
}

/** The column types a declared key may not have (`defineTable` refuses them). */
const UNKEYABLE_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["timestamptz", "time", "json", "jsonb", "vector", "bytea", "array", "other"]);

/** The `PropertyOrderingContext` property type of a column type. */
function orderingType(type: ColumnType): string {
    switch (type.kind) {
        case "smallint": case "integer": case "bigint": case "smallserial": case "serial": case "bigserial":
        case "real": case "doublePrecision": case "numeric":
            return "number";
        case "timestamptz": case "date": case "time": return "date";
        case "json": case "jsonb": return "map";
        case "array": return "array";
        case "boolean": return "boolean";
        case "vector": return "vector";
        case "bytea": return "binary";
        default: return "string";
    }
}

/** A `CustomizationValue` object, built up key by key. */
type FieldOptions = Record<string, CustomizationValue>;

/**
 * The panel options a table's structure and names suggest — what the
 * generator used to write into the collection's `admin` block — or
 * `undefined` when none fired (an icon of its own, a role, a title, a board, a
 * sort, a capped list, an option on a field).
 */
function customizationOf(
    descriptor: TableDescriptor,
    meta: TableMeta,
    input: SchemaGenerationInput,
    enumMap: Map<string, string[]>,
    fieldHints: ReadonlyMap<string, FieldOptions>
): { options: Record<string, CustomizationValue>; comments: string[] } | undefined {
    const table = descriptor.table;
    const classification = input.classifications?.get(table);
    const options: Record<string, CustomizationValue> = {};
    const comments: string[] = [];
    const keyOf = new Map(descriptor.columns.map(column => [column.column, column.key]));
    const relationOf = new Map(descriptor.relations
        .filter(relation => relation.kind === "belongsTo")
        .map(relation => [relation.kind === "belongsTo" ? relation.localKey : "", relation.name]));

    const icon = getIconForTable(table);
    if (icon !== "Database") options.icon = icon;
    if (classification?.role === "owned-child") options.hideFromNavigation = true;
    if (classification?.role === "lookup") options.group = "Reference";

    // Field options, by column key, from the column's name and kind.
    const fields: Record<string, FieldOptions> = {};
    const hidden = new Set<string>();
    for (const column of descriptor.columns) {
        const col = meta.columns.find(candidate => candidate.column_name === column.column);
        if (!col || column.foreignKeyOf !== undefined) continue;
        const name = column.column.toLowerCase();
        const field: FieldOptions = {};
        if (column.stamp?.value === "now") {
            field.readOnly = true;
            if (name === "created_at" || name === "createdat" || name === "updated_at" || name === "updatedat") {
                field.hidden = true;
                hidden.add(column.key);
            }
        } else if (isDerivedIndexColumn(col)) {
            field.hidden = true;
            hidden.add(column.key);
        } else if ((column.type.kind === "text" || column.type.kind === "varchar") && column.validate?.url !== true && !column.primaryKey) {
            if (name === "content" || name === "body") {
                field.multiline = true;
                field.markdown = true;
            } else if (column.type.kind === "text" || name === "description" || name === "summary" || name === "excerpt") {
                field.multiline = true;
            }
        }
        Object.assign(field, fieldHints.get(column.key) ?? {});
        if (Object.keys(field).length > 0) fields[column.key] = field;
    }

    // The order fields are listed in, by the same priority the generator has
    // always used; a link is placed where its relation is.
    const entries: PropertyOrderEntry[] = [];
    descriptor.columns.forEach((column, index) => {
        const col = meta.columns.find(candidate => candidate.column_name === column.column);
        const relation = relationOf.get(column.column);
        const isPk = column.primaryKey === true;
        entries.push({
            key: relation !== undefined && !isPk ? relation : column.key,
            ctx: {
                propType: relation !== undefined && !isPk ? "relation" : orderingType(column.type),
                isPk,
                isEnum: column.type.kind === "enum",
                isStorage: false,
                pgDataType: col?.data_type ?? "",
                originalIndex: index
            }
        });
    });
    const defaultOrder = entries.map(entry => entry.key);
    const order = sortPropertiesOrder(entries);

    if (classification && input.metadata) {
        const facts = buildColumnFacts(meta, input.metadata, enumMap, input.checkFacts ?? new Map());
        const asKey = (column: string): string => keyOf.get(column) ?? toWireKey(column);
        const title = deriveTitleProperty(facts);
        if (title) options.display = { title: asKey(title) };
        const kanban = deriveKanbanProperty(facts);
        const orderField = kanban ? deriveKanbanOrderProperty(facts) : undefined;
        if (kanban && orderField) options.kanban = { columnField: asKey(kanban), orderField: asKey(orderField) };
        else if (kanban) {
            comments.push(
                `A board over "${asKey(kanban)}" fits this table, but a board needs a text column to keep each card's order in. ` +
                `Add one, then declare kanban: { columnField: "${asKey(kanban)}", orderField: "<that column>" }.`
            );
        }
        const sort = deriveSort(facts);
        if (sort) options.sort = [asKey(sort[0]), "desc"];
        const listFields = deriveListProperties(order, hidden);
        if (listFields) options.listFields = listFields;
    }
    if (Object.keys(fields).length > 0) options.fields = fields;
    if (Object.keys(options).length === 0 && comments.length === 0) return undefined;
    if (order.join("\n") !== defaultOrder.join("\n")) options.fieldOrder = order;
    return { options, comments };
}

/** The comment a table whose row-level security is off opens with. */
function rlsOffComment(table: TableRow | undefined): string[] {
    if (table?.rls_enabled !== false) return [];
    return [
        "⚠ Row-level security is off on this table, so every request reaches every row. `rebase db push`",
        "switches it on: from then on the server and admins reach its rows, and anyone else what `rls` grants."
    ];
}

/** Comment lines, safe after `//`. */
const commentLines = (lines: readonly string[]): string =>
    lines.map(line => `// ${line.replace(/\s*[\r\n]+\s*/g, " ")}`.trimEnd()).join("\n");

/**
 * The source `rebase schema introspect` writes for a database: one
 * `backend/schema/<table>.ts` per table through the one table printer
 * (`printTableModule`), and a `frontend/src/cms/<table>.tsx` beside a table
 * whose structure suggested how the panel should show it.
 *
 * The tables are described with `describeTables(…, { purpose: "generate" })`:
 * columns as their Postgres types, foreign keys as `belongsTo` with the column
 * declared, the reverse `hasMany`, a junction as `manyToMany`, the policies as
 * `rls` (or `"admin-only"` when the table holds only the admin baseline). Pure.
 */
export function generateSchemaModules(input: SchemaGenerationInput): SchemaGeneration {
    const { metadata } = input;
    const tablesMap = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);
    const enumMap = buildEnumMap(metadata.enumValues);
    const joinTables = input.classifications
        ? new Set([...input.classifications.values()].filter(c => c.role === "junction").map(c => c.table))
        : identifyJoinTables(tablesMap);
    // A table with no primary key cannot be declared: a row is addressed by
    // its key in every URL, filter and foreign key.
    const keyless = [...tablesMap.values()].filter(meta => meta.pks.length === 0 && !joinTables.has(meta.name) && !(input.leaveOut?.has(meta.name) ?? false));
    const describe = (leaveOut: ReadonlySet<string>) => describeTables(metadata, {
        purpose: "generate",
        joinTables,
        leaveOut: new Set([...(input.leaveOut ?? []), ...keyless.map(meta => meta.name), ...leaveOut]),
        checkFacts: input.checkFacts
    });
    // A key column a row cannot be addressed by — an instant, a document, a
    // list, a type Rebase does not create — cannot be declared either; the
    // table is left out, and described again without it so nothing points at it.
    const unkeyable = new Map<string, string>();
    for (const table of describe(new Set()).tables) {
        const bad = table.columns.filter(column => column.primaryKey && UNKEYABLE_KINDS.has(column.type.kind));
        if (bad.length > 0) {
            unkeyable.set(table.table, `its key includes ${bad.map(column => `"${column.column}" (${columnTypeLabel(column.type)})`).join(", ")}, and a key ` +
                "column is a value a row is addressed by — text, a number, a uuid, a date, a boolean or an enum. Key the table on such a column and introspect again.");
        }
    }
    const described = describe(new Set(unkeyable.keys()));
    const bySlug = new Map(described.tables.map(table => [table.slug, table]));
    const resolveTarget = (target: { name?: string; slug: string }) => {
        const found = bySlug.get(target.slug);
        return { identifier: tableIdentifier(target.slug), importPath: `./${target.slug}`, ...(found ? { table: found.table, kind: found.kind } : {}) };
    };

    const out: SchemaGeneration = {
        tables: [],
        failed: [
            ...keyless.map(meta => ({
                table: meta.name,
                reason: "it has no primary key, and a table is declared with the column (or columns) that identify a row. Add one (`ALTER TABLE … ADD PRIMARY KEY (…)`) and introspect again."
            })),
            ...[...unkeyable].map(([table, reason]) => ({ table, reason }))
        ],
        rlsOff: []
    };
    for (const descriptor of described.tables) {
        const meta = tablesMap.get(descriptor.table);
        if (!meta) continue;
        const notes = [...(described.notes.drift.get(descriptor.table) ?? [])];
        const remarks = [...(described.notes.remark.get(descriptor.table) ?? [])];

        // What the rows and the names add to each column.
        const rows = input.samples?.get(descriptor.table);
        const fieldHints = new Map<string, FieldOptions>();
        const columns = descriptor.columns.map(column => {
            const hints = rows ? inferColumnHints(column.column, column.type, rows.map(row => row[column.column])) : {};
            if (hints.field) fieldHints.set(column.key, { ...hints.field });
            let validate = hints.validate;
            const name = column.column.toLowerCase();
            const text = column.type.kind === "text" || column.type.kind === "varchar" || column.type.kind === "char";
            if (!validate && !rows && text && column.foreignKeyOf === undefined && /_(url|uri|link)$/.test(name)) validate = { url: true };
            return validate ? { ...column, validate: { ...column.validate, ...validate } } : column;
        });
        const table: TableDescriptor = { ...descriptor, columns };

        let schemaModule: string;
        try {
            schemaModule = printTableModule(table, { resolveTarget, ...(input.specifier ? { specifier: input.specifier } : {}) });
        } catch (error) {
            out.failed.push({ table: descriptor.table, reason: error instanceof Error ? error.message : String(error) });
            continue;
        }
        const row = metadata.tables.find(candidate => candidate.table_name === descriptor.table);
        if (row?.rls_enabled === false) out.rlsOff.push(descriptor.table);
        const classification = input.classifications?.get(descriptor.table);
        const header = [
            ...(classification && classification.role !== "entity"
                ? [`Introspected as ${/^[aeiou]/.test(classification.role) ? "an" : "a"} ${classification.role}: ${classification.reason}.`]
                : []),
            ...(notes.length > 0 ? ["⚠ Not reproduced exactly by `rebase db push` — read before pushing:", ...notes.map(note => `  - ${note}`)] : []),
            ...(remarks.length > 0 ? ["Introspection notes:", ...remarks.map(remark => `  - ${remark}`)] : []),
            ...rlsOffComment(row)
        ];
        if (header.length > 0) {
            const split = schemaModule.indexOf("\n\nexport const ");
            schemaModule = `${schemaModule.slice(0, split)}\n\n${commentLines(header)}${schemaModule.slice(split + 1)}`;
        }

        const identifier = tableIdentifier(descriptor.slug);
        let customization: string | undefined;
        if (input.cms) {
            const options = customizationOf(table, meta, input, enumMap, fieldHints);
            if (options) {
                customization = printCustomizationModule({
                    slug: descriptor.slug,
                    tableIdentifier: identifier,
                    tableImport: input.cms.tableImport(descriptor.table),
                    options: options.options,
                    comments: options.comments
                });
            }
        }
        out.tables.push({ table: descriptor.table, identifier, schemaModule, notes, remarks, ...(customization ? { customization } : {}) });
    }
    return out;
}

/**
 * `backend/schema/index.ts` with an export line added for each table it does
 * not export yet — what a run without `--force` does to an index that exists.
 */
export function mergeIndexModule(existing: string, tables: readonly { identifier: string; importPath: string }[]): string {
    const exported = new Set([...existing.matchAll(/from\s+["']\.\/([^"']+)["']/g)].map(match => match[1]));
    const missing = tables.filter(table => !exported.has(table.importPath.replace(/^\.\//, "")));
    if (missing.length === 0) return existing;
    const lines = printIndexModule(missing).trimEnd().split("\n");
    const lastExport = [...existing.matchAll(/^export \{[^}]*\} from [^\n]*$/gm)].pop();
    if (!lastExport || lastExport.index === undefined) return `${lines.join("\n")}\n${existing.startsWith("\n") ? "" : "\n"}${existing}`;
    const at = lastExport.index + lastExport[0].length;
    return `${existing.slice(0, at)}\n${lines.join("\n")}${existing.slice(at)}`;
}

/**
 * What `rebase db push` does to tables whose row-level security is off, for
 * the introspection to say once — or `undefined` when there are none.
 */
export function describeRlsOffTables(tableNames: readonly string[]): string | undefined {
    if (tableNames.length === 0) return undefined;
    return `${tableNames.length} table(s) have row-level security off, so every request reaches every row: ` +
        `${[...tableNames].sort().join(", ")}.\n` +
        "`rebase db push` switches it on: from then on the server and admins reach their rows, and anyone else " +
        "what each table's `rls` grants.";
}

/**
 * Safely extract the host portion of a database URL for logging.
 */
export function safeHostFromUrl(url: string): string {
    return url.includes("@") ? url.split("@")[1] : "(local connection)";
}
