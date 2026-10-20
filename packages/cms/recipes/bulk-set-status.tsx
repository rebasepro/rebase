/**
 * Recipe: a bulk action — set one field on every selected row.
 *
 * A collection's toolbar renders whatever components its `admin.Actions` lists,
 * and hands each the selection and the collection's path. This one appears
 * once rows are ticked and archives them: it reads the selection (which may be
 * "every row matching the filter", not just the ticked ones — `resolveSelection`
 * handles both), updates each row through the data layer, and clears the
 * selection. Saves go through the server, so its callbacks and security rules
 * apply to every row.
 *
 * To use it: `admin: { Actions: [ArchiveSelectedAction] }` on the collection,
 * or copy it and change `FIELD` / `VALUE` / the label.
 */
import React, { useState } from "react";
import type { CollectionActionsProps } from "@rebasepro/cms-types";
import { useData, useSnackbarController } from "@rebasepro/app";
import { resolveSelection } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

const FIELD = "status";
const VALUE = "archived";

export function ArchiveSelectedAction({ path, selectionController }: CollectionActionsProps) {
    const data = useData();
    const snackbar = useSnackbarController();
    const [running, setRunning] = useState(false);

    if (!selectionController.hasSelection) return null;

    const archive = async () => {
        setRunning(true);
        try {
            const accessor = data.collection(path);
            const rows = await resolveSelection({ selection: selectionController.selection, accessor });
            for (const row of rows) {
                await accessor.update(row.id, { [FIELD]: VALUE });
            }
            selectionController.clearSelection();
            snackbar.open({ type: "success", message: `Archived ${rows.length} row${rows.length === 1 ? "" : "s"}` });
        } catch (error) {
            snackbar.open({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
            setRunning(false);
        }
    };

    return (
        <Button size={"small"} variant={"outlined"} color={"neutral"} disabled={running} onClick={archive}>
            Archive selected
        </Button>
    );
}
