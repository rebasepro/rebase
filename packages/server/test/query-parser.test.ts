import { mapOperator, parseQueryOptions, DEFAULT_LIST_LIMIT, DEFAULT_VECTOR_LIST_LIMIT, MAX_LIST_LIMIT } from "../src/api/rest/query-parser";
import { deserializeFilter } from "@rebasepro/common";

// ─────────────────────────────────────────────────────────────
// mapOperator
// ─────────────────────────────────────────────────────────────
describe("mapOperator", () => {
    it("maps PostgREST operators to Rebase operators", () => {
        expect(mapOperator("eq")).toBe("==");
        expect(mapOperator("neq")).toBe("!=");
        expect(mapOperator("gt")).toBe(">");
        expect(mapOperator("gte")).toBe(">=");
        expect(mapOperator("lt")).toBe("<");
        expect(mapOperator("lte")).toBe("<=");
        expect(mapOperator("in")).toBe("in");
        expect(mapOperator("nin")).toBe("not-in");
        expect(mapOperator("cs")).toBe("array-contains");
        expect(mapOperator("csa")).toBe("array-contains-any");
        // LIKE family + null checks (added with the filter-operators feature)
        expect(mapOperator("like")).toBe("like");
        expect(mapOperator("ilike")).toBe("ilike");
        expect(mapOperator("nlike")).toBe("not-like");
        expect(mapOperator("nilike")).toBe("not-ilike");
        expect(mapOperator("isnull")).toBe("is-null");
        expect(mapOperator("notnull")).toBe("is-not-null");
    });

    it("returns null for unknown operators", () => {
        expect(mapOperator("between")).toBeNull();
        expect(mapOperator("xyz")).toBeNull();
        expect(mapOperator("")).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Pagination
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — pagination", () => {
    it("parses limit", () => {
        const result = parseQueryOptions({ limit: "25" });
        expect(result.limit).toBe(25);
    });

    it("parses offset", () => {
        const result = parseQueryOptions({ offset: "50" });
        expect(result.offset).toBe(50);
    });

    it("calculates offset from page number", () => {
        const result = parseQueryOptions({ page: "3",
limit: "10" });
        expect(result.offset).toBe(20); // (3-1) * 10
    });

    it("uses the default limit for page calculation when limit not set", () => {
        const result = parseQueryOptions({ page: "2" });
        expect(result.offset).toBe(DEFAULT_LIST_LIMIT); // (2-1) * DEFAULT_LIST_LIMIT
        // The returned page size must match the offset stride so pages neither
        // overlap nor gap.
        expect(result.limit).toBe(DEFAULT_LIST_LIMIT);
    });

    it("injects the default limit when none is provided (no unbounded reads)", () => {
        const result = parseQueryOptions({});
        expect(result.limit).toBe(DEFAULT_LIST_LIMIT);
        expect(result.offset).toBeUndefined();
    });

    it("clamps an over-large limit to the hard maximum", () => {
        // The core DoS fix: `?limit=100000000` must never be honoured verbatim.
        const result = parseQueryOptions({ limit: "100000000" });
        expect(result.limit).toBe(MAX_LIST_LIMIT);
    });

    it("honours a limit at or below the maximum unchanged", () => {
        expect(parseQueryOptions({ limit: "50" }).limit).toBe(50);
        expect(parseQueryOptions({ limit: String(MAX_LIST_LIMIT) }).limit).toBe(MAX_LIST_LIMIT);
    });

    it("clamps zero and negative limits up to 1 (never an unlimited bypass)", () => {
        expect(parseQueryOptions({ limit: "0" }).limit).toBe(1);
        expect(parseQueryOptions({ limit: "-5" }).limit).toBe(1);
    });

    it("falls back to the default when the limit is non-numeric", () => {
        expect(parseQueryOptions({ limit: "abc" }).limit).toBe(DEFAULT_LIST_LIMIT);
        expect(parseQueryOptions({ limit: "" }).limit).toBe(DEFAULT_LIST_LIMIT);
    });

    it("respects caller-supplied default and max bounds", () => {
        expect(parseQueryOptions({}, { defaultLimit: 25 }).limit).toBe(25);
        expect(parseQueryOptions({ limit: "9999" }, { maxLimit: 200 }).limit).toBe(200);
    });

    it("defaults a vector search to the vector page size, not the list default", () => {
        // A vector search must resolve to its own smaller default (10), never
        // the plain-read default (50).
        const result = parseQueryOptions({
            vector_search: "embedding",
            vector: "[0.1,0.2,0.3]"
        });
        expect(result.limit).toBe(DEFAULT_VECTOR_LIST_LIMIT);
        expect(result.limit).not.toBe(DEFAULT_LIST_LIMIT);
        expect(result.vectorSearch).toBeDefined();
    });

    it("still clamps an explicit over-large limit on a vector search", () => {
        const result = parseQueryOptions({
            vector_search: "embedding",
            vector: "[0.1,0.2,0.3]",
            limit: "100000000"
        });
        expect(result.limit).toBe(MAX_LIST_LIMIT);
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — PostgREST Filters
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — PostgREST filters", () => {
    it("parses equality filter (implicit eq)", () => {
        const result = parseQueryOptions({ status: "published" });
        expect(result.where?.status).toEqual(["==", "published"]);
    });

    it("parses eq operator explicitly", () => {
        const result = parseQueryOptions({ status: "eq.published" });
        expect(result.where?.status).toEqual(["==", "published"]);
    });

    // NOTE: wire values are preserved as strings. Type coercion is delegated
    // to the schema-aware driver / PostgreSQL parameter binding, which casts
    // by column type. This is the canonical filter-dialect contract, shared
    // byte-for-byte with the SDK/admin path — and it fixes bugs where JS-side
    // coercion corrupted values (e.g. a "07306" zip code becoming 7306).
    it("preserves gt value as a string (driver coerces)", () => {
        const result = parseQueryOptions({ age: "gt.18" });
        expect(result.where?.age).toEqual([">", "18"]);
    });

    it("parses gte operator", () => {
        const result = parseQueryOptions({ price: "gte.9.99" });
        expect(result.where?.price).toEqual([">=", "9.99"]);
    });

    it("parses lt operator", () => {
        const result = parseQueryOptions({ count: "lt.100" });
        expect(result.where?.count).toEqual(["<", "100"]);
    });

    it("parses lte operator", () => {
        const result = parseQueryOptions({ rating: "lte.5" });
        expect(result.where?.rating).toEqual(["<=", "5"]);
    });

    it("parses neq operator", () => {
        const result = parseQueryOptions({ status: "neq.draft" });
        expect(result.where?.status).toEqual(["!=", "draft"]);
    });

    it("preserves boolean literal as a string (driver coerces)", () => {
        const result = parseQueryOptions({ active: "true" });
        expect(result.where?.active).toEqual(["==", "true"]);
    });

    it("preserves numeric-looking string without coercion", () => {
        const result = parseQueryOptions({ zip: "07306" });
        expect(result.where?.zip).toEqual(["==", "07306"]);
    });

    it("expresses IS NULL via the explicit is-null operator", () => {
        const result = parseQueryOptions({ deleted_at: "isnull.null" });
        expect(result.where?.deleted_at).toEqual(["is-null", null]);
    });

    it("treats a literal `null` value as the string 'null' (use isnull for SQL NULL)", () => {
        const result = parseQueryOptions({ deleted_at: "null" });
        expect(result.where?.deleted_at).toEqual(["==", "null"]);
    });

    it("parses numeric strings as strings", () => {
        const result = parseQueryOptions({ quantity: "42" });
        expect(result.where?.quantity).toEqual(["==", "42"]);
    });

    it("parses in operator with array", () => {
        const result = parseQueryOptions({ role: "in.(admin,editor,viewer)" });
        expect(result.where?.role).toEqual(["in", ["admin", "editor", "viewer"]]);
    });

    it("parses in operator with numeric array (values stay strings)", () => {
        const result = parseQueryOptions({ priority: "in.(1,2,3)" });
        expect(result.where?.priority).toEqual(["in", ["1", "2", "3"]]);
    });

    it("produces identical output to the SDK/admin deserializeFilter path", () => {
        // Same wire input, both code paths — this is the whole point of the
        // convergence: the REST parser must not diverge from the shared dialect.
        const wire = { status: "eq.active", age: "gte.18", zip: "07306" };
        const viaParser = parseQueryOptions(wire).where;
        const viaDialect = deserializeFilter(wire);
        expect(viaParser).toEqual(viaDialect);
    });

    it("parses array-contains operator", () => {
        const result = parseQueryOptions({ tags: "cs.javascript" });
        expect(result.where?.tags).toEqual(["array-contains", "javascript"]);
    });

    it("skips reserved query keys", () => {
        const result = parseQueryOptions({
            limit: "10",
            offset: "0",
            orderBy: "name:asc",
            status: "eq.active"
        });
        // Only status should be in where
        expect(result.where?.status).toEqual(["==", "active"]);
        expect(result.where?.limit).toBeUndefined();
        expect(result.where?.offset).toBeUndefined();
        expect(result.where?.orderBy).toBeUndefined();
    });

    it("handles string values with dots that are not operators (fallback to eq)", () => {
        const result = parseQueryOptions({ email: "user@example.com" });
        // "user@example" is not a valid operator, so fallback to eq
        expect(result.where?.email).toBeDefined();
    });

    it("removes empty where object", () => {
        const result = parseQueryOptions({ limit: "10" });
        expect(result.where).toBeUndefined();
    });
});


// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Sorting
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — sorting", () => {
    it("parses JSON orderBy", () => {
        const orderBy = JSON.stringify([{ field: "name",
direction: "asc" }]);
        const result = parseQueryOptions({ orderBy });
        expect(result.orderBy).toEqual([{ field: "name",
direction: "asc" }]);
    });

    it("parses simple field:direction format", () => {
        const result = parseQueryOptions({ orderBy: "created_at:desc" });
        expect(result.orderBy).toEqual([{ field: "created_at",
direction: "desc" }]);
    });

    it("defaults direction to asc", () => {
        const result = parseQueryOptions({ orderBy: "name" });
        expect(result.orderBy).toEqual([{ field: "name",
direction: "asc" }]);
    });

    it("handles no orderBy", () => {
        const result = parseQueryOptions({});
        expect(result.orderBy).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Relation includes
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — includes", () => {
    it("parses wildcard include", () => {
        const result = parseQueryOptions({ include: "*" });
        expect(result.include).toEqual(["*"]);
    });

    it("parses comma-separated includes", () => {
        const result = parseQueryOptions({ include: "author,tags,category" });
        expect(result.include).toEqual(["author", "tags", "category"]);
    });

    it("trims whitespace in includes", () => {
        const result = parseQueryOptions({ include: " author , tags " });
        expect(result.include).toEqual(["author", "tags"]);
    });

    it("handles no include", () => {
        const result = parseQueryOptions({});
        expect(result.include).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Field selection
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — fields", () => {
    it("parses comma-separated fields", () => {
        const result = parseQueryOptions({ fields: "id,name,email" });
        expect(result.fields).toEqual(["id", "name", "email"]);
    });

    it("trims whitespace", () => {
        const result = parseQueryOptions({ fields: " id , name " });
        expect(result.fields).toEqual(["id", "name"]);
    });

    it("handles no fields", () => {
        const result = parseQueryOptions({});
        expect(result.fields).toBeUndefined();
    });
});
