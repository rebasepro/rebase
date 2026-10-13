import * as hooks from "../../src/hooks";

/**
 * The admin builds its storage sources from the client: `client.storage`, and
 * `client.createStorageSource(key)` for a named source. A second, hand-rolled
 * REST implementation in this package drifted from it — no `public`, no
 * `context`, no `storageId` — so it is not exported.
 */
describe("storage-source hooks", () => {
    it("exports no second REST storage source", () => {
        expect(Object.keys(hooks)).not.toContain("useBackendStorageSource");
        expect(Object.keys(hooks)).toContain("useStorageSource");
    });
});
