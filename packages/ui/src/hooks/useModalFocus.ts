"use client";
import React, { useCallback, useState } from "react";

export type ModalFocusOptions = {
    /** Whether the modal is open. Focus is recorded on the closed → open edge. */
    open: boolean;
    /**
     * The element to focus when the modal opens. Without it the modal focuses
     * itself (see {@link useModalFocus}).
     */
    initialFocus?: React.RefObject<HTMLElement | null>;
    /**
     * `false` hands the choice back to Radix: the first focusable element
     * inside the modal takes focus. `true` (the default) focuses the modal's
     * own container.
     */
    focusContainer?: boolean;
    onOpenAutoFocus?: (event: Event) => void;
    onCloseAutoFocus?: (event: Event) => void;
};

function currentFocus(): HTMLElement | null {
    if (typeof document === "undefined") return null;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return null;
    // A modal opened from a menu item: the item leaves the document as the menu
    // closes, so the place to come back to is the menu's trigger — the element
    // whose `aria-controls` names the open menu (Radix sets it on every trigger).
    const layer = active.closest("[role=menu], [role=listbox]");
    if (layer instanceof HTMLElement && layer.id && layer !== active) {
        const trigger = Array.from(document.querySelectorAll("[aria-controls]"))
            .find((el) => el.getAttribute("aria-controls") === layer.id);
        if (trigger instanceof HTMLElement && !layer.contains(trigger)) return trigger;
    }
    return active;
}

/**
 * Where focus goes when a kit modal (`Dialog`, `Sheet`) opens and closes.
 *
 * Both used to cancel Radix's open-focus and do nothing else, so focus stayed
 * on the trigger behind the modal — which Radix had just hidden from assistive
 * technology with `aria-hidden`. A screen reader announced nothing, and Enter
 * pressed again fired the trigger a second time underneath the open modal.
 *
 * On open, focus moves into the modal: to `initialFocus` when the caller names
 * an element, otherwise to the modal's own container (it carries
 * `tabIndex=-1`). The container rather than the first field, because the first
 * field on a phone raises the keyboard over a form the user has not started,
 * and because the container is what a screen reader announces by its title.
 * The first Tab then lands on the first control.
 *
 * On close, focus goes back to whatever had it when the modal opened. Radix
 * only returns it to a `Dialog.Trigger`, and the kit's modals are controlled —
 * there is no trigger — so focus used to fall to `<body>` and the next Tab
 * started from the top of the page.
 *
 * The origin is read while rendering the open edge, not from the open-focus
 * event: a field with `autoFocus` inside the modal has taken focus by the time
 * any effect runs, and Radix then skips the event altogether. When the origin
 * is an item in a menu, the menu's trigger is recorded instead: the item is
 * gone a moment later, and the menu does not take focus back to its trigger
 * once the modal has it.
 *
 * Internal to the kit's modals — not exported.
 */
export function useModalFocus({
                                  open,
                                  initialFocus,
                                  focusContainer = true,
                                  onOpenAutoFocus,
                                  onCloseAutoFocus
                              }: ModalFocusOptions) {
    const [origin, setOrigin] = useState<HTMLElement | null>(() => open ? currentFocus() : null);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setOrigin(currentFocus());
    }

    const handleOpenAutoFocus = useCallback((event: Event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;

        const target = initialFocus?.current;
        if (target) {
            event.preventDefault();
            target.focus({ preventScroll: true });
            return;
        }
        if (!focusContainer) return; // Radix focuses the first focusable element
        event.preventDefault();
        // The event is dispatched on the focus scope's container: the content.
        const container = event.currentTarget;
        if (container instanceof HTMLElement) container.focus({ preventScroll: true });
    }, [initialFocus, focusContainer, onOpenAutoFocus]);

    const handleCloseAutoFocus = useCallback((event: Event) => {
        onCloseAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (origin?.isConnected) origin.focus({ preventScroll: true });
    }, [origin, onCloseAutoFocus]);

    return { onOpenAutoFocus: handleOpenAutoFocus, onCloseAutoFocus: handleCloseAutoFocus };
}
