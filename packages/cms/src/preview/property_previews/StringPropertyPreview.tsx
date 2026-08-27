import type { StringProperty } from "@rebasepro/types";
import React from "react";

import { EnumValuesChip } from "../components/EnumValuesChip";
import { PreviewType } from "@rebasepro/cms-types";
import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import { UrlComponentPreview } from "../components/UrlComponentPreview";
import { ErrorBoundary } from "@rebasepro/ui";
import { Chip, cls, getColorSchemeForSeed } from "@rebasepro/ui";
import { collapseToSingleLine } from "../compact_text";

/**
 * @group Preview components
 */
export function StringPropertyPreview({
    propertyKey,
    value,
    property,
    size,
    textOnly,
    compact
}: PropertyPreviewProps<StringProperty>): React.ReactElement {

    const strValue = value as string;

    if (property.enum) {
        const enumKey = strValue;
        return <EnumValuesChip
            enumKey={enumKey}
            enumValues={property.enum}
            size={size}/>;
    } else if (property.admin?.previewAsTag) {
        const colorScheme = getColorSchemeForSeed(propertyKey ?? "");
        return (
            <ErrorBoundary>
                <Chip
                    colorScheme={colorScheme}
                    size={size}>
                    {strValue}
                </Chip>
            </ErrorBoundary>);
    } else if (property.admin?.urlPreview) {
        return (
            <UrlComponentPreview size={size}
                url={strValue}
                previewType={typeof property.admin?.urlPreview === "string" ? property.admin?.urlPreview as PreviewType : undefined}/>
        );
    } else {
        if (!strValue) return <></>;
        // A title/subtitle (textOnly) or a card line (compact) is one line, and
        // `truncate` only clamps text that has no newlines of its own to break
        // on — so the newlines come out here rather than in CSS.
        if (textOnly || compact) {
            const singleLine = collapseToSingleLine(strValue);
            return size === "small"
                ? <span className={"text-sm"}>{singleLine}</span>
                : <>{singleLine}</>;
        }
        return strValue.includes("\n")
            ? <div className={cls(
                "whitespace-pre-line line-clamp-3 overflow-hidden",
                size === "small" ? "text-sm" : "")}>
                {strValue}
            </div>
            : (size === "small"
                ? <span className={"text-sm"}>{strValue}</span>
                : <>{strValue}</>
            );
    }
}
