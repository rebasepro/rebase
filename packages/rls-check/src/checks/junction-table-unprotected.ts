import type { Check, DbRelation, DbSnapshot, Finding } from "../types";

import { finding, qrel, relationAt, scannedTables } from "./util";

const ID = "junction-table-unprotected";

/** Bookkeeping columns a join table is allowed to carry without ceasing to be one. */
const INCIDENTAL_COLUMNS = new Set([
    "id", "uuid", "created_at", "updated_at", "inserted_at", "modified_at", "deleted_at",
    "created_on", "updated_on", "createdat", "updatedat"
]);

/**
 * The edge table of a many-to-many relationship, left without RLS while both
 * endpoints have it.
 *
 * Join tables are the classic forgotten surface: the two tables people think of
 * as "the data" get policies, and the table that records *which user belongs to
 * which organisation* — often the most sensitive relation in the schema — is
 * treated as plumbing. It leaks the graph even when it leaks no attributes.
 *
 * The inference is deliberately narrow: exactly two foreign keys, to two
 * different tables that both have RLS on, and no columns beyond those keys and
 * ordinary bookkeeping. A table with its own payload columns is a domain table
 * that happens to have two foreign keys, and is not reported here.
 */
export const junctionTableUnprotected: Check = {
    id: ID,
    title: "Many-to-many join table without RLS",
    description:
        "A table that is essentially just two foreign keys, both pointing at RLS-protected " +
        "tables, that has no row-level security of its own.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const rel of scannedTables(snapshot)) {
            if (rel.rlsEnabled) continue;

            const fks = snapshot.foreignKeys.filter(
                (fk) => fk.schema === rel.schema && fk.table === rel.name
            );
            if (fks.length !== 2) continue;

            const endpoints = fks.map((fk) => `${fk.refSchema}.${fk.refTable}`);
            if (endpoints[0] === endpoints[1]) continue;
            if (endpoints.some((e) => e === `${rel.schema}.${rel.name}`)) continue;

            const targets = fks.map((fk) => relationAt(snapshot, fk.refSchema, fk.refTable));
            if (!targets.every((t) => t?.rlsEnabled)) continue;

            if (!isMostlyKeys(rel, fks.flatMap((fk) => fk.columns))) continue;

            findings.push(
                finding({
                    id: ID,
                    severity: "high",
                    confidence: "heuristic",
                    title:
                        `${rel.schema}.${rel.name} joins ${endpoints[0]} to ${endpoints[1]}, ` +
                        `and is the only one of the three without RLS`,
                    target: { schema: rel.schema, table: rel.name },
                    detail:
                        `This table looks like a many-to-many join table: its columns are the ` +
                        `foreign keys to ${endpoints[0]} and ${endpoints[1]} plus bookkeeping. Both of ` +
                        `those tables have row-level security enabled; this one does not, so no policy ` +
                        `is consulted when it is read or written.`,
                    impact:
                        `If this table is reachable over an API, a caller reads the full membership ` +
                        `graph between ${endpoints[0]} and ${endpoints[1]} — which rows relate to which — ` +
                        `even though neither endpoint table can be read directly. Where the join table ` +
                        `is also writable, a caller can grant themselves a relationship that the policies ` +
                        `on the endpoint tables then honour.`,
                    fix:
                        `ALTER TABLE ${qrel(rel.schema, rel.name)} ENABLE ROW LEVEL SECURITY;\n` +
                        `-- A join table's policy normally follows its endpoints, e.g.:\n` +
                        `-- CREATE POLICY ${JSON.stringify(`${rel.name}_select`)} ON ${qrel(rel.schema, rel.name)}\n` +
                        `--     FOR SELECT USING (EXISTS (\n` +
                        `--         SELECT 1 FROM ${endpoints[0]} e\n` +
                        `--         WHERE e.id = ${qrel(rel.schema, rel.name)}.${fks[0].columns[0]}\n` +
                        `--     ));`
                })
            );
        }

        return findings;
    }
};

function isMostlyKeys(rel: DbRelation, keyColumns: string[]): boolean {
    const keys = new Set(keyColumns.map((c) => c.toLowerCase()));
    return rel.columns.every((c) => {
        const name = c.name.toLowerCase();
        if (keys.has(name)) return true;
        if (INCIDENTAL_COLUMNS.has(name)) return true;
        // A timestamp column under any name is bookkeeping, not payload.
        return /^timestamp/i.test(c.type);
    });
}
