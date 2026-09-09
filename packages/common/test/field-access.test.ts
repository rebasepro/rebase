import type { CollectionConfig, Property } from "@rebasepro/types";
import {
    ADMIN_ROLE,
    canReadField,
    canWriteField,
    effectiveAccess,
    hasFieldAccessRules,
    restrictedFieldNames
} from "../src/collections/field-access";

/**
 * The one predicate every enforcement point reads.
 *
 * `excludeFromApi` and `access` are one mechanism with two spellings, and the
 * whole reason this module exists is that the flag used to be its own code path
 * in five files — the read strip, the write refusal, the SDK generator, the
 * OpenAPI schema builder and the filter-parameter builder. A second rule with
 * the same shape would have made ten.
 *
 * Three cases, and the middle one is the one worth stating out loud: an omitted
 * list is not an empty one.
 */

const prop = (p: object) => p as Property;

describe("effectiveAccess", () => {
    it("expands `excludeFromApi` to the empty lists it is sugar for", () => {
        expect(effectiveAccess(prop({ type: "string", excludeFromApi: true })))
            .toEqual({ read: [], write: [] });
    });

    it("answers undefined for a property with no rule, so callers can skip the walk", () => {
        expect(effectiveAccess(prop({ type: "string" }))).toBeUndefined();
        expect(effectiveAccess(prop({ type: "string", access: {} }))).toBeUndefined();
        expect(effectiveAccess(undefined)).toBeUndefined();
    });

    it("returns the block as written when there is one", () => {
        expect(effectiveAccess(prop({ type: "string", access: { read: ["hr"] } })))
            .toEqual({ read: ["hr"] });
    });
});

describe("an omitted list", () => {
    it("delegates to the row: everybody the collection lets through", () => {
        expect(canReadField(prop({ type: "string" }), { roles: [] })).toBe(true);
        expect(canWriteField(prop({ type: "string", access: { read: ["hr"] } }), { roles: [] })).toBe(true);
    });
});

describe("an empty list", () => {
    const closed = prop({ type: "string", access: { read: [], write: [] } });

    it("admits nobody, at any privilege", () => {
        for (const roles of [[], ["hr"], [ADMIN_ROLE]]) {
            expect(canReadField(closed, { roles })).toBe(false);
        }
    });

    it("admits not even the trusted server plane", () => {
        // This is what `excludeFromApi` has always meant on the read side, and
        // collapsing the two spellings means the empty list has to keep meaning
        // it: the flag is about the API surface, not about who is calling.
        expect(canReadField(closed, undefined)).toBe(false);
    });
});

describe("a role list", () => {
    const hrOnly = prop({ type: "number", access: { read: ["hr", "payroll"] } });

    it("admits a caller holding any one of the roles", () => {
        expect(canReadField(hrOnly, { roles: ["payroll"] })).toBe(true);
    });

    it("refuses a caller holding none of them", () => {
        expect(canReadField(hrOnly, { roles: ["staff"] })).toBe(false);
        expect(canReadField(hrOnly, { roles: [] })).toBe(false);
        expect(canReadField(hrOnly, {})).toBe(false);
    });

    it("admits `admin`, mirroring the arm every baseline policy carries", () => {
        expect(canReadField(hrOnly, { roles: [ADMIN_ROLE] })).toBe(true);
    });

    it("admits the trusted server plane, which is not an API caller", () => {
        expect(canReadField(hrOnly, undefined)).toBe(true);
    });
});

describe("read and write are separate questions", () => {
    const writeOnly = prop({ type: "string", access: { write: ["admin"] } });

    it("does not let a write rule withhold a read", () => {
        expect(canReadField(writeOnly, { roles: ["anon"] })).toBe(true);
        expect(canWriteField(writeOnly, { roles: ["anon"] })).toBe(false);
    });
});

describe("restrictedFieldNames", () => {
    const collection = {
        slug: "staff",
        properties: {
            name: { type: "string" },
            salary: { type: "number", access: { read: ["hr"] } },
            passwordHash: { type: "string", columnName: "password_hash", excludeFromApi: true }
        }
    } as unknown as CollectionConfig;

    it("names both spellings a caller could send", () => {
        const { refused } = restrictedFieldNames(collection, { roles: ["staff"] }, "read");
        expect([...refused].sort()).toEqual(["passwordHash", "password_hash", "salary"]);
    });

    it("gives `declared` as the property keys alone, for removing from a known set", () => {
        const { declared } = restrictedFieldNames(collection, { roles: ["staff"] }, "read");
        expect(declared.sort()).toEqual(["passwordHash", "salary"]);
    });

    it("narrows for a caller who holds the role", () => {
        const { declared } = restrictedFieldNames(collection, { roles: ["hr"] }, "read");
        expect(declared).toEqual(["passwordHash"]);
    });

    it("asks the write half when told to", () => {
        // `salary` restricts reading only, so nothing stops this caller writing
        // it — a rule that leaked across directions would silently make every
        // read restriction a write one too.
        const { declared } = restrictedFieldNames(collection, { roles: ["staff"] }, "write");
        expect(declared).toEqual(["passwordHash"]);
    });
});

describe("hasFieldAccessRules", () => {
    it("is false for the collection that has none, which is almost all of them", () => {
        expect(hasFieldAccessRules({ properties: { a: { type: "string" } } } as unknown as CollectionConfig))
            .toBe(false);
    });

    it("is true as soon as one property carries either spelling", () => {
        expect(hasFieldAccessRules({
            properties: { a: { type: "string", excludeFromApi: true } }
        } as unknown as CollectionConfig)).toBe(true);
    });
});
