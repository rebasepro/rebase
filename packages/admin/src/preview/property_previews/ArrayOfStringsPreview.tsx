import type { ArrayProperty, StringProperty } from "@rebasepro/types";
import React from "react";
import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import { StringPropertyPreview } from "./StringPropertyPreview";
import { ErrorBoundary } from "@rebasepro/ui";

/**
 * @group Preview components
 */
export function ArrayOfStringsPreview({
    propertyKey,
    value,
    property: property,
    // entity,
    size,
    compact
}: PropertyPreviewProps<ArrayProperty>) {

    if (Array.isArray(property.of)) {
        throw Error("Using array properties instead of single one in `of` in ArrayProperty");
    }
    if (!property.of || property.type !== "array" || property.of.type !== "string")
        throw Error("Picked wrong preview component ArrayOfStringsPreview");

    if (value && !Array.isArray(value)) {
        return <div>{`Unexpected value: ${value}`}</div>;
    }
    const stringProperty = property.of as StringProperty;
    const arrayValues = value as string[];

    // One line, so the items run along it separated by a dot rather than
    // stacking. Each still renders through the string preview: a value that is
    // a tag stays a tag, it just sits beside its neighbours.
    if (compact) {
        return (
            <span className="inline-flex items-center gap-1 min-w-0 truncate">
                {arrayValues &&
                    arrayValues.map((v, index: number) =>
                        <React.Fragment key={`preview_array_strings_${propertyKey}_${index}`}>
                            {index > 0 && <span className="opacity-40"
                                aria-hidden={true}>·</span>}
                            <ErrorBoundary>
                                <StringPropertyPreview propertyKey={propertyKey}
                                    property={stringProperty}
                                    value={v}
                                    compact={true}
                                    size={size}/>
                            </ErrorBoundary>
                        </React.Fragment>
                    )}
            </span>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {arrayValues &&
                arrayValues.map((v, index: number) =>
                    <div key={`preview_array_strings_${propertyKey}_${index}`}>
                        <ErrorBoundary>
                            <StringPropertyPreview propertyKey={propertyKey}
                                property={stringProperty}
                                value={v}
                                size={size}/>
                        </ErrorBoundary>
                    </div>
                )}
        </div>
    );
}
