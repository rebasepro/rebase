/**
 * Builders for `SchemaMetadata`, and loaders for the captured real-database
 * fixtures.
 *
 * The builders exist for the edge cases no real schema happens to contain (a
 * junction that is also referenced, two equally plausible parents). Anything a
 * real schema *does* contain is asserted against the real thing —
 * `loadRealSchema` — because a hand-built fixture only ever proves the code
 * agrees with its author's idea of what Postgres returns.
 */
import fs from "node:fs";
import path from "node:path";

import {
    buildTablesMap,
    type CheckConstraintRow,
    type CommentRow,
    type EnumValue,
    type ForeignKeyRow,
    type PrimaryKeyRow,
    type SchemaMetadata,
    type TableColumn,
    type TableMeta,
    type TableRow,
    type UniqueConstraintRow
} from "../../src/schema/introspect-db-logic";

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "real-schemas");

/** Every real database captured under `test/fixtures/real-schemas`. */
export type RealSchemaName =
    | "pagila"
    | "chinook"
    | "northwind"
    | "openstreetmap"
    | "musicbrainz"
    | "constraint-shapes";

/** The captures that are whole databases, not a subset or a purpose-built schema. */
export const WHOLE_REAL_SCHEMAS: RealSchemaName[] = ["pagila", "chinook", "northwind", "openstreetmap"];

export interface LoadedSchema {
    metadata: SchemaMetadata;
    tables: Map<string, TableMeta>;
}

/**
 * Loads a fixture captured from a live PostgreSQL server by
 * `tooling/scripts/capture-introspection-fixture.ts`.
 */
export function loadRealSchema(name: RealSchemaName): LoadedSchema {
    const raw = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf-8");
    const metadata = JSON.parse(raw) as SchemaMetadata;
    return {
        metadata,
        tables: buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks)
    };
}

// ── Builders ──────────────────────────────────────────────────────────

export function column(table: string, name: string, overrides: Partial<TableColumn> = {}): TableColumn {
    return {
        table_name: table,
        column_name: name,
        data_type: "text",
        udt_name: "text",
        is_nullable: "YES",
        column_default: null,
        atttypmod: -1,
        is_generated: "NEVER",
        is_identity: "NO",
        character_maximum_length: null,
        ...overrides
    };
}

/** A serial primary key, the shape `id integer GENERATED …` / `serial` produces. */
export function serialPk(table: string, name = "id"): TableColumn {
    return column(table, name, {
        data_type: "integer",
        udt_name: "int4",
        is_nullable: "NO",
        column_default: `nextval('${table}_${name}_seq'::regclass)`
    });
}

/** A `timestamptz NOT NULL DEFAULT now()` — a database-maintained stamp. */
export function autoStamp(table: string, name: string): TableColumn {
    return column(table, name, {
        data_type: "timestamp with time zone",
        udt_name: "timestamptz",
        is_nullable: "NO",
        column_default: "now()"
    });
}

export function foreignKey(
    table: string,
    columnName: string,
    foreignTable: string,
    overrides: Partial<ForeignKeyRow> = {}
): ForeignKeyRow {
    return {
        table_name: table,
        column_name: columnName,
        foreign_table_name: foreignTable,
        foreign_column_name: "id",
        constraint_name: `${table}_${columnName}_fkey`,
        ordinal: 1,
        delete_rule: "NO ACTION",
        ...overrides
    };
}

export function unique(table: string, ...columns: string[]): UniqueConstraintRow {
    return {
        table_name: table,
        constraint_name: `${table}_${columns.join("_")}_key`,
        column_names: columns
    };
}

export function check(table: string, definition: string, name = `${table}_check`): CheckConstraintRow {
    return { table_name: table, constraint_name: name, definition };
}

export function comment(table: string, columnName: string | null, text: string): CommentRow {
    return { table_name: table, column_name: columnName, comment: text };
}

export interface TableSpec {
    name: string;
    columns: TableColumn[];
    pks?: string[];
}

export interface SchemaSpec {
    tables: TableSpec[];
    fks?: ForeignKeyRow[];
    uniques?: UniqueConstraintRow[];
    checks?: CheckConstraintRow[];
    comments?: CommentRow[];
    enumValues?: EnumValue[];
    rowCounts?: Record<string, number>;
}

/** Assembles a `SchemaMetadata` plus the table map every entry point wants. */
export function buildSchema(spec: SchemaSpec): LoadedSchema {
    const tables: TableRow[] = spec.tables.map((t) => ({ table_name: t.name, is_partitioned: false }));
    const columns: TableColumn[] = spec.tables.flatMap((t) =>
        t.columns.map((c, index) => ({ ...c, ordinal_position: index + 1 }))
    );
    const pks: PrimaryKeyRow[] = spec.tables.flatMap((t) =>
        (t.pks ?? ["id"]).map((columnName) => ({ table_name: t.name, column_name: columnName }))
    );

    const metadata: SchemaMetadata = {
        schema: "public",
        tables,
        columns,
        enumValues: spec.enumValues ?? [],
        pks,
        fks: spec.fks ?? [],
        uniques: spec.uniques ?? [],
        checks: spec.checks ?? [],
        comments: spec.comments ?? [],
        rowCounts: spec.rowCounts ?? {}
    };

    return { metadata, tables: buildTablesMap(tables, columns, pks, metadata.fks) };
}
