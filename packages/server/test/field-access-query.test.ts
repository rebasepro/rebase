import type { CollectionConfig } from "@rebasepro/types";
import { parseQueryOptions } from "../src/api/rest/query-parser";
import { assertReadableFields, requestViewer } from "../src/api/rest/field-access-query";
import { ApiError } from "../src/api/errors";

/**
 * A field no response can carry must be a field no query can interrogate.
 *
 * The row strip keeps the *value* off the wire. Without this half the value is
 * still readable one predicate at a time: `?salary=gt.100000` returns the rows
 * whose withheld salary is above 100k, and `?orderBy=salary` returns them in
 * order of it. Twenty requests is a binary search.
 *
 * The refusal names the field on purpose — the published OpenAPI lists every
 * property of every collection anyway, so hiding the name protects nothing and
 * answers a genuine typo with "unknown field".
 */

const staff = {
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        salary: { type: "number", access: { read: ["hr"] } },
        passwordHash: { type: "string", columnName: "password_hash", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

const hr = { collection: staff, viewer: { roles: ["hr"] } };
const clerk = { collection: staff, viewer: { roles: ["staff"] } };
const admin = { collection: staff, viewer: { roles: ["admin"] } };

function refusal(fn: () => unknown): ApiError {
    try {
        fn();
    } catch (e) {
        return e as ApiError;
    }
    throw new Error("expected a 400, and the query was accepted");
}

describe("a query naming an unreadable field", () => {
    it("refuses a PostgREST-style filter", () => {
        const error = refusal(() => parseQueryOptions({ salary: "gt.100000" }, {}, clerk));
        expect(error.code).toBe("FIELD_NOT_READABLE");
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("'salary'");
    });

    it("refuses the same field inside `where`", () => {
        expect(refusal(() => parseQueryOptions(
            { where: JSON.stringify({ salary: { gt: 100000 } }) }, {}, clerk
        )).code).toBe("FIELD_NOT_READABLE");
    });

    it("refuses it inside a nested `or` group, however deep", () => {
        expect(refusal(() => parseQueryOptions(
            { or: "name.eq.ada,and(salary.gt.1)" }, {}, clerk
        )).code).toBe("FIELD_NOT_READABLE");
    });

    it("answers the same group for a caller who holds the role", () => {
        expect(() => parseQueryOptions({ or: "name.eq.ada,and(salary.gt.1)" }, {}, hr)).not.toThrow();
    });

    it("refuses an `orderBy`", () => {
        expect(refusal(() => parseQueryOptions({ orderBy: "salary:desc" }, {}, clerk)).code)
            .toBe("FIELD_NOT_READABLE");
    });

    it("refuses a `fields` projection", () => {
        expect(refusal(() => parseQueryOptions({ fields: "id,salary" }, {}, clerk)).code)
            .toBe("FIELD_NOT_READABLE");
    });

    it("refuses an `excludeFromApi` column under either of its spellings", () => {
        expect(refusal(() => parseQueryOptions({ passwordHash: "eq.x" }, {}, admin)).code)
            .toBe("FIELD_NOT_READABLE");
        expect(refusal(() => parseQueryOptions({ password_hash: "eq.x" }, {}, admin)).code)
            .toBe("FIELD_NOT_READABLE");
    });
});

describe("a query the caller may make", () => {
    it("is answered for a caller holding the role", () => {
        const options = parseQueryOptions({ salary: "gt.1", orderBy: "salary" }, {}, hr);
        expect(options.where).toEqual({ salary: [">", "1"] });
        expect(options.orderBy?.[0].field).toBe("salary");
    });

    it("is answered for `admin`, who satisfies any non-empty list", () => {
        expect(() => parseQueryOptions({ salary: "gt.1" }, {}, admin)).not.toThrow();
    });

    it("is answered for anyone on a field with no rule", () => {
        expect(() => parseQueryOptions({ name: "eq.ada", orderBy: "name" }, {}, clerk)).not.toThrow();
    });

    it("is answered when no access context is supplied at all", () => {
        // The parser stays a pure parser for callers that have no collection in
        // hand. Every REST read passes one.
        expect(() => parseQueryOptions({ salary: "gt.1" })).not.toThrow();
    });
});

describe("the foreign key of a withheld to-one relation", () => {
    /**
     * `bandId: 7` names the band exactly as `band: { id: 7 }` does. The row
     * strip withholds both; the query side has to refuse both, or `?bandId=7`
     * answers "which staff sit in band 7" for a caller who may not see a band.
     */
    const bands = {
        slug: "bands",
        table: "bands",
        properties: { id: { type: "number", isId: "increment" } }
    } as unknown as CollectionConfig;
    const banded = {
        ...staff,
        properties: {
            ...staff.properties,
            band: {
                type: "relation",
                access: { read: ["hr"] },
                relation: { kind: "belongsTo", target: () => bands, localKey: "band_id" }
            }
        }
    } as unknown as CollectionConfig;

    it("is refused as a filter, under its wire name and its column name", () => {
        const viewer = { roles: ["staff"] };
        expect(refusal(() => parseQueryOptions({ bandId: "eq.7" }, {}, { collection: banded, viewer })).code)
            .toBe("FIELD_NOT_READABLE");
        expect(refusal(() => parseQueryOptions({ band_id: "eq.7" }, {}, { collection: banded, viewer })).code)
            .toBe("FIELD_NOT_READABLE");
    });

    it("is answered for a caller who may read the relation", () => {
        expect(() => parseQueryOptions({ bandId: "eq.7" }, {}, { collection: banded, viewer: { roles: ["hr"] } }))
            .not.toThrow();
    });
});

describe("sort keys that are not columns", () => {
    /**
     * `comments.count()` is a relation aggregate and `_score` is a search
     * artefact. Neither is a property of this collection, so neither is a field
     * this rule has anything to say about — and treating them as one would
     * refuse every relevance-sorted search.
     */
    it("does not refuse a relation aggregate", () => {
        expect(() => parseQueryOptions({ orderBy: "comments.count():desc" }, {}, clerk)).not.toThrow();
    });

    it("does not refuse a computed search key", () => {
        expect(() => parseQueryOptions({ orderBy: "_score:desc" }, {}, clerk)).not.toThrow();
    });
});

describe("a vector search", () => {
    /**
     * `?vector_search=embedding&vector=[…]` ranks rows by their distance from a
     * vector the caller chose and returns `_distance` with each — which is a
     * reading of the withheld vector: enough probes place it, and
     * `vector_threshold` alone answers "is it within r of this point". So the
     * searched property is a field the query reads, like a sort key.
     */
    const docs = {
        slug: "docs",
        name: "Docs",
        table: "docs",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            embedding: { type: "vector", dimensions: 3 },
            secretEmbedding: { type: "vector", dimensions: 3, columnName: "secret_embedding", access: { read: ["admin"] } },
            internalEmbedding: { type: "vector", dimensions: 3, excludeFromApi: true }
        }
    } as unknown as CollectionConfig;
    const search = (property: string) => ({ vector_search: property, vector: "[1,0,0]", vector_distance: "l2" });

    it("refuses a property the caller cannot read", () => {
        const error = refusal(() => parseQueryOptions(search("secretEmbedding"), {}, { collection: docs, viewer: { roles: ["user"] } }));
        expect(error.code).toBe("FIELD_NOT_READABLE");
        expect(error.message).toContain("'secretEmbedding'");
        expect(error.message).toContain("`vector_search`");
    });

    it("refuses one under its column name too", () => {
        expect(refusal(() => parseQueryOptions(search("secret_embedding"), {}, { collection: docs, viewer: { roles: ["user"] } })).code)
            .toBe("FIELD_NOT_READABLE");
    });

    it("refuses an `excludeFromApi` property, even for admin", () => {
        expect(refusal(() => parseQueryOptions(search("internalEmbedding"), {}, { collection: docs, viewer: { roles: ["admin"] } })).code)
            .toBe("FIELD_NOT_READABLE");
    });

    it("answers a caller who may read it", () => {
        expect(parseQueryOptions(search("secretEmbedding"), {}, { collection: docs, viewer: { roles: ["admin"] } }).vectorSearch?.property)
            .toBe("secretEmbedding");
        expect(() => parseQueryOptions(search("embedding"), {}, { collection: docs, viewer: { roles: ["user"] } })).not.toThrow();
    });
});

describe("a relation an include loads", () => {
    /**
     * An include's own `where`, `logical`, `orderBy` and `fields` read the
     * *target's* columns. `?include={"staff":{"where":{"salary":[">",100000]}}}`
     * answers which departments employ someone earning over 100k — and with
     * `orderBy` and `limit: 1` it names the best paid — while `?salary=gt.100000`
     * on `staff` itself is refused. The rule is the target's, so it is judged
     * against the target, at every level of the tree.
     */
    const withManager = {
        ...staff,
        properties: {
            ...staff.properties,
            manager: {
                type: "relation",
                relation: { kind: "belongsTo", target: () => withManager, localKey: "manager_id" }
            }
        }
    } as unknown as CollectionConfig;
    const departments = {
        slug: "departments",
        name: "Departments",
        table: "departments",
        properties: {
            id: { type: "number", isId: "increment" },
            name: { type: "string" },
            staff: {
                type: "relation",
                relation: { kind: "hasMany", target: () => withManager, foreignKeyOnTarget: "department_id" }
            }
        }
    } as unknown as CollectionConfig;
    const as = (roles: string[]) => ({ collection: departments, viewer: { roles } });
    const include = (spec: unknown) => ({ include: JSON.stringify(spec) });

    it("refuses a filter on a field of the target the caller cannot read", () => {
        const error = refusal(() => parseQueryOptions(
            include({ staff: { where: { salary: [">", 100000] } } }), {}, as(["staff"])
        ));
        expect(error.code).toBe("FIELD_NOT_READABLE");
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("'salary' is not readable on 'staff'");
    });

    it("refuses a logical group over one", () => {
        expect(refusal(() => parseQueryOptions(include({
            staff: { logical: { type: "or", conditions: [
                { column: "name", operator: "==", value: "ada" },
                { type: "and", conditions: [{ column: "salary", operator: ">", value: 1 }] }
            ] } }
        }), {}, as(["staff"]))).code).toBe("FIELD_NOT_READABLE");
    });

    it("refuses an orderBy that ranks the related rows by one", () => {
        expect(refusal(() => parseQueryOptions(
            include({ staff: { orderBy: "salary:desc", limit: 1 } }), {}, as(["staff"])
        )).code).toBe("FIELD_NOT_READABLE");
    });

    it("refuses a fields projection naming one", () => {
        expect(refusal(() => parseQueryOptions(
            include({ staff: { fields: ["name", "passwordHash"] } }), {}, as(["admin"])
        )).code).toBe("FIELD_NOT_READABLE");
    });

    it("checks a nested include against its own target", () => {
        expect(refusal(() => parseQueryOptions(
            include({ staff: { include: { manager: { where: { salary: [">", 1] } } } } }), {}, as(["staff"])
        )).code).toBe("FIELD_NOT_READABLE");
    });

    it("answers the same include for a caller who holds the role", () => {
        expect(() => parseQueryOptions(
            include({ staff: { where: { salary: [">", 1] }, orderBy: "salary:desc", include: { manager: { where: { salary: [">", 1] } } } } }),
            {}, as(["hr"])
        )).not.toThrow();
    });

    it("answers an include that reads nothing withheld", () => {
        expect(() => parseQueryOptions({ include: "staff,staff.manager" }, {}, as(["staff"]))).not.toThrow();
        expect(() => parseQueryOptions(
            include({ staff: { where: { name: ["==", "ada"] }, orderBy: "name", fields: ["name"] } }), {}, as(["staff"])
        )).not.toThrow();
    });

    it("leaves a relation the collection does not have to the driver's own 400", () => {
        expect(() => parseQueryOptions(include({ nope: { where: { salary: [">", 1] } } }), {}, as(["staff"])))
            .not.toThrow();
    });
});

describe("assertReadableFields, which the aggregate route calls directly", () => {
    it("refuses an aggregate over a withheld column", () => {
        const error = refusal(() =>
            assertReadableFields(["salary"], staff, { roles: ["staff"] }, "select"));
        expect(error.code).toBe("FIELD_NOT_READABLE");
        expect(error.message).toContain("`select`");
    });

    it("refuses a groupBy over one — bucketing reads the value a range at a time", () => {
        expect(refusal(() => assertReadableFields(["salary"], staff, { roles: ["staff"] }, "groupBy")).code)
            .toBe("FIELD_NOT_READABLE");
    });

    it("ignores a `count()` with no field", () => {
        expect(() => assertReadableFields([undefined], staff, { roles: ["staff"] }, "select")).not.toThrow();
    });
});

describe("requestViewer", () => {
    /**
     * `undefined` means the trusted server plane, which satisfies every
     * non-empty role list. Returning it for a request that merely has no `user`
     * on the context would hand an unauthenticated caller every field in the
     * database — so the fallback is the list the auth middleware scopes such a
     * request's driver with.
     */
    it("falls back to the anonymous role rather than to no viewer", () => {
        expect(requestViewer({ get: () => undefined } as never)).toEqual({ roles: ["anon"] });
    });

    it("reads the roles off the context's user when there is one", () => {
        const c = { get: (key: string) => (key === "user" ? { roles: ["hr"] } : undefined) };
        expect(requestViewer(c as never)).toEqual({ roles: ["hr"] });
    });
});
