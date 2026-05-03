import { useCallback, useMemo } from "react";
import { setIn } from "@rebasepro/formex";
import { EntityCollection, SaveEntityProps, RebaseData, RebaseContext } from "@rebasepro/types";
import { OnCellValueChange, saveEntityWithCallbacks, UniqueFieldValidator } from "@rebasepro/core";

export interface UseCollectionInlineEditorParams<M extends Record<string, unknown>> {
    path: string;
    collection: EntityCollection<M>;
    dataClient: RebaseData;
    context: RebaseContext;
}

export function useCollectionInlineEditor<M extends Record<string, unknown>>({
    path,
    collection,
    dataClient,
    context
}: UseCollectionInlineEditorParams<M>) {

    // Unique field validator (ported from EntityCollectionView)
    const uniqueFieldValidator: UniqueFieldValidator = useCallback(
        async ({ name, value, property, entityId }: Parameters<UniqueFieldValidator>[0]) => {
            const accessor = dataClient.collection(path);
            const res = await accessor.find({
                where: { [name]: "eq." + value }
            });

            const conflictingEntities = res.data;
            const isUnique = conflictingEntities.length === 0 ||
                (conflictingEntities.length === 1 && conflictingEntities[0].id === entityId);

            return isUnique;
        },
        [path, dataClient]
    );

    // Partial update payload builder
    const onValueChange: OnCellValueChange<any, any> = useCallback(({
        value,
        propertyKey,
        onValueUpdated,
        setError,
        data: entity,
    }) => {

        const updatedValues = setIn({}, propertyKey, value);

        const saveProps: SaveEntityProps = {
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
