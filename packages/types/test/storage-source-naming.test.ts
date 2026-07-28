import {
    DEFAULT_STORAGE_SOURCE_KEY,
    findStorageSuffixCollision,
    normalizeStorageSources,
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

describe("normalizeStorageSources", () => {
    it("turns the rebase.json record into definitions, defaulting transport", () => {
        expect(normalizeStorageSources({ media: { engine: "s3" } }, undefined)).toEqual([
            { key: "media", engine: "s3", transport: "server" }
        ]);
    });

    it("keeps an explicit transport and label", () => {
        expect(normalizeStorageSources(
            { avatars: { engine: "firebase", transport: "direct", label: "Avatars" } },
            undefined
        )).toEqual([
            { key: "avatars", engine: "firebase", transport: "direct", label: "Avatars" }
        ]);
    });

    it("lets config code add a source rebase.json does not mention", () => {
        const merged = normalizeStorageSources(
            { media: { engine: "s3" } },
            [{ key: "avatars", engine: "firebase", transport: "direct" }]
        );
        expect(merged.map(s => s.key)).toEqual(["media", "avatars"]);
    });

    it("does NOT let config code contradict rebase.json", () => {
        // rebase.json is what the console reads to decide which buckets to
        // configure. A runtime that quietly disagreed with it would put the
        // console back to describing a topology the tenant does not have.
        const merged = normalizeStorageSources(
            { media: { engine: "s3", transport: "server", label: "Media" } },
            [{ key: "media", engine: "gcs", transport: "direct", label: "Something else" }]
        );
        expect(merged).toEqual([
            { key: "media", engine: "s3", transport: "server", label: "Media" }
        ]);
    });

    it("lets config code fill in a label rebase.json left out", () => {
        const merged = normalizeStorageSources(
            { media: { engine: "s3" } },
            [{ key: "media", engine: "s3", transport: "server", label: "Media files" }]
        );
        expect(merged[0].label).toBe("Media files");
    });

    it("accepts the already-resolved array form the bundle manifest stores", () => {
        const merged = normalizeStorageSources(
            [{ key: "media", engine: "s3", transport: "server" }],
            [{ key: "avatars", engine: "firebase", transport: "direct" }]
        );
        expect(merged.map(s => s.key)).toEqual(["media", "avatars"]);
    });

    it("invents nothing when both inputs are empty", () => {
        // Whether "declared nothing" means one default bucket is the resolver's
        // decision, not this function's.
        expect(normalizeStorageSources(undefined, undefined)).toEqual([]);
        expect(normalizeStorageSources({}, [])).toEqual([]);
    });
});
