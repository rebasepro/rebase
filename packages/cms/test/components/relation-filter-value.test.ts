import { describe, expect, it } from "@jest/globals";
import { EntityRelation } from "@rebasepro/types";
import { toRelationFilterValue } from "../../src/components/SelectableTable/filters/FilterFieldBinding";

/**
 * A saved `defaultFilter` has been through JSON, so its relations come back as
 * plain objects. The filter field used to accept only `EntityRelation`
 * instances and showed such a filter as empty while it still narrowed the rows.
 */
describe("toRelationFilterValue", () => {

    it("keeps an EntityRelation", () => {
        const relation = new EntityRelation(5, "authors");
        expect(toRelationFilterValue(relation)).toBe(relation);
    });

    it("revives a relation that went through JSON", () => {
        const saved = JSON.parse(JSON.stringify(new EntityRelation(5, "authors")));
        const value = toRelationFilterValue(saved);
        expect(value).toBeInstanceOf(EntityRelation);
        expect(value).toMatchObject({ id: 5, path: "authors" });
    });

    it("revives every relation of a list", () => {
        const saved = JSON.parse(JSON.stringify([new EntityRelation(1, "tags"), new EntityRelation(2, "tags")]));
        const value = toRelationFilterValue(saved);
        expect(Array.isArray(value) && value.every(v => v instanceof EntityRelation)).toBe(true);
        expect(value).toMatchObject([{ id: 1, path: "tags" }, { id: 2, path: "tags" }]);
    });

    it("refuses what is not a relation, and keeps null", () => {
        expect(toRelationFilterValue("five")).toBeUndefined();
        expect(toRelationFilterValue([new EntityRelation(1, "tags"), 7])).toBeUndefined();
        expect(toRelationFilterValue(null)).toBeNull();
    });
});
