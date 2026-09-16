import React, { useState } from "react";
import { useTranslation } from "@rebasepro/app";
import { CheckIcon, cls, CopyIcon } from "@rebasepro/ui";

/**
 * A property's key, shown beside its label while the label is hovered, and
 * copied when clicked.
 *
 * Inline, in the label row's own empty space, rather than a tooltip. The tooltip
 * this replaces wrapped the field's control as well as its label, so it opened
 * the moment a field took focus and sat on top of the label of the very field
 * being filled in. Closing again on blur, it was also what threw Tab out of the
 * dialog (see `useRestoreInterruptedFocus` in `@rebasepro/ui`). A key a
 * developer copies now and then is not worth a layer over the form.
 *
 * Revealed by hovering the nearest `group/label` ancestor, after a pause, so a
 * pointer crossing the form does not flicker keys on and off; hidden again at
 * once. Out of the tab order: a stop per field would double the keystrokes it
 * takes to get through a form, for something only the pointer needs.
 *
 * Gives up its width before the label does (`shrink-[999]`), so a long field
 * name in a narrow column is never truncated to make room for a key that is not
 * even showing.
 */
export function PropertyKeyHint({
    propertyKey,
    className
}: {
    propertyKey: string;
    className?: string;
}) {

    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const copy = (event: React.MouseEvent) => {
        // Labels sit inside things that act on a click — an expandable
        // panel's header, above all. Copying a key must not also toggle it.
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard?.writeText(propertyKey).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }, () => undefined);
    };

    return (
        <button type={"button"}
            tabIndex={-1}
            onClick={copy}
            aria-label={`${t("copy")} ${propertyKey}`}
            className={cls(
                "inline-flex items-center gap-1 min-w-0 shrink-[999] px-1 -my-0.5 rounded-md",
                "font-mono text-[11px] font-normal leading-tight",
                "text-text-disabled dark:text-text-disabled-dark",
                "hover:text-text-secondary dark:hover:text-text-secondary-dark hover:bg-surface-hover",
                "opacity-0 transition-opacity duration-150 group-hover/label:opacity-100 group-hover/label:delay-500",
                className
            )}>
            <span className={"truncate"}>{propertyKey}</span>
            {copied
                ? <CheckIcon size={11} className={"shrink-0"}/>
                : <CopyIcon size={11} className={"shrink-0"}/>}
        </button>
    );
}
