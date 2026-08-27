
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { RebaseData } from "@rebasepro/types";

/**
 * @group Hooks and utilities
 */
export type SaveEntityWithCallbacksProps<M extends Record<string, unknown>> = {
    path: string;
    values: Partial<EntityValues<M>>;
    entityId?: string | number;
    previousValues?: Partial<EntityValues<M>>;
    collection?: AdminCollection<M>;
    status: EntityStatus;
    afterSave?: (updatedEntity: Entity<M>) => void,
    afterSaveError?: (e: Error) => void
}

/**
 * This function is in charge of saving a entity.
 * It will run all the save callbacks specified in the collection.
 * It is also possible to attach callbacks on save success or error, and callback
 * errors.
 *
 * @param collection
 * @param path
 * @param entityId
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
export async function saveEntityWithCallbacks<M extends Record<string, unknown>>({
    collection,
    path,
    entityId,
    values,
    previousValues,
    status,
    data,
    context,
    afterSave,
    afterSaveError
}: Omit<SaveEntityWithCallbacksProps<M>, "collection"> & {
    collection: AdminCollection<M>,
    data: RebaseData,
    context: RebaseContext,
}
): Promise<Entity<M>> {

    if (status !== "new" && status !== "copy" && !entityId) {
        throw new Error("Entity id must be specified when updating an existing entity");
    }

    const accessor = data.collection(path);

    let savePromise: Promise<Entity<M>>;
    if (status === "new" || status === "copy") {
        savePromise = accessor.create(values, entityId) as Promise<Entity<M>>;
    } else {
        savePromise = accessor.update(entityId!, values) as Promise<Entity<M>>;
    }

    return savePromise.then((entity) => {
        if (afterSave)
            afterSave(entity);
        return entity as Entity<M>;
    }).catch((e) => {
        if (afterSaveError) afterSaveError(e);
        throw e;
    });
}
