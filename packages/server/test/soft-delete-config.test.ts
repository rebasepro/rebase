import { parseWithDeleted, parseHardDelete } from "../src/api/rest/soft-delete-params";
import { parseQueryOptions } from "../src/api/rest/query-parser";

/**
 * Whether a `softDelete` table declares its column is the compiler's check now
 * (`compileTables`, packages/common/test). What stays here is the REST half.
 */
describe("the REST parameters", () => {
    describe("?deleted=", () => {
        it("maps the two words onto the driver option", () => {
            expect(parseWithDeleted("include")).toBe(true);
            expect(parseWithDeleted("only")).toBe("only");
            expect(parseWithDeleted("ONLY")).toBe("only");
        });

        it("is absent by default, which means 'hide them'", () => {
            expect(parseWithDeleted(undefined)).toBeUndefined();
            expect(parseWithDeleted("")).toBeUndefined();
        });

        it("refuses anything else rather than quietly defaulting", () => {
            // `?deleted=true` silently hiding every deleted row is the worst of
            // both: it looks like it worked and answers the opposite question.
            expect(() => parseWithDeleted("true")).toThrow(/INVALID|include/i);
            expect(() => parseWithDeleted("1")).toThrow();
        });

        it("reaches QueryOptions through the parser", () => {
            expect(parseQueryOptions({ deleted: "only" }).withDeleted).toBe("only");
            expect(parseQueryOptions({}).withDeleted).toBeUndefined();
        });

        it("is not compiled into the filter as a column named `deleted`", () => {
            // The reserved-key list is what stops that, and leaving a parameter
            // out of it turns it into a 400 on a nonexistent field.
            expect(parseQueryOptions({ deleted: "include" }).where).toBeUndefined();
            expect(parseQueryOptions({ hard: "true" }).where).toBeUndefined();
        });
    });

    describe("?hard=", () => {
        it("takes true and false", () => {
            expect(parseHardDelete("true")).toBe(true);
            expect(parseHardDelete("1")).toBe(true);
            expect(parseHardDelete("false")).toBe(false);
            expect(parseHardDelete(undefined)).toBe(false);
        });

        it("refuses a typo rather than reading it as 'no'", () => {
            // A caller who asked to purge and got a soft delete believes the
            // data is gone.
            expect(() => parseHardDelete("yes")).toThrow();
        });
    });
});
