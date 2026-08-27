import { useTranslation } from "@rebasepro/app";
import { Property } from "@rebasepro/types";
import { EntityTableController, AdminCollection } from "@rebasepro/cms-types";
import { IconButton, SettingsIcon, Tooltip } from "@rebasepro/ui";
import React from "react";
import { useCollectionEditorController } from "../useCollectionEditorController";

export function CollectionViewHeaderAction({
    propertyKey,
    onHover,
    property,
    path,
    parentCollectionSlugs, parentEntityIds,
    collection,
    tableController
}: {
    property: Property,
    propertyKey: string,
    onHover: boolean,
    path: string,
    parentCollectionSlugs: string[], parentEntityIds: string[],
    collection: AdminCollection;
    tableController: EntityTableController;
}) {

    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    return (
        <Tooltip
            asChild={true}
            title={t("studio_collection_view_edit")}>
            <IconButton
                className={onHover ? "bg-white dark:bg-surface-900" : "hidden"}
                onClick={() => {
                    collectionEditorController.editProperty({
                        propertyKey,
                        property,
                        editedCollectionId: collection.slug,
                        parentCollectionSlugs,
parentEntityIds,
                        collection,
                        existingEntities: tableController.data ?? []
                    });
                }}
                size={"small"}>
                <SettingsIcon/>
            </IconButton>
        </Tooltip>
    )
}
