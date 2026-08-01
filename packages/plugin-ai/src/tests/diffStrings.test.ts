// Import the diffStrings function from your module
// import { diffStrings } from './your-module';

import { Change, diffStrings } from "../utils/diffStrings";

/**
 * What a diff has to satisfy no matter how it segments the strings: the kept
 * and deleted parts rebuild the old string, the kept and inserted parts rebuild
 * the new one, no segment is empty, and no two neighbours share a type.
 *
 * Asserted instead of a hard-coded segmentation where the segmentation is an
 * artefact of the LCS strategy rather than a contract — pinning it made any
 * improvement to the algorithm a test failure, so the test was defending the
 * implementation against being made better.
 */
function expectValidDiff(changes: Change[], oldStr: string, newStr: string) {
    const rebuilt = (skip: Change["type"]) => changes
        .filter(c => c.type !== skip)
        .map(c => c.value)
        .join("");

    expect(rebuilt("insert")).toBe(oldStr);
    expect(rebuilt("delete")).toBe(newStr);
    expect(changes.every(c => c.value.length > 0)).toBe(true);
    expect(changes.every((c, i) => i === 0 || c.type !== changes[i - 1].type)).toBe(true);
}

describe("diffStrings", () => {
    test("equal strings", () => {
        const oldStr = "This is a test string";
        const newStr = "This is a test string";
        const expected: Change[] = [
            {
                type: "equal",
                value: "This is a test string"
            }
        ];
        const changes = diffStrings(oldStr, newStr);
        expectValidDiff(changes, oldStr, newStr);
        expect(changes).toEqual(expected);
    });

    test("insertions only", () => {
        const oldStr = "This is a test string";
        const newStr = "This is a new test string";
        const expected: Change[] = [
            {
                type: "equal",
                value: "This is a"
            },
            {
                type: "insert",
                value: " new"
            },
            {
                type: "equal",
                value: " test string"
            }
        ];
        const changes = diffStrings(oldStr, newStr);
        expectValidDiff(changes, oldStr, newStr);
        expect(changes).toEqual(expected);
    });

    test("deletions only", () => {
        const oldStr = "This is an old test string";
        const newStr = "This is a test string";
        const expected: Change[] = [
            {
                type: "equal",
                value: "This is a"
            },
            {
                type: "delete",
                value: "n old"
            },
            {
                type: "equal",
                value: " test string"
            }
        ];
        const changes = diffStrings(oldStr, newStr);
        expectValidDiff(changes, oldStr, newStr);
        expect(changes).toEqual(expected);
    });

    test("insertions and deletions", () => {
        const oldStr = "This is an old test string";
        const newStr = "This is a new modified test string";

        const changes = diffStrings(oldStr, newStr);

        expectValidDiff(changes, oldStr, newStr);
        // Both edit kinds have to be present — a diff that only inserted would
        // rebuild both strings only if nothing was ever removed.
        expect(changes.some(c => c.type === "insert")).toBe(true);
        expect(changes.some(c => c.type === "delete")).toBe(true);
        // The shared prefix and suffix are long and unambiguous, so they are a
        // contract rather than an artefact.
        expect(changes[0]).toEqual({ type: "equal",
value: "This is a" });
        expect(changes[changes.length - 1]).toEqual({ type: "equal",
value: "d test string" });
    });

    test("completely different strings", () => {
        const oldStr = "Old string";
        const newStr = "New string";
        const expected: Change[] = [
            {
                type: "delete",
                value: "Old"
            },
            {
                type: "insert",
                value: "New"
            },
            {
                type: "equal",
                value: " string"
            }
        ];
        const changes = diffStrings(oldStr, newStr);
        expectValidDiff(changes, oldStr, newStr);
        expect(changes).toEqual(expected);
    });
});
