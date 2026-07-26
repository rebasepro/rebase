import type { Check, DbSnapshot, Finding } from "../types";

import { DML, finding, isPublicRole, listAnd, qrel, relationAt, rowsPhrase } from "./util";

const ID = "grant-to-public";

/**
 * A DML privilege granted to PUBLIC.
 *
 * PUBLIC is every role in the cluster, present and future, including ones added
 * after the grant was written. Even with RLS enabled this is rarely intentional:
 * it widens the set of roles whose policies are evaluated, and any role that
 * later gets a permissive policy inherits table access it was never explicitly
 * given. When RLS is off it is simply open access — `rls-disabled` reports that
 * separately and with more force.
 */
export const grantToPublic: Check = {
    id: ID,
    title: "Table privileges granted to PUBLIC",
    description: "A SELECT/INSERT/UPDATE/DELETE privilege granted to PUBLIC on a table.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const grant of snapshot.grants) {
            if (!isPublicRole(grant.grantee)) continue;
            if (!snapshot.schemas.includes(grant.schema)) continue;

            const rel = relationAt(snapshot, grant.schema, grant.table);
            if (!rel || (rel.kind !== "table" && rel.kind !== "partitioned_table")) continue;

            const privileges = DML.filter((p) => grant.privileges.includes(p));
            if (privileges.length === 0) continue;

            findings.push(
                finding({
                    id: ID,
                    severity: "medium",
                    confidence: "certain",
                    title: `${grant.schema}.${grant.table} grants ${listAnd(privileges)} to PUBLIC`,
                    target: { schema: grant.schema, table: grant.table },
                    detail:
                        `PUBLIC is every role in this cluster, including roles created after this grant ` +
                        `was made. ` +
                        (rel.rlsEnabled
                            ? `Row-level security is enabled on the table, so rows are still filtered by ` +
                              `policy — but this grant decides *whose* policies get evaluated, and it ` +
                              `answers "everyone's". A permissive policy added later for any role applies ` +
                              `immediately, with no separate grant needed.`
                            : `Row-level security is not enabled on this table, so nothing filters the rows ` +
                              `this grant exposes.`),
                    impact: rel.rlsEnabled
                        ? `Every role in the database can attempt ${listAnd(privileges)} on this table` +
                          `${rowsPhrase(rel)}; what they get back depends entirely on the policies, ` +
                          `including any added in future.`
                        : `Every role in the database, including any role an API connects as, can ` +
                          `${listAnd(privileges.map((p) => p.toLowerCase()))} every row of this table` +
                          `${rowsPhrase(rel)}.`,
                    fix:
                        `REVOKE ${privileges.join(", ")} ON ${qrel(grant.schema, grant.table)} FROM PUBLIC;\n` +
                        `-- then grant explicitly to the roles that need it:\n` +
                        `-- GRANT ${privileges.join(", ")} ON ${qrel(grant.schema, grant.table)} TO "your_app_role";`
                })
            );
        }

        return findings;
    }
};
