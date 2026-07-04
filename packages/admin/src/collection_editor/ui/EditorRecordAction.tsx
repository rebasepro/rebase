import { useCollectionRegistryController } from "../_cms_internals";
import { useAuthController, useTranslation } from "@rebasepro/core";
import { CollectionConfig, PluginFormActionProps } from "@rebasepro/types";
import { IconButton, SettingsIcon, Tooltip } from "@rebasepro/ui";

import { useCollectionEditorController } from "../useCollectionEditorController";

export function EditorRecordAction({
    path,
    parentCollectionSlugs, parentSnapshotIds,
    collection,
    formContext
}: PluginFormActionProps) {

    const authController = useAuthController();
    const collectionRegistry = useCollectionRegistryController();
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    const parentCollection = parentCollectionSlugs.length > 0 ? collectionRegistry.getCollection(parentCollectionSlugs[parentCollectionSlugs.length - 1]) : undefined;

    const canEditCollection = !collectionEditorController.configController?.readOnly;

    const isDirty = formContext?.formex.dirty ?? false;

    const editorButton = <Tooltip
        asChild={true}
        title={canEditCollection ? (isDirty ? t("studio_editor_snapshot_save_first") : t("studio_editor_snapshot_edit_schema")) : t("studio_editor_snapshot_no_permission")}>
        <IconButton
            color={"primary"}
            disabled={Boolean(!canEditCollection || isDirty)}
            onClick={canEditCollection
                ? () => collectionEditorController?.editCollection({
                    id: collection.slug,
                    path,
                    parentCollectionSlugs,
parentSnapshotIds,
                    parentCollection: parentCollection as CollectionConfig
                })
                : undefined}>
            <SettingsIcon/>
        </IconButton>
    </Tooltip>;

    return <>
        {editorButton}
    </>

}
