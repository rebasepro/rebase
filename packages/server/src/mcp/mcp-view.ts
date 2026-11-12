/**
 * What an MCP App view needs to run the admin panel's own components on a
 * project's tables: the tables' descriptors, redacted for the one caller the
 * view is drawn for, what that caller's connection was granted on each, and
 * what to put on screen — a table's rows, a row's form, or an app the model
 * wrote.
 *
 * The view (`@rebasepro/cms/mcp-view`) mounts the project's own admin app —
 * or a bare one — with a data driver that calls this endpoint's tools, and
 * renders it from these descriptors exactly as the admin panel renders the
 * tables `GET /api/schema/tables` serves: projected by the CMS, with the
 * project's `customizeTable` customizations where the view was built from the
 * project's frontend. The backend holds no presentation; the descriptors are
 * {@link serializeTables}' output for the caller's view, so a column the caller
 * may not read, a private column, a relation into a table the caller is not
 * served and raw policy SQL (without `schema:read`) are not in them — one
 * definition of "what this caller may see" across REST, the wire endpoint and
 * MCP.
 *
 * The grants say what the connection's scopes allow on each table
 * (`data:write`, `data:delete`); the view closes what was not granted. None of
 * that is a permission: every save goes through the write tools, which check
 * the field rules, the scopes and RLS again. It keeps the view from offering
 * what would be refused.
 *
 * @module
 */
import type { TableDescriptor } from "@rebasepro/types";
import { serializeTables, type SchemaView } from "../api/schema-tables.js";

/** The ways a table block lays out its rows, as the admin panel names them. */
export const VIEW_MODES = ["table", "list", "cards", "kanban"] as const;
export type McpViewMode = (typeof VIEW_MODES)[number];

/**
 * The version of {@link McpViewPayload}. A view refuses a payload of another
 * version rather than misdraw it; bump it whenever the shape changes, in step
 * with `PAYLOAD_VERSION` in `@rebasepro/cms/mcp-view` (the view's address
 * carries its document's hash, so a host fetches the new view with the new
 * listing).
 *
 * 2: descriptors (`tables`) and per-table `grants` in place of serialized
 * collections; blocks and seeds name a `table`.
 */
export const MCP_VIEW_PAYLOAD_VERSION = 2;

/** A table block: rows of one table, opened in the admin panel's collection view (show_table). */
export interface McpTableBlock {
    key: string;
    type: "table";
    /** The table's slug, as the tools take it. */
    table: string;
    view?: McpViewMode;
    where?: Record<string, unknown>;
    orderBy?: unknown;
    searchString?: string;
    limit?: number;
}

/** A record block: one row's form, or a new row's (show_record). */
export interface McpRecordBlock {
    key: string;
    type: "record";
    table: string;
    /** The row to open. Absent, the form creates a new one. */
    id?: string;
    /** A new row's starting values. */
    values?: Record<string, unknown>;
}

/** An app block: code the model wrote, compiled, and the tables it reads (show_app). */
export interface McpAppBlock {
    key: string;
    type: "app";
    /** CommonJS, with the source's line numbers; `require` is the view's. */
    code: string;
    tables: string[];
}

export type McpViewBlock = McpTableBlock | McpRecordBlock | McpAppBlock;

/** What the caller's connection may do to one table. */
export interface McpViewGrant {
    read: boolean;
    write: boolean;
    delete: boolean;
}

/** What a show_* tool hands its view, besides what the model reads. */
export interface McpViewPayload {
    /** {@link MCP_VIEW_PAYLOAD_VERSION}. */
    version: typeof MCP_VIEW_PAYLOAD_VERSION;
    title?: string;
    /** One block: the table, the record or the app the tool opens. */
    blocks: McpViewBlock[];
    /**
     * The descriptors the block needs — its tables and, one hop out, their
     * relations' targets — as the caller is served them.
     */
    tables: TableDescriptor[];
    /** What the connection was granted on each table in {@link tables}, by slug. */
    grants: Record<string, McpViewGrant>;
    /** Who the security rules are evaluated for, as the server knows them. */
    viewer: { uid: string; roles: string[] };
    /**
     * show_app's: the first page of each table the app names, read as the
     * caller before the view opens, so its first render reads none of them
     * through the host. Absent where a read failed.
     */
    seeds?: McpViewSeed[];
    /**
     * When the server began reading the rows the result carries (show_table's
     * page, show_app's seeds), in epoch milliseconds. The view serves them in
     * place of a read only while that is recent, so a host that draws a stored
     * result again later reads afresh.
     */
    readAt?: number;
}

/** A page read ahead for a view: the rows, the read's arguments, and the count where the server took it. */
export interface McpViewSeed {
    table: string;
    args: Record<string, unknown>;
    rows: unknown[];
    total?: number;
}

/**
 * The descriptors a set of blocks needs, for the view: each named table and,
 * one hop out, the targets of its relations — the form's relation fields read
 * and pick rows of those — serialized for the caller's view.
 *
 * `served` is what the caller is served (the serializer's output for `view`):
 * only those tables, and their relations, are followed. `grant` answers what
 * the connection was granted on a table; a target it cannot read is left out,
 * and the serializer drops the relation pointing at it with it, as it drops a
 * target's own relations into tables the view was not given.
 */
export function viewTables(
    named: readonly string[],
    all: readonly TableDescriptor[],
    served: readonly TableDescriptor[],
    view: SchemaView,
    grant: (slug: string) => McpViewGrant
): { tables: TableDescriptor[]; grants: Record<string, McpViewGrant> } {
    const bySlug = new Map(served.map(table => [table.slug, table]));
    const included = new Set<string>();
    for (const slug of named) if (bySlug.has(slug)) included.add(slug);
    for (const slug of named) {
        for (const relation of bySlug.get(slug)?.relations ?? []) {
            if (bySlug.has(relation.target) && grant(relation.target).read) included.add(relation.target);
        }
    }
    const tables = serializeTables(all, { ...view, tables: { kind: "only", slugs: [...included].sort() } });
    return {
        tables,
        grants: Object.fromEntries(tables.map(table => [table.slug, grant(table.slug)]))
    };
}
