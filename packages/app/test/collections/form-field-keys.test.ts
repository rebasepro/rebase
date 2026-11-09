import type { AdminCollection } from "@rebasepro/cms-types";
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
};

const talents = (relationAdmin: Record<string, unknown> = {}): AdminCollection =>
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
    });

describe("getFormFieldKeys", () => {

    it("drops a many-relation the entity view already lists as a tab", () => {
        expect(getFormFieldKeys(talents())).toEqual(["id", "name"]);
    });

    it("renders the picker anyway when the author opts in", () => {
        expect(getFormFieldKeys(talents({ renderInForm: true })))
            .toEqual(["id", "name", "talent-applications"]);
    });

    it("keeps a to-one relation, which is a foreign key the author edits", () => {
        const collection: AdminCollection = {
            slug: "applications_2",
            name: "Applications",
            table: "applications_2",
            properties: {
                id: { type: "string" },
                talent: { type: "relation", relation: { kind: "belongsTo", target: () => applications } }
            }
        };

        expect(getFormFieldKeys(collection)).toEqual(["id", "talent"]);
    });

    it("drops it from an explicit propertiesOrder too", () => {
        const ordered: AdminCollection = {
            ...talents(),
            propertiesOrder: ["name", "talent-applications", "id"]
        };

        expect(getFormFieldKeys(ordered)).toEqual(["name", "id"]);
    });

    it("keeps additional fields, which have no property behind them", () => {
        const withExtra: AdminCollection = {
            ...talents(),
            additionalFields: [{ key: "computed", name: "Computed" }]
        };

        expect(getFormFieldKeys(withExtra)).toEqual(["id", "name", "computed"]);
    });

    it("keeps a many-relation whose tab is hidden, which is then its only surface", () => {
        // A post's tags: a manyToMany to a collection marked
        // `hideFromEntityViews`, so the record draws no tab for them, and
        // dropping the picker too left them editable nowhere.
        const tags: CollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: { id: { type: "string" }, name: { type: "string" } },
            admin: { hideFromEntityViews: true }
        };
        const posts: AdminCollection = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {
                id: { type: "string", isId: "uuid" },
                title: { type: "string" },
                tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
            }
        };

        expect(getFormFieldKeys(posts)).toEqual(["id", "title", "tags"]);
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
