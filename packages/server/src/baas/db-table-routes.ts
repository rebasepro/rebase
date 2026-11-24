import type { Hono } from "hono";
import type { SQLAdmin } from "@rebasepro/types";
import { ApiError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import {
    assertIdent,
    assertOnAction,
    assertSafePolicyExpression,
    assertSchema,
    ddlRefusal,
    isRecord,
    quoteIdent
} from "./db-sql-guards";
import { readCatalogColumns, readCatalogRelation, readTableDetails, relationRef, type CatalogColumn } from "./db-table-catalog";
import {
    buildCountQuery,
    buildDelete,
    buildInsert,
    buildRowsQuery,
    buildUpdate,
    csvField,
    EXACT_COUNT_LIMIT,
    MAX_PAGE_SIZE,
    parseRowFilters,
    parseRowValues,
    primaryKeyColumns
} from "./db-table-rows";

export type RunStatements = (
    statements: string[],
    dryRun: boolean,
    reason: string,
    options?: { skipReload?: boolean }
) => Promise<{ dryRun: boolean; statements: string[] }>;

export interface TableRoutesDeps {
    admin: SQLAdmin;
    runStatements: RunStatements;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }, label: string): Promise<Record<string, unknown>> {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isRecord(body)) throw ApiError.badRequest(`Expected a JSON ${label}.`, "INVALID_INPUT");
    return body;
}

async function readOptionalBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
    const body: unknown = await c.req.json().catch(() => ({}));
    return isRecord(body) ? body : {};
}

function identList(raw: unknown, label: string): string[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw ApiError.badRequest(`\`${label}\` must be a non-empty list of column names.`, "INVALID_INPUT");
    }
    return raw.map((value, index) => assertIdent(value, `${label}[${index}]`));
}

/**
 * The per-table routes of `/api/admin/db`: a table's catalog details and
 * definition, constraints, triggers, maintenance, and the row browser.
 * Mounted on the same router, so they share its scope gate (`database:read`
 * for GET, `database:write` otherwise).
 */
export function mountTableRoutes(router: Hono<HonoEnv>, { admin, runStatements }: TableRoutesDeps): void {

    const requireColumns = async (schema: string, table: string): Promise<CatalogColumn[]> => {
        const relation = await readCatalogRelation(admin, schema, table);
        if (!relation) throw ApiError.notFound(`Relation ${schema}.${table} does not exist.`);
        return readCatalogColumns(admin, schema, table);
    };

    const runRowQuery = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
        try {
            return await admin.executeSql(sql, { params });
        } catch (error) {
            throw ddlRefusal(error);
        }
    };

    // ── Catalog details + definition ──
    router.get("/tables/:table/details", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const schema = assertSchema(c.req.query("schema"));
        const details = await readTableDetails(admin, schema, table);
        if (!details) throw ApiError.notFound(`Relation ${schema}.${table} does not exist.`);
        return c.json(details);
    });

    // ── Constraints: foreign key, unique, check ──
    router.post("/tables/:table/constraints", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body = await readBody(c, "constraint specification");
        const schema = assertSchema(body.schema);
        const dryRun = body.dryRun === true;
        const target = relationRef(schema, table);
        const kind = typeof body.kind === "string" ? body.kind : "";

        let clause: string;
        let defaultName: string;
        if (kind === "foreign_key") {
            const columns = identList(body.columns, "columns");
            if (!isRecord(body.references)) {
                throw ApiError.badRequest("A foreign key needs `references: { table, columns }`.", "INVALID_INPUT");
            }
            const refSchema = body.references.schema ? assertSchema(body.references.schema) : schema;
            const refTable = assertIdent(body.references.table, "references.table");
            const refColumns = identList(body.references.columns, "references.columns");
            if (refColumns.length !== columns.length) {
                throw ApiError.badRequest("`columns` and `references.columns` must have the same length.", "INVALID_INPUT");
            }
            const onDelete = assertOnAction(body.references.onDelete, "onDelete");
            const onUpdate = assertOnAction(body.references.onUpdate, "onUpdate");
            clause = `FOREIGN KEY (${columns.map(quoteIdent).join(", ")}) REFERENCES ${relationRef(refSchema, refTable)} (${refColumns.map(quoteIdent).join(", ")})`
                + (onDelete ? ` ON DELETE ${onDelete}` : "")
                + (onUpdate ? ` ON UPDATE ${onUpdate}` : "");
            defaultName = `${table}_${columns.join("_")}_fkey`;
        } else if (kind === "unique") {
            const columns = identList(body.columns, "columns");
            clause = `UNIQUE (${columns.map(quoteIdent).join(", ")})`;
            defaultName = `${table}_${columns.join("_")}_key`;
        } else if (kind === "check") {
            const expression = assertSafePolicyExpression(body.expression, "check");
            if (!expression) throw ApiError.badRequest("A check constraint needs an `expression`.", "INVALID_INPUT");
            clause = `CHECK (${expression})`;
            defaultName = `${table}_check`;
        } else {
            throw ApiError.badRequest("`kind` must be foreign_key, unique or check.", "INVALID_INPUT");
        }
        const name = body.name ? assertIdent(body.name, "Constraint name") : assertIdent(defaultName.slice(0, 63), "Constraint name");
        const statements = [`ALTER TABLE ${target} ADD CONSTRAINT ${quoteIdent(name)} ${clause};`];
        const result = await runStatements(statements, dryRun, `add_constraint:${schema}.${table}.${name}`);
        return c.json({ table: `${schema}.${table}`, constraint: name, ...result }, dryRun ? 200 : 201);
    });

    router.delete("/tables/:table/constraints/:constraint", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const constraint = assertIdent(c.req.param("constraint"), "Constraint name");
        const body = await readOptionalBody(c);
        const schema = assertSchema(body.schema ?? c.req.query("schema"));
        const dryRun = body.dryRun === true;
        const statements = [
            `ALTER TABLE ${relationRef(schema, table)} DROP CONSTRAINT ${quoteIdent(constraint)}${body.cascade === true ? " CASCADE" : ""};`
        ];
        const result = await runStatements(statements, dryRun, `drop_constraint:${schema}.${table}.${constraint}`);
        return c.json({ table: `${schema}.${table}`, constraint, ...result });
    });

    // ── Triggers: enable / disable / drop ──
    router.patch("/tables/:table/triggers/:trigger", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const trigger = assertIdent(c.req.param("trigger"), "Trigger name");
        const body = await readBody(c, "trigger patch");
        const schema = assertSchema(body.schema);
        if (typeof body.enabled !== "boolean") {
            throw ApiError.badRequest("`enabled` must be true or false.", "INVALID_INPUT");
        }
        const statements = [
            `ALTER TABLE ${relationRef(schema, table)} ${body.enabled ? "ENABLE" : "DISABLE"} TRIGGER ${quoteIdent(trigger)};`
        ];
        const result = await runStatements(statements, body.dryRun === true, `alter_trigger:${schema}.${table}.${trigger}`, { skipReload: true });
        return c.json({ table: `${schema}.${table}`, trigger, ...result });
    });

    router.delete("/tables/:table/triggers/:trigger", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const trigger = assertIdent(c.req.param("trigger"), "Trigger name");
        const body = await readOptionalBody(c);
        const schema = assertSchema(body.schema ?? c.req.query("schema"));
        const statements = [`DROP TRIGGER ${quoteIdent(trigger)} ON ${relationRef(schema, table)};`];
        const result = await runStatements(statements, body.dryRun === true, `drop_trigger:${schema}.${table}.${trigger}`, { skipReload: true });
        return c.json({ table: `${schema}.${table}`, trigger, ...result });
    });

    // ── Maintenance: ANALYZE / VACUUM (cannot run inside a transaction block) ──
    router.post("/tables/:table/maintenance", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body = await readBody(c, "maintenance request");
        const schema = assertSchema(body.schema);
        const action = body.action === "vacuum" ? "VACUUM (ANALYZE)" : body.action === "analyze" ? "ANALYZE" : null;
        if (!action) throw ApiError.badRequest("`action` must be analyze or vacuum.", "INVALID_INPUT");
        const statement = `${action} ${relationRef(schema, table)};`;
        if (body.dryRun === true) return c.json({ dryRun: true, statements: [statement] });
        try {
            await admin.executeSql(statement);
        } catch (error) {
            throw ddlRefusal(error);
        }
        return c.json({ dryRun: false, statements: [statement] });
    });

    router.post("/tables/:table/refresh", async (c) => {
        const table = assertIdent(c.req.param("table"), "Materialized view name");
        const body = await readOptionalBody(c);
        const schema = assertSchema(body.schema);
        const relation = await readCatalogRelation(admin, schema, table);
        if (relation?.kind !== "materialized_view") {
            throw ApiError.badRequest(`${schema}.${table} is not a materialized view.`, "INVALID_INPUT");
        }
        const statement = `REFRESH MATERIALIZED VIEW${body.concurrently === true ? " CONCURRENTLY" : ""} ${relationRef(schema, table)};`;
        if (body.dryRun === true) return c.json({ dryRun: true, statements: [statement] });
        try {
            await admin.executeSql(statement);
        } catch (error) {
            throw ddlRefusal(error);
        }
        return c.json({ dryRun: false, statements: [statement] });
    });

    // ── Rows, read as the database owner: unserved tables and views included ──
    router.get("/tables/:table/rows", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const schema = assertSchema(c.req.query("schema"));
        const relation = await readCatalogRelation(admin, schema, table);
        if (!relation) throw ApiError.notFound(`Relation ${schema}.${table} does not exist.`);
        const columns = await readCatalogColumns(admin, schema, table);
        const filters = parseRowFilters(c.req.query("filters"), columns);
        const orderBy = c.req.query("orderBy") || undefined;
        const direction = c.req.query("direction") === "desc" ? "desc" : "asc";

        if (c.req.query("format") === "csv") {
            const header = `${columns.map(column => csvField(column.name)).join(",")}\r\n`;
            const encoder = new TextEncoder();
            let offset = 0;
            let finished = false;
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode(header));
                },
                async pull(controller) {
                    if (finished) return;
                    try {
                        const page = buildRowsQuery({ schema, table, columns, filters, orderBy, direction, limit: MAX_PAGE_SIZE, offset });
                        const rows = await admin.executeSql(page.sql, { params: page.params });
                        offset += rows.length;
                        if (rows.length > 0) {
                            controller.enqueue(encoder.encode(
                                rows.map(row => columns.map(column => csvField(row[column.name])).join(",")).join("\r\n") + "\r\n"
                            ));
                        }
                        if (rows.length < MAX_PAGE_SIZE) {
                            finished = true;
                            controller.close();
                        }
                    } catch (error) {
                        finished = true;
                        controller.error(error);
                    }
                }
            });
            return new Response(stream, {
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="${schema}.${table}.csv"`
                }
            });
        }

        const limit = Number(c.req.query("limit") ?? 100);
        const offset = Number(c.req.query("offset") ?? 0);
        const page = buildRowsQuery({
            schema,
            table,
            columns,
            filters,
            orderBy,
            direction,
            limit: Number.isFinite(limit) ? limit : 100,
            offset: Number.isFinite(offset) ? offset : 0
        });
        const counted = buildCountQuery({ schema, table, columns, filters });
        const [rows, countRows] = await Promise.all([
            runRowQuery(page.sql, page.params),
            runRowQuery(counted.sql, counted.params)
        ]);
        const matched = Number(countRows[0]?.total ?? 0);
        let count = { value: matched, exact: true };
        if (matched > EXACT_COUNT_LIMIT) {
            count = { value: matched, exact: false };
            if (filters.length === 0) {
                const [estimate] = await admin.executeSql(
                    `SELECT GREATEST(c.reltuples, 0)::bigint AS estimate FROM pg_class c WHERE c.oid = $1::regclass`,
                    { params: [relationRef(schema, table)] }
                ).catch(() => []);
                const estimated = Number(estimate?.estimate ?? 0);
                if (estimated > matched) count = { value: estimated, exact: false };
            }
        }

        const primaryKey = primaryKeyColumns(columns).map(column => column.name);
        const isView = relation.kind === "view" || relation.kind === "materialized_view";
        const readOnlyReason = isView ? "view" : primaryKey.length === 0 ? "no_primary_key" : null;
        return c.json({
            columns,
            rows,
            count,
            primaryKey,
            readOnly: readOnlyReason !== null,
            readOnlyReason
        });
    });

    router.post("/tables/:table/rows", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body = await readBody(c, "row insert");
        const schema = assertSchema(body.schema);
        const columns = await requireColumns(schema, table);
        if (!Array.isArray(body.rows)) throw ApiError.badRequest("`rows` must be a list of rows.", "INVALID_INPUT");
        const rows = body.rows.map((row, index) => parseRowValues(row, `rows[${index}]`));
        const insert = buildInsert(schema, table, columns, rows);
        const inserted = await runRowQuery(insert.sql, insert.params);
        return c.json({ rows: inserted }, 201);
    });

    router.patch("/tables/:table/rows", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body = await readBody(c, "row update");
        const schema = assertSchema(body.schema);
        const columns = await requireColumns(schema, table);
        const update = buildUpdate(
            schema,
            table,
            columns,
            parseRowValues(body.key, "key"),
            parseRowValues(body.values, "values")
        );
        const updated = await runRowQuery(update.sql, update.params);
        if (updated.length === 0) throw ApiError.notFound("No row matches that key; it may have been deleted.");
        return c.json({ row: updated[0] });
    });

    router.delete("/tables/:table/rows", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body = await readBody(c, "row delete");
        const schema = assertSchema(body.schema);
        const columns = await requireColumns(schema, table);
        if (!Array.isArray(body.keys)) throw ApiError.badRequest("`keys` must be a list of row keys.", "INVALID_INPUT");
        const keys = body.keys.map((key, index) => parseRowValues(key, `keys[${index}]`));
        const removal = buildDelete(schema, table, columns, keys);
        const deleted = await runRowQuery(removal.sql, removal.params);
        return c.json({ deleted: deleted.length });
    });
}
