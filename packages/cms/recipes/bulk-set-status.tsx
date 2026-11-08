/**
 * Recipe: a bulk action — set one field on every selected row.
 *
 * A collection's toolbar renders whatever components its `admin.Actions` lists,
 * and hands each the selection and the collection's path. This one appears
 * once rows are ticked and archives them: it reads the selection (which may be
 * "every row matching the filter", not just the ticked ones — `resolveSelection`
 * handles both), updates each row with `useRowWrites`, and clears the
 * selection. Each update is the save the record form makes: the collection's
 * `browserCallbacks` run, then the server's callbacks and security rules, and
 * every view of the collection reads it again. When one is refused, the rows
 * before it are already archived: it says how many, and leaves the rest
 * selected for another try.
 *
 * To use it: `admin: { Actions: [ArchiveSelectedAction] }` on the collection,
 * or copy it and change `FIELD` / `VALUE` / the label.
 */
import React, { useState } from "react";
import type { CollectionActionsProps } from "@rebasepro/cms-types";
import { useRowWrites, useSnackbarController } from "@rebasepro/app";
import { resolveSelection } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

const FIELD = "status";
const VALUE = "archived";

export function ArchiveSelectedAction({ path, collection, context, selectionController }: CollectionActionsProps) {
    const { update } = useRowWrites();
    const snackbar = useSnackbarController();
    const [running, setRunning] = useState(false);

    if (!selectionController.hasSelection) return null;

    const archive = async () => {
        setRunning(true);
        let rows: Record<string, unknown>[] = [];
        const archived = new Set<string>();
        try {
            // Rows as the server sends them: this collection's key is its
            // `id` column.
            rows = await resolveSelection({ selection: selectionController.selection, data: context.data, collection });
            for (const row of rows) {
                const id = String(row.id);
                await update(path, id, { [FIELD]: VALUE });
                archived.add(id);
            }
            selectionController.clearSelection();
            snackbar.open({ type: "success", message: `Archived ${rows.length} row${rows.length === 1 ? "" : "s"}` });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            // The ticked rows not yet archived stay ticked, for another try.
            const { selection } = selectionController;
            if (archived.size > 0 && selection.type === "rows") {
                selectionController.setSelectedRows(selection.rows.filter((row) => !archived.has(String(row.id))));
            }
            snackbar.open({
                type: "error",
                message: rows.length > 0 ? `Archived ${archived.size} of ${rows.length} rows. ${reason}` : reason
            });
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
