import type { StorageController } from "../../src/storage/types";

/** A method a fake controller was not given: calling it fails, naming it. */
function unstubbed(name: string): () => never {
    return () => {
        throw new Error(`StorageController.${name} is not stubbed in this test`);
    };
}

/**
 * A complete `StorageController` whose required methods throw until the test
 * supplies them, and whose optional ones are absent unless supplied — the code
 * under test branches on those (`putObjectStream`, `statObject`, …), so a fake
 * that grew one would take a different path than the test meant.
 */
export function fakeStorageController(overrides: Partial<StorageController> = {}): StorageController {
    return {
        putObject: unstubbed("putObject"),
        getSignedUrl: unstubbed("getSignedUrl"),
        getObject: unstubbed("getObject"),
        deleteObject: unstubbed("deleteObject"),
        listObjects: unstubbed("listObjects"),
        getType: () => "fake",
        ...overrides
    };
}

/** What `putObject` answers for `key`: where it was written. */
export function storedAt(key: string, bucket = "default"): { key: string; bucket: string; storageUrl: string; url: null } {
    return { key, bucket, storageUrl: `fake://${bucket}/${key}`, url: null };
}
