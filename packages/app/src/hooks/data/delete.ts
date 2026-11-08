
import { Entity, User } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { RebaseData } from "@rebasepro/types";
import { deleteWithCallbacks } from "./writeCallbacks";
import { toWireRow } from "../../util/wire_row";

/**
 * @internal
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
 * nothing is sent, and `onDeleteFailure` hears about it. Both callbacks are
 * handed the record as the server sends the row (`toWireRow`).
 *
 * @param data
 * @param entity
 * @param collection
 * @param onDeleteSuccess
 * @param onDeleteFailure
 * @param context
 * @internal
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

    return deleteWithCallbacks({
        collection,
        path: entity.path,
        id: String(entity.id),
        row: toWireRow(entity.values, collection),
        context,
        remove: () => data.collection(entity.path).delete(entity.id)
    }).then(() => {
        if (onDeleteSuccess) onDeleteSuccess(entity);
        return true;
    }).catch((e) => {
        if (onDeleteFailure) onDeleteFailure(entity, e);
        return false;
    });
}
