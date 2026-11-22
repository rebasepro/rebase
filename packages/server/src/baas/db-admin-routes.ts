import { Hono } from "hono";
import { policy as policyExpr, type SQLAdmin, type TableDescriptor } from "@rebasepro/types";
import { compilePolicyExpression } from "@rebasepro/common";
import { ApiError, errorHandler, extractDbError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { notifySchemaChanged } from "./catalog-ddl";

/**
 * The admin baseline's condition, compiled by the framework's policy compiler
 * as `db push` compiles it. `rebase.roles()` returns the roles as one
 * comma-separated text, so the hand-written `'admin' = ANY(rebase.roles())`
 * this replaced was refused by Postgres ("op ANY/ALL (array) requires array on
 * right side") and every table create failed.
 */
const IS_ADMIN_SQL = compilePolicyExpression(policyExpr.rolesOverlap(["admin"]));

/** SQLSTATEs for "that already exists": a conflict, not a malformed request. */
const ALREADY_EXISTS_CODES = new Set(["42P07", "42710", "42701", "42P06"]);

/**
 * A statement Postgres refused, as the admin who sent it needs to read it.
 *
 * The DDL these routes run is built from what the admin typed — a name, a
 * type, a default, a policy condition — so the database's own sentence is the
 * answer that tells them what to change. Left alone, a driver error is a 500
 * and the client reads "An unexpected error occurred", with the reason only in
 * the server log.
 */
function ddlRefusal(error: unknown): unknown {
    const pg = extractDbError(error);
    if (!pg?.message) return error;
    const message = [
        `PostgreSQL refused the change: ${pg.message}.`,
        pg.detail,
        pg.hint ? `Hint: ${pg.hint}` : undefined
    ].filter(Boolean).join(" ");
    const status = pg.code && ALREADY_EXISTS_CODES.has(pg.code) ? 409 : 400;
    return new ApiError(status, "DDL_REJECTED", message, { dbCode: pg.code }, true);
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const PROTECTED_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast", "rebase", "auth"]);

const ALLOWED_SQL_TYPES_RE = /^(?:text|boolean|bool|smallint|int2|integer|int|int4|bigint|int8|real|float4|double precision|float8|uuid|date|time|timetz|timestamp|timestamptz|timestamp with time zone|timestamp without time zone|json|jsonb|bytea|inet|cidr|macaddr|tsvector|serial|bigserial|smallserial|varchar(?:\(\d{1,5}\))?|character varying(?:\(\d{1,5}\))?|char(?:\(\d{1,5}\))?|numeric(?:\(\d{1,3}(?:,\s*\d{1,3})?\))?|decimal(?:\(\d{1,3}(?:,\s*\d{1,3})?\))?|vector\(\d{1,5}\))(?:\[\])?$/i;

const ON_ACTIONS = new Set(["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"]);
const POLICY_OPS = new Set(["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

function assertIdent(value: unknown, label: string): string {
    if (typeof value !== "string" || !IDENTIFIER_RE.test(value.trim())) {
        throw ApiError.badRequest(
            `${label} "${String(value ?? "")}" must be a valid PostgreSQL identifier (${IDENTIFIER_RE.source}).`,
            "INVALID_INPUT"
        );
    }
    return value.trim();
}

function assertSchema(value: unknown): string {
    const schema = value === undefined || value === "" ? "public" : assertIdent(value, "Schema name");
    if (PROTECTED_SCHEMAS.has(schema.toLowerCase()) || schema.toLowerCase().startsWith("pg_")) {
        throw ApiError.badRequest(`Schema "${schema}" is protected and cannot be modified through /api/admin/db.`, "INVALID_INPUT");
    }
    return schema;
}

function assertSqlType(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw ApiError.badRequest(`${label} must specify a PostgreSQL column type.`, "INVALID_INPUT");
    }
    const trimmed = value.trim();
    if (!ALLOWED_SQL_TYPES_RE.test(trimmed)) {
        throw ApiError.badRequest(
            `Unsupported or unsafe SQL type "${trimmed}" for ${label}. Use a standard PostgreSQL type (e.g. text, integer, uuid, boolean, timestamptz, jsonb, numeric, varchar(255), text[]).`,
            "INVALID_INPUT"
        );
    }
    return trimmed;
}

function assertOnAction(value: unknown, label: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") {
        throw ApiError.badRequest(`${label} must be a string.`, "INVALID_INPUT");
    }
    const upper = value.trim().toUpperCase().replace(/_/g, " ");
    if (!ON_ACTIONS.has(upper)) {
        throw ApiError.badRequest(`Invalid ${label} action "${value}". Use NO ACTION, RESTRICT, CASCADE, SET NULL, or SET DEFAULT.`, "INVALID_INPUT");
    }
    return upper;
}

function assertSafeDefaultExpression(raw: unknown): string | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string") {
        throw ApiError.badRequest("Column `default` must be a SQL expression string.", "INVALID_INPUT");
    }
    const expr = raw.trim();
    // Prevent statement injection in DEFAULT expressions.
    if (expr.includes(";") || expr.includes("--") || expr.includes("/*")) {
        throw ApiError.badRequest("Column `default` expression must not contain statement terminators or comments.", "INVALID_INPUT");
    }
    return expr;
}

function assertSafePolicyExpression(raw: unknown, label: string): string | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string") {
        throw ApiError.badRequest(`Policy ${label} must be a SQL boolean expression string.`, "INVALID_INPUT");
    }
    const expr = raw.trim();
    if (expr.includes(";") || expr.includes("--") || expr.includes("/*")) {
        throw ApiError.badRequest(`Policy ${label} expression must not contain statement terminators or comments.`, "INVALID_INPUT");
    }
    return expr;
}

interface ColumnSpec {
    name: string;
    type: string;
    nullable?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    default?: string;
    references?: {
        schema?: string;
        table: string;
        column: string;
        onDelete?: string;
        onUpdate?: string;
    };
}

function parseColumnSpec(raw: unknown, index: number): ColumnSpec {
    if (!isRecord(raw)) {
        throw ApiError.badRequest(`columns[${index}] must be an object.`, "INVALID_INPUT");
    }
    const name = assertIdent(raw.name, `columns[${index}].name`);
    const type = assertSqlType(raw.type, `column "${name}"`);
    const def = assertSafeDefaultExpression(raw.default);

    let references: ColumnSpec["references"];
    if (raw.references !== undefined && raw.references !== null) {
        if (!isRecord(raw.references)) {
            throw ApiError.badRequest(`columns[${index}].references must be an object.`, "INVALID_INPUT");
        }
        references = {
            schema: raw.references.schema ? assertSchema(raw.references.schema) : undefined,
            table: assertIdent(raw.references.table, `columns[${index}].references.table`),
            column: assertIdent(raw.references.column, `columns[${index}].references.column`),
            onDelete: assertOnAction(raw.references.onDelete, "onDelete"),
            onUpdate: assertOnAction(raw.references.onUpdate, "onUpdate")
        };
    }

    return {
        name,
        type,
        nullable: raw.nullable !== false,
        primaryKey: raw.primaryKey === true,
        unique: raw.unique === true,
        default: def,
        references
    };
}

function renderColumnDdl(col: ColumnSpec, defaultSchema: string, inlinePrimaryKey: boolean): string {
    const parts: string[] = [quoteIdent(col.name), col.type];
    if (inlinePrimaryKey && col.primaryKey) parts.push("PRIMARY KEY");
    if (col.nullable === false || col.primaryKey) parts.push("NOT NULL");
    if (col.unique && !col.primaryKey) parts.push("UNIQUE");
    if (col.default !== undefined) parts.push(`DEFAULT ${col.default}`);
    if (col.references) {
        const refSchema = col.references.schema ?? defaultSchema;
        let ref = `REFERENCES ${quoteIdent(refSchema)}.${quoteIdent(col.references.table)} (${quoteIdent(col.references.column)})`;
        if (col.references.onDelete) ref += ` ON DELETE ${col.references.onDelete}`;
        if (col.references.onUpdate) ref += ` ON UPDATE ${col.references.onUpdate}`;
        parts.push(ref);
    }
    return parts.join(" ");
}

interface PolicySpec {
    name: string;
    operation: string;
    mode: "PERMISSIVE" | "RESTRICTIVE";
    roles: string[];
    using?: string;
    withCheck?: string;
}

function parsePolicySpec(raw: unknown): PolicySpec {
    if (!isRecord(raw)) {
        throw ApiError.badRequest("Policy must be a JSON object.", "INVALID_INPUT");
    }
    const name = assertIdent(raw.name, "Policy name");
    if (typeof raw.operation !== "string" || !raw.operation.trim()) {
        throw ApiError.badRequest(
            "Policy `operation` is required (ALL, SELECT, INSERT, UPDATE, or DELETE) and will not silently default to ALL.",
            "INVALID_INPUT"
        );
    }
    const rawOp = raw.operation.trim().toUpperCase();
    if (!POLICY_OPS.has(rawOp)) {
        throw ApiError.badRequest(`Invalid policy operation "${rawOp}". Use ALL, SELECT, INSERT, UPDATE, or DELETE.`, "INVALID_INPUT");
    }
    const mode = typeof raw.mode === "string" && raw.mode.trim().toUpperCase() === "RESTRICTIVE"
        ? "RESTRICTIVE"
        : "PERMISSIVE";
    const roles = Array.isArray(raw.roles) && raw.roles.length > 0
        ? raw.roles.map((r, i) => {
            const ident = assertIdent(r, `policy.roles[${i}]`);
            return ident.toLowerCase() === "public" ? "PUBLIC" : quoteIdent(ident);
        })
        : ["PUBLIC"];

    const using = assertSafePolicyExpression(raw.using, "using");
    const withCheck = assertSafePolicyExpression(raw.withCheck, "withCheck");
    if (rawOp === "INSERT" && !withCheck) {
        throw ApiError.badRequest("INSERT policies require a `withCheck` expression.", "INVALID_INPUT");
    }
    if ((rawOp === "SELECT" || rawOp === "DELETE") && !using) {
        throw ApiError.badRequest(`${rawOp} policies require a \`using\` expression.`, "INVALID_INPUT");
    }
    if (!using && !withCheck) {
        throw ApiError.badRequest("Policy must specify at least one of `using` or `withCheck`.", "INVALID_INPUT");
    }
    return { name, operation: rawOp, mode, roles, using, withCheck };
}

function renderCreatePolicySql(schema: string, table: string, policy: PolicySpec): string {
    const parts: string[] = [
        `CREATE POLICY ${quoteIdent(policy.name)} ON ${quoteIdent(schema)}.${quoteIdent(table)}`,
        `AS ${policy.mode}`,
        `FOR ${policy.operation}`,
        `TO ${policy.roles.join(", ")}`
    ];
    if (policy.using && policy.operation !== "INSERT") {
        parts.push(`USING (${policy.using})`);
    }
    if (policy.withCheck && policy.operation !== "SELECT" && policy.operation !== "DELETE") {
        parts.push(`WITH CHECK (${policy.withCheck})`);
    }
    return `${parts.join(" ")};`;
}

export interface DbAdminRoutesOptions {
    admin: SQLAdmin;
    /** Currently served descriptors, so GET /tables marks which tables are served. */
    getServedTables: () => readonly TableDescriptor[];
    /** Triggers live schema re-introspection & REST/Realtime/OpenAPI reload. */
    reloadSchema: () => Promise<{ tables: number; revision: number; unprotectedTables: { schema: string; table: string }[] }>;
}

/**
 * Direct PostgreSQL DDL + `rebase.table_meta` + RLS policy admin API (`/api/admin/db`).
 *
 * Designed for zero-code BaaS mode: every mutation previews SQL with
 * `dryRun: true`, runs DDL directly against PostgreSQL, persists optional
 * `rebase.table_meta`, broadcasts `NOTIFY rebase_schema_changed`, and
 * hot-reloads the running server without restarting.
 */
export function createDbAdminRoutes({ admin, getServedTables, reloadSchema }: DbAdminRoutesOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    const runStatements = async (
        statements: string[],
        dryRun: boolean,
        reason: string,
        options?: { skipReload?: boolean }
    ) => {
        if (dryRun) {
            return { dryRun: true, statements };
        }
        try {
            if (admin.executeSqlTransaction) {
                await admin.executeSqlTransaction(statements);
            } else {
                await admin.executeSql("BEGIN");
                try {
                    for (const stmt of statements) {
                        await admin.executeSql(stmt);
                    }
                    await admin.executeSql("COMMIT");
                } catch (err) {
                    await admin.executeSql("ROLLBACK").catch(() => undefined);
                    throw err;
                }
            }
        } catch (err) {
            throw ddlRefusal(err);
        }
        if (options?.skipReload) {
            return { dryRun: false, statements };
        }
        await notifySchemaChanged(admin, reason);
        const reloaded = await reloadSchema();
        return { dryRun: false, statements, reloaded };
    };

    // ── List tables, columns, indexes, RLS status, policies, and table_meta ──
    router.get("/tables", async (c) => {
        const schema = assertSchema(c.req.query("schema"));
        const servedByTable = new Map(
            getServedTables()
                .filter(t => t.schema === schema)
                .map(t => [t.table, t])
        );

        const tablesRows = await admin.executeSql(
            `SELECT c.relname AS table_name,
                    c.relkind AS relkind,
                    c.relrowsecurity AS rls_enabled,
                    c.relforcerowsecurity AS rls_forced,
                    obj_description(c.oid, 'pg_class') AS comment
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1
                AND c.relkind IN ('r', 'p', 'v', 'm')
              ORDER BY c.relname ASC`,
            { params: [schema] }
        );

        const colsRows = await admin.executeSql(
            `SELECT table_name, column_name, data_type, udt_name, is_nullable,
                    column_default, ordinal_position
               FROM information_schema.columns
              WHERE table_schema = $1
              ORDER BY table_name, ordinal_position`,
            { params: [schema] }
        );

        const constraintRows = await admin.executeSql(
            `SELECT tc.relname AS table_name,
                    con.contype AS constraint_type,
                    a.attname AS column_name,
                    array_length(con.conkey, 1) AS key_length
               FROM pg_constraint con
               JOIN pg_class tc ON tc.oid = con.conrelid
               JOIN pg_namespace n ON n.oid = tc.relnamespace
               JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(con.conkey)
              WHERE n.nspname = $1
                AND con.contype IN ('p', 'u')`,
            { params: [schema] }
        );

        const policiesRows = await admin.executeSql(
            `SELECT tablename AS table_name, policyname AS name, permissive,
                    roles, cmd AS operation, qual AS using_expr, with_check AS with_check_expr
               FROM pg_policies
              WHERE schemaname = $1
              ORDER BY tablename, policyname`,
            { params: [schema] }
        );

        const indexesRows = await admin.executeSql(
            `SELECT t.relname AS table_name,
                    i.relname AS name,
                    pg_get_indexdef(ix.indexrelid) AS definition,
                    ix.indisunique AS is_unique,
                    ix.indisprimary AS is_primary
               FROM pg_index ix
               JOIN pg_class t ON t.oid = ix.indrelid
               JOIN pg_class i ON i.oid = ix.indexrelid
               JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = $1
              ORDER BY t.relname, i.relname`,
            { params: [schema] }
        );

        let metaRows: Record<string, unknown>[] = [];
        try {
            metaRows = await admin.executeSql(
                `SELECT * FROM "rebase"."table_meta" WHERE schema_name = $1`,
                { params: [schema] }
            );
        } catch {
            // table_meta not yet provisioned
        }
        const metaByTable = new Map<string, Record<string, unknown>>();
        for (const r of metaRows) {
            if (typeof r.table_name !== "string") continue;
            metaByTable.set(r.table_name, {
                slug: typeof r.slug === "string" ? r.slug : null,
                exposed: r.exposed !== false,
                description: typeof r.description === "string" ? r.description : null,
                softDeleteColumn: typeof r.soft_delete_column === "string" ? r.soft_delete_column : null,
                historyEnabled: r.history_enabled === true,
                tenantColumn: typeof r.tenant_column === "string" ? r.tenant_column : null,
                tenantSource: isRecord(r.tenant_source) ? r.tenant_source : null,
                tenantBypassRoles: Array.isArray(r.tenant_bypass_roles)
                    ? r.tenant_bypass_roles.filter((v): v is string => typeof v === "string")
                    : ["admin"],
                searchConfig: isRecord(r.search_config) ? r.search_config : null,
                columnAccess: isRecord(r.column_access) ? r.column_access : {},
                columnStorage: isRecord(r.column_storage) ? r.column_storage : {},
                privateColumns: Array.isArray(r.private_columns)
                    ? r.private_columns.filter((v): v is string => typeof v === "string")
                    : [],
                readonlyColumns: Array.isArray(r.readonly_columns)
                    ? r.readonly_columns.filter((v): v is string => typeof v === "string")
                    : []
            });
        }

        const pkByTable = new Map<string, Set<string>>();
        const uniqueByTable = new Map<string, Set<string>>();
        for (const row of constraintRows) {
            const tbl = String(row.table_name ?? "");
            const col = String(row.column_name ?? "");
            const type = String(row.constraint_type ?? "");
            const keyLength = Number(row.key_length ?? 0);
            if (type === "p") {
                const set = pkByTable.get(tbl) ?? new Set<string>();
                set.add(col);
                pkByTable.set(tbl, set);
            } else if (type === "u" && keyLength === 1) {
                const set = uniqueByTable.get(tbl) ?? new Set<string>();
                set.add(col);
                uniqueByTable.set(tbl, set);
            }
        }

        const colsByTable = new Map<string, Record<string, unknown>[]>();
        for (const col of colsRows) {
            const tbl = String(col.table_name ?? "");
            const colName = String(col.column_name ?? "");
            const served = servedByTable.get(tbl);
            const wireKey = served?.columns.find(sc => sc.column === colName)?.key ?? colName;
            const list = colsByTable.get(tbl) ?? [];
            list.push({
                name: colName,
                key: wireKey,
                dataType: col.data_type,
                udtName: col.udt_name,
                nullable: col.is_nullable === "YES",
                default: col.column_default ?? null,
                primaryKey: pkByTable.get(tbl)?.has(colName) ?? false,
                unique: uniqueByTable.get(tbl)?.has(colName) ?? false
            });
            colsByTable.set(tbl, list);
        }

        const policiesByTable = new Map<string, Record<string, unknown>[]>();
        for (const p of policiesRows) {
            const tbl = String(p.table_name ?? "");
            const list = policiesByTable.get(tbl) ?? [];
            const rawRoles = Array.isArray(p.roles)
                ? p.roles.filter((r): r is string => typeof r === "string")
                : typeof p.roles === "string"
                    ? p.roles.replace(/^\{|\}$/g, "").split(",").filter(Boolean)
                    : [];
            list.push({
                name: p.name,
                mode: p.permissive === "RESTRICTIVE" ? "restrictive" : "permissive",
                roles: rawRoles,
                operation: p.operation,
                using: p.using_expr ?? null,
                withCheck: p.with_check_expr ?? null
            });
            policiesByTable.set(tbl, list);
        }

        const indexesByTable = new Map<string, Record<string, unknown>[]>();
        for (const idx of indexesRows) {
            const tbl = String(idx.table_name ?? "");
            const list = indexesByTable.get(tbl) ?? [];
            list.push({
                name: idx.name,
                definition: idx.definition,
                unique: idx.is_unique === true,
                primary: idx.is_primary === true
            });
            indexesByTable.set(tbl, list);
        }

        const tables = tablesRows.map(row => {
            const name = String(row.table_name ?? "");
            const served = servedByTable.get(name);
            const meta = metaByTable.get(name) ?? null;
            return {
                schema,
                name,
                slug: served?.slug ?? (meta && typeof meta.slug === "string" ? meta.slug : null),
                served: Boolean(served),
                exposed: meta ? meta.exposed !== false : true,
                kind: row.relkind === "v" || row.relkind === "m" ? "view" : "table",
                rlsEnabled: row.rls_enabled === true,
                rlsForced: row.rls_forced === true,
                comment: row.comment ?? null,
                columns: colsByTable.get(name) ?? [],
                policies: policiesByTable.get(name) ?? [],
                indexes: indexesByTable.get(name) ?? [],
                meta
            };
        });

        return c.json({ schema, tables });
    });

    // ── Create a table (+ optional RLS & initial policies & table_meta) ──
    router.post("/tables", async (c) => {
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON table specification.", "INVALID_INPUT");

        const schema = assertSchema(body.schema);
        const table = assertIdent(body.name, "Table name");
        const dryRun = body.dryRun === true;

        if (!Array.isArray(body.columns) || body.columns.length === 0) {
            throw ApiError.badRequest("`columns` must be a non-empty array of column definitions.", "INVALID_INPUT");
        }
        const columns = body.columns.map(parseColumnSpec);
        const pkCols = columns.filter(col => col.primaryKey);
        if (pkCols.length === 0) {
            throw ApiError.badRequest("Table must have at least one primary key column (`primaryKey: true`).", "INVALID_INPUT");
        }
        const compositePk = pkCols.length > 1;
        const colLines = columns.map(col => `    ${renderColumnDdl(col, schema, !compositePk)}`);
        if (compositePk) {
            colLines.push(`    PRIMARY KEY (${pkCols.map(col => quoteIdent(col.name)).join(", ")})`);
        }

        const statements: string[] = [
            `CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(table)} (\n${colLines.join(",\n")}\n);`
        ];

        // Enable RLS by default so newly created BaaS tables are protected & served immediately.
        const enableRls = body.enableRls !== false;
        if (enableRls) {
            statements.push(`ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ENABLE ROW LEVEL SECURITY;`);
            // Always ensure admin baseline unless caller opted out.
            if (body.defaultAdminPolicy !== false) {
                statements.push(
                    `CREATE POLICY ${quoteIdent(`${table}_admin_all`)} ON ${quoteIdent(schema)}.${quoteIdent(table)} ` +
                    `AS PERMISSIVE FOR ALL TO PUBLIC USING (${IS_ADMIN_SQL}) WITH CHECK (${IS_ADMIN_SQL});`
                );
            }
        }

        if (Array.isArray(body.policies)) {
            for (const rawPolicy of body.policies) {
                statements.push(renderCreatePolicySql(schema, table, parsePolicySpec(rawPolicy)));
            }
        }

        const hasMeta = !dryRun && isRecord(body.meta);
        const result = await runStatements(statements, dryRun, `create_table:${schema}.${table}`, { skipReload: hasMeta });
        if (hasMeta && isRecord(body.meta)) {
            await upsertTableMeta(admin, schema, table, body.meta);
            await notifySchemaChanged(admin, `create_table:${schema}.${table}`);
            const reloaded = await reloadSchema();
            return c.json({ table: `${schema}.${table}`, ...result, reloaded }, 201);
        }
        return c.json({ table: `${schema}.${table}`, ...result }, dryRun ? 200 : 201);
    });

    // ── Update table RLS status, rename, or rebase.table_meta ──
    router.patch("/tables/:table", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON object.", "INVALID_INPUT");

        const schema = assertSchema(body.schema);
        const dryRun = body.dryRun === true;
        const statements: string[] = [];
        let activeTable = table;
        let renamed = false;

        if (typeof body.renameTo === "string" && body.renameTo.trim() !== "" && body.renameTo.trim() !== table) {
            const target = assertIdent(body.renameTo, "renameTo");
            statements.push(`ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} RENAME TO ${quoteIdent(target)};`);
            activeTable = target;
            renamed = true;
        }
        if (typeof body.rlsEnabled === "boolean") {
            statements.push(
                `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(activeTable)} ${body.rlsEnabled ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY;`
            );
        }

        const hasMeta = !dryRun && isRecord(body.meta);
        const result = statements.length > 0
            ? await runStatements(statements, dryRun, `alter_table:${schema}.${activeTable}`, { skipReload: hasMeta || (renamed && !dryRun) })
            : { dryRun, statements: [] };

        if (!dryRun && renamed) {
            await admin.executeSql(
                `UPDATE "rebase"."table_meta" SET table_name = $3, updated_at = NOW() WHERE schema_name = $1 AND table_name = $2`,
                { params: [schema, table, activeTable] }
            ).catch(() => undefined);
        }

        if (hasMeta && isRecord(body.meta)) {
            await upsertTableMeta(admin, schema, activeTable, body.meta);
        }

        if (!dryRun && (hasMeta || renamed)) {
            await notifySchemaChanged(admin, `alter_table:${schema}.${activeTable}`);
            const reloaded = await reloadSchema();
            return c.json({ table: `${schema}.${activeTable}`, ...result, reloaded });
        }

        return c.json({ table: `${schema}.${activeTable}`, ...result });
    });

    // ── Drop table (requires explicit confirmation matching table name) ──
    router.delete("/tables/:table", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body: unknown = await c.req.json().catch(() => ({}));
        const record = isRecord(body) ? body : {};
        const schema = assertSchema(record.schema ?? c.req.query("schema"));
        const dryRun = record.dryRun === true;
        const cascade = record.cascade === true;

        if (!dryRun && record.confirm !== table) {
            throw ApiError.badRequest(
                `Dropping table "${table}" requires passing \`{ "confirm": "${table}" }\` in the request body.`,
                "CONFIRMATION_REQUIRED"
            );
        }

        const statements = [
            `DROP TABLE ${quoteIdent(schema)}.${quoteIdent(table)}${cascade ? " CASCADE" : ""};`
        ];
        const result = await runStatements(statements, dryRun, `drop_table:${schema}.${table}`);
        if (!dryRun) {
            await admin.executeSql(
                `DELETE FROM "rebase"."table_meta" WHERE schema_name = $1 AND table_name = $2`,
                { params: [schema, table] }
            ).catch(() => undefined);
        }
        return c.json({ table: `${schema}.${table}`, ...result });
    });

    // ── Add column ──
    router.post("/tables/:table/columns", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON column specification.", "INVALID_INPUT");

        const schema = assertSchema(body.schema);
        const dryRun = body.dryRun === true;
        const col = parseColumnSpec(body, 0);
        const statements = [
            `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ADD COLUMN ${renderColumnDdl(col, schema, false)};`
        ];
        const result = await runStatements(statements, dryRun, `add_column:${schema}.${table}.${col.name}`);
        return c.json({ table: `${schema}.${table}`, column: col.name, ...result }, dryRun ? 200 : 201);
    });

    // ── Alter column (rename, type, nullable, default) ──
    router.patch("/tables/:table/columns/:column", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const column = assertIdent(c.req.param("column"), "Column name");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON column patch.", "INVALID_INPUT");

        const schema = assertSchema(body.schema);
        const dryRun = body.dryRun === true;
        const statements: string[] = [];
        let activeColumn = column;

        if (typeof body.renameTo === "string" && body.renameTo.trim() !== "" && body.renameTo.trim() !== column) {
            const nextName = assertIdent(body.renameTo, "renameTo");
            statements.push(
                `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} RENAME COLUMN ${quoteIdent(column)} TO ${quoteIdent(nextName)};`
            );
            activeColumn = nextName;
        }
        if (typeof body.type === "string" && body.type.trim() !== "") {
            const nextType = assertSqlType(body.type, `column "${activeColumn}"`);
            const usingExpr = assertSafeDefaultExpression(body.using);
            statements.push(
                `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ALTER COLUMN ${quoteIdent(activeColumn)} TYPE ${nextType}${usingExpr ? ` USING ${usingExpr}` : ""};`
            );
        }
        if (typeof body.nullable === "boolean") {
            statements.push(
                `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ALTER COLUMN ${quoteIdent(activeColumn)} ${body.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`
            );
        }
        if ("default" in body) {
            if (body.default === null || body.default === "") {
                statements.push(
                    `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ALTER COLUMN ${quoteIdent(activeColumn)} DROP DEFAULT;`
                );
            } else {
                const expr = assertSafeDefaultExpression(body.default);
                if (expr) {
                    statements.push(
                        `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ALTER COLUMN ${quoteIdent(activeColumn)} SET DEFAULT ${expr};`
                    );
                }
            }
        }
        if (statements.length === 0) {
            throw ApiError.badRequest("No column changes specified (renameTo, type, nullable, default).", "INVALID_INPUT");
        }

        const result = await runStatements(statements, dryRun, `alter_column:${schema}.${table}.${activeColumn}`);
        return c.json({ table: `${schema}.${table}`, column: activeColumn, ...result });
    });

    // ── Drop column ──
    router.delete("/tables/:table/columns/:column", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const column = assertIdent(c.req.param("column"), "Column name");
        const body: unknown = await c.req.json().catch(() => ({}));
        const record = isRecord(body) ? body : {};
        const schema = assertSchema(record.schema ?? c.req.query("schema"));
        const dryRun = record.dryRun === true;
        const cascade = record.cascade === true;

        if (!dryRun && record.confirm !== column) {
            throw ApiError.badRequest(
                `Dropping column "${column}" requires passing \`{ "confirm": "${column}" }\` in the request body.`,
                "CONFIRMATION_REQUIRED"
            );
        }

        const statements = [
            `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} DROP COLUMN ${quoteIdent(column)}${cascade ? " CASCADE" : ""};`
        ];
        const result = await runStatements(statements, dryRun, `drop_column:${schema}.${table}.${column}`);
        return c.json({ table: `${schema}.${table}`, column, ...result });
    });

    // ── Create / Drop Index ──
    router.post("/tables/:table/indexes", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON index specification.", "INVALID_INPUT");

        const schema = assertSchema(body.schema);
        const dryRun = body.dryRun === true;
        const unique = body.unique === true;
        if (!Array.isArray(body.columns) || body.columns.length === 0) {
            throw ApiError.badRequest("`columns` must be a non-empty list of column names.", "INVALID_INPUT");
        }
        const cols = body.columns.map((col, i) => assertIdent(col, `columns[${i}]`));
        const indexName = body.name
            ? assertIdent(body.name, "Index name")
            : assertIdent(`idx_${table}_${cols.join("_")}`.slice(0, 63), "Index name");
        const method = typeof body.method === "string" && ["btree", "gin", "gist", "hash", "brin"].includes(body.method.toLowerCase())
            ? body.method.toLowerCase()
            : "btree";

        const statements = [
            `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quoteIdent(indexName)} ON ${quoteIdent(schema)}.${quoteIdent(table)} USING ${method} (${cols.map(quoteIdent).join(", ")});`
        ];
        const result = await runStatements(statements, dryRun, `create_index:${schema}.${indexName}`);
        return c.json({ index: indexName, ...result }, dryRun ? 200 : 201);
    });

    router.delete("/tables/:table/indexes/:index", async (c) => {
        const indexName = assertIdent(c.req.param("index"), "Index name");
        const body: unknown = await c.req.json().catch(() => ({}));
        const record = isRecord(body) ? body : {};
        const schema = assertSchema(record.schema ?? c.req.query("schema"));
        const dryRun = record.dryRun === true;
        const statements = [`DROP INDEX ${quoteIdent(schema)}.${quoteIdent(indexName)};`];
        const result = await runStatements(statements, dryRun, `drop_index:${schema}.${indexName}`);
        return c.json({ index: indexName, ...result });
    });

    // ── Create / Replace / Drop RLS Policy directly on Postgres ──
    router.post("/tables/:table/policies", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON policy specification.", "INVALID_INPUT");

        const schema = assertSchema(body.schema);
        const dryRun = body.dryRun === true;
        const replace = body.replace === true;
        const policy = parsePolicySpec(body);

        const statements: string[] = [];
        if (body.enableRls !== false) {
            statements.push(`ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ENABLE ROW LEVEL SECURITY;`);
        }
        if (replace) {
            statements.push(`DROP POLICY IF EXISTS ${quoteIdent(policy.name)} ON ${quoteIdent(schema)}.${quoteIdent(table)};`);
        }
        statements.push(renderCreatePolicySql(schema, table, policy));

        const result = await runStatements(statements, dryRun, `create_policy:${schema}.${table}.${policy.name}`);
        return c.json({ table: `${schema}.${table}`, policy: policy.name, ...result }, dryRun ? 200 : 201);
    });

    router.delete("/tables/:table/policies/:policy", async (c) => {
        const table = assertIdent(c.req.param("table"), "Table name");
        const policyName = assertIdent(c.req.param("policy"), "Policy name");
        const body: unknown = await c.req.json().catch(() => ({}));
        const record = isRecord(body) ? body : {};
        const schema = assertSchema(record.schema ?? c.req.query("schema"));
        const dryRun = record.dryRun === true;
        const statements = [
            `DROP POLICY ${quoteIdent(policyName)} ON ${quoteIdent(schema)}.${quoteIdent(table)};`
        ];
        const result = await runStatements(statements, dryRun, `drop_policy:${schema}.${table}.${policyName}`);
        return c.json({ table: `${schema}.${table}`, policy: policyName, ...result });
    });

    return router;
}

async function upsertTableMeta(
    admin: SQLAdmin,
    schema: string,
    table: string,
    meta: Record<string, unknown>
): Promise<void> {
    const slug = typeof meta.slug === "string" && meta.slug.trim() !== "" ? meta.slug.trim() : null;
    const exposed = meta.exposed !== false;
    const description = typeof meta.description === "string" ? meta.description : null;
    const softDeleteColumn = typeof meta.softDeleteColumn === "string" && meta.softDeleteColumn.trim() !== ""
        ? meta.softDeleteColumn.trim()
        : null;
    const historyEnabled = meta.historyEnabled === true;
    const tenantColumn = typeof meta.tenantColumn === "string" && meta.tenantColumn.trim() !== ""
        ? meta.tenantColumn.trim()
        : null;
    const tenantSource = isRecord(meta.tenantSource) ? JSON.stringify(meta.tenantSource) : null;
    const tenantBypassRoles = Array.isArray(meta.tenantBypassRoles)
        ? meta.tenantBypassRoles.filter((r): r is string => typeof r === "string")
        : ["admin"];
    const searchConfig = isRecord(meta.searchConfig) ? JSON.stringify(meta.searchConfig) : null;
    const columnAccess = isRecord(meta.columnAccess) ? JSON.stringify(meta.columnAccess) : "{}";
    const columnStorage = isRecord(meta.columnStorage) ? JSON.stringify(meta.columnStorage) : "{}";
    const privateColumns = Array.isArray(meta.privateColumns)
        ? meta.privateColumns.filter((col): col is string => typeof col === "string")
        : [];
    const readonlyColumns = Array.isArray(meta.readonlyColumns)
        ? meta.readonlyColumns.filter((col): col is string => typeof col === "string")
        : [];

    await admin.executeSql(
        `INSERT INTO "rebase"."table_meta" (
            schema_name, table_name, slug, exposed, description,
            soft_delete_column, history_enabled, tenant_column, tenant_source,
            tenant_bypass_roles, search_config, column_access, column_storage,
            private_columns, readonly_columns, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9::jsonb,
            $10::text[], $11::jsonb, $12::jsonb, $13::jsonb,
            $14::text[], $15::text[], NOW()
        )
        ON CONFLICT (schema_name, table_name) DO UPDATE SET
            slug = EXCLUDED.slug,
            exposed = EXCLUDED.exposed,
            description = EXCLUDED.description,
            soft_delete_column = EXCLUDED.soft_delete_column,
            history_enabled = EXCLUDED.history_enabled,
            tenant_column = EXCLUDED.tenant_column,
            tenant_source = EXCLUDED.tenant_source,
            tenant_bypass_roles = EXCLUDED.tenant_bypass_roles,
            search_config = EXCLUDED.search_config,
            column_access = EXCLUDED.column_access,
            column_storage = EXCLUDED.column_storage,
            private_columns = EXCLUDED.private_columns,
            readonly_columns = EXCLUDED.readonly_columns,
            updated_at = NOW()`,
        {
            params: [
                schema, table, slug, exposed, description,
                softDeleteColumn, historyEnabled, tenantColumn, tenantSource,
                tenantBypassRoles, searchConfig, columnAccess, columnStorage,
                privateColumns, readonlyColumns
            ]
        }
    );
}
