import type { SnackbarAction, SnackbarMessageType } from "@rebasepro/admin-types";
import React, { useCallback, useMemo } from "react";
import { useSnackbar } from "notistack";
import { Button } from "@rebasepro/ui";

/**
 * Hook to retrieve the SnackbarContext.
 *
 * Consider that in order to use this hook you need to have a parent
 * `Rebase`
 *
 * @see SnackbarController
 * @group Hooks and utilities
 */
export const useSnackbarController = () => {

    const {
        enqueueSnackbar,
        closeSnackbar
    } = useSnackbar();

    const open = useCallback((props: {
        type: SnackbarMessageType;
        title?: string;
        message: React.ReactNode;
        autoHideDuration?: number;
        action?: SnackbarAction;
    }) => {
        const {
            type,
            message,
            autoHideDuration,
            action
        } = props;
        enqueueSnackbar({
            message: props.title ? <div className={"flex flex-col"}>
                <strong>{props.title}</strong>
                {message}
            </div> : message,
            variant: type,
            autoHideDuration,
            // The provider sets `preventDuplicate`, which collapses two
            // snackbars carrying the same message into one. That is right for a
            // confirmation and wrong for an action: deleting two rows in a row
            // produces the same "Deleted" text twice, and swallowing the second
            // would leave the second deletion with no way to undo it. A key
            // makes each one distinct.
            ...(action ? { key: nextActionKey() } : {}),
            action: action
                ? (key) => (
                    <Button variant={"text"}
                            size={"small"}
                            className={"text-inherit"}
                            onClick={() => {
                                action.onClick();
                                // The offer has been taken; leaving it up
                                // invites a second click that undoes nothing,
                                // or worse, undoes something else.
                                closeSnackbar(key);
                            }}>
                        {action.label}
                    </Button>
                )
                : undefined
        })
    }, [enqueueSnackbar, closeSnackbar]);

    const close = useCallback(() => {
        closeSnackbar();
    }, [closeSnackbar]);

    return useMemo(() => ({
        open,
        close
    }), [open, close]);

};

let actionKeySeq = 0;
const nextActionKey = () => `rebase-snackbar-action-${actionKeySeq++}`;
