import { describe, expect, it } from "@jest/globals";
import {
    deserializeInclude,
    mergeIncludeSpecs,
    normalizeInclude,
    serializeInclude
} from "../src/data/include-spec";

/**
 * `count` on an include: it has to survive every spelling an include travels
 * in — the SDK tree, the REST `?include=` JSON, a merged builder — because a
 * codec that drops it answers with rows and no `_count`, and the admin's "+N"
 * then counts the capped rows.
 */
describe("include `count`", () => {
    it("normalizes onto the node", () => {
        expect(normalizeInclude({ tags: { limit: 4, count: true } })?.tree.tags)
            .toEqual({ limit: 4, count: true, children: {} });
    });

    it("travels as JSON on the REST parameter and reads back the same", () => {
        const wire = serializeInclude({ tags: { limit: 4, count: true } });
        expect(wire).toBe(JSON.stringify({ tags: { limit: 4, count: true } }));
        expect(normalizeInclude(deserializeInclude(wire))?.tree.tags)
            .toEqual({ limit: 4, count: true, children: {} });
    });

    it("is an option on its own: a counted relation without a limit is not the flat spelling", () => {
        expect(serializeInclude({ tags: { count: true } })).toBe("{\"tags\":{\"count\":true}}");
    });

    it("is kept when a later builder call names the relation again", () => {
        const merged = mergeIncludeSpecs({ tags: { limit: 4, count: true } }, ["tags", "author"]);
        expect(normalizeInclude(merged)?.tree.tags).toEqual({ limit: 4, count: true, children: {} });
    });

    it("refuses a count that is not a boolean", () => {
        expect(() => normalizeInclude({ tags: { count: "yes" as unknown as boolean } })).toThrow(/count/);
    });

    it("`count: false` is no count", () => {
        expect(normalizeInclude({ tags: { limit: 2, count: false } })?.tree.tags)
            .toEqual({ limit: 2, children: {} });
    });
});
