import { describe, it, expect } from "@jest/globals";
import type { StorageSource } from "@rebasepro/types";
import { ClientStorageSourceRegistry } from "../src/storage-registry";

/**
 * A key that names a source is that source or nothing. The registry used to
 * answer the default source for a key it did not hold, with a console warning,
 * so a property's uploads for `media` landed in the default bucket.
 */
describe("ClientStorageSourceRegistry.getOrDefault", () => {
    const defaultSource = { id: "default" } as unknown as StorageSource;
    const media = { id: "media" } as unknown as StorageSource;
    const registry = new ClientStorageSourceRegistry();
    registry.register("(default)", defaultSource);
    registry.register("media", media);

    it("answers the default for no key, and a registered key's own source", () => {
        expect(registry.getOrDefault(undefined)).toBe(defaultSource);
        expect(registry.getOrDefault(null)).toBe(defaultSource);
        expect(registry.getOrDefault("media")).toBe(media);
    });

    it("refuses a key it does not hold instead of answering the default", () => {
        expect(() => registry.getOrDefault("medai")).toThrow(/"medai" is not registered/);
    });
});
