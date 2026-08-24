import React from "react";
import { cls } from "../../util";

/**
 * The label above a Select or MultiSelect.
 *
 * It used `text-surface-accent-500` — a SURFACE scale, borrowed for type. The
 * label above a TextField has always used `text-text-secondary`, and the two are
 * the same role, so a form mixing the components showed two different label
 * colours: `#64748b` blue-grey over a Select, `#757575` neutral over a TextField.
 * Measured side by side on /debug/ui, which is where it is most obvious, because
 * the reference puts them in adjacent columns.
 *
 * The text tokens are also the tuned ones: `--color-surface-500` was moved to
 * #797979 precisely so muted type clears AA on both grounds. The slate scale
 * carries no such guarantee — it is for surfaces.
 */
export function SelectInputLabel({ children, error }: { children: React.ReactNode, error?: boolean }) {
    return <div className={cls("text-sm font-medium ml-3.5 mb-1",
        error ? "text-red-600 dark:text-red-500" : "text-text-secondary dark:text-text-secondary-dark")}>
        {children}
    </div>;
}
