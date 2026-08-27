
import { Entity, CollectionCallbacks, User } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { RebaseData } from "@rebasepro/types";

/**
 * @group Hooks and utilities
 */
export type DeleteEntityWithCallbacksProps<M extends Record<string, any>, USER extends User = User> = {
    entity: Entity<M>;
    collection?: AdminCollection<M>;
    callbacks?: CollectionCallbacks<M, USER>;
    onDeleteSuccess?: (entity: Entity<M>) => void;
    onDeleteFailure?: (entity: Entity<M>, e: Error) => void;
}

/**
 * This function is in charge of deleting a entity.
 * It will run all the delete callbacks specified in the collection.
 * It is also possible to attach callbacks on save success or error, and callback
 * errors.
 *
 * @param data
 * @param entity
 * @param collection
 * @param callbacks
 * @param onDeleteSuccess
 * @param onDeleteFailure
 * @param context
 * @group Hooks and utilities
 */
export async function deleteEntityWithCallbacks<M extends Record<string, any>, USER extends User>({
    data,
    entity,
    collection,
    callbacks,
    onDeleteSuccess,
    onDeleteFailure,
    context
}: DeleteEntityWithCallbacksProps<M> & {
    collection: AdminCollection<M>,
    data: RebaseData,
    context: RebaseContext<USER>
}
): Promise<boolean> {

    console.debug("Deleting entity", entity.path, entity.id);

    return data.collection(entity.path).delete(entity.id).then(() => {
        if (onDeleteSuccess) onDeleteSuccess(entity);
        return true;
    }).catch((e) => {
        if (onDeleteFailure) onDeleteFailure(entity, e);
        return false;
    });
}
