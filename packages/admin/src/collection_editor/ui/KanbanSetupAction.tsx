import React from "react";
import { useTranslation } from "@rebasepro/core";
import { SnapshotCollection } from "@rebasepro/types";
import { Button } from "@rebasepro/ui";
import { useCollectionEditorController } from "../useCollectionEditorController";

/**
 * Component rendered when Kanban view is missing orderProperty configuration.
 * Provides a CTA button to open the collection editor to configure Kanban.
 */
export function KanbanSetupAction({
    collection,
    fullPath,
    parentCollectionSlugs,
    parentSnapshotIds
}: {
    collection: SnapshotCollection;
    fullPath: string;
    parentCollectionSlugs: string[], parentSnapshotIds: string[];
}) {
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    const handleConfigureClick = () => {
        collectionEditorController.editCollection({
            id: collection.slug,
            parentCollectionSlugs,
parentSnapshotIds,
            initialView: "display",
            expandKanban: true
        });
    };

    return (
        <Button
            variant="filled"
            onClick={handleConfigureClick}
        >
            {t("studio_kanban_configure")}
        </Button>
    );
}
