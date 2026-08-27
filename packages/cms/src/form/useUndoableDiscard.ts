import { useCallback } from "react";
import type { EntityStatus } from "@rebasepro/types";
import type { FormexController } from "@rebasepro/forms";
import { useSafeSnackbarController } from "../collection_editor/useSafeSnackbarController";

/**
 * Throw away everything the user has typed, reversibly.
 *
 * "Discard" and "Clear" sit next to Save, take one click, and undo everything
 * the user has done since they opened the record — the identity bar's version
 * does not even stop to ask. So the reset goes *through* the undo history
 * rather than around it (see `undoable` in `FormexResetProps`), and the
 * confirmation carries the Undo, which is the only place it can be: the form
 * has no undo button, only the ⌘Z the user has no reason to guess at.
 *
 * Pass `values` to reset to something other than the form's current baseline.
 */
export function useUndoableDiscard() {

    const snackbarController = useSafeSnackbarController();

    return useCallback((
        formex: FormexController<any>,
        status: EntityStatus,
        values?: unknown
    ) => {
        formex.resetForm(values !== undefined
            ? { values, undoable: true }
            : { undoable: true });
        snackbarController?.open({
            type: "info",
            message: status === "existing" ? "Changes discarded" : "Form cleared",
            action: {
                label: "Undo",
                onClick: () => formex.undo()
            }
        });
    }, [snackbarController]);
}
