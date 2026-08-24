import React from "react";
import { Slot } from "@rebasepro/ui";

// Slot merges the props/classes given to it directly onto its single child
// element instead of wrapping it in an extra node — the classic `asChild`
// pattern, here turning a plain <a> into a styled button-like link.
export const AsChildLink = () => (
    <div className="flex items-center gap-3 p-4">
        <Slot className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
            <a href="https://rebase.pro/pricing">View pricing</a>
        </Slot>
        <Slot className="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 px-4 py-2 text-sm font-medium">
            <button type="button">Cancel</button>
        </Slot>
    </div>
);
