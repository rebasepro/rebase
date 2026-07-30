/**
 * Which tables actually have row-level security switched on, according to the
 * database.
 *
 * ## Why this is not read from the collection config
 *
 * The graph used to derive "RLS protected" from `collection.securityRules` —
 * i.e. from what the *codebase* declares. Two problems with that:
 *
 *  - **It is not the truth.** Rules in code are only live once a migration has
 *    applied them, and `ALTER TABLE … DISABLE ROW LEVEL SECURITY` in a psql
 *    session is invisible to it. A security indicator that reports intent
 *    rather than state is worse than none: it is green precisely when you most
 *    need it to be red.
 *  - **The hosted console has no codebase.** There, collections arrive from the
 *    tenant's `/api/meta/contract`, which deliberately strips `securityRules`
 *    (they carry the raw SQL of every policy guarding the project). So the
 *    console showed "RLS protected: 0" and no badge on any table, for every
 *    project, however well secured.
 *
 * `pg_tables.rowsecurity` answers the question directly and is available
 * wherever `databaseAdmin` is — which is both hosts.
 *
 * When there is no SQL capability at all the hook reports `null`, and callers
 * fall back to the config-derived flag rather than claiming everything is
 * unprotected.
 */
import { useEffect, useState } from "react";
import { useRebaseContext } from "@rebasepro/app";

/** `schema.table` for every table with RLS enabled, or `null` if unknown. */
export type LiveRlsTables = Set<string> | null;

const RLS_TABLES_SQL = `
    SELECT schemaname, tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname NOT IN ('information_schema', 'pg_catalog');
`;

/** Postgres column names arrive lower-cased over the wire, but not on every driver. */
function pick<T>(row: Record<string, unknown>, name: string): T | undefined {
    return (row[name] ?? row[name.toUpperCase()]) as T | undefined;
}

function extractRows(result: unknown): Record<string, unknown>[] {
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as { rows: unknown }).rows;
        if (Array.isArray(rows)) return rows as Record<string, unknown>[];
    }
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    return [];
}

export function useLiveRlsTables(): LiveRlsTables {
    const { databaseAdmin } = useRebaseContext();
    const executeSql = databaseAdmin?.executeSql;
    const [tables, setTables] = useState<LiveRlsTables>(null);

    useEffect(() => {
        if (!executeSql) {
            setTables(null);
            return;
        }
        let cancelled = false;
        executeSql(RLS_TABLES_SQL)
            .then((result: unknown) => {
                if (cancelled) return;
                const enabled = new Set<string>();
                for (const row of extractRows(result)) {
                    if (!pick<boolean>(row, "rowsecurity")) continue;
                    const schema = pick<string>(row, "schemaname") ?? "public";
                    const table = pick<string>(row, "tablename");
                    if (table) enabled.add(`${schema}.${table}`);
                }
                setTables(enabled);
            })
            .catch(() => {
                // No answer is not the same as "nothing is protected" — leave it
                // unknown so the caller keeps its config-derived fallback.
                if (!cancelled) setTables(null);
            });
        return () => { cancelled = true; };
    }, [executeSql]);

    return tables;
}
