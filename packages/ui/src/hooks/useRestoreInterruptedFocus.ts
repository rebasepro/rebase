"use client";
import { useEffect } from "react";

/**
 * Finish a focus move that a modal's focus trap interrupted.
 *
 * Radix's `FocusScope` watches a modal for removed nodes, and when one goes
 * while `document.activeElement` is `body` it concludes the focused element was
 * deleted and focuses the modal itself. But `body` is also what `activeElement`
 * reads *during* an ordinary focus move: the browser fires `focusout` before it
 * lands on the next element. Anything that unmounts in response — a tooltip that
 * opened on focus closing on blur, above all — is removed inside that window.
 * The scope focuses the container, the browser abandons the move it was making,
 * and Tab from one field lands on the dialog, so the next Tab starts again from
 * the header. Shift+Tab the same.
 *
 * So remember where each move inside the container was going, and if the
 * container takes focus before the move lands, send it on. A move that nothing
 * interrupts lands on its target and clears the note; a note nobody used is
 * dropped by the next task.
 *
 * The note is taken on `window`, in the capture phase — before any other
 * listener for the event runs. The scope's correction arrives in the microtask
 * checkpoint after whichever listener removed the node, so a note taken any
 * later (on the container, bubbling) is taken after focus has already been
 * moved: a field that drops something from its own `focusout` handler beat it.
 *
 * Internal to the kit's modals — not exported.
 */
export function useRestoreInterruptedFocus(container: HTMLElement | null) {
    useEffect(() => {
        if (!container) return;

        let intended: HTMLElement | null = null;
        let expiry: ReturnType<typeof setTimeout> | undefined;

        const onFocusOut = (event: FocusEvent) => {
            if (!(event.target instanceof Node) || !container.contains(event.target)) return;
            const next = event.relatedTarget;
            intended = next instanceof HTMLElement && next !== container && container.contains(next)
                ? next
                : null;
            clearTimeout(expiry);
            if (intended) expiry = setTimeout(() => {
                intended = null;
            }, 0);
        };

        const onFocusIn = (event: FocusEvent) => {
            const target = intended;
            intended = null;
            if (event.target === container && target?.isConnected && container.contains(target)) {
                target.focus();
            }
        };

        window.addEventListener("focusout", onFocusOut, true);
        container.addEventListener("focusin", onFocusIn);
        return () => {
            clearTimeout(expiry);
            window.removeEventListener("focusout", onFocusOut, true);
            container.removeEventListener("focusin", onFocusIn);
        };
    }, [container]);
}
