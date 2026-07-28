import { resolveFilterOperators } from "../../src/collections/filter-operator-resolution";
import type { Property } from "@rebasepro/types";

const stringProp = (admin?: Record<string, unknown>): Property => ({
    name: "Name",
    type: "string",
    ...(admin ? { admin } : {})
} as Property);

describe("resolveFilterOperators", () => {

    describe("engine capabilities", () => {
        it("offers the LIKE family for string properties on postgres", () => {
            const ops = resolveFilterOperators({ property: stringProp(), engine: "postgres" });
            expect(ops).toEqual(expect.arrayContaining(["like", "ilike", "not-like", "not-ilike"]));
        });

        it("offers the LIKE family on mongodb (regex-backed)", () => {
            const ops = resolveFilterOperators({ property: stringProp(), engine: "mongodb" });
            expect(ops).toEqual(expect.arrayContaining(["like", "ilike"]));
        });

        it("never offers the LIKE family on firestore", () => {
            const ops = resolveFilterOperators({ property: stringProp(), engine: "firestore" });
            expect(ops).not.toEqual(expect.arrayContaining(["like"]));
            expect(ops).not.toEqual(expect.arrayContaining(["ilike"]));
            expect(ops).not.toEqual(expect.arrayContaining(["not-like"]));
            expect(ops).not.toEqual(expect.arrayContaining(["not-ilike"]));
            // ...but still offers the portable ones
            expect(ops).toEqual(expect.arrayContaining(["==", "!=", "in", "is-null", "is-not-null"]));
        });

        it("defaults to the default engine capabilities when engine is omitted", () => {
            const ops = resolveFilterOperators({ property: stringProp() });
            expect(ops).toEqual(expect.arrayContaining(["==", "ilike", "is-null"]));
        });
    });

    describe("property-type defaults", () => {
        it("booleans get equality and null checks only", () => {
            const ops = resolveFilterOperators({
                property: { name: "Active", type: "boolean" } as Property,
                engine: "postgres"
            });
            expect(ops.sort()).toEqual(["!=", "==", "is-not-null", "is-null"].sort());
        });

        it("numbers get comparisons and membership but no pattern matching", () => {
            const ops = resolveFilterOperators({
                property: { name: "Price", type: "number" } as Property,
                engine: "postgres"
            });
            expect(ops).toEqual(expect.arrayContaining(["==", ">", "<=", "in", "not-in"]));
            expect(ops).not.toEqual(expect.arrayContaining(["ilike"]));
        });

        it("non-filterable types resolve to an empty list", () => {
            const ops = resolveFilterOperators({
                property: { name: "Location", type: "geopoint" } as Property,
                engine: "postgres"
            });
            expect(ops).toEqual([]);
        });

        it("array properties get the array-membership operators", () => {
            const ops = resolveFilterOperators({
                property: stringProp(),
                isArray: true,
                engine: "postgres"
            });
            expect(ops.sort()).toEqual(["array-contains", "array-contains-any"].sort());
        });
    });

    describe("property-level narrowing (admin.filterOperators)", () => {
        it("restricts the offered set", () => {
            const ops = resolveFilterOperators({
                property: stringProp({ filterOperators: ["==", "ilike", "is-null"] }),
                engine: "postgres"
            });
            expect(ops.sort()).toEqual(["==", "ilike", "is-null"].sort());
        });

        it("cannot enable an operator the engine does not support", () => {
            const ops = resolveFilterOperators({
                property: stringProp({ filterOperators: ["==", "ilike"] }),
                engine: "firestore"
            });
            // ilike requested but firestore can't run it → only == survives
            expect(ops).toEqual(["=="]);
        });

        it("cannot enable an operator that makes no sense for the type", () => {
            const ops = resolveFilterOperators({
                property: { name: "Active", type: "boolean", admin: { filterOperators: ["ilike", "=="] } } as Property,
                engine: "postgres"
            });
            expect(ops).toEqual(["=="]);
        });

        it("an empty list disables filtering entirely", () => {
            const ops = resolveFilterOperators({
                property: stringProp({ filterOperators: [] }),
                engine: "postgres"
            });
            expect(ops).toEqual([]);
        });
    });

    describe("relation kinds", () => {

        // `belongsTo` is a column comparison — the foreign key is on this row.
        // `manyToMany`, `hasMany` and `hasOne` are correlated `EXISTS`
        // subqueries over the table that does hold the link. `via` is a join
        // path with no stated inverse, so the query layer still has nothing to
        // compile and a filter keyed on one resolves to nothing —
        // historically returning every row, now a 400.
        const relationProp = (relation?: Record<string, unknown>): Property => ({
            name: "Tags",
            type: "relation",
            ...(relation ? { relation } : {})
        } as Property);

        it("offers operators for a belongsTo relation", () => {
            const ops = resolveFilterOperators({
                property: relationProp({ kind: "belongsTo", target: () => ({}) }),
                engine: "postgres"
            });
            expect(ops).toEqual(expect.arrayContaining(["==", "!=", "in"]));
        });

        it.each(["manyToMany", "hasMany", "hasOne"])(
            "offers the membership operators for a %s relation", (kind) => {
                const ops = resolveFilterOperators({
                    property: relationProp({ kind, target: () => ({}) }),
                    engine: "postgres"
                });
                expect(ops.sort()).toEqual(["!=", "==", "in", "is-not-null", "is-null", "not-in"]);
            }
        );

        it("offers only what the driver can compile — never an ordering operator", () => {
            // The `EXISTS` shape answers membership. `>` on a relation is
            // rejected by the driver, so the UI must not put it on screen.
            const ops = resolveFilterOperators({
                property: relationProp({ kind: "manyToMany", target: () => ({}) }),
                engine: "postgres"
            });
            expect(ops).not.toEqual(expect.arrayContaining([">", "<", "ilike"]));
        });

        it("offers nothing for a via relation", () => {
            const ops = resolveFilterOperators({
                property: relationProp({ kind: "via", target: () => ({}) }),
                engine: "postgres"
            });
            expect(ops).toEqual([]);
        });

        it("reads the kind off a stamped resolvedRelation when there is no inline block", () => {
            expect(resolveFilterOperators({
                property: {
                    name: "Tags",
                    type: "relation",
                    resolvedRelation: { kind: "manyToMany" }
                } as unknown as Property,
                engine: "postgres"
            })).toEqual(expect.arrayContaining(["==", "!="]));

            expect(resolveFilterOperators({
                property: {
                    name: "Co-authors",
                    type: "relation",
                    resolvedRelation: { kind: "via" }
                } as unknown as Property,
                engine: "postgres"
            })).toEqual([]);
        });

        it("stays filterable when the kind cannot be determined at all", () => {
            const ops = resolveFilterOperators({
                property: relationProp(),
                engine: "postgres"
            });
            expect(ops).toEqual(expect.arrayContaining(["==", "!="]));
        });

        it("leaves reference properties (Firestore) alone", () => {
            const ops = resolveFilterOperators({
                property: { name: "Author", type: "reference", path: "authors" } as Property,
                engine: "firestore"
            });
            expect(ops).toEqual(expect.arrayContaining(["==", "!="]));
        });
    });
});
