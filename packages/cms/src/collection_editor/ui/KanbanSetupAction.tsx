import React from "react";
import { useTranslation } from "@rebasepro/app";

import { Button } from "@rebasepro/ui";
import { useCollectionEditorController } from "../useCollectionEditorController";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Component rendered when Kanban view is missing orderProperty configuration.
 * Provides a CTA button to open the collection editor to configure Kanban.
 */
export function KanbanSetupAction({
    collection,
    fullPath,
    parentCollectionSlugs,
    parentEntityIds
}: {
    collection: AdminCollection;
    fullPath: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
}) {
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    const handleConfigureClick = () => {
        collectionEditorController.editCollection({
            id: collection.slug,
            parentCollectionSlugs,
parentEntityIds,
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
