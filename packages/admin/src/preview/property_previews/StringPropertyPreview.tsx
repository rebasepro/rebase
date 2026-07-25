import type { StringProperty } from "@rebasepro/types";
import React from "react";

import { EnumValuesChip } from "../components/EnumValuesChip";
import { PreviewType } from "@rebasepro/types";
import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import { UrlComponentPreview } from "../components/UrlComponentPreview";
import { ErrorBoundary } from "@rebasepro/ui";
import { Chip, cls, getColorSchemeForSeed } from "@rebasepro/ui";

/**
 * @group Preview components
 */
export function StringPropertyPreview({
    propertyKey,
    value,
    property,
    size,
    textOnly
}: PropertyPreviewProps<StringProperty>): React.ReactElement {

    const strValue = value as string;

    if (property.enum) {
        const enumKey = strValue;
        return <EnumValuesChip
            enumKey={enumKey}
            enumValues={property.enum}
            size={size}/>;
    } else if (property.ui?.previewAsTag) {
        const colorScheme = getColorSchemeForSeed(propertyKey ?? "");
        return (
            <ErrorBoundary>
                <Chip
                    colorScheme={colorScheme}
                    size={size}>
                    {strValue}
                </Chip>
            </ErrorBoundary>);
    } else if (property.ui?.urlPreview) {
        return (
            <UrlComponentPreview size={size}
                url={strValue}
                previewType={typeof property.ui?.urlPreview === "string" ? property.ui?.urlPreview as PreviewType : undefined}/>
        );
    } else {
        if (!strValue) return <></>;
        // When used as a title/subtitle (textOnly), collapse newlines so the
        // parent `truncate` can clamp it to a single line.
        if (textOnly) {
            const singleLine = strValue.replace(/\s*\n\s*/g, " ");
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
