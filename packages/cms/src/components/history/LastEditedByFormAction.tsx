import type { PluginFormActionProps } from "@rebasepro/cms-types";
import React from "react";
;
import { LastEditedByIndicator } from "./LastEditedByIndicator";
import { hasEntityId } from "../../util/entity_id";

/**
 * Renders the "last edited by" indicator in the entity form top bar.
 * Used as a plugin `form.ActionsTop` component.
 */
export function LastEditedByFormAction({
    entityId,
    path,
    status,
    collection
}: PluginFormActionProps) {
    if (status === "new" || status === "copy" || !hasEntityId(entityId)) return null;
    if (!collection.history) return null;

    return <LastEditedByIndicator
        path={path}
        entityId={entityId.toString()}
        collection={collection}
    />;
}
