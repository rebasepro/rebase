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
    size
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
    } else if (property.ui?.url) {
        return (
            <UrlComponentPreview size={size}
                url={strValue}
                previewType={typeof property.ui?.url === "string" ? property.ui?.url as PreviewType : undefined}/>
        );
    } else {
        if (!strValue) return <></>;
        const lines = strValue.split("\n");
        return strValue && strValue.includes("\n")
            ? <div className={cls("overflow-x-scroll overflow-hidden", size === "small" ? "text-sm" : "")}>
                {lines.map((str: any, index: number) =>
                    <React.Fragment key={`string_preview_${index}`}>
                        <span>{str}</span>
                        {index !== lines.length - 1 && <br/>}
                    </React.Fragment>)}
            </div>
            : (size === "small"
                ? <span className={"text-sm"}>{strValue}</span>
                : <>{strValue}</>
            );
    }
}
