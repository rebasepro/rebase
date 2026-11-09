/**
 * A `StorageController` built from the members a test cares about.
 *
 * The routes probe a controller's optional capabilities (`getObjectStream`,
 * `statObject` …) and take another path when one is absent, so a fake must not
 * invent them: only what the test passes is there. The required members a test
 * does not pass throw when reached, so a route that wanders onto one fails
 * loudly instead of answering `undefined`.
 */
import type { StorageReference } from "@rebasepro/types";
import type { StorageController } from "../../src/storage";

export function fakeStorage(members: Partial<StorageController> = {}): StorageController {
    const unplanned = (name: string) => () => {
        throw new Error(`fakeStorage: ${name} was not expected in this test`);
    };
    return {
        putObject: unplanned("putObject"),
        getSignedUrl: unplanned("getSignedUrl"),
        getObject: unplanned("getObject"),
        deleteObject: unplanned("deleteObject"),
        listObjects: unplanned("listObjects"),
        getType: () => "fake",
        ...members
    };
}

/** A listed object at `fullPath`, the way a listing reports one. */
export function objectRef(fullPath: string, bucket = "bucket"): StorageReference {
    const ref: StorageReference = {
        bucket,
        fullPath,
        name: fullPath.split("/").pop() ?? fullPath,
        root: null,
        parent: null,
        toString: () => `${bucket}/${fullPath}`
    };
    return ref;
}
