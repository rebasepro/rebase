import { useTranslation } from "@rebasepro/core";
import { CollectionConfig, SnapshotTableController, Property } from "@rebasepro/types";
import { IconButton, SettingsIcon, Tooltip } from "@rebasepro/ui";
import React from "react";
import { useCollectionEditorController } from "../useCollectionEditorController";

export function CollectionViewHeaderAction({
    propertyKey,
    onHover,
    property,
    path,
    parentCollectionSlugs, parentSnapshotIds,
    collection,
    tableController
}: {
    property: Property,
    propertyKey: string,
    onHover: boolean,
    path: string,
    parentCollectionSlugs: string[], parentSnapshotIds: string[],
    collection: CollectionConfig;
    tableController: SnapshotTableController;
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
parentSnapshotIds,
                        collection,
                        existingSnapshots: tableController.data ?? []
                    });
                }}
                size={"small"}>
                <SettingsIcon/>
            </IconButton>
        </Tooltip>
    )
}
