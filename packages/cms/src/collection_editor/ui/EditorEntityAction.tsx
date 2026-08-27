import { useCollectionRegistryController } from "../_cms_internals";
import { useAuthController, useTranslation } from "@rebasepro/app";

import { PluginFormActionProps, AdminCollection } from "@rebasepro/cms-types";
import { IconButton, SettingsIcon, Tooltip } from "@rebasepro/ui";

import { useCollectionEditorController } from "../useCollectionEditorController";

export function EditorEntityAction({
    path,
    parentCollectionSlugs, parentEntityIds,
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
        title={canEditCollection ? (isDirty ? t("studio_editor_entity_save_first") : t("studio_editor_entity_edit_schema")) : t("studio_editor_entity_no_permission")}>
        <IconButton
            color={"primary"}
            disabled={Boolean(!canEditCollection || isDirty)}
            onClick={canEditCollection
                ? () => collectionEditorController?.editCollection({
                    id: collection.slug,
                    path,
                    parentCollectionSlugs,
parentEntityIds,
                    parentCollection: parentCollection as AdminCollection
                })
                : undefined}>
            <SettingsIcon/>
        </IconButton>
    </Tooltip>;

    return <>
        {editorButton}
    </>

}
