/**
 * Introspection logic — pure functions and the pipeline that transforms
 * raw PostgreSQL metadata into Rebase collection definition files.
 *
 * This module contains NO side-effects: no fs writes, no pg.Client creation,
 * no process.exit.  It is imported by introspect-db.ts (the CLI entry-point)
 * and consumed directly by tests.
 */
import { firstFreeKey, toWireKey } from "@rebasepro/utils";
import { inferPropertyFromData } from "./introspect-db-inference";
import { humanize } from "./introspect-db-naming";
import { mapPgType } from "./introspect-db-types";
import type { CheckFactsByTable } from "./introspect-db-constraints";
import type { TableClassification } from "./introspect-db-structure";
import {
    buildColumnFacts,
    deriveKanbanProperty,
    deriveListProperties,
    deriveSort,
    deriveTitleProperty,
    isDerivedIndexColumn,
    isReadOnlyColumn
} from "./introspect-db-structure";

// ── Typed interfaces for SQL query results ────────────────────────────

export interface TableRow {
    table_name: string;
    /** True for the parent of a partitioned table (`relkind = 'p'`). */
    is_partitioned?: boolean;
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
    /** `"YES"` for an identity column. */
    is_identity?: string;
    /** `"ALWAYS"` or `"BY DEFAULT"` on an identity column. */
    identity_generation?: string | null;
    /** The declared `varchar(n)` / `char(n)` bound, if any. */
    character_maximum_length?: number | null;
    numeric_precision?: number | null;
    numeric_scale?: number | null;
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
    checks: CheckConstraintRow[];
    comments: CommentRow[];
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

// ── Irregular plurals that naive rules can't handle ───────────────────

const IRREGULAR_SINGULARS: Record<string, string> = {
    people: "person",
    children: "child",
    men: "man",
    women: "woman",
    mice: "mouse",
    geese: "goose",
    teeth: "tooth",
    feet: "foot",
    data: "datum",
    media: "medium",
    criteria: "criterion",
    phenomena: "phenomenon"
};

/**
 * Plurals in "-ves" whose singular really ends in f/fe, and which of the two.
 *
 * A blanket "-ves" -> "-f" rule gets `knives` -> `knif`, and mangles every
 * ordinary "-ive" noun that happens to be plural along with it: `archives` ->
 * `archif`, `objectives` -> `objectif`. The set of English words that genuinely
 * swap f/fe for ves is small and closed, so it is listed rather than guessed —
 * anything else ending in "ves" drops the trailing 's' like any other plural.
 *
 * Matched on the whole word, not on the suffix: `olives` ends in `lives`.
 */
const VES_SINGULAR_ENDINGS: Record<string, "f" | "fe"> = {
    calves: "f", dwarves: "f", elves: "f", halves: "f", hooves: "f",
    leaves: "f", loaves: "f", scarves: "f", selves: "f", sheaves: "f",
    shelves: "f", thieves: "f", wharves: "f", wolves: "f",
    knives: "fe", lives: "fe", wives: "fe"
};

/** Words ending in 's' that are already singular. */
const UNCOUNTABLE = new Set([
    "status", "campus", "virus", "bus", "plus", "census",
    "diagnosis", "analysis", "basis", "crisis", "thesis",
    "synopsis", "parenthesis", "hypothesis", "emphasis",
    "news", "series", "species", "means", "athletics",
    "economics", "electronics", "mathematics", "physics",
    "politics", "statistics"
]);

export function singularize(word: string): string {
    const lower = word.toLowerCase();

    // Check irregular forms
    if (IRREGULAR_SINGULARS[lower]) {
        // Preserve the original casing of the first character
        const singular = IRREGULAR_SINGULARS[lower];
        return word[0] === word[0].toUpperCase()
            ? singular.charAt(0).toUpperCase() + singular.slice(1)
            : singular;
    }

    // Check uncountable
    if (UNCOUNTABLE.has(lower)) return word;

    // Latin/Greek -es endings (diagnosis -> diagnosis is uncountable, but "addresses" -> "address")
    if (lower.endsWith("ices") && lower.length > 5) {
        // e.g. "indices" -> "index", "vertices" -> "vertex"
        return word.slice(0, -4) + "ex";
    }
    if (lower.endsWith("ies") && lower.length > 3) {
        return word.slice(0, -3) + "y";
    }
    if (VES_SINGULAR_ENDINGS[lower]) {
        // e.g. "wolves" -> "wolf", "knives" -> "knife"
        return word.slice(0, -3) + VES_SINGULAR_ENDINGS[lower];
    }
    if (lower.endsWith("ches") || lower.endsWith("shes") || lower.endsWith("sses") || lower.endsWith("xes") || lower.endsWith("zes")) {
        return word.slice(0, -2);
    }
    if (lower.endsWith("ses") && !lower.endsWith("sses")) {
        // e.g. "responses" -> "response", "databases" -> "database"
        return word.slice(0, -1);
    }
    if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us") && !lower.endsWith("is")) {
        return word.slice(0, -1);
    }

    return word;
}

/**
 * Convert a snake_case table name to a camelCase + "Collection" variable name.
 * e.g. "company_token" -> "companyTokenCollection"
 */
export function toCollectionVarName(tableName: string): string {
    const camel = tableName.replace(/_([a-z])/g, (_g, letter: string) => letter.toUpperCase()) + "Collection";
    // Only reshapes names that are not identifiers already, so every table that
    // generated a working file keeps the exact variable name it had. A table
    // called `2024 archive` used to emit `const 2024 archiveCollection`, which
    // is three syntax errors rather than a declaration.
    if (JS_IDENTIFIER.test(camel)) return camel;
    const sanitized = camel.replace(/[^A-Za-z0-9_$]/g, "_");
    return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
}

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
 * Still used by `./introspect-runtime`, which builds collections in memory from
 * a narrower set of catalog queries and has no unique-constraint or row-count
 * data to reason with.
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

// ── Generate collection file content ──────────────────────────────────

export interface GeneratedFile {
    tableName: string;
    fileName: string;
    content: string;
}

/**
 * The structural analysis a run can hand the generator.
 *
 * Optional in full, and the generator degrades to exactly its previous output
 * without it. That is not politeness towards old callers: three existing test
 * suites and the `rebase init` scaffold path build a `TableMeta` by hand and
 * have no database to read constraints or row counts from, and they must keep
 * producing a valid collection.
 */
/**
 * Which `defineCollection` — if any — the project being generated into can import.
 *
 * A bare `const x: PostgresCollectionConfig = { … }` annotation widens `properties`
 * to `Record<string, …>`, and every key-shaped field in the admin block —
 * `titleProperty`, `sort`, `propertiesOrder`, `listProperties`, `fixedFilter` — is
 * derived from those keys. Annotated, they accept any string: introspection was
 * emitting a `propertiesOrder` array that nothing checked, so renaming a column and
 * re-introspecting left a stale key that compiled silently. `defineCollection` is
 * the identity function whose `const P` type parameter keeps the keys literal, which
 * is what turns that checking on.
 *
 * There are two of them and they are not interchangeable:
 *
 * - `admin-types` — `@rebasepro/cms-types`. Its index side-effect-imports
 *   `augment.ts`, so importing it is also what *declares* the `admin` block. Only a
 *   project that depends on the package can resolve it.
 * - `common` — `@rebasepro/common`. Same key inference, no admin surface, no React
 *   anywhere in its graph (`scripts/headless-guard` lists it as core). This is the
 *   headless flavour.
 * - `annotation` — neither package is declared, so neither import would resolve and
 *   the old annotation is the only honest thing to emit. Projects scaffolded before
 *   `@rebasepro/common` joined the headless config package land here.
 *
 * The last two emit **no admin block, on the collection or on any property**. That is
 * not a downgrade: `@rebasepro/types` declares no `admin` field at all, so the block
 * introspection used to emit was a type error in every headless project it was
 * written into. See `packages/cms-types/src/augment.ts`.
 */
export type CollectionBuilder = "admin-types" | "common" | "annotation";

/**
 * The package specifiers the generated files name, spelled once.
 *
 * Written as constants rather than inline in the import templates below because
 * `scripts/headless-guard/check-types.mjs` scans core sources for `from
 * "@rebasepro/cms-types"` and cannot tell a real import from one this module
 * *writes*. It is right to be that blunt — the guard's whole value is that it
 * cannot be reasoned around — so the string simply never appears in that shape
 * here. Inlining them back into the templates re-breaks `check:types-headless`.
 */
export const ADMIN_TYPES_PACKAGE = "@rebasepro/cms-types";
export const COMMON_PACKAGE = "@rebasepro/common";
export const TYPES_PACKAGE = "@rebasepro/types";

export interface GenerationContext {
    metadata?: SchemaMetadata;
    classifications?: Map<string, TableClassification>;
    checkFacts?: CheckFactsByTable;
    /**
     * Defaults to `admin-types`, which is what the generator has always emitted.
     * The CLI never relies on the default — `introspect-db.ts` detects the flavour
     * from the target project and passes it. See `detectCollectionBuilder`.
     */
    builder?: CollectionBuilder;
}

/** Adds entries to a property's `validation` block, creating it if absent. */
function withValidation(extra: string, entries: string[]): string {
    if (entries.length === 0) return extra;
    const block = entries.map((e) => `                ${e}`).join(",\n");
    if (extra.includes("validation: {")) {
        return extra.replace("validation: {", `validation: {\n${block},`);
    }
    return `${extra}\n            validation: {\n${block}\n            },`;
}

/**
 * Whether a property's generated text already sets `key:` as an object key.
 *
 * A bare `extra.includes("min:")` looks like it answers this and does not:
 * `admin:` ends in `min:`, so every property with an admin block claimed to
 * have a minimum already and silently lost the one the database declared. The
 * leading-delimiter requirement is the whole point — a key is preceded by a
 * newline, a brace or a comma, never by another identifier character.
 */
function hasGeneratedKey(extra: string, key: string): boolean {
    return new RegExp(`(^|[\\s{,])${key}\\s*:`).test(extra);
}

/**
 * Adds entries to a property's `admin` block, creating it if absent.
 *
 * `emitAdmin` is false for the headless flavours, where `BaseProperty` has no
 * `admin` field to put them in — see {@link CollectionBuilder}. The options are
 * dropped rather than relocated: every one of them (`readOnly`, `multiline`,
 * `hideFromCollection`, `urlPreview`) describes a form widget, and there is no
 * form.
 */
function withAdminOptions(extra: string, entries: string[], emitAdmin = true): string {
    if (!emitAdmin) return extra;
    if (entries.length === 0) return extra;
    const block = entries.map((e) => `                ${e}`).join(",\n");
    if (extra.includes("admin: {")) {
        return extra.replace("admin: {", `admin: {\n${block},`);
    }
    return `${extra}\n            admin: {\n${block}\n            },`;
}

/** A TypeScript string literal, escaped. */
function quote(value: string): string {
    return JSON.stringify(value);
}

const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * An object key for the generated file: verbatim when the name is a JavaScript
 * identifier, quoted otherwise.
 *
 * Postgres constrains an identifier only by quoting, so `order`, `full name`
 * and `2fa_enabled` are all ordinary column names — and all three produced a
 * file that did not parse when written as a bare key.
 *
 * Still needed now that keys are camel-cased rather than copied from the
 * column: `toWireKey` splits on separators and joins, which fixes `full name`
 * but cannot fix a name that is not an identifier for some other reason —
 * `2fa_enabled` becomes `2faEnabled`, still leading with a digit, and `order`
 * was never a separator problem at all.
 */
function propKey(name: string): string {
    return JS_IDENTIFIER.test(name) ? name : quote(name);
}

/**
 * Text safe to put after `//`.
 *
 * A table comment or a classification reason is free text out of the database.
 * A newline in one ended the comment and let the rest of the value continue as
 * code.
 */
function commentText(value: string): string {
    return value.replace(/\s*[\r\n]+\s*/g, " ");
}

/** A property-key array, one key per line, indented for the admin block. */
function formatKeyList(keys: string[]): string {
    if (keys.length === 0) return "[]";
    return `[\n${keys.map((k) => `            ${quote(k)}`).join(",\n")}\n        ]`;
}

/**
 * Generate the full TypeScript file content for a single collection.
 * Pure function — no I/O.
 */
export function generateCollectionFile(
    tableName: string,
    meta: TableMeta,
    allFks: ForeignKeyRow[],
    joinTables: Set<string>,
    tablesMap: Map<string, TableMeta>,
    enumMap: Map<string, string[]>,
    sampleData?: Record<string, unknown>[],
    context: GenerationContext = {}
): string {
    const collectionName = humanize(tableName);
    const singular = singularize(collectionName);
    const icon = getIconForTable(tableName);

    const classification = context.classifications?.get(tableName);
    const checkFacts: CheckFactsByTable = context.checkFacts ?? new Map();
    const tableChecks = checkFacts.get(tableName);
    const columnComments = new Map<string, string>();
    let tableComment: string | undefined;
    for (const comment of context.metadata?.comments ?? []) {
        if (comment.table_name !== tableName) continue;
        if (comment.column_name === null) tableComment = comment.comment;
        else columnComments.set(comment.column_name, comment.comment);
    }
    const singleColumnUniques = new Set(
        (context.metadata?.uniques ?? [])
            .filter((u) => u.table_name === tableName && u.column_names.length === 1)
            .map((u) => u.column_names[0])
    );

    const builder: CollectionBuilder = context.builder ?? "admin-types";
    /** Whether the target project has an `admin` field to write into at all. */
    const emitAdmin = builder === "admin-types";

    const BUILDER_IMPORT: Record<CollectionBuilder, string> = {
        "admin-types": `import { defineCollection } from ${quote(ADMIN_TYPES_PACKAGE)};`,
        common: `import { defineCollection } from ${quote(COMMON_PACKAGE)};`,
        annotation: `import { PostgresCollectionConfig } from ${quote(TYPES_PACKAGE)};`
    };
    const imports = new Set<string>([BUILDER_IMPORT[builder]]);

    /**
     * Imports the collection a relation points at — unless it is this one.
     *
     * A self-referencing key (`employees.reports_to -> employees`, which both
     * northwind and chinook have) otherwise made the file import its own default
     * export under the name it declares three lines later: `TS2440: Import
     * declaration conflicts with local declaration`. The relation target is a
     * thunk, so referring to the local const directly is fine — it is only
     * dereferenced after the module has finished evaluating.
     */
    const importCollection = (otherTable: string): string => {
        const varName = toCollectionVarName(otherTable);
        if (otherTable !== tableName) imports.add(`import ${varName} from ${quote(`./${otherTable}`)};`);
        return varName;
    };

    /**
     * A relation's `target` thunk, with its return type spelled out.
     *
     * The annotation is what makes `defineCollection` survive a relational schema.
     * Without an explicit type on the const, the collection's type is *inferred*,
     * and a relation cycle — `posts` belongs to `authors`, `authors` has many
     * `posts`; or `employees.reports_to -> employees`, which northwind, chinook and
     * musicbrainz all have — makes that inference circular: `TS7022: implicitly has
     * type 'any' because it is referenced directly or indirectly in its own
     * initializer`, plus `TS7023` on the thunk and `TS2303` on the import alias.
     * Naming the return type lets the checker type the thunk without resolving the
     * collection it points at, which breaks the cycle. Nothing else is given up:
     * the inference that matters runs over `properties`, not over `relations`.
     *
     * The annotated flavour has no cycle to break — its const is already typed — so
     * it keeps the plainer thunk it has always emitted.
     */
    const relationTarget = (targetVarName: string): string => {
        if (builder === "annotation") return `() => ${targetVarName}`;
        imports.add(`import type { AnyCollectionConfig } from ${quote(TYPES_PACKAGE)};`);
        return `(): AnyCollectionConfig => ${targetVarName}`;
    };

    let propsOutput = "";
    let relationsOutput = "";
    const orderEntries: PropertyOrderEntry[] = [];
    const propertyBlocks = new Map<string, string>();
    /**
     * Column → the property key it was generated under.
     *
     * Needed because the structural helpers below (`deriveTitleProperty`,
     * `deriveKanbanProperty`, `deriveSort`) answer in *columns* — they read
     * `pg_attribute` — while `display.title`, `kanban.columnProperty` and
     * `sort` name **properties**. The two used to be the same string, so
     * nothing carried the translation; now `full_name` is generated as
     * `fullName` and a title pointing at `full_name` points at nothing.
     */
    const keyByColumn = new Map<string, string>();
    /** Properties the list view will not render, so `listProperties` skips them. */
    const hiddenFromCollection = new Set<string>();
    let columnIndex = 0;

    // Detect composite primary keys
    const isCompositePk = meta.pks.length > 1;

    // Map columns
    for (const col of meta.columns) {
        // Skip foreign keys since we handle them as relations
        // Exception: Do not skip if it's part of the primary key!
        if (meta.fks.some((fk) => fk.column_name === col.column_name) && !meta.pks.includes(col.column_name)) continue;

        const currentIndex = columnIndex++;

        // The key this column is generated under — its *wire* name, which is
        // not its column name. `columnName` below carries the column, so the
        // two never have to agree and the API stops carrying `user_id` next to
        // `displayName`.
        //
        // Camel-casing makes collisions possible where none existed: `user_id`
        // and `userId` are two columns and one key, which is a duplicate key in
        // an object literal — a TypeScript error that stops the whole generated
        // collection compiling. Resolved the same way the foreign-key loop
        // below resolves its own: first free candidate, then a numbered tail,
        // so no column is ever dropped. The raw column name is the second
        // candidate, so the loser of a collision still gets a name that means
        // something. Deterministic for a given database: the columns arrive in
        // ordinal order, so the same schema always yields the same keys.
        const propertyKey = firstFreeKey([toWireKey(col.column_name), col.column_name], propertyBlocks);
        keyByColumn.set(col.column_name, propertyKey);

        // Check if this column uses a PostgreSQL enum type
        const colEnumValues = enumMap.get(col.udt_name);
        const isEnumColumn = col.data_type === "USER-DEFINED" && colEnumValues !== undefined;
        const isVectorColumn = col.udt_name === "vector";

        const propType = isEnumColumn ? "string" : (isVectorColumn ? "vector" : mapPgType(col.data_type));
        let extra = "";

        const colNameLower = col.column_name.toLowerCase();

        // ── Data Inference Engine ────────────────────────────────────────────
        let finalPropType = propType;
        let inferenceExtra = "";

        if (!isEnumColumn && sampleData && sampleData.length > 0) {
            const values = sampleData.map(r => r[col.column_name]);
            const inferred = inferPropertyFromData(col.column_name, col.data_type, propType, values, meta.pks.includes(col.column_name), emitAdmin);
            if (inferred.propType) finalPropType = inferred.propType;
            if (inferred.extra) inferenceExtra = inferred.extra;
        }

        const columnChecks = tableChecks?.get(col.column_name);

        // Enum values — generate real enum from the PG enum
        if (isEnumColumn && colEnumValues) {
            const enumEntries = colEnumValues
                .map((v) => `{ id: ${quote(v)}, label: ${quote(humanize(v))} }`)
                .join(", ");
            extra += `\n            enum: [${enumEntries}],`;
        } else if (columnChecks?.enumValues && !inferenceExtra.includes("enum:") && propType === "string") {
            // `CHECK (col IN (…))` is the other way a schema declares a closed
            // set. It is the same statement as a Postgres enum type, made by an
            // author who did not want a type — and until now the form offered a
            // free-text box for it and let the database reject the write.
            const enumEntries = columnChecks.enumValues
                .map((v) => `{ id: ${quote(v)}, label: ${quote(humanize(v))} }`)
                .join(", ");
            extra += `\n            enum: [${enumEntries}],`;
        }

        // Date auto-value heuristics
        if (finalPropType === "date") {
            if (colNameLower === "created_at" || colNameLower === "createdat") {
                extra += "\n            autoValue: \"on_create\",";
                extra = withAdminOptions(extra, ["readOnly: true", "hideFromCollection: true"], emitAdmin);
                hiddenFromCollection.add(propertyKey);
            } else if (colNameLower === "updated_at" || colNameLower === "updatedat") {
                extra += "\n            autoValue: \"on_update\",";
                extra = withAdminOptions(extra, ["readOnly: true", "hideFromCollection: true"], emitAdmin);
                hiddenFromCollection.add(propertyKey);
            } else if (col.column_default && (col.column_default.includes("now()") || col.column_default.includes("CURRENT_TIMESTAMP"))) {
                extra += "\n            autoValue: \"on_create\",";
                extra = withAdminOptions(extra, ["readOnly: true"], emitAdmin);
            }
        }

        // Array/Map heuristics (Fallback if not inferred)
        if (finalPropType === "array" && !inferenceExtra.includes("of: {")) {
            let innerType = "string";
            let colType = "";
            if (col.udt_name.startsWith("_")) {
                const baseType = col.udt_name.substring(1);
                innerType = mapPgType(baseType);
                if (innerType === "string") colType = "text[]";
                else if (innerType === "number") colType = col.udt_name === "_numeric" ? "numeric[]" : "integer[]";
                else if (innerType === "boolean") colType = "boolean[]";
            }
            if (colType) {
                extra += `\n            columnType: ${quote(colType)},`;
            }
            extra += `\n            of: { name: ${quote(`${humanize(col.column_name)} Item`)}, type: ${quote(innerType)} },`;
        } else if (finalPropType === "map" && !inferenceExtra.includes("keyValue: true") && !inferenceExtra.includes("properties: {")) {
            extra += "\n            keyValue: true,";
        }

        // String sub-type heuristics (Fallback if not handled by inference or enum)
        if (finalPropType === "string" && !isEnumColumn && !inferenceExtra) {
            const isUrl = colNameLower.endsWith("_url") || colNameLower.endsWith("_uri") || colNameLower.endsWith("_link");
            const isMedia = colNameLower.includes("image") || colNameLower.includes("avatar") || colNameLower.includes("photo") || colNameLower.includes("logo") || colNameLower.includes("cover");

            if (isMedia) {
                extra += `\n            storage: {\n                storagePath: ${quote(`${tableName}/${col.column_name}`)}\n            },`;
            } else if (isUrl) {
                extra += "\n            url: true,";
            } else if (colNameLower === "description" || colNameLower === "summary" || colNameLower === "excerpt") {
                extra = withAdminOptions(extra, ["multiline: true"], emitAdmin);
            } else if (colNameLower === "content" || colNameLower === "body") {
                // Inside `admin`, because that is where both options live. At the
                // top of the property — where these were — the generated file
                // does not compile: `StringProperty` declares neither. Six of
                // OpenStreetMap's tables have a `body` column, which is how this
                // surfaced.
                extra = withAdminOptions(extra, ["multiline: true", "markdown: true"], emitAdmin);
            } else if (col.data_type === "text") {
                extra = withAdminOptions(extra, ["multiline: true"], emitAdmin);
            }
        }

        // Append inference results
        if (inferenceExtra) {
            extra += inferenceExtra;
            if (!extra.endsWith(",")) extra += ",";
        }

        // ── Rules the database already enforces ──────────────────────────────
        // Everything below is read from the catalog, not guessed from the data
        // or the column's name. Each one is a constraint a write would hit
        // anyway; surfacing it means the form says no before the database does.
        const declaredValidation: string[] = [];

        // `varchar(n)` — a bound the author wrote down and nothing has read.
        if (finalPropType === "string" &&
            typeof col.character_maximum_length === "number" &&
            col.character_maximum_length > 0 &&
            !hasGeneratedKey(extra, "max")) {
            declaredValidation.push(`max: ${col.character_maximum_length}`);
        }

        if (columnChecks) {
            if (finalPropType === "number") {
                if (columnChecks.min !== undefined && !hasGeneratedKey(extra, "min")) declaredValidation.push(`min: ${columnChecks.min}`);
                if (columnChecks.max !== undefined && !hasGeneratedKey(extra, "max")) declaredValidation.push(`max: ${columnChecks.max}`);
                if (columnChecks.moreThan !== undefined) declaredValidation.push(`moreThan: ${columnChecks.moreThan}`);
                if (columnChecks.lessThan !== undefined) declaredValidation.push(`lessThan: ${columnChecks.lessThan}`);
            }
            if (finalPropType === "string") {
                if (columnChecks.lengthMin !== undefined && !hasGeneratedKey(extra, "min")) declaredValidation.push(`min: ${columnChecks.lengthMin}`);
                if (columnChecks.lengthMax !== undefined && !declaredValidation.some((v) => v.startsWith("max:")) && !hasGeneratedKey(extra, "max")) {
                    declaredValidation.push(`max: ${columnChecks.lengthMax}`);
                }
            }
        }

        // A single-column unique index is the same promise `validation.unique`
        // makes. Composite uniqueness is not: it constrains the combination, and
        // marking either column unique on its own would reject valid rows.
        if (singleColumnUniques.has(col.column_name) && !meta.pks.includes(col.column_name)) {
            declaredValidation.push("unique: true");
        }

        extra = withValidation(extra, declaredValidation);

        // A generated column rejects every write, and a tsvector holds lexeme
        // positions rather than text, so an editable field for either is a field
        // that can only ever produce an error.
        if (isReadOnlyColumn(col) && !hasGeneratedKey(extra, "readOnly")) {
            const options = ["readOnly: true"];
            if (isDerivedIndexColumn(col) && !hasGeneratedKey(extra, "hideFromCollection")) {
                options.push("hideFromCollection: true");
                hiddenFromCollection.add(propertyKey);
            }
            extra = withAdminOptions(extra, options, emitAdmin);
        }

        // `COMMENT ON COLUMN` — documentation the author already wrote, which
        // introspection has never carried across.
        const columnComment = columnComments.get(col.column_name);
        if (columnComment) {
            extra = `\n            description: ${quote(columnComment)},${extra}`;
        }

        // Identify IDs (unless already inferred as UUID/CUID by inferenceEngine)
        if (meta.pks.includes(col.column_name)) {
            if (isCompositePk) {
                extra += `\n            // Part of composite primary key (${commentText(meta.pks.join(", "))})`;
            } else if (finalPropType === "number" && !inferenceExtra.includes("isId:")) {
                extra += "\n            isId: \"increment\",";
            } else if (col.data_type.toLowerCase() === "uuid" && !inferenceExtra.includes("isId:")) {
                extra += "\n            isId: \"uuid\",";
            } else if (!inferenceExtra.includes("isId:")) {
                extra += "\n            isId: \"uuid\", // Verify if this is a UUID or CUID";
            }
        }

        if (finalPropType === "vector") {
            const dims = col.atttypmod && col.atttypmod > 0 ? col.atttypmod : 1536;
            extra += `\n            dimensions: ${dims},`;
        }

        // `required` on a column the user cannot write is a form that cannot be
        // submitted: pagila's `film.fulltext` is NOT NULL and maintained by a
        // trigger, so demanding it of the user blocks every create.
        if (col.is_nullable === "NO" && !meta.pks.includes(col.column_name) && !col.column_default && !isReadOnlyColumn(col)) {
            if (extra.includes("validation: {")) {
                extra = extra.replace("validation: {", "validation: {\n                required: true,");
            } else {
                extra += "\n            validation: {\n                required: true\n            },";
            }
        }

        const humanName = humanize(col.column_name);

        orderEntries.push({
            key: propertyKey,
            ctx: {
                propType: finalPropType,
                isPk: meta.pks.includes(col.column_name),
                isEnum: isEnumColumn,
                isStorage: extra.includes("storage: {") || inferenceExtra.includes("storage: {"),
                pgDataType: col.data_type,
                originalIndex: currentIndex
            }
        });

        propertyBlocks.set(propertyKey, `
        ${propKey(propertyKey)}: {
            name: ${quote(humanName)},
            columnName: ${quote(col.column_name)},
            type: ${quote(finalPropType)},${extra}
        },`);
    }

    // Map Owning Relations (from this table's FKs to other tables)
    for (const fk of meta.fks) {
        const targetTableName = fk.foreign_table_name;
        if (!joinTables.has(targetTableName)) {
            // The relation gets its own property key, and it must not be one this
            // file has already used — a duplicate key in an object literal is a
            // TypeScript error, so the whole collection stops compiling.
            //
            // The collision needs three things at once and is invisible without
            // all three: a foreign key column that does *not* end in `_id`, that
            // column also being part of the primary key (which is what keeps it
            // as a property of its own rather than folding it into the relation),
            // and the stripped name matching the target table. MusicBrainz names
            // every foreign key after the table it points at — `area_tag (area,
            // tag)` — so 67 of its 339 collections came out with a property
            // declared twice.
            //
            // Camel-cased for the same reason the columns above are: this is a
            // property key, it sits in the same object literal, and a
            // `blog_author` beside a `publishedAt` is the two-conventions
            // defect reproduced inside a single collection.
            const stripped = toWireKey(fk.column_name.replace(/_id$/, ""));
            const relName = firstFreeKey(
                [
                    stripped,
                    toWireKey(targetTableName),
                    `${stripped}Relation`
                ],
                propertyBlocks
            );
            // Push the relation property key, not the FK column name
            orderEntries.push({
                key: relName,
                ctx: {
                    propType: "relation",
                    isPk: false,
                    isEnum: false,
                    isStorage: false,
                    pgDataType: "",
                    originalIndex: columnIndex++
                }
            });

            const targetCollectionCamel = importCollection(targetTableName);

            const relHumanName = humanize(relName);

            propertyBlocks.set(relName, `
        ${propKey(relName)}: {
            name: ${quote(relHumanName)},
            type: "relation",
            // mapped from foreign key: ${commentText(fk.column_name)} -> ${commentText(targetTableName)}(${commentText(fk.foreign_column_name)})
            relation: {
                kind: "belongsTo",
                target: ${relationTarget(targetCollectionCamel)},
                localKey: ${quote(fk.column_name)}
            }
        },`);
        }
    }

    // Map Inverse Relations (1-to-many where OTHER table points to THIS table)
    // These go into the `relations` array so they render as subcollection tabs.
    const inverseFks = allFks.filter((fk) => fk.foreign_table_name === tableName && !joinTables.has(fk.table_name));
    for (const fk of inverseFks) {
        const sourceTableName = fk.table_name;

        const targetCollectionCamel = importCollection(sourceTableName);

        relationsOutput += `
        {
            kind: "hasMany",
            relationName: ${quote(sourceTableName)},
            target: ${relationTarget(targetCollectionCamel)},
            // the ${commentText(sourceTableName)}.${commentText(fk.column_name)} FK points back here
            foreignKeyOnTarget: ${quote(fk.column_name)}
        },`;
    }

    // Map Many-to-Many Relations (Join Tables)
    // These also go into the `relations` array so they render as subcollection tabs.
    const relatedJoinTables = Array.from(joinTables).filter((jt) => {
        const jtMeta = tablesMap.get(jt);
        return jtMeta ? jtMeta.fks.some((fk) => fk.foreign_table_name === tableName) : false;
    });

    for (const jt of relatedJoinTables) {
        const jtMeta = tablesMap.get(jt);
        if (!jtMeta) continue;

        const joinFks = jtMeta.fks;

        // Handle self-referencing M2M: both FKs point to the same table
        const selfRefFks = joinFks.filter((fk) => fk.foreign_table_name === tableName);
        if (selfRefFks.length === 2) {
            // Self-referencing M2M — generate a single owning relation
            const thisFk = selfRefFks[0];
            const otherFk = selfRefFks[1];

            const relPropName = `${tableName}_via_${otherFk.column_name.replace(/_id$/, "")}`;

            relationsOutput += `
        {
            kind: "manyToMany",
            relationName: ${quote(relPropName)},
            target: ${relationTarget(toCollectionVarName(tableName))},
            through: {
                table: ${quote(jt)},
                sourceColumn: ${quote(thisFk.column_name)},
                targetColumn: ${quote(otherFk.column_name)}
            }
        },`;
            continue;
        }

        const otherFk = joinFks.find((fk) => fk.foreign_table_name !== tableName);

        if (otherFk) {
            const targetTableName = otherFk.foreign_table_name;

            const targetCollectionCamel = importCollection(targetTableName);

            // Both sides of a many-to-many are `manyToMany`. There is no owning
            // and inverse side to pick between any more, so this no longer
            // guesses one from table-name ordering and no longer emits a
            // half-configured relation on the losing side with a comment asking
            // the reader to finish it by hand. Introspection already knows both
            // junction columns; each side just names them from its own end.
            const thisFk = joinFks.find((fk) => fk.foreign_table_name === tableName);

            const throughCode = thisFk
                ? `\n            through: {\n                table: ${quote(jt)},\n                sourceColumn: ${quote(thisFk.column_name)},\n                targetColumn: ${quote(otherFk.column_name)}\n            }`
                : "";

            relationsOutput += `
        {
            kind: "manyToMany",
            relationName: ${quote(targetTableName)},
            target: ${relationTarget(targetCollectionCamel)},${throughCode}
        },`;
        }
    }

    const relationsBlock = relationsOutput
        ? `\n    relations: [${relationsOutput}\n    ],`
        : "";

    const sortedPropertiesOrder = sortPropertiesOrder(orderEntries);
    for (const key of sortedPropertiesOrder) {
        propsOutput += propertyBlocks.get(key) || "";
    }

    // ── The admin block ──────────────────────────────────────────────────
    // `icon` and `propertiesOrder` used to be emitted at the *top level* of the
    // config, where they have not belonged since the admin block was split out:
    // `PostgresCollectionConfig` does not declare them, so every generated file
    // was a type error, and the panel — which reads the block — never saw them.
    const adminEntries: string[] = [`icon: ${quote(icon)}`];

    if (classification) {
        const derivedFacts = context.metadata
            ? buildColumnFacts(meta, context.metadata, enumMap, checkFacts)
            : undefined;

        if (classification.role === "owned-child") {
            // The rows are already reachable: every inbound foreign key renders
            // as a tab on the parent. A second, top-level entry for them is what
            // turns a navigation of eight nouns into a list of thirty tables.
            adminEntries.push("hideFromNavigation: true");
        } else if (classification.role === "lookup") {
            adminEntries.push('group: "Reference"');
        }

        if (derivedFacts) {
            // Each of these comes back as a column and is emitted as a property.
            const asProperty = (column: string): string => keyByColumn.get(column) ?? toWireKey(column);

            const titleProperty = deriveTitleProperty(derivedFacts);
            if (titleProperty) adminEntries.push(`display: { title: ${quote(asProperty(titleProperty))} }`);

            const kanbanProperty = deriveKanbanProperty(derivedFacts);
            if (kanbanProperty) adminEntries.push(`kanban: {\n            columnProperty: ${quote(asProperty(kanbanProperty))}\n        }`);

            const sort = deriveSort(derivedFacts);
            if (sort) adminEntries.push(`sort: [${quote(asProperty(sort[0]))}, "desc"]`);
        }

        const listProperties = deriveListProperties(sortedPropertiesOrder, hiddenFromCollection);
        if (listProperties) {
            adminEntries.push(`listProperties: ${formatKeyList(listProperties)}`);
        }
    }

    adminEntries.push(`propertiesOrder: ${formatKeyList(sortedPropertiesOrder)}`);

    // Every entry above names a property key, and with `defineCollection` those
    // keys are now checked against `properties` — a stale `propertiesOrder` entry
    // left behind by a renamed column is a compile error rather than a silent
    // no-op. Which is also why the block cannot be emitted where the field is not
    // declared: see {@link CollectionBuilder}.
    const adminBlock = emitAdmin
        ? `\n    admin: {\n        ${adminEntries.join(",\n        ")}\n    }`
        : "";

    const descriptionBlock = tableComment
        ? `\n    description: ${quote(tableComment)},`
        : "";

    // The classification is stated in the file because it is a *decision*, and a
    // decision the reader may disagree with. Naming the evidence tells them
    // which line to delete when they do.
    const classificationNote = classification && classification.role !== "entity"
        ? `\n// Introspected as a ${commentText(classification.role)}: ${commentText(classification.reason)}.\n`
        : "";

    const collectionVarName = toCollectionVarName(tableName);
    // `const x = defineCollection({ … })` is also the shape the ts-morph schema
    // editor in `@rebasepro/server` expects — `COLLECTION_FACTORIES` — so an
    // introspected collection is now editable from the panel the way a scaffolded
    // one is.
    const [open, close] = builder === "annotation"
        ? [`const ${collectionVarName}: PostgresCollectionConfig = {`, "};"]
        : [`const ${collectionVarName} = defineCollection({`, "});"];
    // Package imports first, then siblings. `AnyCollectionConfig` is added the
    // moment the first relation needs it — which is after the sibling collections
    // it points at have already been added — and only when a relation needs it, so
    // a project with `noUnusedLocals` never sees an import it does not use.
    const importLines = Array.from(imports);
    const orderedImports = [
        ...importLines.filter((line) => !line.includes('from "./')),
        ...importLines.filter((line) => line.includes('from "./'))
    ];
    const fileContent = `${orderedImports.join("\n")}
${classificationNote}
${open}
    name: ${quote(collectionName)},
    singularName: ${quote(singular)},
    slug: ${quote(tableName)},
    table: ${quote(tableName)},${descriptionBlock}
    properties: {${propsOutput}
    },${relationsBlock}${adminBlock}
${close}

export default ${collectionVarName};
`;

    return fileContent;
}

/**
 * Generate the content for an index.ts file that re-exports all collections.
 */
export function generateIndexContent(fileNames: string[]): string {
    const sorted = [...fileNames].sort();
    let imports = "";
    let arrayElements = "";
    for (const f of sorted) {
        const varName = toCollectionVarName(f);
        imports += `import ${varName} from ${quote(`./${f}`)};\n`;
        arrayElements += `    ${varName},\n`;
    }
    return `${imports}\nexport const collections = [\n${arrayElements}];\n`;
}

/**
 * Merge new exports into existing index.ts content.
 * Returns the merged content string.
 */
export function mergeIndexContent(existingContent: string, newFileNames: string[]): string {
    const existingImports = new Set(
        [...existingContent.matchAll(/import\s+([a-zA-Z0-9_]+)\s+from\s+"\.\/([^"]+)"/g)].map((m) => m[2])
    );
    const sorted = [...newFileNames].sort();

    let newImports = "";
    let newElements = "";

    for (const f of sorted) {
        if (!existingImports.has(f)) {
            const varName = toCollectionVarName(f);
            newImports += `import ${varName} from ${quote(`./${f}`)};\n`;
            newElements += `    ${varName},\n`;
        }
    }

    if (!newImports) return existingContent;

    // Simple injection logic:
    // Add new imports below the last import or at the top
    const importRegex = /import\s+.*?;/g;
    let lastImportMatch;
    let match;
    while ((match = importRegex.exec(existingContent)) !== null) {
        lastImportMatch = match;
    }

    let contentWithImports = existingContent;
    if (lastImportMatch) {
        const pos = lastImportMatch.index + lastImportMatch[0].length;
        contentWithImports = existingContent.slice(0, pos) + "\n" + newImports.trimEnd() + existingContent.slice(pos);
    } else {
        contentWithImports = newImports + "\n" + existingContent;
    }

    // Inject into the `collections = [...]` array
    const arrayRegex = /export\s+const\s+collections\s*=\s*\[([\s\S]*?)\];/;
    return contentWithImports.replace(arrayRegex, (fullMatch, arrayContent) => {
        let mergedArray = arrayContent.trimEnd();
        if (mergedArray && !mergedArray.endsWith(",")) mergedArray += ",";
        if (mergedArray) mergedArray += "\n";
        mergedArray += newElements.trimEnd();
        return `export const collections = [\n    ${mergedArray.trim()}\n];`;
    });
}

/**
 * Safely extract the host portion of a database URL for logging.
 */
export function safeHostFromUrl(url: string): string {
    return url.includes("@") ? url.split("@")[1] : "(local connection)";
}
