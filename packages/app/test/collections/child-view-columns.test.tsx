import React from "react";
import { render } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { CollectionConfig } from "@rebasepro/types";
import { getRedundantChildViewColumnIds, useColumnIds } from "../../src/components/common/useColumnsIds";

/**
 * One relation, one column.
 *
 * Every child view gets a button column that opens its tab. When the relation was
 * declared as a property it already has a column — hydrated by the list fetch's
 * `include: ["*"]`, showing the child rows — and the button carried the *same
 * heading*, because the tab takes its name from the declaring property. Two
 * columns called "Vacantes a las que postuló", one of them a button.
 */
const applications: CollectionConfig = {
    slug: "applications",
    name: "Applications",
    table: "applications",
    properties: { id: { type: "string" }, status: { type: "string" } }
} as unknown as CollectionConfig;

const talents = (relationExtra: Record<string, unknown> = {}, collectionExtra: Record<string, unknown> = {}) =>
    ({
        slug: "talents",
        name: "Talents",
        table: "talents",
        properties: {
            id: { type: "string" },
            name: { type: "string" },
            "talent-applications": {
                name: "Vacantes a las que postuló",
                type: "relation",
                relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" },
                ...relationExtra
            }
        },
        ...collectionExtra
    } as unknown as AdminCollection);

describe("getRedundantChildViewColumnIds", () => {

    it("drops the jump-to-tab column when the relation has a column of its own", () => {
        expect([...getRedundantChildViewColumnIds(talents())])
            .toEqual(["subcollection:talent-applications"]);
    });

    it("keeps it for a relation declared in `relations`, its only presence in the table", () => {
        const collection = {
            slug: "talents_2",
            name: "Talents",
            table: "talents_2",
            properties: { id: { type: "string" } },
            relations: [
                { kind: "hasMany", relationName: "applications", target: () => applications, foreignKeyOnTarget: "talent_id" }
            ]
        } as unknown as AdminCollection;

        expect(getRedundantChildViewColumnIds(collection).size).toBe(0);
    });

    it("keeps it when the author hid the relation's own column", () => {
        // `hideFromCollection` is a statement about the column, not about the
        // relation — hiding both would drop the relation out of the table.
        expect(getRedundantChildViewColumnIds(talents({ admin: { hideFromCollection: true } })).size).toBe(0);
    });

    it("keeps it when propertiesOrder leaves the relation column out", () => {
        const ordered = talents({}, { propertiesOrder: ["id", "name", "subcollection:talent-applications"] });
        expect(getRedundantChildViewColumnIds(ordered).size).toBe(0);
    });

    it("drops it when propertiesOrder keeps both", () => {
        const ordered = talents({}, {
            propertiesOrder: ["id", "name", "talent-applications", "subcollection:talent-applications"]
        });
        expect([...getRedundantChildViewColumnIds(ordered)])
            .toEqual(["subcollection:talent-applications"]);
    });

    it("names the view even when the declaring property is keyed differently", () => {
        // Declared in `relations` under one name, pointed at by a property under
        // another. The column id comes from the view — the tab's own key — while
        // the `hideFromCollection` check has to read the *property*. Building the
        // id from the property key would have addressed a column that does not
        // exist, leaving both the button and the relation's column in place.
        const collection = {
            slug: "talents_3",
            name: "Talents",
            table: "talents_3",
            properties: {
                id: { type: "string" },
                applications_field: {
                    type: "relation",
                    relation: { kind: "hasMany", relationName: "sent_applications", target: () => applications, foreignKeyOnTarget: "talent_id" }
                }
            },
            relations: [
                { kind: "hasMany", relationName: "sent_applications", target: () => applications, foreignKeyOnTarget: "talent_id" }
            ]
        } as unknown as AdminCollection;

        expect([...getRedundantChildViewColumnIds(collection)])
            .toEqual(["subcollection:sent_applications"]);
    });

    it("builds the id from the view key, not from the target's slug", () => {
        // The tab is keyed by the relation, so a relation named differently from
        // its target has a column id nothing else would guess.
        const collection = {
            slug: "talents_4",
            name: "Talents",
            table: "talents_4",
            properties: {
                id: { type: "string" },
                sent: {
                    type: "relation",
                    relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" }
                }
            }
        } as unknown as AdminCollection;

        expect([...getRedundantChildViewColumnIds(collection)]).toEqual(["subcollection:sent"]);
    });

    it("says nothing about a to-one relation, which never had a tab", () => {
        const collection = {
            slug: "applications_2",
            name: "Applications",
            table: "applications_2",
            properties: {
                id: { type: "string" },
                talent: { type: "relation", relation: { kind: "belongsTo", target: () => applications } }
            }
        } as unknown as AdminCollection;

        expect(getRedundantChildViewColumnIds(collection).size).toBe(0);
    });
});

/**
 * The end of the chain: what the collection table is actually handed.
 *
 * `useColumnIds` is the single funnel — both the `propertiesOrder` path and the
 * derived-defaults path go through `hideAndExpandKeys` — so this is where the
 * duplicate either survives or does not.
 */
describe("useColumnIds", () => {
    // The hook only wraps `useMemo` over pure functions, so a probe component is
    // enough; nothing here touches a controller or the transport.
    const columnsOf = (collection: AdminCollection): string[] => {
        const state: { current?: { key: string }[] } = {};
        function Probe() {
            state.current = useColumnIds(collection, true);
            return null;
        }
        render(React.createElement(Probe));
        return state.current!.map(c => c.key);
    };

    it("gives a many-relation one column, not two", () => {
        // Used to be ["id", "name", "talent-applications",
        //             "subcollection:talent-applications"] — the last two under
        // the same heading, "Vacantes a las que postuló".
        expect(columnsOf(talents())).toEqual(["id", "name", "talent-applications"]);
    });

    it("falls back to the tab column when the relation's own column is hidden", () => {
        expect(columnsOf(talents({ admin: { hideFromCollection: true } })))
            .toEqual(["id", "name", "subcollection:talent-applications"]);
    });

    it("drops a stale button column out of a saved propertiesOrder", () => {
        // A column order saved before this change still names both.
        const ordered = talents({}, {
            propertiesOrder: ["name", "subcollection:talent-applications", "talent-applications", "id"]
        });
        expect(columnsOf(ordered)).toEqual(["name", "talent-applications", "id"]);
    });
});
