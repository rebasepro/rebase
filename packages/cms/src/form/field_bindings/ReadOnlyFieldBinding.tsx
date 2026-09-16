import type { FieldProps } from "../../types/fields";
import type { Property } from "@rebasepro/types";
import React from "react";

;

import { PropertyPreview } from "../../preview";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
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
    context,
    size = "large"
}: FieldProps<Property>) {

    // if (!context.entityId)
    //     throw new Error("ReadOnlyFieldBinding: Entity id is null");

    const skipCardWrapper = property.type === "relation" || property.type === "reference";

    return (

        <>

            {!minimalistView && !hideLabel && <LabelWithIcon
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
                        // `px-3` is what `TextField` gives its input, so a
                        // read-only value starts on the same vertical line as
                        // the text beside it. It was `px-4 md:px-6`, which in a
                        // one-column span spent a sixth of the box on empty
                        // margin and pushed short values towards the middle.
                        : cls("rounded-lg border border-hairline-strong px-3 text-sm opacity-80", {
                            // The height an editable field of the form's `size`
                            // renders at — the kit's control height plus its 1px
                            // hairline on each side — so a row holding one of
                            // each has its baselines and bottom edges agree. This
                            // was a fixed `min-h-12` (48px) with the page's 16px
                            // text: 2px short of a `large` text field, 14px taller
                            // than a `small` one, and a size above every input's
                            // `text-sm` at either.
                            "min-h-[34px]": size === "small",
                            "min-h-[42px]": size === "medium",
                            "min-h-[50px]": size === "large"
                        })
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
