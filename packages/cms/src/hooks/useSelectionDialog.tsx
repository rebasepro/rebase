import { SelectionProps, SelectionTableBinding } from "../components/ReferenceTable/SelectionTableBinding";

import { useCallback, useMemo } from "react";
import { useSideDialogsController } from "./useSideDialogsController";
import { useCollectionRegistryController } from "./navigation/contexts/CollectionRegistryContext";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * This hook is used to open a side dialog that allows the selection
 * of entities under a given path.
 * You can use it in custom views for selecting entities.
 * You need to specify the path of the target collection at least.
 * If your collection is not defined in your  top collection configuration
 * (in your `Rebase` component), you need to specify explicitly.
 * This is the same hook used internally when a reference property is defined.
 * @group Hooks and utilities
 */
export function useSelectionDialog<M extends Record<string, unknown>>(referenceDialogProps: Omit<SelectionProps<M>, "path"> & {
    path?: string | false;
    onClose?: () => void;
}): { open: () => void; close: () => void } {

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
                    <SelectionTableBinding
                        collection={usedCollection}
                        {...referenceDialogProps as SelectionProps<M>}/>,
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
