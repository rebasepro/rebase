/**
 * A compiled table carries the definition its descriptor was compiled from.
 *
 * The planner's input is `CompiledTable[]`, and it plans each column from the
 * `ColumnDef` (or `rel.*` definition) on `def` — the thunks, index predicates
 * and SQL defaults a descriptor does not carry. This holds every corpus set
 * to that: every column a descriptor states (but the foreign keys a relation
 * derives) has its builder on `def`, and every relation its `rel.*` result.
 *
 * It also holds the lift to the identity the planner relies on: a relation's
 * target thunk returns the very definition that table was compiled from,
 * every time, so `compileSchema` resolves it to the table in the set.
 *
 * (Before the bridge was deleted, this held the same of the lowered
 * collections: every lowered property carried its definition, and every
 * relation target was the collection that table lowered to.)
 */
import { isColumnBuilder, type AnyTableDef, type AnyViewDef } from "@rebasepro/types";

import { loadPlanCorpus, type PlanCorpus } from "./helpers/plan-corpus";
import { compileSet, liftSet } from "./helpers/plan-tables";

describe("the planner plans a compiled column from its definition", () => {
    let corpus: PlanCorpus;

    beforeAll(async () => {
        corpus = await loadPlanCorpus();
    }, 180_000);

    afterAll(() => corpus?.dispose());

    it("carries the definition of every described column and relation", () => {
        let compared = 0;
        for (const set of corpus.sets) {
            let tables;
            try {
                tables = compileSet(set.collections);
            } catch {
                continue; // a set the lift refuses; plan-golden covers it
            }
            for (const { descriptor, def } of tables) {
                for (const column of descriptor.columns) {
                    if (column.derived) continue;
                    const carries = isColumnBuilder(def.config.columns[column.key]);
                    expect({ set: set.id, table: descriptor.slug, key: column.key, carries })
                        .toEqual({ set: set.id, table: descriptor.slug, key: column.key, carries: true });
                    compared++;
                }
                for (const relation of descriptor.relations) {
                    const carries = def.config.relations?.[relation.name] !== undefined;
                    expect({ set: set.id, table: descriptor.slug, relation: relation.name, carries })
                        .toEqual({ set: set.id, table: descriptor.slug, relation: relation.name, carries: true });
                }
            }
        }
        expect(compared).toBeGreaterThan(1000);
    });

    // Moved from plan-equivalence.test.ts (folded into plan-golden, B-PLAN-2
    // step 5), restated for the definitions the planner now reads.
    it("hands every relation target back as the very definition that table was compiled from", () => {
        for (const set of corpus.sets) {
            let defs: (AnyTableDef | AnyViewDef)[];
            try {
                defs = liftSet(set.collections).defs;
            } catch {
                continue; // a set the lift refuses; plan-golden covers it
            }
            const members = new Set<AnyTableDef | AnyViewDef>(defs);
            for (const def of defs) {
                for (const [name, relation] of Object.entries(def.config.relations ?? {})) {
                    const target = relation.target();
                    expect(relation.target()).toBe(target);
                    if (defs.some(candidate => candidate.name === target.name)) {
                        expect({ set: set.id, from: def.name, relation: name, member: members.has(target) })
                            .toEqual({ set: set.id, from: def.name, relation: name, member: true });
                    }
                }
            }
        }
    });
});
