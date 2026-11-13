/**
 * Introspection that speaks tables: a database's catalogue, read into
 * {@link TableDescriptor}s.
 *
 * Two callers, one description:
 *
 * - **the runtime** (`introspectTables`, purpose `"serve"`): a backend with no
 *   `backend/schema` serves every protected table of its database. The
 *   descriptors are what `GET /api/schema/tables` serves, and what the
 *   request-time collections are lowered from.
 * - **the source generator** (`rebase schema introspect`, purpose
 *   `"generate"`): the descriptors are printed as `backend/schema/<table>.ts`.
 *
 * Columns are their Postgres types (`ColumnType`): a uuid stays a uuid, a
 * `varchar(n)` keeps its `n`, an enum its labels and its real type name; a type
 * Rebase serves but does not create is `{ kind: "other", sqlType }`. Defaults
 * are classified (`ColumnDefault`), identity and serial keys recognised,
 * generated columns kept. Wire keys are `toWireKey` of the column with the
 * first-free-key dedupe the runtime has always used, so the REST surface of an
 * introspected database does not move by one key.
 *
 * Row-level security is read from the catalogue (`relrowsecurity`,
 * `pg_policies`) and the refusal lives here, so every caller gets it: a table
 * whose row-level security is off is not described — it is in `skipped`, with
 * the SQL that protects it — unless the caller passes the one explicit opt-out,
 * `unprotectedTables: "serve"`.
 *
 * @module
 */
import type {
    ColumnDefault,
    ColumnDescriptor,
    ColumnType,
    OnAction,
    RelationDescriptor,
    RlsDescriptor,
    SearchConfig,
    SecurityRule,
    TableDescriptor,
    UnmappedTable
} from "@rebasepro/types";
import { classifyTable, getGeneratedPolicyNames, policyToSecurityRule } from "@rebasepro/common";
import { firstFreeKey, toWireKey } from "@rebasepro/utils";

import {
    buildEnumMap,
    buildTablesMap,
    identifyJoinTables,
    type ForeignKeyRow,
    type PolicyRow,
    type SchemaMetadata,
    type TableColumn,
    type TableMeta,
    type TableRow
} from "./introspect-db-logic";
import { readSchemaMetadata, type QueryableClient } from "./introspect-db-queries";
import type { CheckFactsByTable } from "./introspect-db-constraints";
import { serialSequenceName } from "./introspect-db-storage";
import { reconstructSearchBlock } from "./introspect-db-search";
import { SEARCH_STAMP_PREFIX } from "./search-column";
import { foreignKeyIndexSpec } from "./table-index";

// ── Result ───────────────────────────────────────────────────────────────────

/**
 * A table introspection did not describe, and the SQL that would have it
 * described.
 *
 * @group Schema
 */
export interface SkippedTable {
    /** The table, unqualified. */
    table: string;
    /** Why, as a sentence. */
    reason: string;
    /** What to run so the table is served: `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` and an example policy. */
    remediationSql: string;
}

/**
 * A junction table: folded away rather than described (the runtime serves no
 * junction; the generator makes it a `manyToMany`).
 *
 * @group Schema
 */
export interface IntrospectedJunction {
    table: string;
    /** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` has been run on it. */
    rlsEnabled: boolean;
}

/**
 * What {@link introspectTables} returns.
 *
 * @group Schema
 */
export interface IntrospectedTables {
    /** One descriptor per table served, in table-name order. */
    tables: TableDescriptor[];
    /** The tables left out because row-level security is off on them, each with the SQL that protects it. */
    skipped: SkippedTable[];
    /** The junction tables, never described as tables. */
    junctions: IntrospectedJunction[];
    /** Tables described although row-level security is off on them — only with `unprotectedTables: "serve"`. */
    unprotected: string[];
}

/**
 * Options of {@link introspectTables}.
 *
 * @group Schema
 */
export interface IntrospectTablesOptions {
    /**
     * `"serve"` describes a table whose row-level security is off as well —
     * with a rule that says every caller reaches every row. The one explicit,
     * loud opt-out (`baas.unprotectedTables`); `"exclude"` (the default) leaves
     * such a table in `skipped`.
     */
    unprotectedTables?: "exclude" | "serve";
}

/**
 * What one table's description says about itself, by table, for the generator
 * to print: `drift` — what `rebase db push` would not reproduce exactly (a
 * column no builder states as it is, a foreign key no relation can hold) — and
 * `remark` — a decision the file states and the reader may want to undo
 * (`index: false`, a many-to-many declared on one end only).
 *
 * @group Schema
 */
export interface IntrospectionNotes {
    drift: Map<string, string[]>;
    remark: Map<string, string[]>;
}

/**
 * Options of {@link describeTables}.
 *
 * @group Schema
 */
export interface DescribeTablesOptions extends IntrospectTablesOptions {
    /**
     * - `"serve"` (default) — what the runtime serves, exactly as it always
     *   has: owning links only (`belongsTo`, its foreign-key column marked
     *   `derived` — the relation's, left out of the definition it is lowered
     *   from, exactly the collection the runtime has always built), the
     *   catalogue's policies as the rules, no heuristics.
     * - `"generate"` — what `schema introspect` writes: foreign-key columns
     *   declared in `columns`, the reverse `hasMany` and the `manyToMany` of
     *   each junction, the admin baseline folded into `"admin-only"` /
     *   `defaultPolicies`, CHECK bounds as validation, `created_at` /
     *   `updated_at` stamps, the `search` block read back, and a table whose
     *   row-level security is off described as `"admin-only"` (the push then
     *   switches it on).
     */
    purpose?: "serve" | "generate";
    /** The junction tables. Default: the runtime's name-based rule (`identifyJoinTables`). */
    joinTables?: ReadonlySet<string>;
    /** Tables the caller does not want described (and that nothing may point at). */
    leaveOut?: ReadonlySet<string>;
    /** The CHECK constraints, parsed (`parseCheckConstraints`): validation in `"generate"`. */
    checkFacts?: CheckFactsByTable;
}

/**
 * What {@link describeTables} returns: {@link IntrospectedTables} and the notes.
 *
 * @group Schema
 */
export interface DescribedTables extends IntrospectedTables {
    notes: IntrospectionNotes;
}

// ── Entry points ─────────────────────────────────────────────────────────────

/**
 * Describe every table of a Postgres schema, as the runtime serves them.
 *
 * Reads the catalogue (`readSchemaMetadata`: tables with `relrowsecurity`,
 * columns, enums, keys, foreign keys, unique constraints, indexes, CHECKs,
 * comments, `pg_policies`) and describes each table that is neither a junction
 * nor unprotected. Only `SELECT`s.
 *
 * @group Schema
 */
export async function introspectTables(
    client: QueryableClient,
    schema: string,
    options: IntrospectTablesOptions = {}
): Promise<IntrospectedTables> {
    const metadata = await readSchemaMetadata(client, schema);
    const { tables, skipped, junctions, unprotected } = describeTables(metadata, { purpose: "serve", ...options });
    return { tables, skipped, junctions, unprotected };
}

/**
 * The tables of one Postgres schema that no declared table maps, each
 * described for "Import an existing table" to adopt.
 *
 * Each table is described as `rebase schema introspect` writes it
 * (`describeTables(…, { purpose: "generate" })`), alone: a foreign key to a
 * declared table is a `belongsTo`, one to another undeclared table stays a
 * plain column (its constraint is left as it is), and the generator's reverse
 * links — relations of other tables — are not this table's to declare.
 *
 * Its `rls` is never weaker than what the database enforces: with row-level
 * security off, or no policy at all, it is `"admin-only"`, and `rlsRaised`
 * says so. A table with no primary key is listed with why it cannot be
 * imported. Junction tables and Rebase's own tables are left out. Only
 * `SELECT`s.
 *
 * @param mapped The SQL names of the tables already declared in `schema`.
 * @group Schema
 */
export async function describeUnmappedTables(
    client: QueryableClient,
    schema: string,
    options: { mapped: ReadonlySet<string> }
): Promise<UnmappedTable[]> {
    const metadata = await readSchemaMetadata(client, schema);
    const tablesMap = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);
    const joinTables = identifyJoinTables(tablesMap);
    const candidates = metadata.tables
        .map(row => row.table_name)
        .filter(name => !options.mapped.has(name) && !joinTables.has(name) && classifyTable(name, schema) !== "rebase-internal");
    const out: UnmappedTable[] = [];
    for (const name of candidates) {
        const row = metadata.tables.find(candidate => candidate.table_name === name);
        const policies = metadata.policies?.filter(policy => policy.table_name === name) ?? [];
        const base = { schema, table: name, rlsEnabled: row?.rls_enabled === true, policies: policies.length };
        if ((tablesMap.get(name)?.pks.length ?? 0) === 0) {
            out.push({
                ...base,
                notes: [],
                unimportable: "it has no primary key, and a table is declared with the column (or columns) that identify a row. " +
                    "Add one (`ALTER TABLE … ADD PRIMARY KEY (…)`) and import it again."
            });
            continue;
        }
        const described = describeTables(metadata, {
            purpose: "generate",
            joinTables,
            leaveOut: new Set(candidates.filter(other => other !== name))
        });
        const found = described.tables.find(table => table.table === name);
        if (!found) {
            out.push({ ...base, notes: [], unimportable: "introspection could not describe it." });
            continue;
        }
        const rlsRaised = !base.rlsEnabled
            ? `Row-level security is off on "${name}", so today every request reaches every row. It is imported as "admin-only": ` +
                "applying it switches row-level security on, and from then on only the server and admins reach its rows, until you add rules."
            : policies.length === 0
                ? `"${name}" has row-level security on and no policy. It is imported as "admin-only": ` +
                    "applying it gives the server and admins its rows, and nobody else, until you add rules."
                : undefined;
        const descriptor: TableDescriptor = {
            ...found,
            relations: found.relations.filter(relation => relation.kind === "belongsTo"),
            ...(rlsRaised ? { rls: { posture: "admin-only", rules: [], defaultPolicies: true } } : {})
        };
        out.push({
            ...base,
            descriptor,
            ...(rlsRaised ? { rlsRaised } : {}),
            notes: [...(described.notes.drift.get(name) ?? []), ...(described.notes.remark.get(name) ?? [])]
        });
    }
    return out;
}

/**
 * The SQL that protects a table introspection skipped: row-level security on,
 * and an example policy to adapt — what boot prints for it.
 *
 * @group Schema
 */
export function rlsRemediationSql(schema: string, table: string): string {
    const relation = `${quoteIdent(schema)}.${quoteIdent(table)}`;
    return `ALTER TABLE ${relation} ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY ${quoteIdent(`${table}_owner`)} ON ${relation} FOR ALL TO public USING (owner_id = rebase.uid());  -- an example: write the condition that fits`;
}

/**
 * Describe a schema from catalogue rows already read. Pure.
 *
 * @group Schema
 */
export function describeTables(metadata: SchemaMetadata, options: DescribeTablesOptions = {}): DescribedTables {
    const generate = options.purpose === "generate";
    const schema = metadata.schema;
    const tablesMap = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);
    const enumMap = buildEnumMap(metadata.enumValues);
    const joinTables = options.joinTables ?? identifyJoinTables(tablesMap);
    const leaveOut = options.leaveOut ?? new Set<string>();
    const notes: IntrospectionNotes = { drift: new Map(), remark: new Map() };
    const note = (table: string, text: string, kind: keyof IntrospectionNotes = "drift"): void => {
        const list = notes[kind].get(table) ?? [];
        list.push(text);
        notes[kind].set(table, list);
    };

    const skipped: SkippedTable[] = [];
    const junctions: IntrospectedJunction[] = [];
    const unprotected: string[] = [];
    const described: TableRow[] = [];
    for (const row of metadata.tables) {
        const name = row.table_name;
        if (joinTables.has(name)) {
            junctions.push({ table: name, rlsEnabled: row.rls_enabled === true });
            continue;
        }
        if (leaveOut.has(name)) continue;
        if (!generate && row.rls_enabled !== true && options.unprotectedTables !== "serve") {
            skipped.push({
                table: name,
                reason: "row-level security is disabled, so the table has no authorization model: every request would reach every row",
                remediationSql: rlsRemediationSql(schema, name)
            });
            continue;
        }
        if (!generate && row.rls_enabled !== true) unprotected.push(name);
        described.push(row);
    }
    const servedNames = new Set(described.map(row => row.table_name));

    const context: TableContext = {
        metadata,
        schema,
        generate,
        tablesMap,
        enumMap,
        joinTables,
        servedNames,
        checkFacts: options.checkFacts ?? new Map(),
        note
    };
    // Keys first, for every table: a relation names its target's key column.
    const shapes = new Map<string, TableShape>();
    for (const row of described) {
        const meta = tablesMap.get(row.table_name);
        if (meta) shapes.set(row.table_name, shapeTable(meta, context));
    }
    const tables: TableDescriptor[] = [];
    for (const row of described) {
        const shape = shapes.get(row.table_name);
        if (shape) tables.push(describeTable(row, shape, shapes, context));
    }
    return { tables, skipped, junctions, unprotected, notes };
}

// ── Internals ────────────────────────────────────────────────────────────────

interface TableContext {
    metadata: SchemaMetadata;
    schema: string;
    generate: boolean;
    tablesMap: Map<string, TableMeta>;
    enumMap: Map<string, string[]>;
    joinTables: ReadonlySet<string>;
    servedNames: ReadonlySet<string>;
    checkFacts: CheckFactsByTable;
    note: (table: string, text: string, kind?: keyof IntrospectionNotes) => void;
}

/** A foreign key that becomes a `belongsTo`. */
interface OwningLink {
    fk: ForeignKeyRow;
    name: string;
}

/** One table's columns and owning links, before the relations that need other tables are resolved. */
interface TableShape {
    meta: TableMeta;
    columns: ColumnDescriptor[];
    /** column name → wire key. */
    keyByColumn: Map<string, string>;
    links: OwningLink[];
    /** Every key and relation name taken, so later relations stay unique. */
    taken: Set<string>;
    search?: SearchConfig;
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/** `NOT NULL` facts, as the catalogue says them. */
const isNotNull = (col: TableColumn): boolean => col.is_nullable === "NO";

/** The foreign keys of a table that a `belongsTo` can hold: one column, pointing at the target's single-column key. */
function linkableForeignKeys(meta: TableMeta, context: TableContext): ForeignKeyRow[] {
    const byConstraint = new Map<string, ForeignKeyRow[]>();
    for (const fk of meta.fks) {
        const key = fk.constraint_name ?? `${fk.column_name}->${fk.foreign_table_name}`;
        byConstraint.set(key, [...(byConstraint.get(key) ?? []), fk]);
    }
    const out: ForeignKeyRow[] = [];
    for (const [constraint, rows] of byConstraint) {
        const fk = rows[0];
        if (rows.length > 1) {
            context.note(meta.name, `the foreign key ${constraint} spans (${rows.map(r => r.column_name).join(", ")}); a relation holds one column, so its columns are plain columns.`);
            continue;
        }
        if (!context.servedNames.has(fk.foreign_table_name)) continue;
        const target = context.tablesMap.get(fk.foreign_table_name);
        if (!target || target.pks.length !== 1 || target.pks[0] !== fk.foreign_column_name) {
            context.note(meta.name, `"${fk.column_name}" references ${fk.foreign_table_name}(${fk.foreign_column_name}), which is not that table's one-column primary key; a relation points at the key, so it stays a plain column.`);
            continue;
        }
        // One link per column: a second constraint on the same column says nothing new.
        if (out.some(other => other.column_name === fk.column_name)) continue;
        out.push(fk);
    }
    return out;
}

function shapeTable(meta: TableMeta, context: TableContext): TableShape {
    const { generate } = context;
    const comments = new Map<string, string>();
    for (const comment of context.metadata.comments) {
        if (comment.table_name === meta.name && comment.column_name !== null) comments.set(comment.column_name, comment.comment);
    }
    const links = linkableForeignKeys(meta, context);
    const linkColumns = new Set(links.map(fk => fk.column_name));
    // The search block's generated columns belong to `search`, not to `columns`.
    const searchColumns = new Set(meta.columns
        .filter(col => generate && col.is_generated === "ALWAYS" && (comments.get(col.column_name) ?? "").startsWith(SEARCH_STAMP_PREFIX))
        .map(col => col.column_name));

    // Wire keys, in the order the runtime has always taken them: the columns
    // that are not a link's first, in physical order, then the relation names,
    // then the link columns.
    const taken = new Set<string>();
    const keyByColumn = new Map<string, string>();
    const isFolded = (col: TableColumn): boolean => linkColumns.has(col.column_name) && !meta.pks.includes(col.column_name);
    for (const col of meta.columns) {
        if (searchColumns.has(col.column_name) || isFolded(col)) continue;
        const key = firstFreeKey([toWireKey(col.column_name), col.column_name], taken);
        taken.add(key);
        keyByColumn.set(col.column_name, key);
    }
    const named: OwningLink[] = [];
    if (generate) {
        // Declared columns: the link column keeps its own key, and the relation
        // is named beside it (a table keeps a column and a relation apart).
        for (const col of meta.columns) {
            if (!isFolded(col)) continue;
            const key = firstFreeKey([toWireKey(col.column_name), col.column_name], taken);
            taken.add(key);
            keyByColumn.set(col.column_name, key);
        }
        for (const fk of links) {
            const stripped = toWireKey(fk.column_name.replace(/_id$/, ""));
            const name = firstFreeKey([stripped, `${stripped}Relation`], taken);
            taken.add(name);
            named.push({ fk, name });
        }
    } else {
        // The runtime's names: `author_id` → `author`, and the target table when
        // the stripped name is a key column's own.
        for (const fk of links) {
            const stripped = toWireKey(fk.column_name.replace(/_id$/, ""));
            const pkCollision = meta.pks.includes(fk.column_name) && stripped === fk.column_name;
            const name = firstFreeKey([
                ...(pkCollision ? [] : [stripped]),
                fk.foreign_table_name,
                toWireKey(fk.foreign_table_name),
                `${stripped}Relation`
            ], taken);
            taken.add(name);
            named.push({ fk, name });
        }
        for (const col of meta.columns) {
            if (!isFolded(col)) continue;
            const key = firstFreeKey([toWireKey(col.column_name), col.column_name], taken);
            taken.add(key);
            keyByColumn.set(col.column_name, key);
        }
    }

    const uniques = new Set(context.metadata.uniques
        .filter(unique => unique.table_name === meta.name && unique.column_names.length === 1)
        .map(unique => unique.column_names[0]));
    const columns: ColumnDescriptor[] = [];
    for (const col of meta.columns) {
        const key = keyByColumn.get(col.column_name);
        if (key === undefined) continue;
        const link = named.find(entry => entry.fk.column_name === col.column_name);
        columns.push(describeColumn(col, key, meta, context, {
            unique: uniques.has(col.column_name),
            description: comments.get(col.column_name),
            foreignKeyOf: link?.name,
            derived: !generate && link !== undefined && isFolded(col)
        }));
    }

    let search: SearchConfig | undefined;
    if (generate && searchColumns.size > 0) {
        const read = reconstructSearchBlock({ schema: context.schema, table: meta.name, columns: meta.columns, comments, keyByColumn });
        if (read.note) context.note(meta.name, read.note);
        search = read.search;
    }
    return { meta, columns, keyByColumn, links: named, taken, search };
}

/** What a column's description needs besides the catalogue row. */
interface ColumnFacts {
    unique: boolean;
    description?: string;
    foreignKeyOf?: string;
    derived: boolean;
}

function describeColumn(col: TableColumn, key: string, meta: TableMeta, context: TableContext, facts: ColumnFacts): ColumnDescriptor {
    const isPk = meta.pks.includes(col.column_name);
    const sequenceKey = isPk && meta.pks.length === 1 ? serialKind(col) : undefined;
    const type = sequenceKey ?? columnTypeOf(col, context, meta.name);
    const out: ColumnDescriptor = {
        key,
        column: col.column_name,
        type,
        nullable: !isPk && !isNotNull(col)
    };
    if (isPk) out.primaryKey = true;
    if (facts.unique && !isPk) out.unique = true;
    if (col.is_generated === "ALWAYS" && col.generation_expression) {
        out.generated = { expression: col.generation_expression };
        out.readOnly = true;
    } else if (col.is_generated === "ALWAYS") {
        // Generated, by an expression this read did not return: never written.
        out.readOnly = true;
        context.note(meta.name, `"${col.column_name}" is a generated column whose expression was not read; it is declared read-only, and a push would plan it as a plain column.`);
    } else if (!sequenceKey) {
        const fallback = defaultOf(col, type);
        if (fallback) out.default = fallback;
    }
    if (facts.description !== undefined) out.description = facts.description;
    if (facts.foreignKeyOf !== undefined) out.foreignKeyOf = facts.foreignKeyOf;
    if (facts.derived) out.derived = true;
    if (context.generate) {
        applyGeneratedFacts(out, col, meta, context);
    }
    return out;
}

/**
 * The stamps and CHECK bounds the generator writes — what `schema introspect`
 * has always declared. Not in `"serve"`: the runtime stamps nothing the
 * database does not, and leaves CHECKs to the database.
 */
function applyGeneratedFacts(out: ColumnDescriptor, col: TableColumn, meta: TableMeta, context: TableContext): void {
    const name = col.column_name.toLowerCase();
    const temporal = out.type.kind === "timestamptz" || out.type.kind === "date" || out.type.kind === "time";
    const nowDefault = out.default?.kind === "sql" && /^(now\(\)|CURRENT_TIMESTAMP)$/i.test(out.default.expression);
    if (temporal && !out.primaryKey && out.generated === undefined) {
        if (name === "updated_at" || name === "updatedat") {
            out.stamp = { on: "update", value: "now" };
            delete out.default;
        } else if (name === "created_at" || name === "createdat" || nowDefault) {
            out.stamp = { on: "create", value: "now" };
            delete out.default;
        }
    }
    const checks = context.checkFacts.get(meta.name)?.get(col.column_name);
    if (!checks) return;
    const numeric = ["smallint", "integer", "bigint", "real", "doublePrecision", "numeric"].includes(out.type.kind);
    const text = out.type.kind === "text" || out.type.kind === "varchar" || out.type.kind === "char";
    const validate: NonNullable<ColumnDescriptor["validate"]> = {};
    if (numeric) {
        if (checks.min !== undefined) validate.min = checks.min;
        if (checks.max !== undefined) validate.max = checks.max;
        if (checks.moreThan !== undefined) validate.moreThan = checks.moreThan;
        if (checks.lessThan !== undefined) validate.lessThan = checks.lessThan;
    }
    if (text) {
        if (checks.lengthMin !== undefined) validate.min = checks.lengthMin;
        if (checks.lengthMax !== undefined) validate.max = checks.lengthMax;
    }
    if (Object.keys(validate).length > 0) out.validate = validate;
    if (checks.enumValues && text) {
        context.note(meta.name, `"${col.column_name}" accepts only ${checks.enumValues.map(v => `'${v}'`).join(", ")} (a CHECK the database enforces); ` +
            "a closed set on a text column is not declared yet (`.oneOf()` there waits on `text-one-of`), so the API leaves it to the database.");
    }
}

/** `NEXTVAL('<table>_<column>_seq')`, the default `SERIAL` gives a column. */
const SEQUENCE_DEFAULT = /^nextval\('([^']+)'::regclass\)$/i;

/** The serial kind of a single-column key whose default is its own conventional sequence. */
function serialKind(col: TableColumn): ColumnType | undefined {
    const match = col.column_default ? SEQUENCE_DEFAULT.exec(col.column_default.trim()) : null;
    if (!match) return undefined;
    const bare = match[1].replace(/^.*\./, "").replace(/^"|"$/g, "");
    if (bare !== serialSequenceName(col.table_name, col.column_name)) return undefined;
    switch (col.data_type.toLowerCase()) {
        case "smallint": return { kind: "smallserial" };
        case "integer": return { kind: "serial" };
        case "bigint": return { kind: "bigserial" };
        default: return undefined;
    }
}

/** A catalogue element type name (`udt_name` without the `_`) as the type an array holds, when it is one Rebase stores in an array. */
function elementTypeOf(udt: string, typmod: number | null, enumMap: Map<string, string[]>): ColumnType | undefined {
    switch (udt) {
        case "text": return { kind: "text" };
        case "varchar": return typmod !== null && typmod > 4 ? { kind: "varchar", length: typmod - 4 } : { kind: "text" };
        case "bpchar": return { kind: "char", length: typmod !== null && typmod > 4 ? typmod - 4 : 1 };
        case "uuid": return { kind: "uuid" };
        case "int2": return { kind: "smallint" };
        case "int4": return { kind: "integer" };
        case "int8": return { kind: "bigint" };
        case "float4": return { kind: "real" };
        case "float8": return { kind: "doublePrecision" };
        case "numeric": return { kind: "numeric" };
        case "bool": return { kind: "boolean" };
        case "timestamptz": return { kind: "timestamptz" };
        case "date": return { kind: "date" };
        case "time": return { kind: "time" };
        default: {
            const labels = enumMap.get(udt);
            return labels ? { kind: "enum", values: labels, name: udt } : undefined;
        }
    }
}

/**
 * A column's Postgres type, as the catalogue states it. A type with no
 * `ColumnType` member is `{ kind: "other", sqlType }`, spelled as Postgres
 * names it — served as the driver returns it, and declared with `col.custom()`.
 */
function columnTypeOf(col: TableColumn, context: TableContext, table: string): ColumnType {
    const dataType = col.data_type.toLowerCase();
    switch (dataType) {
        case "text": return { kind: "text" };
        case "character varying":
            if (typeof col.character_maximum_length === "number" && col.character_maximum_length > 0) {
                return { kind: "varchar", length: col.character_maximum_length };
            }
            context.note(table, `"${col.column_name}" is a varchar with no length, declared as text: a push would convert it to text, which keeps every value.`);
            return { kind: "text" };
        case "character": return { kind: "char", length: typeof col.character_maximum_length === "number" && col.character_maximum_length > 0 ? col.character_maximum_length : 1 };
        case "uuid": return { kind: "uuid" };
        case "smallint": return { kind: "smallint" };
        case "integer": return { kind: "integer" };
        case "bigint": return { kind: "bigint" };
        case "real": return { kind: "real" };
        case "double precision": return { kind: "doublePrecision" };
        case "numeric":
            if (typeof col.numeric_precision !== "number") return { kind: "numeric" };
            return typeof col.numeric_scale === "number"
                ? { kind: "numeric", precision: col.numeric_precision, scale: col.numeric_scale }
                : { kind: "numeric", precision: col.numeric_precision };
        case "boolean": return { kind: "boolean" };
        // A declared fractional precision (`timestamptz(3)`, `time(0)`) is no
        // builder's: kept as the type the database holds, so a push does not
        // widen the column back to the default of 6.
        case "timestamp with time zone":
            return withPrecision(col) ?? { kind: "timestamptz" };
        case "date": return { kind: "date" };
        case "time without time zone":
            return withPrecision(col) ?? { kind: "time" };
        case "json": return { kind: "json" };
        case "jsonb": return { kind: "jsonb" };
        case "bytea": return { kind: "bytea" };
        case "user-defined": {
            const labels = context.enumMap.get(col.udt_name);
            if (labels) return { kind: "enum", values: labels, name: col.udt_name };
            if (col.udt_name === "vector" && typeof col.atttypmod === "number" && col.atttypmod > 0) {
                return { kind: "vector", dimensions: col.atttypmod };
            }
            return { kind: "other", sqlType: col.formatted_type ?? col.udt_name };
        }
        case "array": {
            const element = col.udt_name.replace(/^_/, "");
            const of = elementTypeOf(element, col.atttypmod, context.enumMap);
            return of ? { kind: "array", of } : { kind: "other", sqlType: col.formatted_type ?? `${element}[]` };
        }
        // A `col.custom()` type, as `format_type` prints it where the read has
        // it — modifiers kept (`timestamp(3)`, a PostGIS SRID) — which is the
        // type a push then writes back.
        default:
            return { kind: "other", sqlType: col.formatted_type ?? col.data_type };
    }
}

/** A temporal column with a declared precision, as `col.custom()` of the type the catalogue prints; `undefined` without one. */
function withPrecision(col: TableColumn): ColumnType | undefined {
    return col.formatted_type && /\(\d+\)/.test(col.formatted_type) ? { kind: "other", sqlType: col.formatted_type } : undefined;
}

/** `'text'::type` → `text`, unescaped. */
const QUOTED_LITERAL = /^'((?:[^']|'')*)'(?:::[\w\s."[\]]+)?$/;

/**
 * A column's DEFAULT, classified.
 *
 * - identity → `{ kind: "identity" }`; `gen_random_uuid()` → `random-uuid`;
 * - a literal of the column's own type → `literal`;
 * - an expression Rebase can state again verbatim (`now()`, a function call,
 *   an operator) → `sql`;
 * - a `nextval` of a sequence that is not the column's own `SERIAL` one —
 *   an object Rebase does not create, so stating it would fail on a fresh
 *   database — → `database`: the database owns it, and a push leaves it alone.
 */
function defaultOf(col: TableColumn, type: ColumnType): ColumnDefault | undefined {
    if (col.is_identity === "YES") return { kind: "identity" };
    const raw = col.column_default?.trim();
    if (!raw) return undefined;
    if (/^gen_random_uuid\(\)$/i.test(raw) && type.kind === "uuid") return { kind: "random-uuid" };
    if (/^nextval\(/i.test(raw)) return { kind: "database" };
    // `DEFAULT NULL` is no default.
    if (/^NULL(::[\w\s."[\]]+)?$/i.test(raw)) return undefined;
    const literal = literalOf(raw, type);
    if (literal !== undefined) return { kind: "literal", value: literal };
    return { kind: "sql", expression: raw };
}

/** A DEFAULT that is a literal of the column's type, as the value; `undefined` when it is an expression. */
function literalOf(raw: string, type: ColumnType): unknown {
    const quoted = QUOTED_LITERAL.exec(raw);
    const text = quoted ? quoted[1].replace(/''/g, "'") : undefined;
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "enum":
            return text;
        case "smallint":
        case "integer":
        case "bigint":
        case "real":
        case "doublePrecision":
        case "numeric": {
            const value = text ?? raw.replace(/^\((.*)\)$/, "$1").replace(/::[\w\s]+$/, "");
            return /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : undefined;
        }
        case "boolean":
            if (/^true$/i.test(raw)) return true;
            if (/^false$/i.test(raw)) return false;
            return undefined;
        case "json":
        case "jsonb": {
            if (text === undefined) return undefined;
            try {
                const parsed: unknown = JSON.parse(text);
                return parsed !== null && typeof parsed === "object" ? parsed : undefined;
            } catch {
                return undefined;
            }
        }
        case "date":
        case "time":
        case "timestamptz":
            return text !== undefined && /^\d/.test(text) ? text : undefined;
        default:
            return undefined;
    }
}

/** `ON DELETE`, when it is not the default a relation gets (`RESTRICT` for a required link, `SET NULL` otherwise). */
function onDeleteOf(fk: ForeignKeyRow, required: boolean): OnAction | undefined {
    const rule = fk.delete_rule?.toLowerCase();
    if (!rule) return undefined;
    if (rule === (required ? "restrict" : "set null")) return undefined;
    switch (rule) {
        case "cascade":
        case "restrict":
        case "no action":
        case "set null":
        case "set default":
            return rule;
        default:
            return undefined;
    }
}

function describeTable(row: TableRow, shape: TableShape, shapes: ReadonlyMap<string, TableShape>, context: TableContext): TableDescriptor {
    const { meta } = shape;
    const name = meta.name;
    const relations: RelationDescriptor[] = [];
    for (const link of shape.links) {
        const col = meta.columns.find(column => column.column_name === link.fk.column_name);
        const required = col ? isNotNull(col) : false;
        const onDelete = onDeleteOf(link.fk, required);
        relations.push({
            name: link.name,
            kind: "belongsTo",
            target: link.fk.foreign_table_name,
            cardinality: "one",
            localKey: link.fk.column_name,
            localField: shape.keyByColumn.get(link.fk.column_name) ?? toWireKey(link.fk.column_name),
            ...(onDelete !== undefined ? { onDelete } : {}),
            index: foreignKeyIndexed(name, link.fk.column_name, meta, context),
            constraint: true
        });
    }
    if (context.generate) {
        relations.push(...inverseRelations(name, shape, shapes, context));
    }

    let description: string | undefined;
    for (const comment of context.metadata.comments) {
        if (comment.table_name === name && comment.column_name === null) description = comment.comment;
    }
    const descriptor: TableDescriptor = {
        name,
        slug: name,
        table: name,
        schema: context.schema,
        kind: "table",
        ...(description !== undefined ? { description } : {}),
        columns: shape.columns,
        primaryKey: meta.pks.map(pk => shape.keyByColumn.get(pk) ?? toWireKey(pk)),
        relations,
        rls: rlsOf(row, name, context)
    };
    if (shape.search) descriptor.search = shape.search;
    return descriptor;
}

/**
 * Whether the database indexes a foreign-key column the way Rebase would —
 * so that a `belongsTo` saying `index: true` (the default) plans no new
 * index. `true` when the indexes were not read: nothing is claimed then.
 */
function foreignKeyIndexed(table: string, column: string, meta: TableMeta, context: TableContext): boolean {
    const indexes = context.metadata.indexes?.filter(index => index.table_name === table);
    if (indexes === undefined || meta.pks[0] === column) return true;
    const derived = foreignKeyIndexSpec(context.schema, table, column).indexName;
    if (indexes.some(index => index.index_name === derived)) return true;
    const servedBy = indexes.find(index => index.leading_column === column && index.serves_leading_column);
    context.note(table, servedBy
        ? `${servedBy.index_name} already indexes "${column}", so its relation says \`index: false\`: without it \`rebase db push\` would build a second index.`
        : `the database has no index on "${column}", so its relation says \`index: false\`; drop that to have one built.`, "remark");
    return false;
}

/** The generator's reverse links: a `hasMany` for each foreign key into the table, a `manyToMany` through each junction. */
function inverseRelations(table: string, shape: TableShape, shapes: ReadonlyMap<string, TableShape>, context: TableContext): RelationDescriptor[] {
    const out: RelationDescriptor[] = [];
    const nameFor = (preferred: string, fallback: string): string => {
        const name = firstFreeKey([preferred, fallback], shape.taken);
        shape.taken.add(name);
        return name;
    };
    for (const [source, other] of shapes) {
        for (const link of other.links) {
            if (link.fk.foreign_table_name !== table) continue;
            out.push({
                name: nameFor(source, `${source}_by_${link.fk.column_name}`),
                kind: "hasMany",
                target: source,
                cardinality: "many",
                foreignKey: link.fk.column_name
            });
        }
    }
    for (const junction of context.joinTables) {
        const jt = context.tablesMap.get(junction);
        if (!jt || jt.fks.length < 2) continue;
        const keyPosition = (fk: ForeignKeyRow): number => {
            const position = jt.pks.indexOf(fk.column_name);
            return position === -1 ? Number.MAX_SAFE_INTEGER : position;
        };
        const linkColumns = new Set(jt.fks.map(fk => fk.column_name));
        const pivot = (): ColumnDescriptor[] => jt.columns
            .filter(col => !linkColumns.has(col.column_name))
            .map(col => {
                const column = describeColumn(col, toWireKey(col.column_name), { ...jt, pks: [] }, context, { unique: false, derived: false });
                delete column.primaryKey;
                return column;
            });
        const selfLinks = jt.fks.filter(fk => fk.foreign_table_name === table).sort((a, b) => keyPosition(a) - keyPosition(b));
        if (selfLinks.length === 2) {
            const [own, otherEnd] = selfLinks;
            const preferred = `${table}_via_${otherEnd.column_name.replace(/_id$/, "")}`;
            out.push({
                name: nameFor(preferred, `${preferred}_${junction}`),
                kind: "manyToMany",
                target: table,
                cardinality: "many",
                through: { table: junction, sourceKey: own.column_name, targetKey: otherEnd.column_name, pivot: pivot() }
            });
            continue;
        }
        const own = jt.fks.find(fk => fk.foreign_table_name === table);
        const otherEnd = jt.fks.find(fk => fk.foreign_table_name !== table);
        if (!own || !otherEnd || !context.servedNames.has(otherEnd.foreign_table_name)) continue;
        // Which ends declare the link decides how the planner keys the junction:
        // from the one declaring side, or — when both declare it — from the side
        // whose table sorts first. Declared here only when that keys it the way
        // the database already has it.
        const leading = jt.fks.find(fk => fk.column_name === jt.pks[0])?.foreign_table_name;
        const sortsFirst = [table, otherEnd.foreign_table_name].sort()[0];
        if (leading && leading !== sortsFirst && leading !== table) {
            context.note(table, `the many-to-many with ${otherEnd.foreign_table_name} through ${junction} is declared on ${otherEnd.foreign_table_name} only: declaring it here too would re-key ${junction} from (${jt.pks.join(", ")}).`, "remark");
            continue;
        }
        out.push({
            name: nameFor(otherEnd.foreign_table_name, `${otherEnd.foreign_table_name}_via_${junction}`),
            kind: "manyToMany",
            target: otherEnd.foreign_table_name,
            cardinality: "many",
            through: { table: junction, sourceKey: own.column_name, targetKey: otherEnd.column_name, pivot: pivot() }
        });
    }
    return out;
}

/** The admin baseline's policy names (`<table>_default_admin_*`). */
const adminBaselineNames = (table: string): Set<string> =>
    getGeneratedPolicyNames({ name: table, slug: table, table, properties: {} });

/** A `pg_policies` row as the rule `db push` compiles back into it. */
function ruleOf(policy: PolicyRow): SecurityRule {
    const cmd = policy.cmd.toUpperCase();
    return policyToSecurityRule({
        policyname: policy.policy_name,
        cmd: cmd === "SELECT" || cmd === "INSERT" || cmd === "UPDATE" || cmd === "DELETE" || cmd === "ALL" ? cmd : undefined,
        permissive: policy.permissive.toUpperCase() === "RESTRICTIVE" ? "RESTRICTIVE" : "PERMISSIVE",
        roles: policy.roles,
        qual: policy.qual,
        with_check: policy.with_check
    });
}

/**
 * A table's row-level security, from the catalogue.
 *
 * `"serve"`: every policy as a rule, `defaultPolicies: false` (Rebase injected
 * nothing). RLS on with no policy is `rules: []` — closed. RLS off (only with
 * `unprotectedTables: "serve"`) is one rule granting everyone everything,
 * which is what such a table does.
 *
 * `"generate"`: the admin baseline is folded — a table holding every baseline
 * policy keeps `defaultPolicies` and lists only its own; holding nothing else,
 * it is `"admin-only"`. RLS on with no policy at all is one closed rule (a
 * push then creates a policy that grants nothing, which is what the table
 * does today). RLS off keeps the baseline and its own policies (`"admin-only"`
 * when it has none): the push switches it on.
 */
function rlsOf(row: TableRow, table: string, context: TableContext): RlsDescriptor {
    const policies = context.metadata.policies?.filter(policy => policy.table_name === table);
    if (!context.generate) {
        if (row.rls_enabled !== true) {
            return { posture: "rules", rules: [{ name: `${table}_rls_disabled`, operations: ["all"], access: "public" }], defaultPolicies: false };
        }
        return { posture: "rules", rules: (policies ?? []).map(ruleOf), defaultPolicies: false };
    }
    if (policies === undefined) return { posture: "admin-only", rules: [], defaultPolicies: true };
    const baseline = adminBaselineNames(table);
    if (row.rls_enabled === false) {
        // The push switches RLS on whatever the file says; the table keeps the
        // baseline (nothing narrowed anyone before) and its own policies.
        const own = policies.filter(policy => !baseline.has(policy.policy_name)).map(ruleOf);
        return own.length > 0 ? { posture: "rules", rules: own, defaultPolicies: true } : { posture: "admin-only", rules: [], defaultPolicies: true };
    }
    const present = new Set(policies.map(policy => policy.policy_name));
    if (row.rls_enabled !== true && present.size === 0) return { posture: "admin-only", rules: [], defaultPolicies: true };
    const keepsBaseline = [...baseline].every(name => present.has(name));
    const own = policies.filter(policy => !(keepsBaseline && baseline.has(policy.policy_name))).map(ruleOf);
    if (keepsBaseline) return own.length > 0 ? { posture: "rules", rules: own, defaultPolicies: true } : { posture: "admin-only", rules: [], defaultPolicies: true };
    if (own.length > 0) return { posture: "rules", rules: own, defaultPolicies: false };
    return { posture: "rules", rules: [{ name: `${table}_closed`, operation: "all", using: "false" }], defaultPolicies: false };
}
