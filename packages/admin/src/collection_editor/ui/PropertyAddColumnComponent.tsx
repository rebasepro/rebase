import {
    useAuthController,
    useTranslation
} from "@rebasepro/core";
import { getDefaultPropertiesOrder } from "../_cms_internals";
import { CollectionConfig, SnapshotTableController } from "@rebasepro/types";
import { PlusIcon, Tooltip } from "@rebasepro/ui";
import { useCollectionEditorController } from "../useCollectionEditorController";

export function PropertyAddColumnComponent({
    path,
    parentCollectionSlugs, parentSnapshotIds,
    collection,
    tableController
}: {
    path: string,
    parentCollectionSlugs: string[], parentSnapshotIds: string[],
    collection: CollectionConfig;
    tableController: SnapshotTableController;
}) {

    const authController = useAuthController();
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();
    const canEditCollection = !collectionEditorController.configController?.readOnly;

    return (
        <Tooltip
            asChild={true}
            title={canEditCollection ? t("studio_property_add_column") : t("studio_property_add_column_no_permission")}>
            <div
                className={"p-0.5 w-20 h-full flex items-center justify-center cursor-pointer bg-surface-100/40 bg-surface-100/40 hover:bg-surface-100 dark:bg-surface-900 dark:bg-opacity-40 dark:bg-surface-900/40 dark:hover:bg-surface-800"}
                // className={onHover ? "bg-white dark:bg-surface-900" : undefined}
                onClick={canEditCollection ? () => {
                    collectionEditorController.editProperty({
                        editedCollectionId: collection.slug,
                        parentCollectionSlugs,
parentSnapshotIds,
                        currentPropertiesOrder: getDefaultPropertiesOrder(collection),
                        collection,
                        existingSnapshots: tableController.data
                    });
                } : undefined}>
                <PlusIcon/>
            </div>
        </Tooltip>
    )
}
