/**
 * Running behind a transaction-mode pooler (PgBouncer, `DATABASE_POOLED=true`).
 *
 * The pool sends no session settings at connect behind one — the pooler would
 * refuse or drop them — and a transaction sets its own (`SET LOCAL`, see
 * `pooledTransactionSettings`). What that leaves is a statement outside any
 * transaction: it runs with the role's defaults, and the default
 * `search_path` is `"$user", public`. This framework's role is usually called
 * `rebase`, and so is its schema, so an unqualified table resolves to
 * `rebase.<name>` before `public.<name>` — the hazard `pinSearchPath` exists
 * for, which a pooled pool cannot pin.
 *
 * So the boot gives the role a default `search_path` of `public` in this
 * database, the same value every direct connection of this framework already
 * pins, over the direct URL. It applies to server connections the pooler opens
 * from then on.
 *
 * @module
 */
import { Client, type Pool } from "pg";
import { logger } from "@rebasepro/server";
import { searchPathList } from "./connection";

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, "\"\"")}"`;
}

/** The statement that gives `role` a default `search_path` in `database`. */
export function roleSearchPathStatement(role: string, database: string, searchPath: string): string {
    return `ALTER ROLE ${quoteIdent(role)} IN DATABASE ${quoteIdent(database)} SET search_path TO ${searchPathList(searchPath)}`;
}

/** Whether a reported `search_path` already is `wanted`, spelling aside. */
export function searchPathMatches(reported: string, wanted: string): boolean {
    const normalise = (value: string) => value.split(",").map(part => part.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean).join(",");
    return normalise(reported) === normalise(wanted);
}

/**
 * Make the role the pooled pool connects as default to `searchPath` in its
 * database, when it does not already. Asked through the pool (what the pooler
 * hands out is what matters), changed through `directUrl`.
 *
 * With `provision: false` — a boot that runs no DDL — nothing is changed and
 * the statement to run is logged. A role that may not change its own
 * defaults is logged the same way; neither stops the boot, because every
 * transaction still sets the path for itself.
 */
export async function ensurePooledRoleDefaults(
    pool: Pick<Pool, "query">,
    directUrl: string,
    options: { provision: boolean; searchPath?: string }
): Promise<void> {
    const wanted = options.searchPath ?? "public";
    let facts: { search_path: string; role: string; database: string } | undefined;
    try {
        const result = await pool.query<{ search_path: string; role: string; database: string }>(
            "SELECT current_setting('search_path') AS search_path, current_user AS role, current_database() AS database"
        );
        facts = result.rows[0];
    } catch (error: unknown) {
        logger.warn("[pooler] Could not read the search_path the pooler hands out", {
            error: error instanceof Error ? error.message : String(error)
        });
        return;
    }
    if (!facts || searchPathMatches(facts.search_path, wanted)) return;

    const statement = roleSearchPathStatement(facts.role, facts.database, wanted);
    if (!options.provision) {
        logger.warn(
            `⚠️ [pooler] Statements outside a transaction resolve unqualified tables with search_path ` +
            `"${facts.search_path}", not "${wanted}", and this process runs no DDL at boot. Run once:\n    ${statement};`
        );
        return;
    }
    const client = new Client({ connectionString: directUrl, connectionTimeoutMillis: 10_000 });
    client.on("error", () => undefined);
    try {
        await client.connect();
        await client.query(statement);
        logger.info(
            `[pooler] Set the default search_path of role "${facts.role}" in "${facts.database}" to ${wanted} ` +
            "(was " + JSON.stringify(facts.search_path) + "), for statements outside a transaction."
        );
    } catch (error: unknown) {
        logger.warn(
            `⚠️ [pooler] Could not set the default search_path of role "${facts.role}": ` +
            `${error instanceof Error ? error.message : String(error)}. Run once as a role that may:\n    ${statement};`
        );
    } finally {
        await client.end().catch(() => undefined);
    }
}
