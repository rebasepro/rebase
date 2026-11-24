/**
 * The SQL console's saved snippets, kept in `rebase.sql_snippets` so they
 * follow a person from browser to browser and can be shared with the team.
 *
 * Who sees one is its `visibility`: `personal` (its owner) or `team` (everyone
 * who may open the SQL console). Only its owner, or an admin, changes or
 * deletes one, whoever can see it. A snippet is text: running it runs it as
 * whoever runs it, in the role they pick, so sharing one shares no access.
 *
 * The table is not a collection and carries no RLS, so no end user is granted
 * anything on it; every read and write here filters by the viewer itself.
 *
 * @module
 */
import type { DataDriver } from "@rebasepro/types";
import { hasAdminRole, isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { createDdlBootstrapper, type SqlExec } from "../boot/ddl-bootstrap.js";

export type SqlSnippetVisibility = "personal" | "team";

export const SQL_SNIPPET_VISIBILITIES: readonly SqlSnippetVisibility[] = ["personal", "team"];

export interface SqlSnippet {
    id: string;
    name: string;
    sql: string;
    visibility: SqlSnippetVisibility;
    favorite: boolean;
    ownerId: string;
    createdAt: string;
    updatedAt: string;
}

/** Who is asking: whose personal snippets, and whether they may change anyone's. */
export interface SqlSnippetViewer {
    uid: string;
    roles: readonly string[];
}

export interface CreateSqlSnippetInput {
    name: string;
    sql: string;
    visibility?: SqlSnippetVisibility;
    favorite?: boolean;
}

/** The fields a change sets; the ones left out keep their value. */
export type UpdateSqlSnippetInput = Partial<CreateSqlSnippetInput>;

/** A request the store refuses, with a reason the caller can show. */
export class SqlSnippetError extends Error {
    constructor(message: string, readonly status: 400 | 404 = 400) {
        super(message);
        this.name = "SqlSnippetError";
    }
}

export interface SqlSnippetStore {
    list(viewer: SqlSnippetViewer): Promise<SqlSnippet[]>;
    create(input: CreateSqlSnippetInput, viewer: SqlSnippetViewer): Promise<SqlSnippet>;
    update(id: string, input: UpdateSqlSnippetInput, viewer: SqlSnippetViewer): Promise<SqlSnippet>;
    remove(id: string, viewer: SqlSnippetViewer): Promise<boolean>;
}

const TABLE = "rebase.sql_snippets";

/** The most snippets one person keeps: a place for queries, not storage. */
export const MAX_SQL_SNIPPETS_PER_OWNER = 500;

/** The longest snippet, in characters. */
export const MAX_SQL_SNIPPET_LENGTH = 100_000;

/** The longest snippet name, in characters. */
export const MAX_SQL_SNIPPET_NAME_LENGTH = 200;

/** The rows a viewer may see: their own and the team's. */
const VISIBLE = "(owner_id = $1 OR visibility = 'team')";

/**
 * The dates as ISO 8601 text: a driver may hand a timestamptz back as
 * Postgres's own text, which not every browser parses.
 */
const COLUMNS = "id, name, sql, visibility, favorite, owner_id, "
    + "to_json(created_at) #>> '{}' AS created_at, to_json(updated_at) #>> '{}' AS updated_at";

const stores = new WeakMap<DataDriver, SqlSnippetStore | undefined>();

/**
 * The store on `driver`'s database, made once per driver; `undefined` on a
 * driver with no SQL.
 */
export function sqlSnippetStore(driver: DataDriver): SqlSnippetStore | undefined {
    if (stores.has(driver)) return stores.get(driver);
    const admin = driver.admin;
    const store = isSQLAdmin(admin)
        ? createSqlSnippetStore((sqlText, options) => admin.executeSql(sqlText, options?.params ? { params: options.params } : undefined))
        : undefined;
    stores.set(driver, store);
    return store;
}

export function createSqlSnippetStore(exec: SqlExec): SqlSnippetStore {
    const ddl = createDdlBootstrapper(exec, "sql-snippets");
    let ready: Promise<void> | undefined;

    /** The table, made on first use, and closed to end users every time it is made ready. */
    const ensure = () => ready ??= (async () => {
        await ddl.ensureObject("Creating schema rebase", "CREATE SCHEMA IF NOT EXISTS rebase");
        await ddl.ensureObject(`Creating ${TABLE}`, `
            CREATE TABLE IF NOT EXISTS ${TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                sql TEXT NOT NULL,
                visibility TEXT NOT NULL CHECK (visibility IN ('personal', 'team')),
                favorite BOOLEAN NOT NULL DEFAULT false,
                owner_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);
        if (!await ddl.isReadable(TABLE)) {
            ready = undefined;
            throw new SqlSnippetError("Saved snippets need the rebase.sql_snippets table, and this backend could not create it "
                + "(is provisioning off?). Create it with the server's schema tooling, then try again.");
        }
        await ddl.step("Revoking end-user access to sql_snippets", () => exec(revokeInternalTableSql("rebase", "sql_snippets")));
    })();

    return {
        async list(viewer) {
            await ensure();
            const rows = await exec(
                `SELECT ${COLUMNS} FROM ${TABLE} WHERE ${VISIBLE} ORDER BY favorite DESC, updated_at DESC LIMIT ${MAX_SQL_SNIPPETS_PER_OWNER * 2}`,
                { params: [viewer.uid] }
            );
            return (rows ?? []).map(snippetOf);
        },

        async create(input, viewer) {
            checkName(input.name);
            checkSql(input.sql);
            const visibility = input.visibility ?? "personal";
            await ensure();
            const [{ n } = { n: 0 }] = await exec(`SELECT count(*)::int AS n FROM ${TABLE} WHERE owner_id = $1`, { params: [viewer.uid] });
            if (Number(n) >= MAX_SQL_SNIPPETS_PER_OWNER) {
                throw new SqlSnippetError(`You have ${MAX_SQL_SNIPPETS_PER_OWNER} saved snippets, the most one person keeps. Delete one to save another.`);
            }
            const rows = await exec(`
                INSERT INTO ${TABLE} (name, sql, visibility, favorite, owner_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING ${COLUMNS}`,
            { params: [input.name.trim(), input.sql, visibility, input.favorite === true, viewer.uid] });
            const row = rows?.[0];
            if (!row) throw new SqlSnippetError("The snippet was not saved.");
            return snippetOf(row);
        },

        async update(id, input, viewer) {
            if (input.name !== undefined) checkName(input.name);
            if (input.sql !== undefined) checkSql(input.sql);
            if (!isUuid(id)) throw new SqlSnippetError(`No saved snippet with id "${id}".`, 404);
            await ensure();
            // Its owner, or an admin, changes it; nobody else, whoever can see it.
            const rows = await exec(`
                UPDATE ${TABLE} SET
                    name = COALESCE($1, name),
                    sql = COALESCE($2, sql),
                    visibility = COALESCE($3, visibility),
                    favorite = COALESCE($4, favorite),
                    updated_at = now()
                WHERE id = $5 AND (owner_id = $6 OR $7)
                RETURNING ${COLUMNS}`,
            { params: [input.name?.trim() ?? null, input.sql ?? null, input.visibility ?? null, input.favorite ?? null, id, viewer.uid, hasAdminRole(viewer.roles)] });
            const row = rows?.[0];
            if (!row) throw new SqlSnippetError(`No saved snippet with id "${id}" that you may change.`, 404);
            return snippetOf(row);
        },

        async remove(id, viewer) {
            if (!isUuid(id)) return false;
            await ensure();
            const rows = await exec(`DELETE FROM ${TABLE} WHERE id = $1 AND (owner_id = $2 OR $3) RETURNING id`,
                { params: [id, viewer.uid, hasAdminRole(viewer.roles)] });
            return (rows ?? []).length > 0;
        }
    };
}

function checkName(name: string): void {
    if (name.trim() === "") throw new SqlSnippetError("A snippet has a name.");
    if (name.length > MAX_SQL_SNIPPET_NAME_LENGTH) {
        throw new SqlSnippetError(`A snippet's name is at most ${MAX_SQL_SNIPPET_NAME_LENGTH} characters.`);
    }
}

function checkSql(sql: string): void {
    if (sql.trim() === "") throw new SqlSnippetError("A snippet holds some SQL.");
    if (sql.length > MAX_SQL_SNIPPET_LENGTH) {
        throw new SqlSnippetError(`A snippet is at most ${MAX_SQL_SNIPPET_LENGTH} characters; this one is ${sql.length}.`);
    }
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value ?? "");
}

function snippetOf(row: Record<string, unknown>): SqlSnippet {
    return {
        id: String(row.id),
        name: String(row.name ?? ""),
        sql: String(row.sql ?? ""),
        visibility: SQL_SNIPPET_VISIBILITIES.find(visibility => visibility === row.visibility) ?? "personal",
        favorite: row.favorite === true || row.favorite === "t" || row.favorite === "true",
        ownerId: String(row.owner_id ?? ""),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
    };
}
