import { deepEqual as equal } from "fast-equals"

import {
    useAuthController,
    useSnackbarController,
    useTranslation
} from "@rebasepro/core";
import { SnapshotCollection, CollectionActionsProps } from "@rebasepro/types";
import { Button, SaveIcon, Tooltip, UndoIcon } from "@rebasepro/ui";

import { useCollectionEditorController } from "../useCollectionEditorController";
import { useCollectionsConfigController } from "../useCollectionsConfigController";
import { mergeDeep } from "@rebasepro/utils";

export function EditorCollectionActionStart({
    path,
    parentCollectionSlugs, parentSnapshotIds,
    collection,
    tableController
}: CollectionActionsProps) {

    const authController = useAuthController();
    const collectionEditorController = useCollectionEditorController();
    const configController = useCollectionsConfigController();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();

    const canEditCollection = !configController.readOnly;

    let saveDefaultFilterButton = null;
    if (!equal(getObjectOrNull(tableController.filterValues), getObjectOrNull(collection.defaultFilter)) ||
        !equal(getObjectOrNull(tableController.sortBy), getObjectOrNull(collection.sort))) {
        saveDefaultFilterButton = <>
            <Tooltip
                asChild={true}
                title={tableController.sortBy || tableController.filterValues ? t("studio_editor_collection_start_save_filter") : t("studio_editor_collection_start_clear_filter")}>
                <Button
                    size={"small"}
                    variant={"text"}
                    onClick={() => configController
                        ?.saveCollection({
                            id: collection.slug,
                            parentCollectionSlugs,
parentSnapshotIds,
                            collectionData: mergeDeep(collection as SnapshotCollection,
                                {
                                    defaultFilter: tableController.filterValues ?? null,
                                    sort: tableController.sortBy ?? null
                                })
                        }).then(() => {
                            snackbarController.open({
                                type: "success",
                                message: t("studio_editor_collection_start_saved")
                            });
                        })}>
                    <SaveIcon/>
                </Button>
            </Tooltip>

            {(collection.defaultFilter || collection.sort) && <Tooltip
                title={t("studio_editor_collection_start_reset_filter")}>
                <Button
                    size={"small"}
                    variant={"text"}
                    onClick={() => {
                        tableController.clearFilter?.();
                        if (collection?.defaultFilter)
                            tableController.setFilterValues?.(collection?.defaultFilter);
                        if (collection?.sort)
                            tableController.setSortBy?.(collection?.sort);
                    }}>
                    <UndoIcon/>
                </Button>
            </Tooltip>}
        </>;
    }

    return <>
        {canEditCollection && saveDefaultFilterButton}
    </>

}

function getObjectOrNull(o?: object): object | null {
    if (o && Object.keys(o).length === 0)
        return o
    return o ?? null;
}
