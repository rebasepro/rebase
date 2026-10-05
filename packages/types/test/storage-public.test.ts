import { isPublicStorageKey, isPublicStoragePath, PUBLIC_STORAGE_PREFIX } from "../src/controllers/storage";

describe("isPublicStoragePath", () => {
    it("treats keys under the public prefix as public", () => {
        expect(isPublicStoragePath("public/avatar.png")).toBe(true);
        expect(isPublicStoragePath(`${PUBLIC_STORAGE_PREFIX}logo.svg`)).toBe(true);
        expect(isPublicStoragePath("/public/leading-slash.png")).toBe(true);
        expect(isPublicStoragePath("local://public/x.png")).toBe(true);
        expect(isPublicStoragePath("s3://public/x.png")).toBe(true);
    });

    it("tolerates a single leading `default/` bucket segment", () => {
        expect(isPublicStoragePath("default/public/x.png")).toBe(true);
        expect(isPublicStoragePath("local://default/public/x.png")).toBe(true);
    });

    it("does NOT treat a private folder literally named `public` as public", () => {
        // Security: substring matching would wrongly expose these token-less.
        expect(isPublicStoragePath("reports/public/q3.pdf")).toBe(false);
        expect(isPublicStoragePath("media/public/x.png")).toBe(false);
        expect(isPublicStoragePath("a/b/public/c.png")).toBe(false);
    });

    it("never treats a traversal path as public (defense-in-depth)", () => {
        expect(isPublicStoragePath("public/../secret.png")).toBe(false);
        expect(isPublicStoragePath("default/public/../../etc/passwd")).toBe(false);
    });

    it("returns false for empty / non-public keys", () => {
        expect(isPublicStoragePath(null)).toBe(false);
        expect(isPublicStoragePath(undefined)).toBe(false);
        expect(isPublicStoragePath("")).toBe(false);
        expect(isPublicStoragePath("products/img.png")).toBe(false);
        expect(isPublicStoragePath("publicish/x.png")).toBe(false); // not the prefix folder
    });
});

/**
 * The server's predicate. It reads a canonical key within its bucket and parses
 * nothing out of it, because everything `isPublicStoragePath` strips is part of
 * a key: a request path `notes://public/x` names the key `notes:/public/x`, and
 * `default/public/x` is a key in a folder called `default`.
 */
describe("isPublicStorageKey", () => {
    it("is true for a key under the public prefix", () => {
        expect(isPublicStorageKey("public/avatar.png")).toBe(true);
        expect(isPublicStorageKey(`${PUBLIC_STORAGE_PREFIX}a/b/c.png`)).toBe(true);
        expect(isPublicStorageKey(PUBLIC_STORAGE_PREFIX)).toBe(true);
    });

    it("strips no scheme, bucket or slash before deciding", () => {
        expect(isPublicStorageKey("notes:/public/x.txt")).toBe(false);
        expect(isPublicStorageKey("notes://public/x.txt")).toBe(false);
        expect(isPublicStorageKey("local://public/x.png")).toBe(false);
        expect(isPublicStorageKey("default/public/x.png")).toBe(false);
        expect(isPublicStorageKey("/public/x.png")).toBe(false);
    });

    it("is anchored, exact-case, and refuses traversal", () => {
        expect(isPublicStorageKey("reports/public/q3.pdf")).toBe(false);
        expect(isPublicStorageKey("publicish/x.png")).toBe(false);
        expect(isPublicStorageKey("public")).toBe(false);
        expect(isPublicStorageKey("PUBLIC/x.png")).toBe(false);
        expect(isPublicStorageKey("public/../secret.png")).toBe(false);
        expect(isPublicStorageKey("public/..\\secret.png")).toBe(false);
    });

    it("is false for nothing", () => {
        expect(isPublicStorageKey(null)).toBe(false);
        expect(isPublicStorageKey(undefined)).toBe(false);
        expect(isPublicStorageKey("")).toBe(false);
    });
});
