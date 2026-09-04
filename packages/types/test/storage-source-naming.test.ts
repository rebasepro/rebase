import {
    DEFAULT_STORAGE_SOURCE_KEY,
    findStorageSuffixCollision,
    storageEnvSuffix
} from "../src/types/storage_source";

/**
 * The naming rule is a contract between four independent readers — the CLI, the
 * runtime, the control plane and the docs. These tests are the contract; if one
 * of them changes this file, they are changing every consumer at once, which is
 * exactly the property that having a single implementation is meant to buy.
 */
describe("storageEnvSuffix", () => {
    it("gives the default source no suffix at all", () => {
        // The load-bearing case: it is why a project configured with plain
        // S3_BUCKET keeps working having declared nothing.
        expect(storageEnvSuffix(DEFAULT_STORAGE_SOURCE_KEY)).toBe("");
        expect(storageEnvSuffix("")).toBe("");
    });

    it("uppercases a named key behind a double underscore", () => {
        expect(storageEnvSuffix("media")).toBe("__MEDIA");
        expect(storageEnvSuffix("Media")).toBe("__MEDIA");
    });

    it("collapses non-alphanumerics so a key is always a legal variable name", () => {
        expect(storageEnvSuffix("media-cdn")).toBe("__MEDIA_CDN");
        expect(storageEnvSuffix("media.cdn")).toBe("__MEDIA_CDN");
        expect(storageEnvSuffix("--media--")).toBe("__MEDIA");
    });

    it("rejects a key with nothing to build a name from", () => {
        expect(() => storageEnvSuffix("---")).toThrow(/at least one letter or digit/);
    });

    it("honours a caller-supplied default key", () => {
        expect(storageEnvSuffix("primary", "primary")).toBe("");
        expect(storageEnvSuffix(DEFAULT_STORAGE_SOURCE_KEY, "primary")).toBe("__DEFAULT");
    });
});

describe("findStorageSuffixCollision", () => {
    it("finds two keys that would read the same variables", () => {
        // Without this, one of the two silently reads the other's bucket and
        // credentials — the failure this check exists to make impossible.
        const collision = findStorageSuffixCollision(["media-cdn", "media_cdn"]);
        expect(collision).toEqual({ a: "media-cdn", b: "media_cdn", suffix: "__MEDIA_CDN" });
    });

    it("does not flag a key repeated against itself", () => {
        expect(findStorageSuffixCollision(["media", "media"])).toBeNull();
    });

    it("passes distinct keys, including the default", () => {
        expect(findStorageSuffixCollision([DEFAULT_STORAGE_SOURCE_KEY, "media", "backups"])).toBeNull();
    });
});
