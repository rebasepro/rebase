import { createRelationRefWithData } from "@rebasepro/common";
import type { Entity } from "@rebasepro/types";
import { resolveCollectionRelations } from "../src/util/collection_relations";
import type { CollectionConfig } from "../src/types/collections";

// ─────────────────────────────────────────────────────────────
// createRelationRefWithData
// ─────────────────────────────────────────────────────────────
describe("createRelationRefWithData", () => {
    const entity: Entity = {
        id: "e1",
        path: "orders",
        values: { total: 100 }
    };

    it("includes data alongside the canonical fields", () => {
        const ref = createRelationRefWithData("e1", "orders", entity);
        expect(ref.__type).toBe("relation");
        expect(ref.id).toBe("e1");
        expect(ref.path).toBe("orders");
        expect(ref.data).toBe(entity);
    });

    it("is structurally identical to a hand-written literal with data", () => {
        const factory = createRelationRefWithData("e1", "orders", entity);
        const manual = {
            id: "e1",
            path: "orders",
            __type: "relation" as const,
            data: entity
        };
        expect(factory).toEqual(manual);
    });
});

// ─────────────────────────────────────────────────────────────
// resolveCollectionRelations — memoization
// ─────────────────────────────────────────────────────────────
describe("resolveCollectionRelations memoization", () => {
    const collection: CollectionConfig = {
        name: "Test",
        slug: "test",
        table: "test",
        properties: {
            title: { type: "string",
name: "Title" }
        }
    };

    it("returns the same reference for the same collection object", () => {
        const result1 = resolveCollectionRelations(collection);
        const result2 = resolveCollectionRelations(collection);
        expect(result1).toBe(result2); // Reference equality, not just deep equality
    });

    it("returns different references for structurally identical but distinct objects", () => {
        const clone = { ...collection };
        const result1 = resolveCollectionRelations(collection);
        const result2 = resolveCollectionRelations(clone);
        // Different object identities → different cache entries (WeakMap is identity-based)
        expect(result1).not.toBe(result2);
        // But they should be deeply equal
        expect(result1).toEqual(result2);
    });
});
