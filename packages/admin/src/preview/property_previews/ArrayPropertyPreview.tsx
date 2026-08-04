import type { ArrayProperty, Property } from "@rebasepro/types";
import React from "react";

import type { PropertyPreviewProps, PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useAuthController, useCustomizationController } from "@rebasepro/app";
import { PropertyPreview } from "../PropertyPreview";
import { cls, defaultBorderMixin } from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { resolveArrayProperties } from "@rebasepro/common";

/**
 * @group Preview components
 */
export function ArrayPropertyPreview({
    propertyKey,
    value,
    property: property,
    size,
    compact
}: PropertyPreviewProps<ArrayProperty>) {

    if (property.type !== "array")
        throw Error("Picked wrong preview component ArrayPreview");

    if (!property.of) {
        throw Error(`You need to specify an 'of' prop (or specify a custom field) in your array property ${propertyKey}`);
    }

    const authController = useAuthController();
    const customizationController = useCustomizationController();
    const resolvedProperties = resolveArrayProperties({
        propertyKey,
        property: property as ArrayProperty,
        propertyConfigs: customizationController.propertyConfigs,
        authController
    });

    const values = value as unknown[];

    if (!values) return null;

    // Each entry is a block of its own — a bordered row, sometimes a whole
    // sub-table. Stating how many there are is the only honest one-liner.
    if (compact) {
        return <span className={"text-sm truncate"}>
            {values.length === 1 ? "1 item" : `${values.length} items`}
        </span>;
    }

    const childSize: PreviewSize = size === "medium" ? "medium" : "small";

    return (
        <div className="w-full flex flex-col gap-2">
            {values &&
                values.map((val, index: number) => {
                    if (!resolvedProperties) {
                        throw Error("Property resolvedProperties is undefined");
                    }
                    const of: Property = resolvedProperties[index] ??
                        (resolvedProperties[index] ?? (Array.isArray(property.of) ? property.of[index] : property.of));
                    return of
                        ? <React.Fragment
                            key={"preview_array_" + index}>
                            <div className={cls(defaultBorderMixin, "m-1 border-b last:border-b-0")}>
                                <ErrorBoundary>
                                    <PropertyPreview
                                        propertyKey={propertyKey}
                                        value={val}
                                        property={of}
                                        size={childSize}/>
                                </ErrorBoundary>
                            </div>
                        </React.Fragment>
                        : null;
                }
                )}
        </div>
    );
}
