import { describe, it, expect } from "@jest/globals";
import { ClientStorageSourceRegistry } from "../src/storage-registry";
import { createStorage } from "../src/storage";
import { fakeTransport } from "./support/fake-transport";

/**
 * A key that names a source is that source or nothing. The registry used to
 * answer the default source for a key it did not hold, with a console warning,
 * so a property's uploads for `media` landed in the default bucket.
 */
describe("ClientStorageSourceRegistry.getOrDefault", () => {
    // Real sources over a transport nothing reaches: only their identity is asserted.
    const transport = fakeTransport(async () => ({}));
    const defaultSource = createStorage(transport);
    const media = createStorage(transport, "media");
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
