import {
    parseReferenceString,
    looksLikeReference,
    findCommonInitialStringInPath,
    removeInitialAndTrailingSlashes,
    removeInitialSlash,
    removeTrailingSlash
} from "../src/strings";
import type { ValuesCountEntry } from "../src/types";

describe("parseReferenceString", () => {
    it("parses a simple path/snapshotId reference", () => {
        const result = parseReferenceString("users/abc123");
        expect(result).toEqual({ path: "users",
database: undefined });
    });

    it("parses a nested path reference", () => {
        const result = parseReferenceString("organizations/org1/members/user1");
        expect(result).toEqual({ path: "organizations/org1/members",
database: undefined });
    });

    it("parses reference with database prefix", () => {
        const result = parseReferenceString("mydb:::users/abc123");
        expect(result).toEqual({ path: "users",
database: "mydb" });
    });

    it("treats (default) database as undefined", () => {
        const result = parseReferenceString("(default):::users/abc123");
        expect(result).toEqual({ path: "users",
database: undefined });
    });

    it("returns null for empty string", () => {
        expect(parseReferenceString("")).toBeNull();
    });

    it("returns null for string without slash", () => {
        expect(parseReferenceString("no-slash-here")).toBeNull();
    });

    it("returns null for database prefix without path", () => {
        expect(parseReferenceString("mydb:::noslash")).toBeNull();
    });

    it("handles path with only one slash", () => {
        const result = parseReferenceString("a/b");
        expect(result).toEqual({ path: "a",
database: undefined });
    });

    it("handles database prefix with nested path", () => {
        const result = parseReferenceString("mydb:::a/b/c/d");
        expect(result).toEqual({ path: "a/b/c",
database: "mydb" });
    });
});

describe("looksLikeReference", () => {
    it("returns true for a valid reference string", () => {
        expect(looksLikeReference("users/abc123")).toBe(true);
    });

    it("returns false for a non-string value", () => {
        expect(looksLikeReference(42)).toBe(false);
        expect(looksLikeReference(null)).toBe(false);
        expect(looksLikeReference(undefined)).toBe(false);
        expect(looksLikeReference({})).toBe(false);
        expect(looksLikeReference([])).toBe(false);
    });

    it("returns false for a string without slash", () => {
        expect(looksLikeReference("noslash")).toBe(false);
    });

    it("returns true for reference with database prefix", () => {
        expect(looksLikeReference("mydb:::users/abc")).toBe(true);
    });

    it("returns false for empty string", () => {
        expect(looksLikeReference("")).toBe(false);
    });
});

describe("findCommonInitialStringInPath", () => {
    it("returns the common path prefix", () => {
        const valuesCount: ValuesCountEntry = {
            values: ["users/a", "users/b", "users/c"],
            valuesCount: new Map([
                ["users/a", 1],
                ["users/b", 1],
                ["users/c", 1]
            ])
        };
        expect(findCommonInitialStringInPath(valuesCount)).toBe("users");
    });

    it("returns undefined when input is undefined", () => {
        expect(findCommonInitialStringInPath(undefined)).toBeUndefined();
    });

    it("returns undefined when no values have slashes", () => {
        const valuesCount: ValuesCountEntry = {
            values: ["hello", "world"],
            valuesCount: new Map([
                ["hello", 1],
                ["world", 1]
            ])
        };
        expect(findCommonInitialStringInPath(valuesCount)).toBeUndefined();
    });

    it("returns undefined when less than 2/3 share the prefix", () => {
        const valuesCount: ValuesCountEntry = {
            values: ["users/a", "posts/b", "comments/c"],
            valuesCount: new Map([
                ["users/a", 1],
                ["posts/b", 1],
                ["comments/c", 1]
            ])
        };
        expect(findCommonInitialStringInPath(valuesCount)).toBeUndefined();
    });

    it("handles database-prefixed values", () => {
        const valuesCount: ValuesCountEntry = {
            values: ["mydb:::users/a", "mydb:::users/b", "mydb:::users/c"],
            valuesCount: new Map([
                ["mydb:::users/a", 1],
                ["mydb:::users/b", 1],
                ["mydb:::users/c", 1]
            ])
        };
        expect(findCommonInitialStringInPath(valuesCount)).toBe("users");
    });
});

describe("removeInitialSlash", () => {
    it("removes leading slash", () => {
        expect(removeInitialSlash("/hello")).toBe("hello");
    });

    it("does nothing when no leading slash", () => {
        expect(removeInitialSlash("hello")).toBe("hello");
    });

    it("removes only the first slash", () => {
        expect(removeInitialSlash("/hello/world")).toBe("hello/world");
    });

    it("handles empty string", () => {
        expect(removeInitialSlash("")).toBe("");
    });
});

describe("removeTrailingSlash", () => {
    it("removes trailing slash", () => {
        expect(removeTrailingSlash("hello/")).toBe("hello");
    });

    it("does nothing when no trailing slash", () => {
        expect(removeTrailingSlash("hello")).toBe("hello");
    });

    it("removes only the last slash", () => {
        expect(removeTrailingSlash("hello/world/")).toBe("hello/world");
    });

    it("handles empty string", () => {
        expect(removeTrailingSlash("")).toBe("");
    });
});

describe("removeInitialAndTrailingSlashes", () => {
    it("removes both leading and trailing slashes", () => {
        expect(removeInitialAndTrailingSlashes("/hello/")).toBe("hello");
    });

    it("removes only leading slash", () => {
        expect(removeInitialAndTrailingSlashes("/hello")).toBe("hello");
    });

    it("removes only trailing slash", () => {
        expect(removeInitialAndTrailingSlashes("hello/")).toBe("hello");
    });

    it("does nothing when no slashes", () => {
        expect(removeInitialAndTrailingSlashes("hello")).toBe("hello");
    });

    it("handles path with internal slashes", () => {
        expect(removeInitialAndTrailingSlashes("/a/b/c/")).toBe("a/b/c");
    });
});
