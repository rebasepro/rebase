import type { PluginFormActionProps } from "@rebasepro/types";
import React from "react";
;
import { LastEditedByIndicator } from "./LastEditedByIndicator";

/**
 * Renders the "last edited by" indicator in the snapshot form top bar.
 * Used as a plugin `form.ActionsTop` component.
 */
export function LastEditedByFormAction({
    snapshotId,
    path,
    status,
    collection
}: PluginFormActionProps) {
    if (status === "new" || status === "copy" || !snapshotId) return null;
    if (!collection.history) return null;

    return <LastEditedByIndicator
        path={path}
        snapshotId={snapshotId.toString()}
        collection={collection}
    />;
}
