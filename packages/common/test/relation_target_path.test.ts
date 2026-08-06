import { getRelationTargetPath } from "../src/util/relations";
import { normalizeToEntityRelation } from "../src/util/entities";
import type { PostgresCollectionConfig, RelationProperty } from "@rebasepro/types";

const companies = {
    name: "Companies",
    slug: "companies",
    table: "companies",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" }
    }
} as unknown as PostgresCollectionConfig;

describe("getRelationTargetPath", () => {
    it("reads the stamped resolvedRelation first", () => {
        const property = {
            name: "Company",
            type: "relation",
            resolvedRelation: { targetSlug: "companies" }
        } as unknown as RelationProperty;
        expect(getRelationTargetPath(property)).toBe("companies");
    });

    it("falls back to the inline relation's target", () => {
        const property: RelationProperty = {
            name: "Company",
            type: "relation",
            relation: { kind: "belongsTo", target: () => companies }
        };
        expect(getRelationTargetPath(property)).toBe("companies");
    });

    // The third declaration form — a relation named in the collection's
    // `relations` array — carries no target on the property, and a preview has
    // no collection to look it up in. Undefined, not a throw.
    it("returns undefined when the property declares no target", () => {
        const property = { name: "Company",
type: "relation" } as RelationProperty;
        expect(getRelationTargetPath(property)).toBeUndefined();
    });

    /**
     * The shape that produced a red "Unexpected value" box per row: a relation
     * property keyed by the foreign key column itself, so the scalar the REST
     * layer returns lands directly on the property. This is how the preview
     * composes the two helpers — the property names the target, the value names
     * the row.
     */
    it("resolves a bare foreign key the way the preview composes it", () => {
        const property: RelationProperty = {
            name: "Company",
            type: "relation",
            relation: { kind: "belongsTo", target: () => companies, localKey: "company_id" }
        };
        const wireValue = "91093fb9-0046-4839-a84e-8f0f4dd0d0a1";

        const relation = normalizeToEntityRelation(wireValue, "relation", getRelationTargetPath(property));

        expect(relation).not.toBeNull();
        expect(relation!.path).toBe("companies");
        expect(relation!.id).toBe(wireValue);
    });

    it("returns undefined rather than throwing when the target thunk throws", () => {
        const property: RelationProperty = {
            name: "Company",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => { throw new Error("module not initialised"); }
            }
        };
        expect(getRelationTargetPath(property)).toBeUndefined();
    });
});
