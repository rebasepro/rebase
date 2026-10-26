import type { FieldProps } from "../../types/fields";
import type { Property } from "@rebasepro/types";
import React from "react";

import { PropertyPreview } from "../../preview";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { cls, ErrorBoundary, InputLabel } from "@rebasepro/ui";
import { getIconForProperty } from "../../util/property_utils";
import { readOnlyLabelsInside } from "../label_placement";

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

    // A one-line value at the form's size is drawn like the one-line fields
    // around it: the same 64px box, the label shrunk into its top edge. It keeps
    // the outline and drops the fill — that is what says it cannot be edited.
    if (!minimalistView && !hideLabel && size === "large" && readOnlyLabelsInside(property)) {
        return (
            <>
                <div className={"relative w-full min-h-[66px] rounded-lg border border-hairline-strong px-3 pt-8 pb-2 text-base"}>
                    {/* `left-0` is the box's padding edge, where a text field's
                        label starts; left to its static position it would
                        start after the `px-3`, 12px too far in. */}
                    <InputLabel shrink
                        className={"pointer-events-none absolute top-1 left-0 text-text-secondary dark:text-text-secondary-dark"}>
                        <LabelWithIcon
                            icon={getIconForProperty(property, "small")}
                            required={property.validation?.required}
                            title={property.name ?? propertyKey}/>
                    </InputLabel>
                    <div className={"min-h-6 flex items-center overflow-x-auto no-scrollbar opacity-80"}>
                        <ErrorBoundary>
                            <PropertyPreview propertyKey={propertyKey}
                                value={value}
                                property={property}
                                hideLabel
                                size={"medium"}/>
                        </ErrorBoundary>
                    </div>
                </div>

                <FieldHelperText includeDescription={includeDescription}
                    showError={showError}
                    error={error}
                    property={property}/>
            </>
        );
    }

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
