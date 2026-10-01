import type { Check, DbSnapshot, Finding } from "../types";

import {
    callerIdCall,
    DML,
    exposedGrantees,
    finding,
    listAnd,
    qi,
    qrel,
    qrole,
    revokesReaching,
    rowsPhrase,
    scannedForeignTables,
    scannedTables
} from "./util";

const ID = "rls-disabled";

/**
 * A table with RLS off *and* a DML grant to a role an untrusted caller arrives as.
 *
 * The grant half is not a formality. Most databases contain plenty of tables
 * with RLS off that nothing outside the owner can address — migration bookkeeping,
 * lookup tables reachable only by the service role. Flagging those is how a
 * scanner produces forty findings on a healthy database and gets ignored, so a
 * table nobody exposed produces no finding at all.
 *
 * Foreign tables are included, and are always "RLS off": Postgres refuses
 * `ENABLE ROW LEVEL SECURITY` on one, so a grant to an exposed role hands over
 * whatever the remote server returns, and the fix is the grant, not a policy.
 */
export const rlsDisabled: Check = {
    id: ID,
    title: "Table exposed without row-level security",
    description:
        "A table with RLS disabled that also grants SELECT/INSERT/UPDATE/DELETE to a role " +
        "an unauthenticated or untrusted caller can reach.",

    run(snapshot: DbSnapshot): Finding[] {
        const uidCall = callerIdCall(snapshot);
        const findings: Finding[] = [];

        for (const rel of [...scannedTables(snapshot), ...scannedForeignTables(snapshot)]) {
            if (rel.rlsEnabled) continue;
            const foreign = rel.kind === "foreign_table";

            const exposed = exposedGrantees(snapshot, rel.schema, rel.name, DML);
            if (exposed.length === 0) continue;

            const roles = exposed.map((e) => e.role);
            const privileges = [...new Set(exposed.flatMap((e) => e.privileges))].sort();
            const canRead = privileges.includes("SELECT");
            const writes = privileges.filter((p) => p !== "SELECT");

            const reach: string[] = [];
            if (canRead) reach.push(`read every row${rowsPhrase(rel)}`);
            if (writes.length > 0) reach.push(`${listAnd(writes.map((w) => w.toLowerCase()))} any row`);

            findings.push(
                finding({
                    id: ID,
                    severity: "critical",
                    confidence: "certain",
                    title: foreign
                        ? `${rel.schema}.${rel.name} is a foreign table, which cannot have row-level security, ` +
                          `and is granted to ${listAnd(roles)}`
                        : `${rel.schema}.${rel.name} has row-level security disabled and is granted to ${listAnd(roles)}`,
                    target: { schema: rel.schema, table: rel.name },
                    detail:
                        (foreign
                            ? `This is a foreign table. Postgres cannot enable row-level security on one, ` +
                              `so no per-row filter applies to it and every row the remote server returns ` +
                              `is returned. `
                            : `Row-level security is not enabled on this table, so Postgres applies no ` +
                              `per-row filter at all — policies, if any exist, are never consulted. `) +
                        `${listAnd(roles)} ${roles.length > 1 ? "hold" : "holds"} ` +
                        `${listAnd(privileges)} on it.`,
                    impact:
                        `If this table is reachable over an API that connects as ${listAnd(roles)}, ` +
                        `a caller can ${listAnd(reach)}, with no tenant or owner scoping.`,
                    fix: foreign
                        ? foreignTableFix(snapshot, rel.schema, rel.name, roles)
                        : `ALTER TABLE ${qrel(rel.schema, rel.name)} ENABLE ROW LEVEL SECURITY;\n` +
                        `-- Enabling RLS with no policies denies every row to everyone but the owner,\n` +
                        `-- so add the policy you intend in the same migration, for example:\n` +
                        `-- CREATE POLICY ${qi(`${rel.name}_owner_select`)} ON ${qrel(rel.schema, rel.name)}\n` +
                        `--     FOR SELECT TO ${qrole(roles[0])} USING (user_id = ${uidCall});`
                })
            );
        }

        return findings;
    }
};

/** Take a foreign table away from the exposed roles: it cannot have row-level security. */
function foreignTableFix(snapshot: DbSnapshot, schema: string, table: string, exposed: string[]): string {
    return (
        `-- A foreign table cannot have row-level security, so take the grant away:\n` +
        `${revokesReaching(snapshot, schema, table, exposed, DML).join("\n")}\n` +
        `-- and keep it in a schema your API does not expose, reading it through a\n` +
        `-- function that checks the caller.`
    );
}
