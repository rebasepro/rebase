import {
    createRelationRef,
    createRelationRefWithData,
    resolveCollectionRelations
} from "../src/util";
import { EntityCollection, Property } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// createRelationRef
// ─────────────────────────────────────────────────────────────
describe("createRelationRef", () => {
    it("produces a canonical relation object with __type 'relation'", () => {
        const ref = createRelationRef("abc123", "users");
        expect(ref).toEqual({
            id: "abc123",
            path: "users",
            __type: "relation"
        });
    });

    it("accepts numeric IDs", () => {
        const ref = createRelationRef(42, "products");
        expect(ref.id).toBe(42);
        expect(ref.__type).toBe("relation");
    });

    it("is structurally identical to a hand-written literal", () => {
        const factory = createRelationRef("x", "y");
        const manual = { id: "x", path: "y", __type: "relation" as const };
        expect(factory).toEqual(manual);
    });
});

// ─────────────────────────────────────────────────────────────
// createRelationRefWithData
// ─────────────────────────────────────────────────────────────
describe("createRelationRefWithData", () => {
    const entity = {
        id: "e1",
        path: "orders",
        values: { total: 100 }
    };

    it("includes data alongside the canonical fields", () => {
        const ref = createRelationRefWithData("e1", "orders", entity as any);
        expect(ref.__type).toBe("relation");
        expect(ref.id).toBe("e1");
        expect(ref.path).toBe("orders");
        expect(ref.data).toBe(entity);
    });

    it("is structurally identical to a hand-written literal with data", () => {
        const factory = createRelationRefWithData("e1", "orders", entity as any);
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
    const collection: EntityCollection = {
        name: "Test",
        slug: "test",
        path: "test",
        properties: {
            title: { type: "string", name: "Title" } as Property
        },
        collectionType: "postgres",
        tableName: "test"
    } as unknown as EntityCollection;

    it("returns the same reference for the same collection object", () => {
        const result1 = resolveCollectionRelations(collection);
        const result2 = resolveCollectionRelations(collection);
        expect(result1).toBe(result2); // Reference equality, not just deep equality
    });

    it("returns different references for structurally identical but distinct objects", () => {
        const clone = { ...collection };
        const result1 = resolveCollectionRelations(collection);
        const result2 = resolveCollectionRelations(clone as EntityCollection);
        // Different object identities → different cache entries (WeakMap is identity-based)
        expect(result1).not.toBe(result2);
        // But they should be deeply equal
        expect(result1).toEqual(result2);
    });
});
