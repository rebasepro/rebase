import type { CollectionConfig } from "@rebasepro/types";
import { Snapshot, CollectionCallbacks, RebaseContext, User } from "@rebasepro/types";
import { RebaseData } from "@rebasepro/types";

/**
 * @group Hooks and utilities
 */
export type DeleteSnapshotWithCallbacksProps<M extends Record<string, any>, USER extends User = User> = {
    snapshot: Snapshot<M>;
    collection?: CollectionConfig<M>;
    callbacks?: CollectionCallbacks<M, USER>;
    onDeleteSuccess?: (snapshot: Snapshot<M>) => void;
    onDeleteFailure?: (snapshot: Snapshot<M>, e: Error) => void;
}

/**
 * This function is in charge of deleting a snapshot.
 * It will run all the delete callbacks specified in the collection.
 * It is also possible to attach callbacks on save success or error, and callback
 * errors.
 *
 * @param data
 * @param snapshot
 * @param collection
 * @param callbacks
 * @param onDeleteSuccess
 * @param onDeleteFailure
 * @param context
 * @group Hooks and utilities
 */
export async function deleteSnapshotWithCallbacks<M extends Record<string, any>, USER extends User>({
    data,
    snapshot,
    collection,
    callbacks,
    onDeleteSuccess,
    onDeleteFailure,
    context
}: DeleteSnapshotWithCallbacksProps<M> & {
    collection: CollectionConfig<M>,
    data: RebaseData,
    context: RebaseContext<USER>
}
): Promise<boolean> {

    console.debug("Deleting snapshot", snapshot.path, snapshot.id);

    return data.collection(snapshot.path).delete(snapshot.id).then(() => {
        if (onDeleteSuccess) onDeleteSuccess(snapshot);
        return true;
    }).catch((e) => {
        if (onDeleteFailure) onDeleteFailure(snapshot, e);
        return false;
    });
}
