import type { SideDialogPanelProps } from "../hooks/useSideDialogsController";
import React, { useCallback, useContext, useEffect, useState, useMemo } from "react";
import { useSideDialogsController } from "../hooks";
import { Sheet, Dialog } from "@rebasepro/ui";
import { useUnsavedChangesDialog, UnsavedChangesDialog } from "@rebasepro/app";
import { ErrorBoundary } from "@rebasepro/ui";
import type { SidePanelBindingProps } from "@rebasepro/cms-types";


export type SideDialogController = {
    blocked: boolean,
    setBlocked: (blocked: boolean) => void,
    setBlockedNavigationMessage: (message?: React.ReactNode) => void,
    width?: string,
    close: (force?: boolean) => void;
    pendingClose: boolean,
    setPendingClose: (pendingClose: boolean) => void
}

const SideDialogContext = React.createContext<SideDialogController>({
    width: "",
    blocked: false,
    setBlocked: (blocked: boolean) => {
    },
    setBlockedNavigationMessage: (message?: React.ReactNode) => {
    },
    close: () => {
    },
    pendingClose: false,
    setPendingClose: () => {

    }
});

/**
 * This hook is used to access the properties of a particular side dialog,
 * in contrast with {@link useSideDialogsController} which handles the
 * state of all the dialogs.
 */
export const useSideDialogContext = () => useContext<SideDialogController>(SideDialogContext);

/**
 * This is the component in charge of rendering the side dialogs used
 * for editing entities. Use the {@link useSidePanel} to open
 * and control the dialogs.
 * This component needs a parent {@link Rebase}
 * {@link useSideDialogsController}
 * @group Components
 */
export function SideDialogs() {

    const sideDialogsController = useSideDialogsController();

    const sidePanels = sideDialogsController.sidePanels;

    // A trailing `undefined` slot ("ghost panel") is always appended so that
    // close animations work correctly. Index-based keys ensure that when the
    // last real panel is removed, the ghost inherits key=0 — re-using the
    // same SideDialogView instance so the Sheet smoothly transitions from
    // open → closed rather than unmounting instantly.
    const panels: (SideDialogPanelProps | undefined)[] = [...sidePanels];
    panels.push(undefined);

    return <>
        {
            panels.map((panel, index) =>
                <SideDialogView
                    key={`side_dialog_${index}`}
                    panel={panel}
                    panelIndex={index}
                    offsetPosition={sidePanels.length - index - 1}
                    isTopPanel={index === sidePanels.length - 1}/>)
        }
    </>;
}

function SideDialogView({
    offsetPosition,
    panel,
    panelIndex,
    isTopPanel
}: {
    offsetPosition: number,
    panel?: SideDialogPanelProps,
    panelIndex: number,
    isTopPanel: boolean
}) {

    // was the closing of the dialog requested by the drawer
    const [drawerCloseRequested, setDrawerCloseRequested] = useState<boolean>(false);
    const [blocked, setBlocked] = useState(false);
    const [blockedNavigationMessage, setBlockedNavigationMessage] = useState<React.ReactNode | undefined>();

    // Held in a ref, read through a getter, because of *when* it is written and
    // read. "Save and close" raises it and submits the form in one click
    // handler, and the callback that acts on it — the form's `onSaved` — was
    // captured before React could re-render with the new value. As state the
    // flag was therefore always read one save late: the first "save and close"
    // saved and left the panel open, and the *next* save closed it.
    // Nothing renders from it, so a ref loses nothing.
    const pendingCloseRef = React.useRef(false);
    const setPendingClose = useCallback((value: boolean) => {
        pendingCloseRef.current = value;
    }, []);

    const widthRef = React.useRef<string | undefined>(panel?.width);
    const width = widthRef.current;

    const sideDialogsController = useSideDialogsController();

    // Prevent non-topmost dialogs from being dismissed by outside clicks.
    // When stacked Sheets exist, clicking the overlay of the topmost dialog
    // would otherwise propagate and dismiss lower dialogs too.
    const preventDismiss = useCallback((e: Event) => {
        e.preventDefault();
    }, []);

    const { dialogProps, triggerDialog } = useUnsavedChangesDialog(
        blocked,
        () => setBlocked(false)
    );

    useEffect(() => {
        if (panel)
            widthRef.current = panel.width;
    }, [panel])

    const handleDrawerCloseOk = () => {
        setBlocked(false);
        setDrawerCloseRequested(false);
        sideDialogsController.close();
        panel?.onClose?.();
    };

    const handleDrawerCloseCancel = () => {
        setDrawerCloseRequested(false);
    };

    const onCloseRequest = useCallback((force?: boolean) => {
        if (blocked && !force) {
            setDrawerCloseRequested(true);
            triggerDialog();
        } else {
            sideDialogsController.close();
            panel?.onClose?.();
        }
    }, [blocked, triggerDialog, sideDialogsController, panel]);

    const contextValue = useMemo(() => ({
        blocked,
        setBlocked,
        setBlockedNavigationMessage,
        width,
        close: onCloseRequest,
        get pendingClose() {
            return pendingCloseRef.current;
        },
        setPendingClose
    }), [blocked, setBlockedNavigationMessage, width, onCloseRequest, setPendingClose]);

    const additionalProps = panel?.additional as SidePanelBindingProps | undefined;
    const isDialogMode = additionalProps?.collection?.openEntityMode === "dialog";

    return (
        <SideDialogContext.Provider value={contextValue}>

            {isDialogMode ? (
                <Dialog
                    open={Boolean(panel)}
                    onOpenChange={(open) => {
                        if (!open) {
                            onCloseRequest();
                        }
                    }}
                    maxWidth="4xl"
                    scrollable={false}
                >
                    {panel && (
                        <div className="flex flex-col h-[75vh] min-h-[500px] w-full min-w-0 max-w-full overflow-hidden">
                            <ErrorBoundary>
                                {panel.component}
                            </ErrorBoundary>
                        </div>
                    )}
                </Dialog>
            ) : (
                <Sheet
                    open={Boolean(panel)}
                    includeBackgroundOverlay={true}
                    overlayStyle={{ zIndex: 40 + panelIndex * 10 }}
                    style={{ zIndex: 45 + panelIndex * 10 }}
                    onOpenChange={(open) => {
                        if (!open) {
                            onCloseRequest();
                        }
                    }}
                    onPointerDownOutside={!isTopPanel ? preventDismiss : undefined}
                    onInteractOutside={!isTopPanel ? preventDismiss : undefined}
                    title={"Side dialog " + panel?.key}
                >
                    {panel &&
                        <div
                            className={"transform max-w-[100vw] lg:max-w-[95vw] flex flex-col h-full transition-all duration-250 ease-in-out bg-white dark:bg-surface-800 "}
                            style={{
                                width: panel.width,
                                transform: `translateX(-${offsetPosition * 200}px)`
                            }}
                        >
                            <ErrorBoundary>
                                {panel.component}
                            </ErrorBoundary>
                        </div>}

                    {!panel && <div style={{ width }}/>}

                </Sheet>
            )}

            <UnsavedChangesDialog
                {...dialogProps}
                handleOk={() => {
                    dialogProps.handleOk();
                    if (drawerCloseRequested) {
                        handleDrawerCloseOk();
                    }
                }}
                handleCancel={() => {
                    dialogProps.handleCancel();
                    if (drawerCloseRequested) {
                        handleDrawerCloseCancel();
                    }
                }}
                body={blockedNavigationMessage || "There are unsaved changes"}/>

        </SideDialogContext.Provider>

    );
}
