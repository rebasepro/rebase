import { parseQueryOptions } from "../src/api/rest/query-parser";
import { ApiError } from "../src/api/errors";

/**
 * `?page=` and `?offset=` describe one window two ways. `page` used to win
 * silently — while the API reference promises no window parameter is "clamped
 * or ignored", and `after` + `offset` is already refused. The pair is a 400
 * `PAGE_WITH_OFFSET` now, flagged `expected` like every other malformed
 * parameter, and either one alone still pages.
 */
describe("?page= with ?offset=", () => {
    it("is refused with 400 PAGE_WITH_OFFSET", () => {
        let caught: unknown;
        try {
            parseQueryOptions({ page: "2", offset: "10" });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ApiError);
        const error = caught as ApiError;
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("PAGE_WITH_OFFSET");
        expect(error.expected).toBe(true);
        expect(error.message).toBe("`page` and `offset` describe the same window; send one.");
    });

    it("is refused whatever the offset, zero included", () => {
        expect(() => parseQueryOptions({ page: "1", offset: "0" })).toThrow(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
    });

    it("still pages by either one alone", () => {
        expect(parseQueryOptions({ page: "2", limit: "10" }).offset).toBe(10);
        expect(parseQueryOptions({ offset: "10", limit: "10" }).offset).toBe(10);
    });
});
