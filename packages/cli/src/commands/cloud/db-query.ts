/**
 * `rebase cloud db query` — run SQL on the project's managed database, from
 * here, with nothing installed but the CLI.
 *
 * Applying a SQL file to a Cloud database used to take `rebase cloud db
 * connect --reveal --json` held open in the background and a local `psql`
 * pointed at the URL it printed. This opens the same tunnel on an ephemeral
 * port for the length of one query, connects with the CLI's own Postgres
 * driver, runs the text, and closes both.
 *
 * The text goes over the simple query protocol, so a file of several
 * statements (functions, triggers, `DO` blocks) runs as one script and stops at
 * the first error, the way `psql -v ON_ERROR_STOP=1 -f` does. `COPY … FROM
 * STDIN` is not supported: it needs a client-side stream (`psql`'s `\copy`).
 *
 * The gate is the control plane's: revealing the password needs the
 * organization's owner or admin role, the same as the console's SQL console.
 */
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import chalk from "chalk";
import type { QueryResult } from "pg";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    fail
} from "./context";
import { loadTunnelAccess, localDsn, tunnelListener, tunnelUrl } from "./db-connect";

/** Documented in `action-help.ts`, and paired with it by `action-help.test.ts`. */
export const DB_QUERY_FLAGS = {
    "--file": String
} as const;

/** The most rows of a result printed as a table; the JSON form carries them all. */
const MAX_TABLE_ROWS = 200;

/** One statement's result, as the JSON form reports it. */
export interface QueryResultSummary {
    command: string | null;
    rowCount: number | null;
    rows: Record<string, unknown>[];
}

/** The SQL to run: the file, or the one positional. Exactly one of them. */
export function querySql(file: string | undefined, positional: string | undefined, read: (path: string) => string = (p) => fs.readFileSync(p, "utf-8")): string {
    if (file !== undefined && positional !== undefined) {
        fail("Give the SQL as an argument or with --file, not both.", "rebase cloud db query --file schema-extras.sql", "usage");
    }
    if (file === undefined && positional === undefined) {
        fail("rebase cloud db query needs SQL: rebase cloud db query \"select 1\", or --file <path>.", undefined, "usage");
    }
    let sql: string;
    if (file !== undefined) {
        try {
            sql = read(file);
        } catch (e) {
            fail(`Could not read ${file}: ${e instanceof Error ? e.message : String(e)}`, undefined, "file_unreadable");
        }
    } else {
        sql = positional as string;
    }
    if (!sql.trim()) fail("The SQL is empty.", undefined, "usage");
    if (/^\s*\\copy\b|\bfrom\s+stdin\b/im.test(sql)) {
        fail(
            "`COPY … FROM STDIN` needs a client-side stream, which this command does not open.",
            "Load rows with INSERT statements, or use `rebase cloud db connect` and psql's \\copy.",
            "copy_from_stdin"
        );
    }
    return sql;
}

/** `pg` answers one result for one statement and an array for several. */
export function summarizeResults(result: QueryResult | QueryResult[]): QueryResultSummary[] {
    const list = Array.isArray(result) ? result : [result];
    return list.map((r) => ({ command: r.command ?? null, rowCount: r.rowCount ?? null, rows: r.rows as Record<string, unknown>[] }));
}

export async function dbQuery(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: DB_QUERY_FLAGS,
        rawArgs,
        commandWords: 3, // cloud db query
        command: "cloud db query",
        maxPositionals: 1
    });
    const sql = querySql(flags["--file"], positionals[0]);
    const { client, url } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    const { info, password } = await loadTunnelAccess(client, projectId, true);

    const server = tunnelListener(client, tunnelUrl(url, projectId));
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    // Imported here: most commands never open a database connection.
    const { Client } = await import("pg");
    const db = new Client({ connectionString: localDsn({ port, username: info.username, database: info.database, password }) });

    let summaries: QueryResultSummary[];
    try {
        await db.connect();
        summaries = summarizeResults(await db.query(sql));
    } catch (e) {
        const err = e as { message?: string; code?: string; position?: string; detail?: string; hint?: string };
        fail(
            `The database refused the SQL${err.code ? ` (SQLSTATE ${err.code})` : ""}: ${err.message ?? String(e)}`,
            [err.detail, err.hint].filter(Boolean).join(" ") || "Statements before the failing one have run unless the script wraps itself in BEGIN/COMMIT.",
            "query_failed"
        );
    } finally {
        await db.end().catch(() => {});
        server.close();
    }

    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🗄  SQL on project ${projectRef}`));
            for (const s of summaries) {
                console.log("");
                console.log(`  ${chalk.green(s.command ?? "OK")}${s.rowCount !== null ? chalk.gray(` ${s.rowCount}`) : ""}`);
                if (s.rows.length > 0) {
                    console.table(s.rows.slice(0, MAX_TABLE_ROWS));
                    if (s.rows.length > MAX_TABLE_ROWS) console.log(chalk.gray(`  … ${s.rows.length - MAX_TABLE_ROWS} more rows (--json prints them all)`));
                }
            }
            console.log("");
        },
        { projectId, results: summaries }
    );
}
