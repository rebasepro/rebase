/**
 * A lowered column is planned from its definition, not from the legacy
 * property beside it.
 *
 * `plan-equivalence.test.ts` proves the bridges exact: every corpus set,
 * lifted into tables and lowered again, renders what the goldens recorded.
 * This proves *which path* rendered it. Every lowered property carries the
 * `ColumnDef` (or `rel.*` definition) it came from, and here the legacy fields
 * the planner used to derive a column from — `columnType`, `isId`,
 * `validation`, `defaultValue`, `databaseDefault`, `autoValue`, `precision`,
 * `scale`, `enum` — are stripped from every property that carries one. The
 * plan does not move by a byte: nothing in the planner read them.
 */
import { collectionsToTableDefs, lowerTables, type LoweredCollection } from "@rebasepro/common";
import type { CollectionConfig, SecurityRule } from "@rebasepro/types";

import { loadPlanCorpus, renderAllOutputs, type PlanCorpus } from "./helpers/plan-corpus";

/** The legacy fields a column's type, key, nullability and default were derived from. */
const DERIVATION_FIELDS = ["columnType", "isId", "validation", "defaultValue", "databaseDefault", "autoValue", "precision", "scale", "enum"] as const;

/**
 * The outputs the column planning alone decides. The policies are left out:
 * the rule compiler (`compileRulePolicies`) still reads a column's legacy
 * type to cast a claim, and moves onto descriptors with the rest of the policy
 * path. So are the search and vector files, whose column specs read the
 * legacy property too.
 */
const PLANNED_OUTPUTS = ["schema.sql", "schema.generated.no-policies.ts"];

/** `plan.json` without the policies (see {@link PLANNED_OUTPUTS}). */
function planWithoutPolicies(planJson: string | undefined): unknown {
    if (planJson === undefined || planJson.startsWith("THROWS")) return planJson;
    const plan: { tables?: { policies?: unknown }[] } = JSON.parse(planJson);
    for (const table of plan.tables ?? []) delete table.policies;
    return plan;
}

function sharedDefaultRules(collections: readonly CollectionConfig[]): readonly SecurityRule[] | undefined {
    if (collections.some(collection => !collection.securityRules?.length)) return undefined;
    const counts = new Map<readonly SecurityRule[], number>();
    for (const collection of collections) {
        const rules = collection.securityRules;
        if (rules && rules.length > 0) counts.set(rules, (counts.get(rules) ?? 0) + 1);
    }
    for (const [rules, count] of counts) if (count > 1) return rules;
    return undefined;
}

function lowered(collections: readonly CollectionConfig[]): LoweredCollection[] {
    const defaultSecurityRules = sharedDefaultRules(collections);
    const { tables, defaultRls } = collectionsToTableDefs(collections, defaultSecurityRules ? { defaultSecurityRules } : {});
    return lowerTables(tables, defaultRls ? { defaultRls } : {});
}

/** Every derivation field off every property that carries its column's definition. */
function stripDerivations(collections: LoweredCollection[]): number {
    let stripped = 0;
    for (const collection of collections) {
        for (const property of Object.values(collection.properties)) {
            if (!property.tableColumn || property.type === "relation") continue;
            for (const field of DERIVATION_FIELDS) Reflect.deleteProperty(property, field);
            stripped++;
        }
    }
    return stripped;
}

describe("the planner plans a lowered column from its definition", () => {
    let corpus: PlanCorpus;

    beforeAll(async () => {
        corpus = await loadPlanCorpus();
    }, 180_000);

    afterAll(() => corpus?.dispose());

    it("attaches the definition to every lowered property", () => {
        for (const set of corpus.sets) {
            let collections: LoweredCollection[];
            try {
                collections = lowered(set.collections);
            } catch {
                continue; // a set the bridges adjust first; plan-equivalence covers it
            }
            for (const collection of collections) {
                for (const [key, property] of Object.entries(collection.properties)) {
                    const carries = property.type === "relation" ? property.tableRelation !== undefined : property.tableColumn !== undefined;
                    expect({ set: set.id, table: collection.slug, key, carries }).toEqual({ set: set.id, table: collection.slug, key, carries: true });
                }
            }
        }
    });

    it("renders the same plan with every legacy derivation field stripped", () => {
        let checked = 0;
        for (const set of corpus.sets) {
            let before: Record<string, string>;
            try {
                before = renderAllOutputs(lowered(set.collections), set.options);
            } catch {
                continue;
            }
            const collections = lowered(set.collections);
            if (stripDerivations(collections) === 0) continue;
            const after = renderAllOutputs(collections, set.options);
            expect({ set: set.id, plan: planWithoutPolicies(after["plan.json"]) })
                .toEqual({ set: set.id, plan: planWithoutPolicies(before["plan.json"]) });
            for (const output of PLANNED_OUTPUTS) {
                expect(before[output]).toEqual(expect.any(String));
                expect({ set: set.id, output, same: after[output] === before[output] })
                    .toEqual({ set: set.id, output, same: true });
            }
            checked++;
        }
        expect(checked).toBeGreaterThan(5);
    });
});
