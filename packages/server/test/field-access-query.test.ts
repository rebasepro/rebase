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
