
/**
 * Possible snackbar types
 * @group Hooks and utilities
 */
export type SnackbarMessageType = "success" | "info" | "warning" | "error";

/**
 * A single button rendered inside a snackbar.
 *
 * The reason snackbars have one: undo-after-mutation is the core interaction of
 * any queue or triage screen, and the window in which "undo" means anything is
 * exactly the window the snackbar is on screen. Without a slot here every such
 * view has to build its own strip somewhere else on the page, at which point the
 * confirmation and the way to reverse it are two different pieces of UI.
 *
 * The snackbar dismisses itself after `onClick`, since the action it was
 * offering has been taken.
 *
 * @group Hooks and utilities
 */
export interface SnackbarAction {
    label: string;
    onClick: () => void;
}

/**
 * Controller to display snackbars
 * @group Hooks and utilities
 */
export interface SnackbarController {

    /**
     * Close the currently open snackbar
     */
    close: () => void;

    /**
     * Display a new snackbar. You need to specify the type and message.
     * You can optionally specify a title
     */
    open: (props: {
        type: SnackbarMessageType;
        title?: string;
        message: React.ReactNode;
        autoHideDuration?: number;
        /** A button rendered alongside the message — typically "Undo". */
        action?: SnackbarAction;
    }) => void;

}
