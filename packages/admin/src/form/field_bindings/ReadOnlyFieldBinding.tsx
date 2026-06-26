import type { FieldProps } from "../../types/fields";
import type { Property } from "@rebasepro/types";
import React from "react";

;

import { PropertyPreview } from "../../preview";
import { FieldHelperText, LabelWithIconAndTooltip } from "../components";
import { ErrorBoundary } from "@rebasepro/ui";
import { getIconForProperty } from "../../util/property_utils";
import { cls } from "@rebasepro/ui";

/**
 *
 * Simply render the non-editable preview of a field
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function ReadOnlyFieldBinding({
    propertyKey,
    value,
    error,
    showError,
    minimalistView,
    property,
    includeDescription,
    context
}: FieldProps<Property>) {

    // if (!context.entityId)
    //     throw new Error("ReadOnlyFieldBinding: Entity id is null");

    const skipCardWrapper = property.type === "relation" || property.type === "reference";

    return (

        <>

            {!minimalistView && <LabelWithIconAndTooltip
                propertyKey={propertyKey}
                icon={getIconForProperty(property, "small")}
                required={property.validation?.required}
                title={property.name ?? propertyKey}
                className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5"}/>
            }

            <div
                className={cls(
                    "w-full overflow-x-scroll no-scrollbar flex items-center",
                    skipCardWrapper
                        ? ""
                        : "rounded-lg border border-surface-200 dark:border-surface-700 px-4 md:px-6 min-h-10 opacity-80"
                )}>

                <ErrorBoundary>
                    <PropertyPreview propertyKey={propertyKey}
                        value={value}
                        property={property}
                        size={"medium"}/>
                </ErrorBoundary>

            </div>

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                property={property}/>

        </>
    );
}
