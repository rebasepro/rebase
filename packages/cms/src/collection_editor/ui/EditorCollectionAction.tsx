import { useCollectionRegistryController } from "../_cms_internals";
import { useAuthController, useTranslation } from "@rebasepro/app";

import { CollectionActionsProps, AdminCollection } from "@rebasepro/cms-types";
import { IconButton, SettingsIcon, Tooltip } from "@rebasepro/ui";

import { useCollectionEditorController } from "../useCollectionEditorController";

export function EditorCollectionAction({
    path,
    parentCollectionSlugs, parentEntityIds,
    collection,
    tableController
}: CollectionActionsProps) {

    const authController = useAuthController();
    const collectionRegistry = useCollectionRegistryController();
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    const parentCollection = parentCollectionSlugs.length > 0 ? collectionRegistry.getCollection(parentCollectionSlugs[parentCollectionSlugs.length - 1]) : undefined;

    const canEditCollection = !collectionEditorController.configController?.readOnly;

    const tooltipTitle = collectionEditorController.configController?.readOnly
        ? (collectionEditorController.configController.readOnlyReason || t("studio_editor_collection_disabled"))
        : (canEditCollection ? t("studio_editor_collection_edit") : t("studio_editor_collection_no_permission"));

    const editorButton = <Tooltip
        asChild={true}
        title={tooltipTitle}>
        <IconButton
            size={"small"}
            color={"primary"}
            disabled={!canEditCollection}
            onClick={canEditCollection
                ? () => collectionEditorController?.editCollection({
                    id: collection.slug,
                    path,
                    parentCollectionSlugs,
parentEntityIds,
                    parentCollection: parentCollection as AdminCollection,
                    existingEntities: tableController?.data ?? []
                })
                : undefined}>
            <SettingsIcon/>
        </IconButton>
    </Tooltip>;

    return <>
        {editorButton}
    </>

}
