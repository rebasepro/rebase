import type { RebaseContext } from "@rebasepro/cms-types";

/**
 * Helpers for the sample entity actions declared across `cms/*`.
 *
 * Every collection in the demo carries a few actions that do real work on the
 * record — publish it, ship it, assign it — so the panel shows the whole range
 * of what an action can be: a button in the record's bar (`collapsed: false`),
 * an item in its ⋮ menu, and a greyed-out one that says why
 * (`isEnabled` + `disabledReason`). The demo reseeds itself every hour, so a
 * visitor is free to press them.
 *
 * Writing a record is `updateRecord` from `@rebasepro/cms`; what is here is
 * what the browser does besides.
 */

/** Copies `text` to the clipboard and says so. */
export async function copyToClipboard(context: RebaseContext | undefined, text: string, message: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    context?.snackbarController?.open({ type: "info", message });
}

/** Opens `url` in a new tab. */
export function openInNewTab(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
}

/** A string value, or undefined for anything else — enough to branch on. */
export function text(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
