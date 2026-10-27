/**
 * Whether the auth tables a backend reads are there, on a backend that may not
 * create them.
 *
 * A driver opened without provisioning skips `ensureAuthTablesExist` — the
 * tables are another process's to make — and before this nothing took its
 * place. A database that lacked `rebase.refresh_tokens`, or had a users table
 * from a release before `disabled_at`, booted green and then failed every
 * sign-in with a 500 whose cause was one missing relation. Auth cannot run on
 * part of its schema, so this is a refusal at boot, naming each table.
 *
 * Asked by reading, not by the catalogue: a `SELECT` of every column the auth
 * services name, `WHERE false`. That answers "missing", "out of date" and "this
 * role may not read it" in one statement per table, with the database's own
 * words for whichever it is.
 */
import { getTableColumns, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { AUTH_USERS_COLUMNS } from "../schema/auth-users-columns";
import { deepestErrorMessage } from "../cli-errors";

/** One table and the columns of it that auth reads and writes. */
export interface AuthTableExpectation {
    /** Schema-qualified, quoted. */
    table: string;
    columns: string[];
}

const quote = (identifier: string): string => `"${identifier.replace(/"/g, "\"\"")}"`;

/** What a Drizzle table definition says auth will query. */
export function expectationOf(table: PgTable): AuthTableExpectation {
    const config = getTableConfig(table);
    return {
        table: config.schema ? `${quote(config.schema)}.${quote(config.name)}` : quote(config.name),
        columns: Object.values(getTableColumns(table)).map(column => column.name)
    };
}

/**
 * The users table, which is the project's own when it declares an auth
 * collection: only the columns the auth bootstrap guarantees on it are
 * expected, never the collection's other fields — those are the collection
 * schema's business, checked where collections are.
 */
export function usersExpectation(qualifiedTable: string): AuthTableExpectation {
    return { table: qualifiedTable, columns: ["id", ...AUTH_USERS_COLUMNS.map(spec => spec.column)] };
}

/** Each table that cannot be read as expected, with the database's reason. */
export async function findUnusableAuthTables(
    db: NodePgDatabase,
    expectations: readonly AuthTableExpectation[]
): Promise<string[]> {
    const problems: string[] = [];
    for (const { table, columns } of expectations) {
        try {
            await db.execute(sql.raw(`SELECT ${columns.map(quote).join(", ")} FROM ${table} WHERE false`));
        } catch (err) {
            problems.push(`${table}: ${deepestErrorMessage(err)}`);
        }
    }
    return problems;
}

/** The refusal, phrased as what to run. */
export function unusableAuthTablesError(problems: readonly string[]): Error {
    return new Error(
        "Auth cannot run on this database, and this backend changes nothing in it (provisioning is off):\n" +
        problems.map(problem => `  - ${problem}`).join("\n") + "\n" +
        "Create them with a provisioning run against this database (REBASE_PROVISION_ONLY=true, without " +
        "REBASE_PROVISION=false), or apply the SQL such a run recorded (REBASE_PROVISION_SQL_OUT)."
    );
}
