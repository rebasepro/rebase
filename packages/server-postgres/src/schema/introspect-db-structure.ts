/**
 * What a schema's *structure* says about the app on top of it.
 *
 * Introspection has always been a table mirror: one table in, one collection
 * out, one nav entry each, every column a form field. A schema of thirty tables
 * produces thirty sidebar entries, and a panel whose navigation is a list of
 * table names reads as a database browser however good the fields are — which
 * is the actual complaint about generated admin panels, and is structural, not
 * cosmetic.
 *
 * Most of what separates the eight nouns a user navigates by from the thirty
 * tables underneath them is written down in the schema already: which tables
 * only exist to join two others, which are small referenced code lists, which
 * rows cannot outlive a parent row. This module reads that.
 *
 * ## Structure only
 *
 * Nothing here looks at a column or table *name*. Name heuristics — `status`,
 * `*_url`, `image`, `created_at` — are wrong exactly when a schema is not in
 * English, or is domain-specific, or spells things differently, and they are
 * wrong silently. Every rule below is a fact the database enforces: key
 * composition, foreign-key direction and delete rule, uniqueness, nullability,
 * declared type and length, generated-ness, row count.
 *
 * That constraint has a cost, and it is worth stating: a schema that declares
 * nothing beyond `NOT NULL` gives this module very little to work with, and it
 * returns `entity` for everything rather than guessing. Under-classifying is
 * the intended failure mode. A table wrongly hidden from the navigation is a
 * table the user cannot find; a table wrongly left in it is merely the status
 * quo.
 *
 * Pure module: no I/O. Row counts come in on {@link SchemaMetadata.rowCounts},
 * which the caller fills from {@link ./introspect-db-queries.countRowsUpTo} for
 * the tables {@link lookupCandidates} names.
 */
import type {
    ForeignKeyRow,
    SchemaMetadata,
    TableColumn,
    TableMeta,
    UniqueConstraintRow
} from "./introspect-db-logic";
import { mapPgType } from "./introspect-db-types";
import type { CheckFactsByTable } from "./introspect-db-constraints";

// ── Thresholds ────────────────────────────────────────────────────────

/**
 * The row count above which a referenced table is a real entity rather than a
 * code list. Deliberately low: `pagila.category` has 16 rows and `language` 6,
 * while `actor` has 200 and `country` 109 — the gap between "a fixed set
 * somebody typed once" and "data the app accumulates" is wide, and picking a
 * number in the middle of it costs nothing.
 */
export const LOOKUP_MAX_ROWS = 50;

/**
 * The most payload columns a code list may carry. A code list is an id, a
 * label, and perhaps a sort key or a flag; past that it is a table with
 * attributes, which is an entity.
 */
export const LOOKUP_MAX_PAYLOAD_COLUMNS = 3;

/**
 * The most enum values a board can usefully have as columns. A kanban with
 * thirty columns is a horizontally scrolling table.
 */
export const KANBAN_MAX_VALUES = 12;

/** Below this, a "board" is one or two columns — a filter, not a board. */
export const KANBAN_MIN_VALUES = 2;

/**
 * How many columns a generated list view shows before it stops being readable.
 * Only applied when a table has more properties than this; a six-column table
 * gets no `listProperties` at all rather than a restatement of its own columns.
 */
export const LIST_PROPERTIES_CAP = 6;

// ── Roles ─────────────────────────────────────────────────────────────

/**
 * What a table *is*, structurally.
 *
 * - `entity` — a thing the app is about. Gets a collection and a nav entry.
 * - `junction` — exists only to relate two other tables. Gets no collection at
 *   all; it becomes a many-to-many relation on both sides.
 * - `lookup` — a small, referenced, self-contained code list. Gets a collection,
 *   grouped away from the entities rather than listed beside them.
 * - `owned-child` — rows that belong to exactly one parent row and are reached
 *   through it. Gets a collection (it is a real table with real rows, and the
 *   API still serves it) but no nav entry: it already renders as a tab on its
 *   parent.
 */
export type TableRole = "entity" | "junction" | "lookup" | "owned-child";

/**
 * Why a table was called someone's child, weakest last.
 *
 * Carried into the generated file as a comment. A reader who disagrees with the
 * classification needs to see what it was based on to know which line to change.
 */
export type OwnershipEvidence =
    /** The only foreign key declared `ON DELETE CASCADE`. */
    | "cascade-delete"
    /** The only foreign key that is part of the table's primary key. */
    | "identifying-key"
    /** The only foreign key that is `NOT NULL`. */
    | "sole-required-key"
    /** First column of a composite primary key made entirely of foreign keys. */
    | "leading-key-column";

export interface JunctionShape {
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
}

export interface TableClassification {
    table: string;
    role: TableRole;
    /** One line, in prose, for the generated file. */
    reason: string;
    /** Set when `role === "owned-child"`. */
    owner?: { table: string; column: string; evidence: OwnershipEvidence };
    /** Set when `role === "junction"`. */
    junction?: JunctionShape;
}

// ── Column-level structural predicates ────────────────────────────────

/**
 * A timestamp the database maintains: a temporal column defaulting to the
 * transaction clock.
 *
 * This is the structural stand-in for the `created_at`/`updated_at` name check.
 * It is strictly better than the name: it catches `fecha_creacion` and
 * `last_update` (pagila's spelling, which the name list misses), and it does not
 * fire on a user-editable `created_at date` column that has no default and which
 * the name check would wrongly make read-only.
 */
export function isAutoTimestamp(column: TableColumn): boolean {
    if (mapPgType(column.data_type) !== "date") return false;
    const columnDefault = (column.column_default ?? "").toLowerCase();
    if (!columnDefault) return false;
    return /\b(now\(\)|current_timestamp|current_date|current_time|localtimestamp|localtime|transaction_timestamp\(\)|statement_timestamp\(\)|clock_timestamp\(\))/.test(columnDefault);
}

/** A key the database fills in: identity, serial, or a uuid-generating default. */
export function isGeneratedKey(column: TableColumn): boolean {
    if (column.is_identity === "YES") return true;
    const columnDefault = (column.column_default ?? "").toLowerCase();
    if (!columnDefault) return false;
    return columnDefault.includes("nextval(") ||
        columnDefault.includes("gen_random_uuid") ||
        columnDefault.includes("uuid_generate");
}

/** A column Postgres computes; writing to it is an error. */
export function isGeneratedColumn(column: TableColumn): boolean {
    return column.is_generated === "ALWAYS";
}

/**
 * Types that exist to be searched or indexed, never to be typed into.
 *
 * A `tsvector` column is a derived search index — maintained by a trigger, a
 * generated expression, or an application job — and its contents are lexeme
 * positions, not text. Pagila's `film.fulltext` is one, and introspection used
 * to emit it as an ordinary required string: a mandatory form field whose
 * correct value no user can produce, on the sixth column of the list view.
 */
export function isDerivedIndexColumn(column: TableColumn): boolean {
    return column.udt_name === "tsvector" || column.udt_name === "tsquery";
}

/** Anything the user cannot meaningfully edit, whatever the reason. */
export function isReadOnlyColumn(column: TableColumn): boolean {
    return isGeneratedColumn(column) || isDerivedIndexColumn(column);
}

/**
 * A string column with a declared maximum length.
 *
 * `varchar(50)` and `text` are the same type to an application but not to the
 * author: choosing a bound is a statement that the value is short and
 * label-like, which is what makes this usable for picking a display column.
 */
export function isBoundedString(column: TableColumn): boolean {
    return mapPgType(column.data_type) === "string" &&
        typeof column.character_maximum_length === "number" &&
        column.character_maximum_length > 0;
}

/**
 * A column carrying data rather than structure: not a key, not a foreign key,
 * not a database-maintained timestamp, not computed.
 *
 * The count of these is what tells a pure join table from an association that
 * carries its own attributes — `northwind.order_details` has the key shape of a
 * junction and three payload columns, so it is not one.
 */
export function isPayloadColumn(column: TableColumn, pks: string[], fkColumns: Set<string>): boolean {
    if (pks.includes(column.column_name)) return false;
    if (fkColumns.has(column.column_name)) return false;
    if (isAutoTimestamp(column)) return false;
    if (isGeneratedColumn(column)) return false;
    return true;
}

// ── Foreign-key topology ──────────────────────────────────────────────

/** One foreign key, with its columns grouped back together. */
export interface ForeignKeyConstraint {
    name: string;
    table: string;
    columns: string[];
    foreignTable: string;
    foreignColumns: string[];
    deleteRule?: string;
}

/**
 * Groups per-column foreign key rows back into constraints.
 *
 * Rows arrive one per referencing column. A composite key looks exactly like two
 * separate keys until they are grouped by constraint name, and the difference
 * matters: two single-column keys to two tables can be a junction, one
 * two-column key never is.
 */
export function groupForeignKeys(fks: ForeignKeyRow[]): ForeignKeyConstraint[] {
    const byName = new Map<string, ForeignKeyConstraint>();
    for (const fk of fks) {
        // Rows from older callers carry no constraint name. Falling back to a
        // per-column key treats each as its own single-column constraint, which
        // is what the generator assumed before names were available.
        const key = `${fk.table_name}::${fk.constraint_name ?? `${fk.column_name}->${fk.foreign_table_name}`}`;
        const existing = byName.get(key);
        if (existing) {
            existing.columns.push(fk.column_name);
            existing.foreignColumns.push(fk.foreign_column_name);
            continue;
        }
        byName.set(key, {
            name: fk.constraint_name ?? `${fk.table_name}_${fk.column_name}_fkey`,
            table: fk.table_name,
            columns: [fk.column_name],
            foreignTable: fk.foreign_table_name,
            foreignColumns: [fk.foreign_column_name],
            deleteRule: fk.delete_rule
        });
    }
    return Array.from(byName.values());
}

/** Column sets that are unique in a table: its primary key and every unique index. */
function uniqueColumnSets(table: string, pks: string[], uniques: UniqueConstraintRow[]): string[][] {
    const sets: string[][] = [];
    if (pks.length > 0) sets.push(pks);
    for (const unique of uniques) {
        if (unique.table_name === table) sets.push(unique.column_names);
    }
    return sets;
}

function sameColumnSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((value, index) => value === right[index]);
}

// ── Classification ────────────────────────────────────────────────────

/** Everything classification needs, assembled once per run. */
interface AnalysisContext {
    tables: Map<string, TableMeta>;
    constraintsByTable: Map<string, ForeignKeyConstraint[]>;
    inboundByTable: Map<string, ForeignKeyConstraint[]>;
    uniques: UniqueConstraintRow[];
    rowCounts: Record<string, number>;
}

function buildContext(metadata: SchemaMetadata, tables: Map<string, TableMeta>): AnalysisContext {
    const allConstraints = groupForeignKeys(metadata.fks);
    const constraintsByTable = new Map<string, ForeignKeyConstraint[]>();
    const inboundByTable = new Map<string, ForeignKeyConstraint[]>();

    for (const constraint of allConstraints) {
        const outbound = constraintsByTable.get(constraint.table) ?? [];
        outbound.push(constraint);
        constraintsByTable.set(constraint.table, outbound);

        const inbound = inboundByTable.get(constraint.foreignTable) ?? [];
        inbound.push(constraint);
        inboundByTable.set(constraint.foreignTable, inbound);
    }

    return {
        tables,
        constraintsByTable,
        inboundByTable,
        uniques: metadata.uniques,
        rowCounts: metadata.rowCounts
    };
}

/**
 * A table that exists only to relate two others.
 *
 * Requires all of:
 * - exactly two single-column foreign keys, to two distinct columns;
 * - that pair is unique — it is the primary key, or a unique index covers it.
 *   Without this the table can hold the same pair twice, which is a list of
 *   events between two things, not a set membership;
 * - no payload columns. A join row that carries a quantity is an association
 *   with attributes, and collapsing it into a many-to-many silently drops those
 *   attributes from the UI entirely;
 * - nothing references it. A junction with its own dependents is something rows
 *   point *at*, so it needs an identity of its own.
 */
function classifyJunction(table: string, context: AnalysisContext): TableClassification | null {
    const meta = context.tables.get(table);
    if (!meta) return null;

    const constraints = context.constraintsByTable.get(table) ?? [];
    if (constraints.length !== 2) return null;
    if (constraints.some((c) => c.columns.length !== 1)) return null;

    const [first, second] = constraints;
    if (first.columns[0] === second.columns[0]) return null;

    if ((context.inboundByTable.get(table) ?? []).length > 0) return null;

    const pair = [first.columns[0], second.columns[0]];
    const uniqueSets = uniqueColumnSets(table, meta.pks, context.uniques);
    if (!uniqueSets.some((set) => sameColumnSet(set, pair))) return null;

    const fkColumns = new Set(pair);
    const payload = meta.columns.filter((column) => isPayloadColumn(column, meta.pks, fkColumns));
    if (payload.length > 0) return null;

    return {
        table,
        role: "junction",
        reason: `only relates ${first.foreignTable} to ${second.foreignTable}: two foreign keys, unique together, no other data`,
        junction: {
            sourceTable: first.foreignTable,
            sourceColumn: first.columns[0],
            targetTable: second.foreignTable,
            targetColumn: second.columns[0]
        }
    };
}

/**
 * A small, referenced, self-contained code list.
 *
 * Requires: something references it, it references nothing, it carries few and
 * simple payload columns, and it is small — where "small" is a real count, not
 * an estimate. `reltuples` is -1 on any table that has never been analyzed,
 * which is every table in a freshly restored dump, so a count that is merely
 * absent must not read as "small".
 */
function classifyLookup(table: string, context: AnalysisContext): TableClassification | null {
    if (!isLookupCandidate(table, context)) return null;

    const rowCount = context.rowCounts[table];
    if (typeof rowCount !== "number") return null;
    // An empty table is not a code list — there is nothing to look up, and a
    // schema-only restore would otherwise classify half the database this way.
    if (rowCount < 1 || rowCount > LOOKUP_MAX_ROWS) return null;

    const referencedBy = (context.inboundByTable.get(table) ?? []).length;
    return {
        table,
        role: "lookup",
        reason: `a ${rowCount}-row code list: referenced by ${referencedBy} table(s), references none, ${LOOKUP_MAX_PAYLOAD_COLUMNS} or fewer simple columns`
    };
}

/**
 * The structural half of the lookup test — everything except the row count.
 *
 * Separate because the count costs a query per table, and the caller only wants
 * to pay it for tables that could possibly qualify.
 */
function isLookupCandidate(table: string, context: AnalysisContext): boolean {
    const meta = context.tables.get(table);
    if (!meta) return false;

    if ((context.constraintsByTable.get(table) ?? []).length > 0) return false;
    if ((context.inboundByTable.get(table) ?? []).length === 0) return false;

    const payload = meta.columns.filter((column) => isPayloadColumn(column, meta.pks, new Set()));
    if (payload.length > LOOKUP_MAX_PAYLOAD_COLUMNS) return false;

    // A code list holds labels and flags. Documents, arrays, files and dates are
    // content, and content means the rows are worth browsing in their own right.
    //
    // Strings are allowed whether or not they declare a length. Requiring
    // `varchar(n)` looked like a way to say "label, not prose", and it is —
    // except that a schema written any time recently uses `text` for everything,
    // which is the advice Postgres itself gives. Modern pagila is all `text`, so
    // that rule classified nothing at all on it.
    return payload.every((column) => {
        const type = mapPgType(column.data_type);
        return type === "boolean" || type === "number" || type === "string";
    });
}

/**
 * Names the tables whose classification depends on a row count.
 *
 * The caller counts these — and only these — before calling
 * {@link classifyTables}. On a schema of any size this is a handful of tables,
 * and the count itself is capped (see `countRowsUpTo`), so the whole extra cost
 * is bounded regardless of how much data the database holds.
 */
export function lookupCandidates(metadata: SchemaMetadata, tables: Map<string, TableMeta>): string[] {
    const context = buildContext(metadata, tables);
    return Array.from(tables.keys()).filter((table) => isLookupCandidate(table, context));
}

/**
 * Rows that belong to one parent row and are reached through it.
 *
 * Requires nothing to reference the table — a table others point at has an
 * identity of its own and belongs in the navigation — and an *unambiguous*
 * owner among its foreign keys. The evidence ladder runs strongest first; each
 * rung is only taken when exactly one key satisfies it, so a table with two
 * equally plausible parents stays an entity rather than being filed under a
 * coin-flip.
 */
function classifyOwnedChild(table: string, context: AnalysisContext): TableClassification | null {
    const meta = context.tables.get(table);
    if (!meta) return null;

    const constraints = context.constraintsByTable.get(table) ?? [];
    if (constraints.length === 0) return null;
    if ((context.inboundByTable.get(table) ?? []).length > 0) return null;

    const owner = pickOwner(meta, constraints);
    if (!owner) return null;

    return {
        table,
        role: "owned-child",
        reason: `belongs to ${owner.constraint.foreignTable} (${describeEvidence(owner.evidence)}) and nothing else references it`,
        owner: {
            table: owner.constraint.foreignTable,
            column: owner.constraint.columns[0],
            evidence: owner.evidence
        }
    };
}

function describeEvidence(evidence: OwnershipEvidence): string {
    switch (evidence) {
        case "cascade-delete": return "its only ON DELETE CASCADE foreign key";
        case "identifying-key": return "its only foreign key inside the primary key";
        case "sole-required-key": return "its only NOT NULL foreign key";
        case "leading-key-column": return "the leading column of a primary key made only of foreign keys";
    }
}

function pickOwner(
    meta: TableMeta,
    constraints: ForeignKeyConstraint[]
): { constraint: ForeignKeyConstraint; evidence: OwnershipEvidence } | null {
    const singleColumn = constraints.filter((c) => c.columns.length === 1);
    if (singleColumn.length === 0) return null;

    const nullability = new Map(meta.columns.map((c) => [c.column_name, c.is_nullable === "NO"]));

    const cascading = singleColumn.filter((c) => c.deleteRule === "CASCADE");
    if (cascading.length === 1) return { constraint: cascading[0], evidence: "cascade-delete" };

    const identifying = singleColumn.filter((c) => meta.pks.includes(c.columns[0]));
    if (identifying.length === 1) return { constraint: identifying[0], evidence: "identifying-key" };

    const required = singleColumn.filter((c) => nullability.get(c.columns[0]) === true);
    if (required.length === 1) return { constraint: required[0], evidence: "sole-required-key" };

    // Last resort, and the only rung that leans on an ordering convention rather
    // than a guarantee: in a table whose whole primary key is foreign keys, the
    // first key column is the parent the rows are filed under.
    // `northwind.order_details` is keyed `(order_id, product_id)` — the rows are
    // lines of an order, which is exactly what that ordering says.
    if (identifying.length === meta.pks.length && meta.pks.length > 1) {
        const leading = identifying.find((c) => c.columns[0] === meta.pks[0]);
        if (leading) return { constraint: leading, evidence: "leading-key-column" };
    }

    return null;
}

/**
 * Classifies every table in the schema.
 *
 * Order matters: junction is the most specific and most consequential (the
 * table disappears), so it is tested first; then lookup, which needs no
 * ownership reasoning; then ownership. Anything unmatched is an entity, which
 * is also what every rule falls back to when its evidence is ambiguous.
 */
export function classifyTables(
    metadata: SchemaMetadata,
    tables: Map<string, TableMeta>
): Map<string, TableClassification> {
    const context = buildContext(metadata, tables);
    const result = new Map<string, TableClassification>();

    for (const table of tables.keys()) {
        const classification =
            classifyJunction(table, context) ??
            classifyLookup(table, context) ??
            classifyOwnedChild(table, context) ?? {
                table,
                role: "entity" as const,
                reason: "no structural evidence that it is a join table, a code list, or owned by another table"
            };
        result.set(table, classification);
    }

    return result;
}

// ── Presentation derived from structure ───────────────────────────────

/**
 * The columns a property-level derivation needs, resolved once.
 */
export interface ColumnFacts {
    column: TableColumn;
    isPk: boolean;
    isFk: boolean;
    /** Covered by a single-column unique constraint or unique index. */
    isUniqueAlone: boolean;
    isAutoTimestamp: boolean;
    isGenerated: boolean;
    /** Allowed values, from a Postgres enum type or a readable CHECK. */
    enumValues?: string[];
    propType: string;
}

export function buildColumnFacts(
    meta: TableMeta,
    metadata: SchemaMetadata,
    enumMap: Map<string, string[]>,
    checkFacts: CheckFactsByTable
): Map<string, ColumnFacts> {
    const fkColumns = new Set(meta.fks.map((fk) => fk.column_name));
    const singleColumnUniques = new Set(
        metadata.uniques
            .filter((u) => u.table_name === meta.name && u.column_names.length === 1)
            .map((u) => u.column_names[0])
    );
    const tableChecks = checkFacts.get(meta.name);

    const facts = new Map<string, ColumnFacts>();
    for (const column of meta.columns) {
        const pgEnum = column.data_type === "USER-DEFINED" ? enumMap.get(column.udt_name) : undefined;
        const checkEnum = tableChecks?.get(column.column_name)?.enumValues;
        facts.set(column.column_name, {
            column,
            isPk: meta.pks.includes(column.column_name),
            isFk: fkColumns.has(column.column_name),
            isUniqueAlone: singleColumnUniques.has(column.column_name),
            isAutoTimestamp: isAutoTimestamp(column),
            isGenerated: isGeneratedColumn(column),
            enumValues: pgEnum ?? checkEnum,
            propType: pgEnum ? "string" : mapPgType(column.data_type)
        });
    }
    return facts;
}

/**
 * The column that identifies a row to a human.
 *
 * Structural, in three rungs, strongest first:
 *
 * 1. A single-column unique constraint on a required string. This is as close
 *    as a schema comes to declaring "this is what a row is called": it is the
 *    column a person looks a row up by, and the database guarantees it picks
 *    out one row.
 * 2. The first required string that declares a length, when the table also has
 *    strings that do not. Choosing `varchar(n)` for one column and `text` for
 *    another is the author distinguishing a label from prose.
 * 3. The first required string in declaration order. Weak, but it is the same
 *    rung the panel's own fallback stands on, and column order carries real
 *    information — the identifying column of a table is written near the top of
 *    it, in every schema, in every language.
 *
 * Deliberately not: a column called `name`, or `title`. That works on English
 * schemas written by someone who read the same tutorial. This picks
 * `film.title`, `actor.first_name` and `category.name` out of pagila without
 * knowing what any of those words mean.
 */
export function deriveTitleProperty(facts: Map<string, ColumnFacts>): string | undefined {
    const candidates = Array.from(facts.values()).filter((f) =>
        !f.isPk && !f.isFk && !f.isGenerated &&
        f.propType === "string" &&
        !f.enumValues &&
        f.column.is_nullable === "NO"
    );
    if (candidates.length === 0) return undefined;

    const unique = candidates.find((f) => f.isUniqueAlone);
    if (unique) return unique.column.column_name;

    const bounded = candidates.filter((f) => isBoundedString(f.column));
    if (bounded.length > 0 && bounded.length < candidates.length) {
        return bounded[0].column.column_name;
    }

    return candidates[0].column.column_name;
}

/**
 * The enum column a board should have as its columns.
 *
 * A board needs a small, closed, always-present set of states. `NOT NULL` is
 * required because a null has no column to sit in; the bounds keep out
 * two-state flags (a filter, not a board) and long code lists (a scrolling
 * table). The first qualifying column in declaration order wins, so the output
 * is stable across runs.
 */
export function deriveKanbanProperty(facts: Map<string, ColumnFacts>): string | undefined {
    for (const fact of facts.values()) {
        if (fact.isPk || fact.isFk || fact.isGenerated) continue;
        if (!fact.enumValues) continue;
        if (fact.column.is_nullable !== "NO") continue;
        if (fact.enumValues.length < KANBAN_MIN_VALUES || fact.enumValues.length > KANBAN_MAX_VALUES) continue;
        return fact.column.column_name;
    }
    return undefined;
}

/**
 * The column a list should be sorted by, newest first.
 *
 * Only when the table has exactly one database-maintained timestamp. With two —
 * a created and an updated stamp — the two orderings differ and the schema does
 * not say which the user means, so neither is chosen.
 */
export function deriveSort(facts: Map<string, ColumnFacts>): [string, "desc"] | undefined {
    const stamps = Array.from(facts.values()).filter((f) => f.isAutoTimestamp);
    if (stamps.length !== 1) return undefined;
    return [stamps[0].column.column_name, "desc"];
}

/**
 * The first `LIST_PROPERTIES_CAP` visible properties, or nothing.
 *
 * Returning nothing when the table is already narrow matters: `listProperties`
 * that restates every column is config the reader has to check against the
 * property list to discover it does nothing, and it silently stops new columns
 * from appearing in the list view when someone adds one later.
 *
 * `hidden` names the properties already marked `hideFromCollection` — spending
 * one of six columns on a value the list does not render is worse than not
 * capping at all.
 */
export function deriveListProperties(propertiesOrder: string[], hidden: ReadonlySet<string> = new Set()): string[] | undefined {
    const visible = propertiesOrder.filter((key) => !hidden.has(key));
    if (visible.length <= LIST_PROPERTIES_CAP) return undefined;
    return visible.slice(0, LIST_PROPERTIES_CAP);
}
