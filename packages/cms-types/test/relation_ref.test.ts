import { createRelationRef } from "@rebasepro/cms-types";

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
        const manual = { id: "x",
path: "y",
__type: "relation" as const };
        expect(factory).toEqual(manual);
    });
});
