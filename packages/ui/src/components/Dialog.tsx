"use client";
import React, { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { focusedDisabled, paperMixin } from "../styles";
import { cls } from "../util";
import { PortalContainerProvider, usePortalContainer } from "../hooks/PortalContainerContext";
import { useRestoreInterruptedFocus } from "../hooks/useRestoreInterruptedFocus";
import { useModalFocus } from "../hooks/useModalFocus";

export type DialogProps = {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
    className?: string;
    containerClassName?: string;
    fullWidth?: boolean;
    fullHeight?: boolean;
    fullScreen?: boolean;
    scrollable?: boolean;
    maxWidth?: keyof typeof widthClasses;
    modal?: boolean;
    onOpenAutoFocus?: (e: Event) => void;
    /**
     * Called when focus is about to return after the dialog closes. By default
     * it goes back to the element that had it when the dialog opened; call
     * `preventDefault()` to put it somewhere else.
     */
    onCloseAutoFocus?: (e: Event) => void;
    onEscapeKeyDown?: (e: KeyboardEvent) => void;
    onPointerDownOutside?: (e: Event) => void;
    onInteractOutside?: (e: Event) => void;
    /**
     * Whether a click on the dimmed backdrop closes the dialog. Off by default:
     * a record or a form dialog holds work that one stray click must not throw
     * away. Turn it on for a picker, where closing loses nothing. Escape closes
     * either kind.
     */
    dismissOnBackdrop?: boolean;
    /**
     * The element to focus when the dialog opens, for a dialog whose purpose is
     * one field. Without it the dialog focuses itself, so a screen reader
     * announces it by its title and a phone does not raise its keyboard.
     */
    initialFocus?: React.RefObject<HTMLElement | null>;
    /**
     * If `true` (the default), the dialog will not focus the first focusable
     * element when opened: it focuses its own container instead. `false` lets
     * the first focusable element take focus.
     */
    disableInitialFocus?: boolean;
    portalContainer?: HTMLElement | null;
    "aria-describedby"?: string;
};

const widthClasses = {
    xs: "max-w-xs w-xs",
    sm: "max-w-sm w-sm",
    md: "max-w-md w-md",
    lg: "max-w-lg w-lg",
    xl: "max-w-xl w-xl",
    "2xl": "max-w-2xl w-2xl",
    "3xl": "max-w-3xl w-3xl",
    "4xl": "max-w-4xl w-4xl",
    "5xl": "max-w-5xl w-5xl",
    "6xl": "max-w-6xl w-6xl",
    "7xl": "max-w-7xl w-7xl",
    full: "max-w-full w-full"
};

export const Dialog = ({
                           open,
                           onOpenChange,
                           children,
                           className,
                           containerClassName,
                           fullWidth = true,
                           fullHeight,
                           fullScreen,
                           scrollable = true,
                           maxWidth = "lg",
                           modal = true,
                           onOpenAutoFocus,
                           onCloseAutoFocus,
                           onEscapeKeyDown,
                           onPointerDownOutside,
                           onInteractOutside,
                           dismissOnBackdrop = false,
                           initialFocus,
                           disableInitialFocus = true,
                           portalContainer,
                           "aria-describedby": ariaDescribedby
                       }: DialogProps) => {
    const [displayed, setDisplayed] = useState(false);
    // Where popups rendered *inside* this dialog get portaled to. A modal
    // dialog locks scrolling everywhere but its own content, so a popup
    // portaled to `document.body` renders fine and then refuses to scroll:
    // `react-remove-scroll` cancels every wheel event outside the lock.
    // Handing descendants this host keeps them inside it.
    const [popupHost, setPopupHost] = useState<HTMLDivElement | null>(null);

    // The focus trap's container. Tab between two fields used to land here
    // whenever the first field's tooltip closed on the way out.
    const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
    useRestoreInterruptedFocus(contentEl);

    // The two surfaces outside the paper: a pointer-down on either is a
    // click on the backdrop. Anything else outside the paper — a toast, a
    // popup some other layer portaled to the body — is not.
    const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
    const [layerEl, setLayerEl] = useState<HTMLDivElement | null>(null);

    const focus = useModalFocus({
        open: Boolean(open),
        initialFocus,
        focusContainer: disableInitialFocus,
        onOpenAutoFocus,
        onCloseAutoFocus
    });

    // Get the portal container from context
    const contextContainer = usePortalContainer();

    // Prioritize manual prop, fallback to context container
    const finalContainer = (portalContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

    useEffect(() => {
        if (!open) {
            const timeout = setTimeout(() => {
                setDisplayed(false);
            }, 100);
            return () => clearTimeout(timeout);
        } else {
            setDisplayed(true);
            return () => {
            };
        }
    }, [open]);

    return (
        <DialogPrimitive.Root open={displayed || open}
                              modal={modal}
                              onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal container={finalContainer}>

                <div ref={setLayerEl}
                     className={cls("fixed inset-0 z-50 flex justify-center items-center", containerClassName)}>

                    <DialogPrimitive.Overlay
                        ref={setOverlayEl}
                        className={cls("fixed inset-0 transition-opacity ease-in-out duration-200 bg-black/50 dark:bg-black/60 backdrop-blur-sm",
                            displayed && open ? "opacity-100" : "opacity-0",
                            "z-50 fixed top-0 left-0 w-full h-full"
                        )}
                        style={{
                            pointerEvents: displayed ? "auto" : "none"
                        }}
                    />

                    {/* The content IS the paper's box: what is outside it is the
                        backdrop, and what assistive technology and a test runner
                        measure as the dialog is what the user sees. It used to fill
                        the viewport, so the dimmed area was part of the dialog and
                        the outside-click handlers could never fire. The paper itself
                        is a child because its open animation scales it, and a
                        transform would make it the containing block of every popup
                        portaled into the host beside it. */}
                    <DialogPrimitive.Content
                        ref={setContentEl}
                        onEscapeKeyDown={onEscapeKeyDown}
                        onOpenAutoFocus={focus.onOpenAutoFocus}
                        onCloseAutoFocus={focus.onCloseAutoFocus}
                        onPointerDownOutside={(e) => {
                            onPointerDownOutside?.(e);
                            if (e.defaultPrevented) return;
                            const target = e.target;
                            const onBackdrop = target === overlayEl || target === layerEl;
                            if (!dismissOnBackdrop || !onBackdrop) e.preventDefault();
                        }}
                        // Focus leaving the paper is not a request to close it. A modal
                        // dialog already ignores it; a non-modal one would dismiss.
                        onFocusOutside={(e) => e.preventDefault()}
                        onInteractOutside={onInteractOutside}
                        aria-describedby={ariaDescribedby}
                        className={cls(
                            "relative z-60 outline-none",
                            // Focused on open so a screen reader announces it; it is
                            // a container, not a control, so it draws no ring.
                            focusedDisabled,
                            fullWidth && !fullScreen ? "w-11/12" : undefined,
                            fullHeight && !fullScreen ? "h-[90vh]" : undefined,
                            fullScreen ? "h-screen w-screen" : undefined,
                            maxWidth && !fullScreen ? widthClasses[maxWidth] : undefined
                        )}
                    >
                        <div
                            className={cls(paperMixin,
                                "rounded-2xl",
                                "z-60",
                                "relative",
                                "w-full",
                                "overflow-hidden",
                                "outline-none focus:outline-none",
                                fullHeight || fullScreen ? "h-full" : undefined,
                                "text-text-primary dark:text-text-primary-dark",
                                "justify-center items-center",
                                fullScreen ? undefined : "max-h-[90vh] shadow-lg",
                                "ease-in-out duration-200",
                                scrollable && "overflow-y-auto",
                                displayed && open ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]",
                                className
                            )}>
                            <PortalContainerProvider container={popupHost}>
                                {children}
                            </PortalContainerProvider>
                        </div>

                        {/* Sized to nothing so it changes no layout, but positioned and
                            stacked above the paper so popups portaled here are not
                            painted behind it. */}
                        <div ref={setPopupHost} className={"relative z-70 w-0 h-0"}/>

                    </DialogPrimitive.Content>
                </div>

            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
};
