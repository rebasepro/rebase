/**
 * A composite-key table addressed with the wrong number of parts answers what
 * is wrong, instead of the 404 that blames row-level security.
 *
 * `GET /api/data/proposals/p1` on a table keyed on `(agency_id, id)` answered
 * "may be hidden from this caller by row-level security" for the very caller
 * who had just listed the row.
 */
import { describe, it, expect } from "@jest/globals";
import { assertKeyAddress } from "../src/api/rest/api-generator";
import { ApiError } from "../src/api/errors";

const proposals = { slug: "proposals", primaryKey: ["agencyId", "id"] };

describe("assertKeyAddress", () => {
    it("refuses a one-part address on a two-column key, naming the columns and the form", () => {
        let thrown: unknown;
        try {
            assertKeyAddress(proposals, "p1");
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ApiError);
        const error = thrown as ApiError;
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("COMPOSITE_KEY_ADDRESS");
        expect(error.message).toContain("(agencyId, id)");
        expect(error.message).toContain("/proposals/<agencyId>:::<id>");
    });

    it("lets a full composite address and any single-key address through", () => {
        expect(() => assertKeyAddress(proposals, "a1:::p1")).not.toThrow();
        expect(() => assertKeyAddress({ slug: "posts", primaryKey: ["id"] }, "p1")).not.toThrow();
        expect(() => assertKeyAddress({ slug: "posts", primaryKey: ["id"] }, "a:::b")).not.toThrow();
    });
});
