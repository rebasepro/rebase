/**
 * The checks are linear in the size of the catalog.
 *
 * They looked up a table's grants, its relation and its policies by walking the
 * whole snapshot, once per table per exposed role — and the sort did the same
 * lookup inside its comparator. At 20,000 tables and 60,000 grants a scan took
 * 81 s, all of it in JavaScript after a 0.4 s introspection, and the statement
 * timeout hint the CLI prints on a slow scan did not apply. This holds a
 * synthetic catalog of that size to a budget several times what the indexed
 * lookups take (about a second) and a fraction of what the quadratic ones did
 * (34 s on the same machine).
 */
import { describe, expect, it } from "vitest";

import { foreignKey, grant, policy, snapshot, table } from "../../test/fixtures/snapshot";
import type { DbForeignKey, DbGrant, DbPolicy, DbRelation } from "../types";
import { runChecks } from "./index";

const TABLES = 20_000;

function bigCatalog() {
    const relations: DbRelation[] = [];
    const grants: DbGrant[] = [];
    const policies: DbPolicy[] = [];
    const foreignKeys: DbForeignKey[] = [];

    for (let i = 0; i < TABLES; i++) {
        const name = `t_${i}`;
        // Half with RLS off and granted to anon: 10,000 findings to sort.
        const rlsEnabled = i % 2 === 0;
        relations.push(
            table("public", name, {
                rlsEnabled,
                columns: ["id", "user_id", "org_id"],
                estimatedRows: i
            })
        );
        grants.push(
            grant("public", name, "anon", ["SELECT"]),
            grant("public", name, "authenticated", ["SELECT", "INSERT", "UPDATE", "DELETE"]),
            grant("public", name, "service_role", ["SELECT", "INSERT", "UPDATE", "DELETE"])
        );
        if (rlsEnabled) {
            policies.push(
                policy("public", name, `${name}_own`, {
                    roles: ["authenticated"],
                    using: "(user_id = auth.uid())"
                })
            );
        }
        if (i > 0) foreignKeys.push(foreignKey("public", name, ["org_id"], "public", `t_${i - 1}`));
    }

    return snapshot({ relations, grants, policies, foreignKeys });
}

describe("checks at catalog scale", () => {
    it("scans 20,000 tables and 60,000 grants inside the budget", { timeout: 300_000 }, () => {
        const catalog = bigCatalog();

        const started = performance.now();
        const findings = runChecks(catalog);
        const elapsed = performance.now() - started;

        expect(findings.filter((f) => f.id === "rls-disabled")).toHaveLength(TABLES / 2);
        expect(elapsed, `runChecks took ${Math.round(elapsed)} ms`).toBeLessThan(10_000);
    });
});
