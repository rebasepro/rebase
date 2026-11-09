import type { StorageReference } from "@rebasepro/types";
import type { StorageController } from "../../src/storage/types";

/** A listed object at `fullPath`, as the built-in sources report one (no root, no parent). */
export function storageRef(fullPath: string, bucket = "default"): StorageReference {
    return { fullPath, name: fullPath.split("/").pop() ?? fullPath, bucket, root: null, parent: null };
}

/**
 * A `StorageController` holding nothing: reads miss, lists are empty, writes
 * are refused. A test overrides the methods it is about.
 */
export function fakeStorageController(overrides: Partial<StorageController> = {}): StorageController {
    return {
        putObject: async () => { throw new Error("this fake storage refuses writes"); },
        getObject: async () => null,
        getSignedUrl: async () => ({ url: null, fileNotFound: true }),
        deleteObject: async () => undefined,
        listObjects: async () => ({ prefixes: [], items: [] }),
        getType: () => "fake",
        ...overrides
    };
}
