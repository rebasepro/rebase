import { describe, expect, it } from "@jest/globals";
import type { Properties } from "@rebasepro/types";
import { fakeCollection, resolvedManyToMany } from "../helpers/fakes";

const authors = fakeCollection("authors");
const tags = fakeCollection("tags");
const comments = fakeCollection("comments");

import { getSortablePropertyOptions, propertiesToColumns } from "../../src/components/CollectionTableBinding/column_utils";

/**
 * Which columns offer a sort.
 *
 * `sortable` arrived as one flag for the whole table while `filter` was
 * computed per property, so every column advertised a sort — including the ones
 * no `ORDER BY` can be written for. A to-many relation is a *set* per row
 * (`posts.tags`), with no single value to order on.
 *
 * That went unnoticed because the driver answered such a sort by silently
 * dropping the `ORDER BY` and returning rows in whatever order Postgres
 * pleased: the header appeared to work, the rows moved (they were re-fetched),
 * and they were not sorted. The driver refuses now, which turns a header that
 * did nothing into a failed request — so the header has to stop offering it.
 */
function columnsFor(properties: Properties) {
    return propertiesToColumns({ properties, sortable: true });
}

const sortableKeys = (properties: Properties) =>
    columnsFor(properties).filter(c => c.sortable).map(c => c.key).sort();

describe("column sortability follows the property, not the table", () => {
    it("offers a sort on plain scalar columns", () => {
        const properties: Properties = {
            title: { name: "Title", type: "string" },
            views: { name: "Views", type: "number" },
            published: { name: "Published", type: "boolean" }
        };

        expect(sortableKeys(properties)).toEqual(["published", "title", "views"]);
    });

    it("offers a sort on an owning relation — it compiles to a foreign key", () => {
        const properties: Properties = {
            author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authors } }
        };

        expect(sortableKeys(properties)).toEqual(["author"]);
    });

    it("withholds it from a to-many relation, which has no single value per row", () => {
        const properties: Properties = {
            title: { name: "Title", type: "string" },
            tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } },
            comments: { name: "Comments", type: "relation", relation: { kind: "hasMany", target: () => comments, foreignKeyOnTarget: "post_id" } }
        };

        expect(sortableKeys(properties)).toEqual(["title"]);
    });

    it("reads the kind off a resolved relation too", () => {
        const properties: Properties = {
            tags: { name: "Tags", type: "relation", resolvedRelation: resolvedManyToMany("tags", "posts", tags) }
        };

        expect(sortableKeys(properties)).toEqual([]);
    });

    it("gives an unresolved relation the benefit of the doubt", () => {
        // The same choice `isFilterableRelation` makes for a kind it cannot
        // see: withholding the control on incomplete information would hide a
        // sort that works.
        const properties: Properties = {
            author: { name: "Author", type: "relation" }
        };

        expect(sortableKeys(properties)).toEqual(["author"]);
    });

    it("still lets the caller turn sorting off for the whole table", () => {
        const properties: Properties = {
            title: { name: "Title", type: "string" }
        };

        expect(propertiesToColumns({ properties, sortable: false }).every(c => !c.sortable)).toBe(true);
    });
});

/**
 * The toolbar's sort control (list and card views, which have no headers to
 * click) offers the same columns the table does. Two walks over the same
 * properties are two chances to disagree — one offering a sort the other
 * refuses — so they are pinned to each other here.
 */
describe("the toolbar sort options match the table's sortable columns", () => {

    it("offers exactly the keys the table marks sortable", () => {
        const properties: Properties = {
            title: { name: "Title", type: "string" },
            views: { name: "Views", type: "number" },
            author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authors } },
            tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
        };

        expect(getSortablePropertyOptions(properties).map(o => o.key).sort())
            .toEqual(sortableKeys(properties));
    });

    it("spreads a map's children under the same dotted keys the table uses", () => {
        const properties: Properties = {
            address: {
                name: "Address",
                type: "map",
                admin: { spreadChildren: true },
                properties: {
                    city: { name: "City", type: "string" },
                    zip: { name: "Zip", type: "string" }
                }
            }
        };

        expect(getSortablePropertyOptions(properties).map(o => o.key).sort())
            .toEqual(["address.city", "address.zip"]);
    });

    it("labels an option with the property name, falling back to its key", () => {
        const properties: Properties = {
            title: { name: "Title", type: "string" },
            slug: { type: "string" }
        };

        expect(getSortablePropertyOptions(properties).map(o => o.title))
            .toEqual(["Title", "slug"]);
    });
});

/**
 * This walk runs inside the memo that builds the table's columns, so anything
 * it throws takes the header, the rows and the empty state with it — a blank
 * pane with nothing to attribute it to. One column the table cannot describe is
 * one column fewer, not a dead table.
 */
describe("an unresolvable column key does not take the table down", () => {
    it("skips a spread-map child whose root property is missing", () => {
        const properties: Properties = {
            title: { name: "Title", type: "string" },
            // `spreadChildren` emits `data.mode` as a column key; the lookup
            // that resolves it back used to read `.type` off the miss.
            data: {
                name: "Data",
                type: "map",
                admin: { spreadChildren: true },
                properties: {
                    mode: { name: "Mode", type: "string" }
                }
            }
        };

        expect(() => columnsFor(properties)).not.toThrow();
        expect(columnsFor(properties).map(c => c.key)).toEqual(["title", "data.mode"]);
    });

    it("keeps every resolvable column when one cannot be resolved", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const properties: Properties = {
                title: { name: "Title", type: "string" },
                // A map that promises children it does not have: the emitted
                // key has no property behind it.
                broken: {
                    name: "Broken",
                    type: "map",
                    admin: { spreadChildren: true },
                    properties: { ghost: undefined }
                },
                status: { name: "Status", type: "string" }
            };

            const keys = columnsFor(properties).map(c => c.key);
            expect(keys).toContain("title");
            expect(keys).toContain("status");
            expect(keys).not.toContain("broken.ghost");
        } finally {
            warn.mockRestore();
        }
    });
});
