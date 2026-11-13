/**
 * A lowered column carries the definition it came from.
 *
 * The planner's input is `CompiledTable[]`; until its column planning reads
 * the descriptor (B-PLAN-2 step 3) it lowers the definitions itself and plans
 * each column from the `ColumnDef` (or `rel.*` definition) lowering attaches.
 * This holds every corpus set to that: every lowered property carries one.
 *
 * (It also proved, by stripping the legacy derivation fields from lowered
 * collections, that the planner never read them. With the planner's input no
 * longer a collection, nothing can hand it those fields: that half is true by
 * construction and was retired with the collection input.)
 */
import { lowerTables, type LoweredCollection } from "@rebasepro/common";
import { collectionsToTableDefs } from "@rebasepro/common/migrate";
import type { CollectionConfig, SecurityRule } from "@rebasepro/types";

import { loadPlanCorpus, type PlanCorpus } from "./helpers/plan-corpus";

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
                continue; // a set the bridges adjust first; plan-golden covers it
            }
            for (const collection of collections) {
                for (const [key, property] of Object.entries(collection.properties)) {
                    const carries = property.type === "relation" ? property.tableRelation !== undefined : property.tableColumn !== undefined;
                    expect({ set: set.id, table: collection.slug, key, carries }).toEqual({ set: set.id, table: collection.slug, key, carries: true });
                }
            }
        }
    });

    // Moved from plan-equivalence.test.ts (folded into plan-golden, B-PLAN-2
    // step 5): the lowering hands every relation target back as the very
    // collection that table lowered to, memoised.
    it("hands every relation target back as the very collection that table lowered to", () => {
        for (const set of corpus.sets) {
            let collections: LoweredCollection[];
            try {
                collections = lowered(set.collections);
            } catch {
                continue; // a set the lift adjusts first; plan-golden covers it
            }
            const members = new Set<CollectionConfig>(collections);
            for (const collection of collections) {
                for (const relation of collection.relations ?? []) {
                    const target = relation.target();
                    expect(relation.target()).toBe(target);
                    if (collections.some(c => c.slug === target.slug)) {
                        expect({ set: set.id, from: collection.slug, relation: relation.relationName, member: members.has(target) })
                            .toEqual({ set: set.id, from: collection.slug, relation: relation.relationName, member: true });
                    }
                }
            }
        }
    });
});
