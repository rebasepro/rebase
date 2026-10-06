/**
 * The planner's cost grows with the number of collections, not its square.
 *
 * `planSchema` runs at every boot (the table ensure, the policies step) and
 * several times per `db push` / `db generate`. Pairing Drizzle relations
 * scanned every other collection's relations once per collection, and
 * resolved a collection by slug with a linear search: 24 ms at 200
 * collections, 204 ms at 1,000 — five times the collections, 8.5 times the
 * time. Counted here rather than timed, so the test cannot flake: how many
 * times the planner asks a relation for its target.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";

/** `n` collections, each with a hasMany to the next (the foreign key on the target's table). */
function chain(n: number): { collections: CollectionConfig[]; targetCalls: () => number } {
    let calls = 0;
    const cols: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
        const props: Record<string, unknown> = {
            id: { type: "string", isId: "uuid" },
            title: { type: "string" },
            parent_id: { type: "string" }
        };
        if (i + 1 < n) {
            const next = i + 1;
            props.children = {
                type: "relation",
                relation: {
                    kind: "hasMany",
                    relationName: "children",
                    foreignKeyOnTarget: "parent_id",
                    target: () => { calls++; return cols[next]; }
                }
            };
        }
        cols.push({ name: `C${i}`, slug: `c${i}`, table: `c${i}`, properties: props });
    }
    return { collections: cols as unknown as CollectionConfig[], targetCalls: () => calls };
}

const targetCallsFor = (n: number): number => {
    const { collections, targetCalls } = chain(n);
    const before = targetCalls();
    planSchema(collections);
    return targetCalls() - before;
};

describe("planSchema", () => {
    it("asks each relation for its target a number of times linear in the collections", () => {
        const small = targetCallsFor(100);
        const large = targetCallsFor(400);
        // Four times the collections: about four times the calls. The scan
        // this replaced made it sixteen.
        expect(large / small).toBeLessThan(6);
    });
});
