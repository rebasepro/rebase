/**
 * The API-key permission vocabulary the Studio shows must describe what the
 * server actually enforces.
 *
 * The guard is `@rebasepro/server`'s `api-key-permission-guard.ts`. It is not
 * importable here — the Studio is a browser bundle — so this suite pins the
 * two facts the old UI got wrong and would get wrong again:
 *
 * 1. `"*"` is not "all collections". It matches every collection *and* every
 *    custom function *and* storage. The dialog labelled its input "Collection
 *    slug or *" and the detail panel rendered "* (all collections)", so the
 *    widest grant in the product read as the narrower one.
 * 2. `storage` and `functions` are addressable resources in the same field.
 *    Nothing in the UI said so, which made them undiscoverable.
 */

import {
    FUNCTION_PREFIX,
    grantSentence,
    parseResource,
    permissionSummary,
    RESOURCE_ALL_FUNCTIONS,
    RESOURCE_EVERYTHING,
    RESOURCE_STORAGE,
    resourceLabel,
    resourcePhrase
} from "../src/components/ApiKeys/permissions";

describe("parseResource", () => {
    it("classifies each namespace the guard matches on", () => {
        expect(parseResource(RESOURCE_EVERYTHING)).toEqual({ kind: "everything", name: "" });
        expect(parseResource(RESOURCE_STORAGE)).toEqual({ kind: "storage", name: "" });
        expect(parseResource(RESOURCE_ALL_FUNCTIONS)).toEqual({ kind: "all-functions", name: "" });
        expect(parseResource(`${FUNCTION_PREFIX}sendEmail`)).toEqual({ kind: "function", name: "sendEmail" });
        expect(parseResource("products")).toEqual({ kind: "collection", name: "products" });
    });

    it("tolerates the whitespace a free-text input produces", () => {
        expect(parseResource("  products  ").name).toBe("products");
        expect(parseResource(" * ").kind).toBe("everything");
    });
});

describe("resourcePhrase", () => {
    it("names all three namespaces the wildcard covers", () => {
        const phrase = resourcePhrase(RESOURCE_EVERYTHING);
        expect(phrase).toContain("collection");
        expect(phrase).toContain("function");
        expect(phrase).toContain("storage");
    });

    it("never describes the wildcard as collections alone", () => {
        expect(resourcePhrase(RESOURCE_EVERYTHING)).not.toMatch(/^all collections$/i);
    });

    it("reads naturally for the other namespaces", () => {
        expect(resourcePhrase(RESOURCE_STORAGE)).toBe("storage");
        expect(resourcePhrase(RESOURCE_ALL_FUNCTIONS)).toBe("every custom function");
        expect(resourcePhrase(`${FUNCTION_PREFIX}resize`)).toBe("the resize function");
        expect(resourcePhrase("orders")).toBe("the orders collection");
    });
});

describe("resourceLabel", () => {
    it("never shows a bare asterisk", () => {
        expect(resourceLabel(RESOURCE_EVERYTHING)).toBe("Everything");
    });

    it("distinguishes a single function from the whole namespace", () => {
        expect(resourceLabel(RESOURCE_ALL_FUNCTIONS)).toBe("All functions");
        expect(resourceLabel(`${FUNCTION_PREFIX}resize`)).toBe("resize()");
    });
});

describe("grantSentence", () => {
    it("spells out what a wildcard key can reach", () => {
        const sentence = grantSentence({ collection: RESOURCE_EVERYTHING, operations: ["read", "write"] });
        expect(sentence).toBe("Read and write every collection, every custom function and storage");
    });

    it("uses storage verbs for storage rather than CRUD ones", () => {
        expect(grantSentence({ collection: RESOURCE_STORAGE, operations: ["read"] }))
            .toBe("Download from storage");
        expect(grantSentence({ collection: RESOURCE_STORAGE, operations: ["write"] }))
            .toBe("Upload to storage");
    });

    it("says functions are called, not written to", () => {
        expect(grantSentence({ collection: `${FUNCTION_PREFIX}resize`, operations: ["write"] }))
            .toBe("Call (POST, PUT, PATCH) the resize function");
    });

    it("does not pretend an empty operation list grants something", () => {
        expect(grantSentence({ collection: "orders", operations: [] }))
            .toBe("No access to the orders collection");
    });

    it("joins three operations without an orphan comma", () => {
        expect(grantSentence({ collection: "orders", operations: ["read", "write", "delete"] }))
            .toBe("Read, write and delete the orders collection");
    });
});

describe("permissionSummary", () => {
    it("reports a wildcard as everything, even beside narrower entries", () => {
        // The guard returns on the first matching entry, so a key holding `*`
        // is a full-access key whatever else sits in the array.
        expect(permissionSummary([
            { collection: "orders", operations: ["read"] },
            { collection: RESOURCE_EVERYTHING, operations: ["read", "write", "delete"] }
        ])).toBe("Everything (read, write, delete)");
    });

    it("labels a lone entry by its resource, not its raw value", () => {
        expect(permissionSummary([{ collection: RESOURCE_STORAGE, operations: ["read"] }]))
            .toBe("Storage (read)");
    });

    it("counts resources rather than collections when there are several", () => {
        expect(permissionSummary([
            { collection: "orders", operations: ["read"] },
            { collection: RESOURCE_STORAGE, operations: ["read"] }
        ])).toBe("2 resources");
    });

    it("handles a key with nothing granted", () => {
        expect(permissionSummary([])).toBe("No permissions");
    });
});
