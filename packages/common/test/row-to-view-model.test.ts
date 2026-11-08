import { EntityRelation } from "@rebasepro/types";
import { rowToViewModel } from "../src/data/buildRebaseData";

/**
 * A flat row, in the view model the admin hands its callbacks and renders —
 * the same `values` an `Entity` of that collection gets from the data layer.
 */
describe("rowToViewModel", () => {
    const authors = { slug: "authors", properties: { id: { type: "number", isId: true }, name: { type: "string" } } };
    const posts = {
        slug: "posts",
        properties: {
            id: { type: "number", isId: true },
            published_at: { type: "date" },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } }
        }
    };
    const resolve = (slug: string) => slug === "posts" ? posts : slug === "authors" ? authors : undefined;

    it("turns a date into a Date and a foreign key into the relation it names", () => {
        const values = rowToViewModel({ id: 1, published_at: "2026-11-08T09:30:00.000Z", author_id: 7 }, "posts", resolve);
        expect(values.published_at).toEqual(new Date("2026-11-08T09:30:00.000Z"));
        expect(values.author).toEqual(new EntityRelation(7, "authors"));
        // The foreign key stays, as it does on an entity's values.
        expect(values.author_id).toBe(7);
    });

    it("leaves the row of a collection it does not know as it is", () => {
        const row = { id: 1, published_at: "2026-11-08T09:30:00.000Z" };
        expect(rowToViewModel(row, "comments", resolve)).toBe(row);
    });
});
