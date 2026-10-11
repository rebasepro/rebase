import type { Check, DbRelation, DbSnapshot, Finding } from "../types";

import { callerIdCall, finding, ownerColumnOf, policiesFor, qi, qrel, scannedTables } from "./util";

const ID = "rls-enabled-no-policies";

/**
 * RLS on, zero policies — deny-all for everyone except the table's owner.
 *
 * This is not a hole, it is a *correctness* bug, and an invisible one: the API
 * returns `[]` and an empty table is indistinguishable from a filtered one. It
 * is worth a finding precisely because nothing else reports it — a database in
 * this state passes every "is RLS enabled?" audit while serving nothing.
 */
export const rlsEnabledNoPolicies: Check = {
    id: ID,
    title: "RLS enabled with no policies (denies everything)",
    description: "A table with row-level security enabled but not a single policy defined.",

    run(snapshot: DbSnapshot): Finding[] {
        const uidCall = callerIdCall(snapshot);
        const findings: Finding[] = [];

        for (const rel of scannedTables(snapshot)) {
            if (!rel.rlsEnabled) continue;
            if (policiesFor(snapshot, rel.schema, rel.name).length > 0) continue;

            const ownerNote = rel.rlsForced
                ? "FORCE ROW LEVEL SECURITY is also set, so even the owner sees nothing."
                : `The owner (${rel.owner}) still reads and writes the table normally, because ` +
                  `FORCE ROW LEVEL SECURITY is not set — which is why this often looks fine from ` +
                  `psql and returns nothing through the application.`;

            findings.push(
                finding({
                    id: ID,
                    severity: "medium",
                    confidence: "certain",
                    title: `${rel.schema}.${rel.name} has row-level security enabled but no policies`,
                    target: { schema: rel.schema, table: rel.name },
                    detail:
                        `With RLS enabled and no policy defined, Postgres denies every row to every ` +
                        `role. ${ownerNote}`,
                    impact:
                        `Reads of this table return zero rows and writes are rejected for every ` +
                        `non-owner role. No data is exposed; data is silently missing instead, and ` +
                        `an empty result is indistinguishable from a correctly filtered one.`,
                    fix: definePolicyFix(rel, uidCall) +
                        `-- or, if this table is genuinely meant to be unreadable, drop the grants\n` +
                        `-- instead of relying on an empty policy set:\n` +
                        `-- REVOKE ALL ON ${qrel(rel.schema, rel.name)} FROM PUBLIC;`
                })
            );
        }

        return findings;
    }
};

/**
 * The policy to suggest. It used to name `user_id` on every table, and a table
 * without one rejected the pasted fix (`column "user_id" does not exist`). A
 * column that looks like the owner is used; otherwise the template stays a
 * comment, with the column to fill in.
 */
function definePolicyFix(rel: DbRelation, uidCall: string): string {
    const owner = ownerColumnOf(rel);
    const create = (column: string) =>
        `CREATE POLICY ${qi(`${rel.name}_select`)} ON ${qrel(rel.schema, rel.name)}\n` +
        `    FOR SELECT TO authenticated USING (${column} = ${uidCall});\n`;
    if (owner) return `-- Either define the policy you intended:\n` + create(qi(owner));
    return `-- Either define the policy you intended, naming the column that holds the row's owner:\n` +
        create("<owner_column>").split("\n").map((line) => (line ? `-- ${line}` : line)).join("\n");
}
