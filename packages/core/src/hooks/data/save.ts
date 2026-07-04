import type { CollectionConfig } from "@rebasepro/types";
import { Snapshot, SnapshotStatus, SnapshotValues, RebaseContext } from "@rebasepro/types";
import { RebaseData } from "@rebasepro/types";

/**
 * @group Hooks and utilities
 */
export type SaveSnapshotWithCallbacksProps<M extends Record<string, unknown>> = {
    path: string;
    values: Partial<SnapshotValues<M>>;
    snapshotId?: string | number;
    previousValues?: Partial<SnapshotValues<M>>;
    collection?: CollectionConfig<M>;
    status: SnapshotStatus;
    afterSave?: (updatedSnapshot: Snapshot<M>) => void,
    afterSaveError?: (e: Error) => void
}

/**
 * This function is in charge of saving a snapshot.
 * It will run all the save callbacks specified in the collection.
 * It is also possible to attach callbacks on save success or error, and callback
 * errors.
 *
 * @param collection
 * @param path
 * @param snapshotId
 * @param callbacks
 * @param values
 * @param previousValues
 * @param status
 * @param data
 * @param context
 * @param afterSave
 * @param afterSaveError
 * @group Hooks and utilities
 */
export async function saveSnapshotWithCallbacks<M extends Record<string, unknown>>({
    collection,
    path,
    snapshotId,
    values,
    previousValues,
    status,
    data,
    context,
    afterSave,
    afterSaveError
}: SaveSnapshotWithCallbacksProps<M> & {
    collection: CollectionConfig,
    data: RebaseData,
    context: RebaseContext,
}
): Promise<Snapshot<M>> {

    if (status !== "new" && status !== "copy" && !snapshotId) {
        throw new Error("Snapshot id must be specified when updating an existing snapshot");
    }

    const accessor = data.collection(path);

    let savePromise: Promise<Snapshot<M>>;
    if (status === "new" || status === "copy") {
        savePromise = accessor.create(values, snapshotId) as Promise<Snapshot<M>>;
    } else {
        savePromise = accessor.update(snapshotId!, values) as Promise<Snapshot<M>>;
    }

    return savePromise.then((snapshot) => {
        if (afterSave)
            afterSave(snapshot);
        return snapshot as Snapshot<M>;
    }).catch((e) => {
        if (afterSaveError) afterSaveError(e);
        throw e;
    });
}
