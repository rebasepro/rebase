import type { PluginFormActionProps } from "@rebasepro/cms-types";
import { hasEntityId } from "../../util/identity";
import React from "react";
;
import { LastEditedByIndicator } from "./LastEditedByIndicator";

/**
 * Renders the "last edited by" indicator in the entity form top bar.
 * Used as a plugin `form.ActionsTop` component.
 */
export function LastEditedByFormAction({
    id,
    path,
    status,
    collection
}: PluginFormActionProps) {
    if (status === "new" || status === "copy" || !hasEntityId(id)) return null;
    if (!collection.history) return null;

    return <LastEditedByIndicator
        path={path}
        entityId={id.toString()}
        collection={collection}
    />;
}
