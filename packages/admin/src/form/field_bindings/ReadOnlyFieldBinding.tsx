import type { FieldProps } from "../../types/fields";
import type { Property } from "@rebasepro/types";
import React from "react";

;

import { PropertyPreview } from "../../preview";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
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
    hideLabel,
    context
}: FieldProps<Property>) {

    // if (!context.entityId)
    //     throw new Error("ReadOnlyFieldBinding: Entity id is null");

    const skipCardWrapper = property.type === "relation" || property.type === "reference";

    return (

        <>

            {!minimalistView && !hideLabel && <LabelWithIconAndTooltip
                propertyKey={propertyKey}
                icon={getIconForProperty(property, "small")}
                required={property.validation?.required}
                title={property.name ?? propertyKey}
                className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3"}/>
            }

            <div
                className={cls(
                    "w-full overflow-x-scroll no-scrollbar flex items-center",
                    skipCardWrapper
                        ? ""
                        // `min-h-12` is `TextField`'s own `large` height, which is
                        // what every editable field in the form is. At 40px a
                        // read-only field sat 8px short of the input beside it,
                        // so a row holding one of each had its two boxes'
                        // baselines and bottom edges disagree — the field looked
                        // misaligned rather than uneditable.
                        // `px-3` is what `TextField` gives its input, so a
                        // read-only value starts on the same vertical line as
                        // the text beside it. It was `px-4 md:px-6`, which in a
                        // one-column span spent a sixth of the box on empty
                        // margin and pushed short values towards the middle.
                        : "rounded-lg border border-surface-200 dark:border-surface-700 px-3 min-h-12 opacity-80"
                )}>

                <ErrorBoundary>
                    {/* The field is labelled either just above by this
                        component, or by the `FieldBlock` that asked for
                        `hideLabel` — never by the preview. `BooleanPreview`
                        prints the property name beside its checkbox, so a
                        read-only boolean read as "Procesado por LLM" over a
                        checkbox saying "Procesado por LLM", wrapped over two
                        lines in a one-column span. */}
                    <PropertyPreview propertyKey={propertyKey}
                        value={value}
                        property={property}
                        hideLabel={hideLabel || !minimalistView}
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
