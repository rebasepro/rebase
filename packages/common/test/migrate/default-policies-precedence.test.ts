import { afterEach, describe, expect, it } from "@jest/globals";
import { database, resetDeclaredResources, type SecurityRule } from "@rebasepro/types";

import { collectionsToTableDefs, type LegacyCollectionConfig } from "../../src/migrate";
import { compileTables } from "../../src/schema/compile-tables";
import { printTableModule } from "../../src/schema/print-table";
import { tableEffectiveRules } from "../../src/util/auth-default-policies";
import { compileTableRulePolicies } from "../../src/util/policy/compileRulePolicies";
import { policyTableFromDescriptor, type PolicyTable } from "../../src/util/policy/policy-table";

/**
 * On 0.30 a collection's own `disableDefaultPolicies` decided before its
 * database's `rls.defaultPolicies` (`defaultPoliciesDisabled` in
 * `@rebasepro/common` at v0.30.1: "its own `disableDefaultPolicies` when it
 * says, otherwise the database's"). So under
 * `database({ rls: { defaultPolicies: false } })` a collection that wrote
 * `disableDefaultPolicies: false` kept the injected admin baseline. The lift
 * once dropped that `false` as "redundant", and the migrated table followed
 * the database's opt-out instead: its admin policies were gone after the
 * migration. Every combination must generate the policies 0.30 generated.
 */

const rules: SecurityRule[] = [{ operation: "select", access: "public" }];

function collection(slug: string, disableDefaultPolicies: boolean | undefined): LegacyCollectionConfig {
    return {
        name: slug, slug, table: slug,
        properties: { id: { name: "ID", type: "number", isId: "increment" }, title: { name: "Title", type: "string" } },
        securityRules: rules,
        ...(disableDefaultPolicies !== undefined ? { disableDefaultPolicies } : {})
    };
}

/** Every policy a table gets, as SQL: what `db push` writes. */
function policies(table: PolicyTable): string[] {
    return tableEffectiveRules(table).flatMap(rule => compileTableRulePolicies(table, rule)).map(policy => JSON.stringify(policy)).sort();
}

/** The policy table 0.30 compiled a collection with: the descriptor's columns, the collection's own say over the baseline. */
function asOn030(lifted: PolicyTable, disableDefaultPolicies: boolean | undefined): PolicyTable {
    const { defaultPolicies: _ignored, ...rest } = lifted;
    void _ignored;
    return disableDefaultPolicies === undefined ? rest : { ...rest, defaultPolicies: !disableDefaultPolicies };
}

describe("a collection's disableDefaultPolicies over its database's rls.defaultPolicies", () => {
    afterEach(() => resetDeclaredResources());

    const cases: { database: boolean | undefined; collection: boolean | undefined; baseline: boolean }[] = [
        { database: false, collection: false, baseline: true },
        { database: false, collection: undefined, baseline: false },
        { database: false, collection: true, baseline: false },
        { database: true, collection: true, baseline: false },
        { database: undefined, collection: true, baseline: false },
        { database: undefined, collection: false, baseline: true },
        { database: undefined, collection: undefined, baseline: true }
    ];

    for (const { database: databaseDefault, collection: own, baseline } of cases) {
        it(`database ${String(databaseDefault)}, collection disableDefaultPolicies ${String(own)}: ${baseline ? "keeps" : "drops"} the baseline, as 0.30 did`, () => {
            if (databaseDefault !== undefined) database({ rls: { defaultPolicies: databaseDefault } });
            const legacy = collection("posts", own);
            const { tables } = collectionsToTableDefs([legacy]);
            const [descriptor] = compileTables(tables);
            const lifted = policyTableFromDescriptor(descriptor);
            expect(policies(lifted)).toEqual(policies(asOn030(lifted, own)));
            expect(tableEffectiveRules(lifted).some(rule => rule.name?.endsWith("_default_admin_read"))).toBe(baseline);
        });
    }

    it("writes the explicit opt-in into the migrated table, and nothing for an unset or redundant one", () => {
        const { tables } = collectionsToTableDefs([collection("kept", false), collection("plain", undefined), collection("off", true)]);
        const [kept, plain, off] = tables.map(table => printTableModule(table));
        expect(kept).toContain("defaultPolicies: true");
        expect(plain).not.toContain("defaultPolicies");
        expect(off).toContain("defaultPolicies: false");
    });

    it("keeps the opt-in through the descriptor and back", () => {
        const { tables } = collectionsToTableDefs([collection("kept", false)]);
        const [descriptor] = compileTables(tables);
        expect(descriptor.rls).toMatchObject({ defaultPolicies: true, declaredDefaultPolicies: true });
        expect(policyTableFromDescriptor(descriptor).defaultPolicies).toBe(true);
    });
});
