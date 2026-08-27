import type { ArrayProperty, Property } from "@rebasepro/types";
import React from "react";
import type { PropertyPreviewProps, PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useAuthController, useCustomizationController } from "@rebasepro/app";
import { PropertyPreview } from "../PropertyPreview";
import { cls, defaultBorderMixin } from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { DEFAULT_ONE_OF_TYPE, DEFAULT_ONE_OF_VALUE } from "@rebasepro/common";

/**
 * @group Preview components
 */
export function ArrayOneOfPreview({
    propertyKey,
    value,
    property: property,
    size,
    compact
    // entity
}: PropertyPreviewProps<ArrayProperty>) {

    if (property.type !== "array")
        throw Error(
            `You need to specify an 'of' or 'oneOf' prop (or specify a custom field) in your array property ${propertyKey}`
        )

    const authController = useAuthController();
    const customizationController = useCustomizationController();

    if (property?.type !== "array")
        throw Error("Picked wrong preview component ArrayPreview");

    if (!property?.oneOf) {
        throw Error(`You need to specify an 'of' or 'oneOf' prop (or specify a custom field) in your array property ${propertyKey}`);
    }

    const values = value as Record<string, unknown>[];

    if (!values) return null;

    // As in {@link ArrayPropertyPreview}: blocks stacked vertically, so a
    // single line can only report the count.
    if (compact) {
        return <span className={"text-sm truncate"}>
            {values.length === 1 ? "1 block" : `${values.length} blocks`}
        </span>;
    }

    const childSize: PreviewSize = size === "medium" ? "medium" : "small";

    const typeField = property.oneOf.typeField ?? DEFAULT_ONE_OF_TYPE;
    const valueField = property.oneOf.valueField ?? DEFAULT_ONE_OF_VALUE;
    const properties = property.oneOf.properties;

    return (
        <div className={"flex flex-col"}>
            {values &&
                values.map((val, index: number) => {
                    const resolvedProperty = properties[val?.[typeField] as string];
                    if (!val || !resolvedProperty) return null;
                    return (
                        <React.Fragment
                            key={"preview_array_" + index}>
                            <div className={cls(defaultBorderMixin, "m-1 border-b last:border-b-0 py-2")}>
                                <ErrorBoundary>
                                    <PropertyPreview
                                        propertyKey={propertyKey}
                                        value={val[valueField]}
                                        // entity={entity}
                                        property={resolvedProperty as Property}
                                        size={childSize}/>
                                </ErrorBoundary>
                            </div>
                        </React.Fragment>
                    );
                })}
        </div>
    );
}
