import type { CollectionConfig } from "@rebasepro/types";
import { assertKnownWriteFields, assertWriteRequestValid } from "../src/api/rest/write-validation";
import { ApiError } from "../src/api/errors";

/**
 * Per-field `access.write`, at the write boundary.
 *
 * Row access is the collection's security rules; this is the field inside the
 * row, and the two are independent. The rule that matters here is that a value
 * for a field the caller may not set is **refused**, never dropped: a write that
 * silently discards a key answers 201 for an edit that did not happen, and a
 * form has no way to find out.
 *
 * The empty list and the role list are one mechanism with two answers —
 * `VALIDATION_EXCLUDED_FIELDS` is a fact about the collection and the same for
 * everybody, `FIELD_NOT_WRITABLE` is a fact about the caller and would be a 200
 * for their colleague — so a client can tell "never" from "not yet" without
 * parsing English.
 */

const staff = {
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        // Readable by HR, writable by HR.
        salary: { type: "number", access: { read: ["hr"], write: ["hr"] } },
        // Everyone may read it; nobody may set it through the API.
        rating: { type: "number", access: { write: [] } },
        // The old spelling of the line above, applied to both directions.
        passwordHash: { type: "string", columnName: "password_hash", excludeFromApi: true },
        // No rule at all.
        nickname: { type: "string" }
    }
} as unknown as CollectionConfig;

function thrown(fn: () => void): ApiError {
    try {
        fn();
    } catch (e) {
        return e as ApiError;
    }
    throw new Error("expected a refusal, and the write was accepted");
}

const hr = { roles: ["hr"] };
const clerk = { roles: ["staff"] };
const admin = { roles: ["admin"] };
const anon = { roles: ["anon"] };

describe("access.write on a create", () => {
    it("accepts the field from a caller holding the role", () => {
        expect(() => assertKnownWriteFields({ salary: 90_000 }, staff, { viewer: hr })).not.toThrow();
    });

    it("refuses it from a caller who does not, naming the field", () => {
        const error = thrown(() => assertKnownWriteFields({ salary: 90_000 }, staff, { viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("'salary'");
    });

    it("carries `details.violations` keyed by the wire name the caller sent", () => {
        const error = thrown(() => assertKnownWriteFields({ salary: 1 }, staff, { viewer: clerk }));
        expect((error.details as { violations: unknown[] }).violations).toEqual([
            { field: "salary", code: "access", message: expect.stringContaining("'salary'") }
        ]);
    });

    it("lets `admin` through any non-empty role list", () => {
        expect(() => assertKnownWriteFields({ salary: 1 }, staff, { viewer: admin })).not.toThrow();
    });

    it("refuses an anonymous caller, who holds no application role", () => {
        expect(thrown(() => assertKnownWriteFields({ salary: 1 }, staff, { viewer: anon })).code)
            .toBe("FIELD_NOT_WRITABLE");
    });

    it("leaves a field with no rule alone", () => {
        expect(() => assertKnownWriteFields({ nickname: "ada" }, staff, { viewer: anon })).not.toThrow();
    });

    it("treats an absent viewer as the trusted server plane", () => {
        // `rebase.data` in a hook, a migration, the auth adapter. This is the
        // exemption that makes the rule enforceable at all — something has to be
        // able to write the column.
        expect(() => assertKnownWriteFields({ salary: 1 }, staff)).not.toThrow();
    });
});

describe("the empty list", () => {
    it("refuses every caller, including admin, with the excluded code", () => {
        for (const viewer of [hr, clerk, admin, anon]) {
            const error = thrown(() => assertKnownWriteFields({ rating: 5 }, staff, { viewer }));
            expect(error.code).toBe("VALIDATION_EXCLUDED_FIELDS");
        }
    });

    it("refuses the trusted plane too — `[]` is not a role check", () => {
        // The one difference from the role case, and it is the whole point of
        // `excludeFromApi`: this rule is about the API surface, not about who is
        // calling. In-process writes bypass this function entirely; a write that
        // *reaches* it is an API write.
        expect(thrown(() => assertKnownWriteFields({ rating: 5 }, staff)).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("is what `excludeFromApi` expands to, under either spelling of the name", () => {
        expect(thrown(() => assertKnownWriteFields({ passwordHash: "x" }, staff, { viewer: admin })).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(thrown(() => assertKnownWriteFields({ password_hash: "x" }, staff, { viewer: admin })).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });
});

describe("every write door", () => {
    it("refuses a bulk row, naming the row index", () => {
        const error = thrown(() =>
            assertKnownWriteFields({ salary: 1 }, staff, { rowIndex: 3, viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
        expect(error.message).toContain("Row 3");
    });

    it("refuses a field operation, which names its field the same way a value does", () => {
        // `{ salary: { $inc: 1000 } }` is a write to `salary`; the key is the
        // field, so the rule needs no special case for it — and must not.
        const error = thrown(() =>
            assertKnownWriteFields({ salary: { $inc: 1000 } }, staff, { viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
    });

    it("refuses through `assertWriteRequestValid`, which is the socket's door", () => {
        const error = thrown(() =>
            assertWriteRequestValid({ salary: 1 }, staff, { viewer: clerk }));
        expect(error.code).toBe("FIELD_NOT_WRITABLE");
    });

    it("accepts through the socket's door for a caller holding the role", () => {
        expect(() => assertWriteRequestValid({ salary: 1 }, staff, { viewer: hr })).not.toThrow();
    });
});

describe("the known-fields list", () => {
    /**
     * The list in an "unknown field" error is an offer. Offering a field the
     * next request would refuse is worse than saying nothing.
     */
    it("does not name a field this caller cannot write", () => {
        const error = thrown(() => assertKnownWriteFields({ titel: "x" }, staff, { viewer: clerk }));
        expect(error.code).toBe("VALIDATION_UNKNOWN_FIELDS");
        expect(error.message).not.toContain("'salary'");
        expect(error.message).toContain("'nickname'");
    });

    it("names it for a caller who can", () => {
        const error = thrown(() => assertKnownWriteFields({ titel: "x" }, staff, { viewer: hr }));
        expect(error.message).toContain("'salary'");
    });
});

describe("strictWrites: false", () => {
    /**
     * A convenience flag must not switch off a security rule. `strictWrites`
     * says "this config does not list every column"; it says nothing about who
     * may write the columns it *does* list.
     */
    const loose = { ...staff, strictWrites: false } as unknown as CollectionConfig;

    it("still refuses a field the caller cannot write", () => {
        expect(thrown(() => assertKnownWriteFields({ salary: 1 }, loose, { viewer: clerk })).code)
            .toBe("FIELD_NOT_WRITABLE");
    });

    it("still refuses an excluded one", () => {
        expect(thrown(() => assertKnownWriteFields({ rating: 1 }, loose, { viewer: admin })).code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("still lets an undeclared key through, which is what the flag is for", () => {
        expect(() => assertKnownWriteFields({ whatever: 1 }, loose, { viewer: clerk })).not.toThrow();
    });
});
