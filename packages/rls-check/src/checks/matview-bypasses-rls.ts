import type { Check, DbSnapshot, Finding } from "../types";

import { exposedGrantees, finding, listAnd, qrel, qrole, relationAt } from "./util";
import { protectedBaseTables } from "./view-bypasses-rls";

const ID = "matview-bypasses-rls";

/**
 * A materialized view over an RLS-protected table, readable by an untrusted role.
 *
 * Materialized views cannot have row-level security at all — `ALTER MATERIALIZED
 * VIEW ... ENABLE ROW LEVEL SECURITY` is not valid syntax, and `security_invoker`
 * does not apply either. The contents are a snapshot taken by the owner at
 * refresh time, so there is no policy anywhere that can filter a read of it. The
 * only controls are the grant and what the defining query selects.
 */
export const matviewBypassesRls: Check = {
    id: ID,
    title: "Materialized view exposes RLS-protected data",
    description:
        "A materialized view granted to an untrusted role whose defining query reads a table " +
        "with row-level security enabled.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const view of snapshot.views) {
            if (!snapshot.schemas.includes(view.schema)) continue;

            const rel = relationAt(snapshot, view.schema, view.name);
            if (rel?.kind !== "materialized_view") continue;

            const bases = protectedBaseTables(snapshot, view);
            if (bases.length === 0) continue;

            const exposed = exposedGrantees(snapshot, view.schema, view.name, ["SELECT"]);
            if (exposed.length === 0) continue;

            const roles = exposed.map((e) => e.role);

            findings.push(
                finding({
                    id: ID,
                    severity: "high",
                    confidence: "certain",
                    title:
                        `Materialized view ${view.schema}.${view.name} snapshots ${listAnd(bases)} ` +
                        `and is readable by ${listAnd(roles)}`,
                    target: { schema: view.schema, view: view.name, table: view.name },
                    detail:
                        `This materialized view reads ${listAnd(bases)}, which ` +
                        `${bases.length > 1 ? "have" : "has"} row-level security enabled. Materialized ` +
                        `views cannot have policies of their own, and \`security_invoker\` does not apply ` +
                        `to them — the rows were computed once, by ${view.owner}, and are stored ` +
                        `unfiltered. Every caller with SELECT reads the same stored rows.`,
                    impact:
                        `If this materialized view is reachable over an API as ${listAnd(roles)}, a caller ` +
                        `reads a full copy of the protected data in ${listAnd(bases)} as of the last ` +
                        `REFRESH. No policy can restrict this; only the grant can.`,
                    fix:
                        `-- There is no RLS for materialized views. Restrict the grant:\n` +
                        `REVOKE SELECT ON ${qrel(view.schema, view.name)} FROM ${qrole(roles[0])};\n` +
                        `-- and, if callers need this data, expose it through a view that applies the\n` +
                        `-- caller's own privileges:\n` +
                        `-- CREATE VIEW ${qrel(view.schema, `${view.name}_scoped`)} WITH (security_invoker = true)\n` +
                        `--     AS SELECT * FROM ${bases[0].split(".").map((p) => `"${p}"`).join(".")} WHERE ...;`
                })
            );
        }

        return findings;
    }
};
