import { useCallback, useEffect, useState, useMemo } from "react";
import { UnsavedChangesDialogProps } from "../components/UnsavedChangesDialog";
import { useNavigationBlocker } from "./useNavigationBlocker";

/**
 * A single, unified hook to prevent navigation when there are unsaved changes.
 *
 * It automatically handles:
 * 1. Internal React Router navigation using `useBlocker`.
 * 2. External browser navigation (page refresh, tab close) using `beforeunload`.
 *
 * `when` may be a function, read at the moment a navigation is attempted. Pass
 * one when the flag can be cleared in the same tick as the navigation it
 * should let through — a save that reports the form clean and then moves on.
 * A boolean is only seen once its component re-renders, which is after a
 * navigation raised in that tick has already been blocked.
 */
export function useUnsavedChangesDialog(
    when: boolean | (() => boolean),
    onOk: () => void
): {
    dialogProps: UnsavedChangesDialogProps;
    triggerDialog: () => void;
} {
    const [manualDialogOpen, setManualDialogOpen] = useState(false);

    const isBlocking = useCallback(
        () => typeof when === "function" ? when() : when,
        [when]
    );

    const blocker = useNavigationBlocker(
        useCallback(
            ({ currentLocation, nextLocation }) =>
                currentLocation.pathname !== nextLocation.pathname && isBlocking(),
            [isBlocking]
        )
    );

    useEffect(() => {
        if (!when) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!isBlocking()) return;
            e.preventDefault();
            e.returnValue = "";
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [when, isBlocking]);

    const handleOk = useCallback(() => {
        onOk();
        if (blocker.state === "blocked") {
            blocker.proceed();
        }
        setManualDialogOpen(false);
    }, [blocker, onOk]);

    const handleCancel = useCallback(() => {
        if (blocker.state === "blocked") {
            blocker.reset();
        }
        setManualDialogOpen(false);
    }, [blocker]);

    const triggerDialog = useCallback(() => setManualDialogOpen(true), []);

    return useMemo(() => ({
        dialogProps: {
            open: manualDialogOpen || blocker.state === "blocked",
            handleOk,
            handleCancel,
            body: "There are unsaved changes in this collection"
        },
        triggerDialog
    }), [manualDialogOpen, blocker.state, handleOk, handleCancel, triggerDialog]);
}
