/**
 * Whether a key event has already been handled by something above you — the
 * one question every global key handler (a `keydown` listener on `window` or
 * `document`) must ask before acting.
 *
 * The rule: **a handler that acts on a key calls `event.preventDefault()`;
 * a global handler that finds the event already handled does nothing.** Every
 * kit overlay follows it for free — `Dialog`, `Sheet`, `Popover`, `Menu`,
 * `Select`, `MultiSelect`, `Tooltip` are Radix layers, and a Radix layer calls
 * `preventDefault()` on the Escape it consumes to close itself. So Escape
 * pressed in an open dropdown closes the dropdown, and the record panel's
 * Escape handler underneath sees it handled and leaves the record open.
 *
 * Two conditions make it hold:
 *
 *  - **Listen in the bubble phase.** A Radix layer listens on `document` in
 *    the capture phase, so it has run before any bubble listener — on the
 *    target, on `document` or on `window` — whatever order they were added in.
 *    A capture listener added before the layer opened runs *before* it and
 *    cannot see its claim. Only a layer of your own, one that sits above
 *    everything else while it is open, belongs in the capture phase, and it
 *    must call `preventDefault()` when it acts.
 *  - **Do not ask the DOM instead.** `document.querySelector('[role="dialog"]')`
 *    misses every layer that is not a dialog (a menu is `role="menu"`, a select
 *    list `role="listbox"`), and the list of roles is never finished.
 *
 * An IME composition counts as handled too: Escape while composing Japanese or
 * Chinese text cancels the composition, and must not close a panel.
 */
export function isKeyHandled(event: KeyboardEvent): boolean {
    return event.defaultPrevented || event.isComposing;
}
