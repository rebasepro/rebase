import { describe, expect, it } from "@jest/globals";

import { findCollectionConfigProblems } from "../src/collections/validate-config";

/**
 * A per-field `access` block that means nothing, caught at boot.
 *
 * Every shape below boots clean without this check, serves rows, and is wrong in
 * a direction nobody can see from the outside: the field is either open to
 * everyone when its author thought it was closed, or closed to everyone
 * including the author. A config that contradicts itself has to say which half
 * it meant.
 */

const collection = (salary: unknown, extra: Record<string, unknown> = {}) => ({
    name: "Staff",
    singularName: "Member",
    slug: "staff",
    table: "staff",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", ...(salary as object) }
    },
    ...extra
});

const errors = (config: unknown) =>
    findCollectionConfigProblems([config], {}).filter(p => p.severity === "error");

const problems = (config: unknown) => findCollectionConfigProblems([config], {});

describe("a well-formed access block", () => {
    it("accepts a role list", () => {
        expect(errors(collection({ access: { read: ["admin"] } }))).toEqual([]);
    });

    it("accepts an empty list, which is how you say nobody", () => {
        expect(errors(collection({ access: { read: [], write: [] } }))).toEqual([]);
    });

    it("accepts one direction on its own", () => {
        expect(errors(collection({ access: { write: ["hr"] } }))).toEqual([]);
    });

    it("accepts a property with no access block at all", () => {
        expect(errors(collection({}))).toEqual([]);
    });
});

describe("access beside excludeFromApi", () => {
    /**
     * They are one mechanism: the flag expands to `{ read: [], write: [] }`
     * *before* `access` is read, so the block beside it is dead. An author who
     * wrote both meant the second line to do something.
     */
    it("is refused, naming both spellings", () => {
        const found = errors(collection({ excludeFromApi: true, access: { read: ["admin"] } }));
        expect(found).toHaveLength(1);
        expect(found[0].path).toBe("staff.properties.salary.access");
        expect(found[0].message).toContain("excludeFromApi");
        expect(found[0].message).toContain("one mechanism");
    });
});

describe("a malformed access block", () => {
    it("refuses a bare string, which reads as a rule no caller satisfies", () => {
        const found = errors(collection({ access: { read: "admin" } }));
        expect(found).toHaveLength(1);
        expect(found[0].path).toBe("staff.properties.salary.access.read");
        expect(found[0].message).toContain("[\"admin\"]");
    });

    it("refuses a role that is not a non-empty string", () => {
        const found = errors(collection({ access: { write: ["hr", ""] } }));
        expect(found).toHaveLength(1);
        expect(found[0].path).toBe("staff.properties.salary.access.write");
    });

    it("refuses a non-object block", () => {
        const found = errors(collection({ access: ["admin"] }));
        expect(found).toHaveLength(1);
        expect(found[0].path).toBe("staff.properties.salary.access");
    });

    it("reports an unknown key inside the block", () => {
        const found = problems(collection({ access: { read: ["hr"], delete: ["hr"] } }));
        expect(found.map(p => p.path)).toContain("staff.properties.salary.access.delete");
    });
});

describe("a restricted field in the search index", () => {
    /**
     * `search` compiles to one generated `tsvector` shared by every caller.
     * There is no per-role variant of it, so a restricted field named there
     * stays *matchable* to callers who can never see its value — recoverable a
     * term at a time, which is the whole of the disclosure the rule prevents.
     */
    it("is refused when the field has a read rule", () => {
        const found = errors(collection(
            { access: { read: ["hr"] }, type: "string" },
            { search: { fields: ["name", "salary"] } }
        ));
        expect(found).toHaveLength(1);
        expect(found[0].path).toBe("staff.search.fields");
        expect(found[0].message).toContain("access.read");
    });

    it("is refused for `excludeFromApi` too, in the same words", () => {
        const found = errors(collection(
            { excludeFromApi: true, type: "string" },
            { search: { fields: [{ path: "salary", weight: "A" }] } }
        ));
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain("excludeFromApi");
    });

    it("says nothing about a field with only a write rule", () => {
        // Writing is not reading: a field anyone may read and only HR may set is
        // perfectly searchable.
        expect(errors(collection(
            { access: { write: ["hr"] }, type: "string" },
            { search: { fields: ["salary"] } }
        ))).toEqual([]);
    });

    it("says nothing about an unrestricted search field", () => {
        expect(errors(collection({}, { search: { fields: ["name"] } }))).toEqual([]);
    });
});
