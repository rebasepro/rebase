import { resolveFilterOperators } from "@rebasepro/app";
import type { Property } from "@rebasepro/types";
import { renderableRelationOperators } from "../../src/components/SelectableTable/filters/RelationFilterField";

/**
 * The two halves of a relation filter have to agree.
 *
 * `resolveFilterOperators` decides whether the table header offers a filter
 * control at all; `RelationFilterField` decides what that control renders. When
 * the first says yes and the second comes up empty, the field returns null and
 * the user clicks a filter icon that opens onto nothing — which is what
 * happened the moment the to-many kinds became filterable, because the field
 * still offered only the array operators for them.
 *
 * Neither side's own tests can see that: each is individually correct. The
 * intersection is the thing, so it is what these pin.
 */

const relationProp = (kind: string): Property => ({
    name: "Tags",
    type: "relation",
    relation: { kind, target: () => ({}) }
} as unknown as Property);

/** What the field would put on screen for a property, end to end. */
const rendered = (kind: string, isArray = false) => renderableRelationOperators(
    { kind },
    resolveFilterOperators({ property: relationProp(kind), isArray, engine: "postgres" })
);

describe("relation filter operators, header to field", () => {

    describe("the driver compiles it, so the field renders something", () => {

        it.each(["manyToMany", "hasMany"])(
            "offers membership operators for a to-many %s relation", (kind) => {
                // Not `==`: the selector takes its multiplicity from the
                // relation, so on a to-many it only ever emits a list.
                expect(rendered(kind)).toEqual(["in", "not-in"]);
            }
        );

        it.each(["belongsTo", "hasOne"])(
            "offers equality and membership for a to-one %s relation", (kind) => {
                expect(rendered(kind)).toEqual(["==", "!=", "in", "not-in"]);
            }
        );

        it("never renders an operator the driver rejects on a relation", () => {
            // The `EXISTS` shape answers membership only; the driver 400s on
            // an ordering or pattern operator rather than dropping it.
            for (const kind of ["belongsTo", "hasOne", "hasMany", "manyToMany"]) {
                expect(rendered(kind)).not.toEqual(
                    expect.arrayContaining([">", "<", ">=", "<=", "array-contains", "array-contains-any"])
                );
            }
        });
    });

    describe("the driver cannot compile it, so nothing is offered at all", () => {

        it("offers no filter control for a via relation", () => {
            expect(resolveFilterOperators({ property: relationProp("via"), engine: "postgres" })).toEqual([]);
            expect(rendered("via")).toEqual([]);
        });
    });

    describe("an array *of* relations is a different property", () => {

        it("keeps the array operators, which the column really does hold", () => {
            // Narrowing the to-many list to the list-valued operators must not
            // cost this case the array operators it had before.
            expect(rendered("manyToMany", true)).toEqual(["array-contains", "array-contains-any"]);
        });
    });

    describe("with no narrowing supplied", () => {

        it("falls back to everything the field can render", () => {
            expect(renderableRelationOperators({ kind: "manyToMany" })).toEqual(
                ["array-contains", "array-contains-any", "in", "not-in"]
            );
            expect(renderableRelationOperators({ kind: "belongsTo" })).toEqual(
                ["==", "!=", ">", "<", ">=", "<=", "in", "not-in"]
            );
        });
    });
});
