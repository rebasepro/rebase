import { findCollectionConfigProblems } from "../src/collections/validate-config";
import { parseWithDeleted, parseHardDelete } from "../src/api/rest/soft-delete-params";
import { parseQueryOptions } from "../src/api/rest/query-parser";

/**
 * `softDelete` says what a column *means*. It does not create the column.
 *
 * A config that turns it on without the property has to be refused at boot,
 * where the answer is a config change — not at the first delete, where the
 * failure is a 500 landing on whoever pressed the button, on a row that then
 * either vanished or did not depending on which half of the feature was
 * reached. Both halves need that column: the delete writes it and every read
 * filters on it.
 */
describe("softDelete is refused without its column", () => {
    const collection = (softDelete: unknown, properties: Record<string, unknown>) => ({
        slug: "posts",
        name: "Posts",
        table: "posts",
        softDelete,
        properties
    });

    const errors = (config: unknown) =>
        findCollectionConfigProblems([config], { unknownKeys: "off" })
            .filter(p => p.severity === "error");

    it("accepts the default field when the collection declares it", () => {
        expect(errors(collection(true, {
            id: { type: "number", isId: "increment" },
            deletedAt: { type: "date" }
        }))).toEqual([]);
    });

    it("refuses `softDelete: true` with no deletedAt", () => {
        const [problem] = errors(collection(true, { id: { type: "number", isId: "increment" } }));
        expect(problem?.path).toBe("posts.softDelete");
        expect(problem?.message).toContain("deletedAt");
        expect(problem?.message).toContain("does not add one");
    });

    it("refuses a named field the collection does not declare", () => {
        const [problem] = errors(collection({ field: "removedOn" }, {
            id: { type: "number", isId: "increment" },
            deletedAt: { type: "date" }
        }));
        expect(problem?.message).toContain("removedOn");
    });

    it("accepts a named field the collection does declare", () => {
        expect(errors(collection({ field: "removedOn" }, {
            id: { type: "number", isId: "increment" },
            removedOn: { type: "date" }
        }))).toEqual([]);
    });

    it("refuses a field of the wrong type", () => {
        // Otherwise the delete writes `now()` into a boolean column and fails
        // at the database — the same failure, one layer further from the cause.
        const [problem] = errors(collection(true, {
            id: { type: "number", isId: "increment" },
            deletedAt: { type: "boolean" }
        }));
        expect(problem?.message).toContain("has to be a `date`");
    });

    it("refuses a malformed value", () => {
        expect(errors(collection("yes", { id: { type: "number", isId: "increment" } })).length).toBe(1);
    });

    it("says nothing when the flag is absent or off", () => {
        expect(errors(collection(undefined, { id: { type: "number", isId: "increment" } }))).toEqual([]);
        expect(errors(collection(false, { id: { type: "number", isId: "increment" } }))).toEqual([]);
    });

    it("does not treat `softDelete` as an unknown key", () => {
        // The compile-time key list and this check are two different gates, and
        // a key registered in neither warns at boot about a feature that works.
        const problems = findCollectionConfigProblems(
            [collection(true, { id: { type: "number", isId: "increment" }, deletedAt: { type: "date" } })],
            { unknownKeys: "error" }
        );
        expect(problems).toEqual([]);
    });
});

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
