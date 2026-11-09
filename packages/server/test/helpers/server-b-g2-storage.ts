import type { StorageController } from "../../src/storage/types";

/** A method a fake did not expect to be called: it says which. */
function unstubbed(name: string): () => never {
    return () => {
        throw new Error(`StorageController.${name} is not stubbed in this test`);
    };
}

/**
 * A `StorageController` whose required methods throw until the test gives
 * them an answer, and whose optional ones are absent — their absence is a
 * capability the routes branch on. `getType()` answers `"fake"`.
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
