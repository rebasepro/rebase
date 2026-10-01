import { deepEqual as equal } from "fast-equals"

import {
    useAuthController,
    useSnackbarController,
    useTranslation
} from "@rebasepro/app";

import { CollectionActionsProps, AdminCollection } from "@rebasepro/cms-types";
import { Button, SaveIcon, Tooltip, UndoIcon } from "@rebasepro/ui";

import { useCollectionEditorController } from "../useCollectionEditorController";
import { useCollectionsConfigController } from "../useCollectionsConfigController";
import { normalizeOrderBy } from "@rebasepro/common";
import { isSchemaChangeCancelled } from "../liveSchemaClient";

export function EditorCollectionActionStart({
    path,
    parentCollectionSlugs, parentEntityIds,
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
        !equal(getObjectOrNull(tableController.sortBy), getObjectOrNull(normalizeOrderBy(collection.sort)))) {
        saveDefaultFilterButton = <>
            <Tooltip
                asChild={true}
                title={tableController.sortBy || tableController.filterValues ? t("studio_editor_collection_start_save_filter") : t("studio_editor_collection_start_clear_filter")}>
                <Button
                    size={"small"}
                    variant={"text"}
                    // The two keys this button is about, as an update — not
                    // the collection the view renders. That one is normalized
                    // and flattened for the panel, and saving it wrote the
                    // runtime's `resolvedRelation`, the default `dataSource`
                    // and the default rules into the file, which then no
                    // longer type-checked.
                    onClick={() => configController
                        ?.updateCollection({
                            id: collection.slug,
                            parentCollectionSlugs,
                            parentEntityIds,
                            // Absent rather than null when cleared: the key is
                            // removed from the file instead of written as
                            // `undefined`.
                            collectionData: {
                                defaultFilter: tableController.filterValues ?? undefined,
                                sort: tableController.sortBy ?? undefined
                            } as Partial<AdminCollection>
                        }).then(() => {
                            snackbarController.open({
                                type: "success",
                                message: t("studio_editor_collection_start_saved")
                            });
                        }, (error: unknown) => {
                            // Closing the review is the person's answer, not
                            // a failure.
                            if (isSchemaChangeCancelled(error)) return;
                            console.error(error);
                            snackbarController.open({
                                type: "error",
                                message: error instanceof Error ? error.message : String(error)
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
                            tableController.setSortBy?.(normalizeOrderBy(collection.sort) as Parameters<NonNullable<typeof tableController.setSortBy>>[0]);
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
