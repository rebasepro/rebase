import { useCallback, useMemo } from "react";
import { getIn, setIn } from "@rebasepro/forms";
import { RebaseData } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { OnCellValueChange, saveEntityWithCallbacks, SaveEntityWithCallbacksProps, UniqueFieldValidator } from "@rebasepro/app";

export interface UseCollectionInlineEditorParams<M extends Record<string, unknown>> {
    path: string;
    collection: AdminCollection<M>;
    dataClient: RebaseData;
    context: RebaseContext;
}

export function useCollectionInlineEditor<M extends Record<string, unknown>>({
    path,
    collection,
    dataClient,
    context
}: UseCollectionInlineEditorParams<M>) {

    // Unique field validator (ported from CollectionViewBinding)
    const uniqueFieldValidator: UniqueFieldValidator = useCallback(
        async ({ name, value, property, entityId }: Parameters<UniqueFieldValidator>[0]) => {
            const accessor = dataClient.collection(path);
            const res = await accessor.find({
                where: { [name]: ["==", value] }
            });

            const conflictingEntities = res.data;
            const isUnique = conflictingEntities.length === 0 ||
                (conflictingEntities.length === 1 && conflictingEntities[0].id === entityId);

            return isUnique;
        },
        [path, dataClient]
    );

    // Partial update payload builder: the edited column, whole.
    //
    // A cell can address a key *inside* a column — `address.street` for a map
    // with `spreadChildren`, `tags[1]` for an array item — but the column is
    // what the database stores and what an update replaces. Sending
    // `{ address: { street } }` erased every other key of the map, so the edit
    // is applied to the row's current value and the whole top-level value is
    // sent.
    const onValueChange: OnCellValueChange<any, any> = useCallback(({
        value,
        propertyKey,
        onValueUpdated,
        setError,
        data: entity
    }) => {
        if (!entity) return;

        const column = propertyKey.split(/[.[]/)[0];
        const updatedRow = setIn(entity.values ?? {}, propertyKey, value);
        const updatedValues: Partial<Record<string, unknown>> = { [column]: getIn(updatedRow, column) };

        const saveProps: SaveEntityWithCallbacksProps<Record<string, unknown>> = {
            path: entity.path ?? path,
            entityId: entity.id,
            values: updatedValues,
            previousValues: entity.values,
            collection,
            status: "existing"
        };

        return saveEntityWithCallbacks({
            ...saveProps,
            collection,
            data: dataClient,
            context,
            afterSave: () => {
                setError(undefined);
                onValueUpdated();
            },
            afterSaveError: (e: Error) => {
                console.error("Save failure");
                console.error(e);
                setError(e);
            }
        }).then();

    }, [path, collection, dataClient, context]);

    return useMemo(() => ({
        onValueChange,
        uniqueFieldValidator
    }), [onValueChange, uniqueFieldValidator]);
}
