import {
    EntitySelectionProps,
    EntitySelectionTable,
    entitySelectionPropsOf,
    SelectionProps
} from "../components/ReferenceTable/SelectionTableBinding";

import { useCallback, useMemo } from "react";
import { useSideDialogsController } from "./useSideDialogsController";
import { useCollectionRegistryController } from "./navigation/contexts/CollectionRegistryContext";
import type { AdminCollection } from "@rebasepro/cms-types";

type DialogOptions = {
    path?: string | false;
    onClose?: () => void;
};

/**
 * This hook is used to open a side dialog that allows the selection
 * of rows under a given path.
 * You can use it in custom views for selecting rows; the callbacks are handed
 * them as the server sends them, and their ids beside them.
 * You need to specify the path of the target collection at least.
 * If your collection is not defined in your  top collection configuration
 * (in your `Rebase` component), you need to specify explicitly.
 * This is the same hook used internally when a reference property is defined.
 * @group Hooks and utilities
 */
export function useSelectionDialog<M extends Record<string, unknown>>(selectionProps: Omit<SelectionProps<M>, "path"> & DialogOptions): { open: () => void; close: () => void } {
    const { path, onClose, ...props } = selectionProps;
    const navigation = useCollectionRegistryController();
    // Resolved before the rows are made: a row is read by its collection, and
    // one registered under `path` is the one the dialog shows.
    const collection = props.collection
        ?? (path ? navigation.getCollection(path) as AdminCollection<M> | undefined : undefined);
    return useEntitySelectionDialog<M>({ ...entitySelectionPropsOf<M>({ ...props, collection, path: path || "" }), path, onClose });
}

/**
 * {@link useSelectionDialog} over the admin's `Entity` view model, for its own
 * reference and relation fields.
 *
 * @internal
 */
export function useEntitySelectionDialog<M extends Record<string, unknown>>(referenceDialogProps: Omit<EntitySelectionProps<M>, "path"> & DialogOptions): { open: () => void; close: () => void } {

    const navigation = useCollectionRegistryController();
    const sideDialogsController = useSideDialogsController();

    const open = useCallback(() => {
        if (referenceDialogProps.path) {
            let usedCollection = referenceDialogProps.collection;
            if (!usedCollection)
                usedCollection = navigation.getCollection(referenceDialogProps.path) as AdminCollection<M> | undefined;
            if (!usedCollection)
                throw Error("Not able to resolve the collection in useSelectionDialog. Make sure a collection is registered in path " + referenceDialogProps.path);
            sideDialogsController.open({
                key: `reference_${referenceDialogProps.path}`,
                component:
                    <EntitySelectionTable
                        {...referenceDialogProps as EntitySelectionProps<M>}
                        collection={usedCollection}/>,
                width: "90vw",
                onClose: () => {
                    referenceDialogProps.onClose?.();
                }
            });
        } else {
            throw Error("useReferenceDialog: You are trying to open a reference dialog, but have not declared the `path`")
        }
    }, [navigation, referenceDialogProps, sideDialogsController]);

    const close = useCallback(() => {
        sideDialogsController.close();
    }, [sideDialogsController]);

    return useMemo(() => ({
        open,
        close
    }), [open, close]);

}
