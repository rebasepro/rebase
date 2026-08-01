import { describe, expect, it } from "@jest/globals";
import type { Properties } from "@rebasepro/types";

import { propertiesToColumns } from "../../src/components/CollectionTableBinding/column_utils";

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
        const properties = {
            title: { name: "Title", type: "string" },
            views: { name: "Views", type: "number" },
            published: { name: "Published", type: "boolean" }
        } as unknown as Properties;

        expect(sortableKeys(properties)).toEqual(["published", "title", "views"]);
    });

    it("offers a sort on an owning relation — it compiles to a foreign key", () => {
        const properties = {
            author: { name: "Author", type: "relation", relation: { kind: "belongsTo" } }
        } as unknown as Properties;

        expect(sortableKeys(properties)).toEqual(["author"]);
    });

    it("withholds it from a to-many relation, which has no single value per row", () => {
        const properties = {
            title: { name: "Title", type: "string" },
            tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany" } },
            comments: { name: "Comments", type: "relation", relation: { kind: "hasMany" } }
        } as unknown as Properties;

        expect(sortableKeys(properties)).toEqual(["title"]);
    });

    it("reads the kind off a resolved relation too", () => {
        const properties = {
            tags: { name: "Tags", type: "relation", resolvedRelation: { kind: "manyToMany" } }
        } as unknown as Properties;

        expect(sortableKeys(properties)).toEqual([]);
    });

    it("gives an unresolved relation the benefit of the doubt", () => {
        // The same choice `isFilterableRelation` makes for a kind it cannot
        // see: withholding the control on incomplete information would hide a
        // sort that works.
        const properties = {
            author: { name: "Author", type: "relation" }
        } as unknown as Properties;

        expect(sortableKeys(properties)).toEqual(["author"]);
    });

    it("still lets the caller turn sorting off for the whole table", () => {
        const properties = {
            title: { name: "Title", type: "string" }
        } as unknown as Properties;

        expect(propertiesToColumns({ properties, sortable: false }).every(c => !c.sortable)).toBe(true);
    });
});
