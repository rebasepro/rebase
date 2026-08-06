import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { getChildViewDeclaringProperties, getChildViewRelationPropertyKeys, getEntityChildViews } from "../src/util";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * A many-relation is declared once and surfaced once.
 *
 * `properties` is the only place a relation can be declared, and
 * `getEntityChildViews` promotes every many-relation to a tab — so the same
 * declaration was also still a member of the form's property list, and every
 * `hasMany` in every project rendered a second time as a relation picker. This
 * is the set that tells a form which of its properties the entity view has
 * already taken.
 */
describe("getChildViewRelationPropertyKeys", () => {

    const applications: CollectionConfig = {
        slug: "applications",
        name: "Applications",
        table: "applications",
        properties: { id: { type: "string" }, status: { type: "string" } }
    } as unknown as CollectionConfig;

    const collection = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}): CollectionConfig => ({
        slug: "talents",
        name: "Talents",
        table: "talents",
        properties,
        ...extra
    } as unknown as CollectionConfig);

    it("claims the property key an inline hasMany was declared under", () => {
        const talents = collection({
            id: { type: "string" },
            "talent-applications": {
                name: "Applications",
                type: "relation",
                relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" }
            }
        });
        const registry = new CollectionRegistry([talents, applications]);
        const resolved = registry.get("talents")!;

        // Same relation, both answers: one tab, and the property key it came from.
        expect(getEntityChildViews(resolved).map(v => v.key)).toEqual(["talent-applications"]);
        expect([...getChildViewRelationPropertyKeys(resolved)]).toEqual(["talent-applications"]);
    });

    it("leaves a to-one relation alone — a foreign key is an input, not a tab", () => {
        const talents = collection({
            id: { type: "string" },
            primary_application: {
                type: "relation",
                relation: { kind: "belongsTo", target: () => applications }
            }
        });
        const registry = new CollectionRegistry([talents, applications]);
        const resolved = registry.get("talents")!;

        expect(getEntityChildViews(resolved)).toEqual([]);
        expect(getChildViewRelationPropertyKeys(resolved).size).toBe(0);
    });

    it("pairs the tab with the property, in both directions", () => {
        // The table needs the view key (to name the button column it drops) and
        // the property key (to check whether that property yields a column at
        // all), so the answer has to be a pairing rather than either set alone.
        const talents = collection({
            id: { type: "string" },
            "talent-applications": {
                type: "relation",
                relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" }
            }
        });
        const registry = new CollectionRegistry([talents, applications]);

        expect([...getChildViewDeclaringProperties(registry.get("talents")!)])
            .toEqual([["talent-applications", "talent-applications"]]);
    });

    it("matches on the relation name, not the property key", () => {
        // The relation is declared in `relations` under one name and pointed at
        // by a property under another. The tab is keyed by the relation; the form
        // addresses the property. Comparing keys would have missed it.
        const talents = collection({
            id: { type: "string" },
            applications_field: { type: "relation", relation: { kind: "hasMany", relationName: "sent_applications", target: () => applications, foreignKeyOnTarget: "talent_id" } }
        }, {
            relations: [
                { kind: "hasMany", relationName: "sent_applications", target: () => applications, foreignKeyOnTarget: "talent_id" }
            ]
        });
        const registry = new CollectionRegistry([talents, applications]);
        const resolved = registry.get("talents")!;

        expect(getEntityChildViews(resolved).map(v => v.key)).toEqual(["sent_applications"]);
        expect([...getChildViewRelationPropertyKeys(resolved)]).toEqual(["applications_field"]);
        expect([...getChildViewDeclaringProperties(resolved)])
            .toEqual([["sent_applications", "applications_field"]]);
    });

    it("keeps a relation nested in a map, which gets no tab of its own", () => {
        const talents = collection({
            id: { type: "string" },
            metadata: {
                type: "map",
                properties: {
                    related: {
                        type: "relation",
                        relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" }
                    }
                }
            }
        });
        const registry = new CollectionRegistry([talents, applications]);
        const resolved = registry.get("talents")!;

        // No tab, so the picker is the only surface the relation has.
        expect(getEntityChildViews(resolved)).toEqual([]);
        expect(getChildViewRelationPropertyKeys(resolved).size).toBe(0);
    });

    it("claims nothing on an engine without relations", () => {
        const docs: CollectionConfig = {
            slug: "docs", name: "Docs", engine: "firestore",
            properties: {
                id: { type: "string" },
                related: { type: "relation", relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "doc_id" } }
            }
        } as unknown as CollectionConfig;

        expect(getChildViewRelationPropertyKeys(docs).size).toBe(0);
    });

    it("works on a collection that was never normalized", () => {
        // A config read straight from a module, before the registry stamps
        // `resolvedRelation` onto each property.
        const talents = collection({
            id: { type: "string" },
            "talent-applications": {
                type: "relation",
                relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" }
            }
        });

        expect([...getChildViewRelationPropertyKeys(talents)]).toEqual(["talent-applications"]);
    });
});
