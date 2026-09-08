import {
    useAuthController,
    useTranslation
} from "@rebasepro/app";
import { getDefaultPropertiesOrder } from "../_cms_internals";

import { EntityTableController, AdminCollection } from "@rebasepro/cms-types";
import { PlusIcon, Tooltip } from "@rebasepro/ui";
import { useCollectionEditorController } from "../useCollectionEditorController";

export function PropertyAddColumnComponent({
    path,
    parentCollectionSlugs, parentEntityIds,
    collection,
    tableController
}: {
    path: string,
    parentCollectionSlugs: string[], parentEntityIds: string[],
    collection: AdminCollection;
    tableController: EntityTableController;
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
                className={"p-0.5 w-20 h-full flex items-center justify-center cursor-pointer hover:bg-surface-hover"}
                // className={onHover ? "bg-surface-card" : undefined}
                onClick={canEditCollection ? () => {
                    collectionEditorController.editProperty({
                        editedCollectionId: collection.slug,
                        parentCollectionSlugs,
parentEntityIds,
                        currentPropertiesOrder: getDefaultPropertiesOrder(collection),
                        collection,
                        existingEntities: tableController.data
                    });
                } : undefined}>
                <PlusIcon/>
            </div>
        </Tooltip>
    )
}
