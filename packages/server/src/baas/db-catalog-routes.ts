import { Hono, type Context } from "hono";
import type { SQLAdmin } from "@rebasepro/types";
import { ApiError, errorHandler, extractDbError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { notifySchemaChanged } from "./catalog-ddl";
import { assertIdent, assertSchema, ddlRefusal, PROTECTED_SCHEMAS, quoteIdent } from "./db-admin-routes";
import { createSourceResolver, type DbSqlSource } from "./db-sources";

/**
 * The database's own objects besides tables, for the Studio's Database view
 * (`/api/admin/db/catalog`): functions, triggers, types and extensions.
 *
 * Every mutation previews its SQL with `dryRun: true`. Objects in the
 * protected schemas (`pg_catalog`, `information_schema`, `pg_toast`, `rebase`,
 * `auth`) are listed, marked `protected`, and never changed here. Objects an
 * extension owns are left to the extension.
 *
 * Every route takes `?source=<key>` to act on one of the SQL databases the
 * backend serves (`database("analytics")`); without it, the default one.
 */

export interface DbCatalogRoutesOptions {
    /** The default database's admin. */
    admin: SQLAdmin;
    /** The other SQL databases the backend serves, by data-source key. */
    sources?: () => readonly DbSqlSource[];
    /** Re-introspects after a change that can alter served tables (an enum value, an extension). */
    reloadSchema: () => Promise<unknown>;
}

/** The catalogs never listed: the system's own. */
const SYSTEM_SCHEMA_FILTER = (column: string) =>
    `${column} NOT IN ('pg_catalog', 'information_schema') AND ${column} NOT LIKE 'pg\\_toast%' AND ${column} NOT LIKE 'pg\\_temp%'`;

/** Not owned by an extension: `pg_depend` records ownership with deptype `e`. */
const NOT_EXTENSION_OWNED = (oid: string) =>
    `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = ${oid} AND d.deptype = 'e')`;

const EXTENSION_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/;
const MAX_ENUM_LABEL_BYTES = 63;

const str = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const nullableStr = (value: unknown): string | null => (value === null || value === undefined ? null : str(value));
const isProtectedSchema = (schema: string) => PROTECTED_SCHEMAS.has(schema.toLowerCase()) || schema.toLowerCase().startsWith("pg_");
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const asTextArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(str) : typeof value === "string" && value.startsWith("{")
        ? value.slice(1, -1).split(",").filter(Boolean).map(label => label.replace(/^"|"$/g, ""))
        : [];
const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function readBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
    try {
        const body = await c.req.json();
        return isRecord(body) ? body : {};
    } catch {
        return {};
    }
}

/**
 * The refusal for `CREATE EXTENSION`, with the hint `vector-index.ts` gives
 * for pgvector, said of any extension: what is missing is the library on the
 * server or the grant, not something the admin can type differently.
 */
function extensionRefusal(name: string, error: unknown): unknown {
    const message = extractDbError(error)?.message ?? "";
    const installRefused = /extension "[^"]+" is not available/i.test(message)
        || /could not open extension control file/i.test(message)
        || /(permission denied to create extension|must be (superuser|owner).{0,40}extension)/i.test(message);
    if (!installRefused) return ddlRefusal(error);
    return new ApiError(
        400,
        "DDL_REJECTED",
        `PostgreSQL refused the change: ${message}. ${name} is a server extension, so it needs a server that ships its ` +
        `library and a role allowed to run \`CREATE EXTENSION ${quoteIdent(name)};\`. Managed Postgres usually allows it ` +
        "once the extension is on the provider's allow-list.",
        { dbCode: extractDbError(error)?.code },
        true
    );
}

export function createDbCatalogRoutes({ admin: defaultAdmin, sources, reloadSchema }: DbCatalogRoutesOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const databases = createSourceResolver(defaultAdmin, sources);
    const adminFor = (c: Context<HonoEnv>) => databases.resolve(c.req.query("source")).admin;

    const run = async (
        admin: SQLAdmin,
        statements: string[],
        dryRun: boolean,
        options: { reload?: string; refuse?: (error: unknown) => unknown } = {}
    ) => {
        if (dryRun) return { dryRun: true, statements };
        try {
            if (admin.executeSqlTransaction) {
                await admin.executeSqlTransaction(statements);
            } else {
                for (const statement of statements) await admin.executeSql(statement);
            }
        } catch (err) {
            throw (options.refuse ?? ddlRefusal)(err);
        }
        if (options.reload) {
            await notifySchemaChanged(admin, options.reload);
            await reloadSchema();
        }
        return { dryRun: false, statements };
    };

    // ── Functions and procedures ──
    router.get("/functions", async (c) => {
        const admin = adminFor(c);
        const rows = await admin.executeSql(
            `SELECT n.nspname AS schema, p.proname AS name,
                    pg_get_function_identity_arguments(p.oid) AS args,
                    pg_get_function_result(p.oid) AS returns,
                    l.lanname AS language,
                    p.prokind AS kind,
                    p.prosecdef AS security_definer,
                    p.provolatile AS volatility,
                    obj_description(p.oid, 'pg_proc') AS comment,
                    pg_get_functiondef(p.oid) AS definition
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               JOIN pg_language l ON l.oid = p.prolang
              WHERE p.prokind IN ('f', 'p')
                AND ${SYSTEM_SCHEMA_FILTER("n.nspname")}
                AND ${NOT_EXTENSION_OWNED("p.oid")}
              ORDER BY n.nspname, p.proname, args`
        );
        return c.json({
            functions: rows.map(row => ({
                schema: str(row.schema),
                name: str(row.name),
                args: str(row.args),
                returns: nullableStr(row.returns),
                language: str(row.language),
                kind: row.kind === "p" ? "procedure" : "function",
                securityDefiner: row.security_definer === true,
                volatility: row.volatility === "i" ? "immutable" : row.volatility === "s" ? "stable" : "volatile",
                comment: nullableStr(row.comment),
                definition: str(row.definition),
                protected: isProtectedSchema(str(row.schema))
            }))
        });
    });

    router.delete("/functions/:schema/:name", async (c) => {
        const admin = adminFor(c);
        const schema = assertSchema(c.req.param("schema"));
        const name = c.req.param("name");
        const body = await readBody(c);
        if (typeof body.args !== "string") {
            throw ApiError.badRequest(
                "`args` is required: the function's argument types as `pg_get_function_identity_arguments` prints them (\"\" for none).",
                "INVALID_INPUT"
            );
        }
        const wanted = body.args.trim();
        // The signature is matched against the catalog and the statement built
        // from the catalog's own text, so nothing the caller typed reaches it
        // beyond a quoted name.
        const candidates = await admin.executeSql(
            `SELECT p.prokind AS kind, pg_get_function_identity_arguments(p.oid) AS args
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind IN ('f', 'p')
                AND ${NOT_EXTENSION_OWNED("p.oid")}`,
            { params: [schema, name] }
        );
        const match = candidates.find(row => str(row.args) === wanted);
        if (!match) {
            throw ApiError.notFound(`No function ${schema}.${name}(${wanted}) exists that can be dropped here.`, "FUNCTION_NOT_FOUND");
        }
        const keyword = match.kind === "p" ? "PROCEDURE" : "FUNCTION";
        const cascade = body.cascade === true ? " CASCADE" : "";
        const statement = `DROP ${keyword} ${quoteIdent(schema)}.${quoteIdent(name)}(${str(match.args)})${cascade};`;
        return c.json(await run(admin, [statement], body.dryRun === true));
    });

    // ── Triggers ──
    router.get("/triggers", async (c) => {
        const admin = adminFor(c);
        const rows = await admin.executeSql(
            `SELECT n.nspname AS schema, c.relname AS table_name, tg.tgname AS name,
                    pg_get_triggerdef(tg.oid) AS definition,
                    tg.tgenabled AS enabled,
                    pn.nspname AS function_schema, p.proname AS function_name,
                    CASE WHEN tg.tgtype & 2 <> 0 THEN 'BEFORE'
                         WHEN tg.tgtype & 64 <> 0 THEN 'INSTEAD OF'
                         ELSE 'AFTER' END AS timing,
                    array_remove(ARRAY[
                        CASE WHEN tg.tgtype & 4 <> 0 THEN 'INSERT' END,
                        CASE WHEN tg.tgtype & 16 <> 0 THEN 'UPDATE' END,
                        CASE WHEN tg.tgtype & 8 <> 0 THEN 'DELETE' END,
                        CASE WHEN tg.tgtype & 32 <> 0 THEN 'TRUNCATE' END
                    ], NULL) AS events,
                    CASE WHEN tg.tgtype & 1 <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS level
               FROM pg_trigger tg
               JOIN pg_class c ON c.oid = tg.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_proc p ON p.oid = tg.tgfoid
               JOIN pg_namespace pn ON pn.oid = p.pronamespace
              WHERE NOT tg.tgisinternal
                AND ${SYSTEM_SCHEMA_FILTER("n.nspname")}
              ORDER BY n.nspname, c.relname, tg.tgname`
        );
        return c.json({
            triggers: rows.map(row => ({
                schema: str(row.schema),
                table: str(row.table_name),
                name: str(row.name),
                definition: str(row.definition),
                enabled: row.enabled !== "D",
                timing: str(row.timing),
                events: asTextArray(row.events),
                level: str(row.level),
                function: `${str(row.function_schema)}.${str(row.function_name)}`,
                protected: isProtectedSchema(str(row.schema))
            }))
        });
    });

    // ── Types: enums, composites, domains ──
    router.get("/types", async (c) => {
        const admin = adminFor(c);
        const rows = await admin.executeSql(
            `SELECT n.nspname AS schema, t.typname AS name,
                    CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'c' THEN 'composite' WHEN 'd' THEN 'domain' END AS kind,
                    CASE WHEN t.typtype = 'e' THEN
                        (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid)
                    END AS enum_values,
                    CASE WHEN t.typtype = 'c' THEN
                        (SELECT array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                           FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped)
                    END AS attributes,
                    CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END AS base_type,
                    obj_description(t.oid, 'pg_type') AS comment
               FROM pg_type t
               JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE t.typtype IN ('e', 'c', 'd')
                AND (t.typtype <> 'c' OR (SELECT c.relkind FROM pg_class c WHERE c.oid = t.typrelid) = 'c')
                AND ${SYSTEM_SCHEMA_FILTER("n.nspname")}
                AND ${NOT_EXTENSION_OWNED("t.oid")}
              ORDER BY n.nspname, t.typname`
        );
        return c.json({
            types: rows.map(row => ({
                schema: str(row.schema),
                name: str(row.name),
                kind: str(row.kind),
                values: asTextArray(row.enum_values),
                attributes: asTextArray(row.attributes),
                baseType: nullableStr(row.base_type),
                comment: nullableStr(row.comment),
                protected: isProtectedSchema(str(row.schema))
            }))
        });
    });

    router.post("/types/:schema/:name/values", async (c) => {
        const admin = adminFor(c);
        const schema = assertSchema(c.req.param("schema"));
        const name = assertIdent(c.req.param("name"), "Type name");
        const body = await readBody(c);
        const value = typeof body.value === "string" ? body.value : "";
        if (!value || value.includes("\u0000") || new TextEncoder().encode(value).length > MAX_ENUM_LABEL_BYTES) {
            throw ApiError.badRequest(`An enum value is 1 to ${MAX_ENUM_LABEL_BYTES} bytes of text.`, "INVALID_INPUT");
        }
        const [type] = await admin.executeSql(
            `SELECT (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) AS labels
               FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname = $1 AND t.typname = $2 AND t.typtype = 'e'`,
            { params: [schema, name] }
        );
        if (!type) throw ApiError.notFound(`No enum type ${schema}.${name} exists.`, "TYPE_NOT_FOUND");
        const labels = asTextArray(type.labels);
        let position = "";
        for (const key of ["before", "after"] as const) {
            const anchor = body[key];
            if (anchor === undefined || anchor === null || anchor === "") continue;
            if (position) throw ApiError.badRequest("Give `before` or `after`, not both.", "INVALID_INPUT");
            if (typeof anchor !== "string" || !labels.includes(anchor)) {
                throw ApiError.badRequest(`\`${key}\` must be one of the type's values (${labels.join(", ")}).`, "INVALID_INPUT");
            }
            position = ` ${key.toUpperCase()} ${sqlLiteral(anchor)}`;
        }
        const statement = `ALTER TYPE ${quoteIdent(schema)}.${quoteIdent(name)} ADD VALUE ${sqlLiteral(value)}${position};`;
        return c.json(await run(admin, [statement], body.dryRun === true, { reload: `enum value added to ${schema}.${name}` }));
    });

    // ── Extensions ──
    router.get("/extensions", async (c) => {
        const admin = adminFor(c);
        let rows: Record<string, unknown>[];
        try {
            rows = await admin.executeSql(
                `SELECT a.name, a.default_version, a.comment,
                        e.extversion AS installed_version, n.nspname AS schema
                   FROM pg_available_extensions a
                   LEFT JOIN pg_extension e ON e.extname = a.name
                   LEFT JOIN pg_namespace n ON n.oid = e.extnamespace
                  ORDER BY (e.extname IS NULL), a.name`
            );
        } catch {
            // A server that will not list what it could install still says
            // what is installed.
            rows = await admin.executeSql(
                `SELECT e.extname AS name, e.extversion AS default_version, NULL::text AS comment,
                        e.extversion AS installed_version, n.nspname AS schema
                   FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                  ORDER BY e.extname`
            );
        }
        return c.json({
            extensions: rows.map(row => ({
                name: str(row.name),
                defaultVersion: nullableStr(row.default_version),
                installedVersion: nullableStr(row.installed_version),
                schema: nullableStr(row.schema),
                comment: nullableStr(row.comment),
                installed: row.installed_version !== null && row.installed_version !== undefined
            }))
        });
    });

    const assertExtensionName = (raw: string | undefined): string => {
        const name = (raw ?? "").trim();
        if (!EXTENSION_NAME_RE.test(name)) {
            throw ApiError.badRequest(`"${name}" is not an extension name.`, "INVALID_INPUT");
        }
        return name;
    };

    router.post("/extensions/:name", async (c) => {
        const admin = adminFor(c);
        const name = assertExtensionName(c.req.param("name"));
        const body = await readBody(c);
        const schema = body.schema === undefined || body.schema === null || body.schema === "" ? undefined : assertSchema(body.schema);
        const statement = `CREATE EXTENSION IF NOT EXISTS ${quoteIdent(name)}${schema ? ` WITH SCHEMA ${quoteIdent(schema)}` : ""};`;
        return c.json(await run(admin, [statement], body.dryRun === true, {
            reload: `extension ${name} created`,
            refuse: error => extensionRefusal(name, error)
        }));
    });

    router.delete("/extensions/:name", async (c) => {
        const admin = adminFor(c);
        const name = assertExtensionName(c.req.param("name"));
        if (name === "plpgsql") {
            throw ApiError.badRequest("plpgsql is the server's own procedural language and stays installed.", "INVALID_INPUT");
        }
        const body = await readBody(c);
        const [installed] = await admin.executeSql(
            `SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = $1`,
            { params: [name] }
        );
        if (!installed) throw ApiError.notFound(`Extension ${name} is not installed.`, "EXTENSION_NOT_FOUND");
        const cascade = body.cascade === true ? " CASCADE" : "";
        const statement = `DROP EXTENSION ${quoteIdent(name)}${cascade};`;
        return c.json(await run(admin, [statement], body.dryRun === true, { reload: `extension ${name} dropped` }));
    });

    return router;
}
