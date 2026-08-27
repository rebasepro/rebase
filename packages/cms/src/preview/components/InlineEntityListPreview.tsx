import * as React from "react";

import { cls } from "@rebasepro/ui";

/**
 * How many links a nested list shows before collapsing the rest into a count.
 */
const MAX_INLINE_ITEMS = 3;

export type InlineEntityListPreviewProps<T> = {
    items: T[];
    renderItem: (item: T, index: number) => React.ReactNode;
    max?: number;
    className?: string;
};

/**
 * One wrapping line of inline entity links, with the overflow collapsed into a
 * `+N`. Used for arrays of references or relations that are nested inside
 * another preview, where stacking full-width cards turns a card into a wall.
 *
 * @group Preview components
 */
export function InlineEntityListPreview<T>({
    items,
    renderItem,
    max = MAX_INLINE_ITEMS,
    className
}: InlineEntityListPreviewProps<T>) {

    if (!items || items.length === 0) return null;

    const shown = items.slice(0, max);
    const overflow = items.length - shown.length;

    return <span className={cls("inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 max-w-full", className)}>
        {shown.map((item, index) => renderItem(item, index))}
        {overflow > 0 && <span className={"text-text-secondary dark:text-text-secondary-dark shrink-0"}>
            +{overflow}
        </span>}
    </span>;
}
