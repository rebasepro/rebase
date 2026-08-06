import type { AdminCollection } from "@rebasepro/admin-types";
import type { CollectionConfig } from "@rebasepro/types";
import { getFormFieldKeys } from "../../src/components/common/useColumnsIds";
import { resolveFormLayout } from "../../src/collections/form-layout";

/**
 * The form's field list, and what a many-relation is doing in it.
 *
 * A `hasMany` becomes an entity tab, which is the whole treatment for a list of
 * child rows. It was *also* a member of `properties` — the only place a relation
 * can be declared — so the form rendered it a second time as a relation picker:
 * a dropdown offering to select a collection's own children, one card per child
 * row. One declaration, two surfaces, and the second one unusable.
 */
const applications: CollectionConfig = {
    slug: "applications",
    name: "Applications",
    table: "applications",
    properties: { id: { type: "string" }, status: { type: "string" } }
} as unknown as CollectionConfig;

const talents = (relationAdmin: Record<string, unknown> = {}) =>
    ({
        slug: "talents",
        name: "Talents",
        table: "talents",
        properties: {
            id: { type: "string", isId: "uuid" },
            name: { type: "string" },
            "talent-applications": {
                name: "Vacantes a las que postuló",
                type: "relation",
                relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" },
                ...(Object.keys(relationAdmin).length ? { admin: relationAdmin } : {})
            }
        }
    } as unknown as AdminCollection);

describe("getFormFieldKeys", () => {

    it("drops a many-relation the entity view already lists as a tab", () => {
        expect(getFormFieldKeys(talents())).toEqual(["id", "name"]);
    });

    it("renders the picker anyway when the author opts in", () => {
        expect(getFormFieldKeys(talents({ renderInForm: true })))
            .toEqual(["id", "name", "talent-applications"]);
    });

    it("keeps a to-one relation, which is a foreign key the author edits", () => {
        const collection = {
            slug: "applications_2",
            name: "Applications",
            table: "applications_2",
            properties: {
                id: { type: "string" },
                talent: { type: "relation", relation: { kind: "belongsTo", target: () => applications } }
            }
        } as unknown as AdminCollection;

        expect(getFormFieldKeys(collection)).toEqual(["id", "talent"]);
    });

    it("drops it from an explicit propertiesOrder too", () => {
        const ordered = {
            ...talents(),
            propertiesOrder: ["name", "talent-applications", "id"]
        } as unknown as AdminCollection;

        expect(getFormFieldKeys(ordered)).toEqual(["name", "id"]);
    });

    it("keeps additional fields, which have no property behind them", () => {
        const withExtra = {
            ...talents(),
            additionalFields: [{ key: "computed", name: "Computed" }]
        } as unknown as AdminCollection;

        expect(getFormFieldKeys(withExtra)).toEqual(["id", "name", "computed"]);
    });

    it("does not reach the form layout either", () => {
        // The end of the chain: no field, so no section built around one.
        const collection = talents();
        const layout = resolveFormLayout({
            collection,
            fieldKeys: getFormFieldKeys(collection),
            status: "existing"
        });

        expect(layout.sections.flatMap(s => s.fields.map(f => f.key))).toEqual(["name"]);
    });
});
