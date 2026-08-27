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

        it.each(["manyToMany", "hasMany", "belongsTo", "hasOne"])(
            "offers the same questions of a %s relation, whatever its cardinality", (kind) => {
                // `==` included for a to-many: the value selector is sized by
                // the operator, so asking "has this one tag" is available and
                // is not a one-element `in` in disguise.
                expect(rendered(kind)).toEqual(["==", "!=", "in", "not-in", "is-null", "is-not-null"]);
            }
        );

        it("defaults a to-many relation to `==`, not to a list operator", () => {
            // The first offered operator is what the field opens on. It used
            // to be `in`, because `==` could not be rendered at all.
            expect(rendered("manyToMany")[0]).toBe("==");
        });

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

    describe("the engine decides, not this UI", () => {

        // The admin is one interface over every engine. "A many-to-many
        // compiles to an EXISTS over the junction" is a fact about the
        // Postgres driver, so it is the driver's descriptor that says so.

        it("offers nothing on a document store, which has no relations", () => {
            for (const engine of ["firestore", "mongodb"]) {
                for (const kind of ["belongsTo", "manyToMany", "hasMany", "hasOne"]) {
                    expect(resolveFilterOperators({
                        property: relationProp(kind), engine
                    })).toEqual([]);
                }
            }
        });

        it("gives an unknown engine only the kind that needs no subquery", () => {
            // A driver that has not claimed the subquery kinds may answer one
            // by dropping the condition, which returns every row.
            expect(resolveFilterOperators({ property: relationProp("belongsTo"), engine: "acme-db" }))
                .toEqual(expect.arrayContaining(["==", "!="]));
            for (const kind of ["manyToMany", "hasMany", "hasOne"]) {
                expect(resolveFilterOperators({ property: relationProp(kind), engine: "acme-db" }))
                    .toEqual([]);
            }
        });
    });

    describe("an array *of* relations is a different property", () => {

        it("offers the array operators for an array of to-many relations", () => {
            // These are what `resolveFilterOperators` returns for any array
            // property. Offering them is only correct because the driver
            // answers them on a to-many relation — `array-contains` is `==`
            // and `array-contains-any` is `in` over the same `EXISTS`. It
            // used to reject both, which is a 400 behind a rendered control.
            expect(rendered("manyToMany", true)).toEqual(["array-contains", "array-contains-any"]);
        });

        it("offers nothing for an array of to-one relations", () => {
            // Pre-existing and untouched: the field renders a single-value
            // selector for a to-one relation, so it has no array operator to
            // pair with, and `FilterFieldBinding` renders null. The table
            // header still offers the control — a gap that predates this work
            // and belongs with `filterableProperty`, not here.
            expect(rendered("belongsTo", true)).toEqual([]);
        });
    });

    describe("with no narrowing supplied", () => {

        it("falls back to everything the field can render", () => {
            const scalar = ["==", "!=", ">", "<", ">=", "<=", "in", "not-in", "is-null", "is-not-null"];
            // A to-many link is a list, so it also answers the array operators.
            expect(renderableRelationOperators({ kind: "manyToMany" }))
                .toEqual([...scalar, "array-contains", "array-contains-any"]);
            expect(renderableRelationOperators({ kind: "belongsTo" })).toEqual(scalar);
        });
    });
});
