
import { Entity, User } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { RebaseData } from "@rebasepro/types";

/**
 * @group Hooks and utilities
 */
export type DeleteEntityWithCallbacksProps<M extends Record<string, any>, USER extends User = User> = {
    entity: Entity<M>;
    collection?: AdminCollection<M>;
    onDeleteSuccess?: (entity: Entity<M>) => void;
    onDeleteFailure?: (entity: Entity<M>, e: Error) => void;
}

/**
 * This function is in charge of deleting a entity.
 *
 * It runs the collection's **`admin.browserCallbacks`** around the delete —
 * `beforeDelete`, then `afterDelete`. Not `callbacks`: that block belongs to
 * the server, which runs it inside the delete it serves, and its bodies are
 * stripped from this bundle entirely.
 *
 * Which matters most for a collection on a `direct`/`custom` transport, where
 * the panel talks to the store itself and no server sees the delete at all —
 * before this ran them, such a collection had no delete callbacks anywhere.
 * This function has been named `deleteEntityWithCallbacks` since it was written
 * and did not run any; it even took a `callbacks` prop and ignored it.
 *
 * A `beforeDelete` that throws blocks the delete, exactly as the server's does:
 * nothing is sent, and `onDeleteFailure` hears about it.
 *
 * @param data
 * @param entity
 * @param collection
 * @param onDeleteSuccess
 * @param onDeleteFailure
 * @param context
 * @group Hooks and utilities
 */
export async function deleteEntityWithCallbacks<M extends Record<string, any>, USER extends User>({
    data,
    entity,
    collection,
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

    const browserCallbacks = collection.browserCallbacks;

    if (browserCallbacks?.beforeDelete) {
        try {
            await browserCallbacks.beforeDelete({
                collection,
                path: entity.path,
                id: entity.id,
                row: { id: entity.id, ...entity.values },
                context
            });
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            if (onDeleteFailure) onDeleteFailure(entity, error);
            return false;
        }
    }

    return data.collection(entity.path).delete(entity.id).then(async () => {
        await browserCallbacks?.afterDelete?.({
            collection,
            path: entity.path,
            id: entity.id,
            row: { id: entity.id, ...entity.values },
            context
        });
        if (onDeleteSuccess) onDeleteSuccess(entity);
        return true;
    }).catch((e) => {
        if (onDeleteFailure) onDeleteFailure(entity, e);
        return false;
    });
}
