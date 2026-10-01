import React, { useEffect, useState } from "react";
import { Markdown, type MarkdownProps } from "@rebasepro/ui";
import { resolveStorageReferences, STORAGE_REFERENCE_SCHEME } from "@rebasepro/types";
import { useStorageReferenceResolver } from "../../hooks/useStorageReferenceResolver";

/**
 * Removes every storage reference from the text, for the moment before their
 * URLs arrive: an image whose `src` is a reference is a request the browser
 * would send to nowhere.
 */
const withoutReferences = (source: string) =>
    source.replace(/\(rebase-storage:[^)\s]*/g, "(");

/**
 * Markdown whose images may be stored as `rebase-storage:` references — what
 * the markdown editor writes for an uploaded image — rendered with a freshly
 * signed URL for each.
 *
 * @internal
 */
export function StorageMarkdown({ source, ...props }: MarkdownProps) {
    const resolve = useStorageReferenceResolver();
    const text = typeof source === "string" ? source : "";
    const hasReferences = text.includes(STORAGE_REFERENCE_SCHEME);
    const [resolved, setResolved] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (!hasReferences) return;
        let live = true;
        setResolved(undefined);
        resolveStorageReferences(text, resolve).then((value) => {
            if (live) setResolved(value);
        });
        return () => {
            live = false;
        };
    }, [text, hasReferences, resolve]);

    const shown = !hasReferences ? text : resolved ?? withoutReferences(text);
    return <Markdown source={shown} {...props}/>;
}
